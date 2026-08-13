// ============================================================
// شاطر — القاعدة المحلية (نسخة احتياطية على جهازك)
// برنامج صغير بلا أي تثبيت: يستخدم SQLite المدمج في Node.
// يفتح صفحة بحث محلية على http://localhost:3456
// لوحة التحكم ترسل إليه البيانات عبر POST /api/sync
// ============================================================
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3456;
const DB_PATH = path.join(__dirname, 'شاطر.db');
const HTML_PATH = path.join(__dirname, 'search.html');

let db = null;

function initDb() {
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, role TEXT, data TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, data TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS recharge_requests (
      id TEXT PRIMARY KEY, phone TEXT, userId TEXT, data TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY, data TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS delivery_requests (
      id TEXT PRIMARY KEY, data TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT, doc_id TEXT, field TEXT, mime TEXT, data BLOB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_photo ON photos(collection, doc_id, field);
  `);
}

function setMeta(k, v) {
  db.prepare(
    'INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v'
  ).run(k, String(v));
}

function getMeta(k) {
  const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k);
  return r ? r.v : null;
}

function countRows(table) {
  const r = db.prepare('SELECT COUNT(*) AS c FROM ' + table).get();
  return r ? Number(r.c) : 0;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function sendHtml(res, html) {
  cors(res);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendPhoto(res, row) {
  cors(res);
  if (!row) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('الصورة غير موجودة في القاعدة المحلية');
    return;
  }
  const mime = row.mime || 'image/jpeg';
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=86400'
  });
  res.end(Buffer.from(row.data));
}

function readBody(req, limitMb) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const max = (limitMb || 200) * 1024 * 1024;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('البيانات كبيرة جداً')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function upsertCollection(name, rows, now) {
  const statements = {
    drivers: db.prepare(
      'INSERT INTO drivers(id,name,phone,role,data,synced_at) VALUES(?,?,?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, role=excluded.role, data=excluded.data, synced_at=excluded.synced_at'
    ),
    customers: db.prepare(
      'INSERT INTO customers(id,name,phone,data,synced_at) VALUES(?,?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, data=excluded.data, synced_at=excluded.synced_at'
    ),
    recharge_requests: db.prepare(
      'INSERT INTO recharge_requests(id,phone,userId,data,synced_at) VALUES(?,?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET phone=excluded.phone, userId=excluded.userId, data=excluded.data, synced_at=excluded.synced_at'
    ),
    rides: db.prepare(
      'INSERT INTO rides(id,data,synced_at) VALUES(?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET data=excluded.data, synced_at=excluded.synced_at'
    ),
    delivery_requests: db.prepare(
      'INSERT INTO delivery_requests(id,data,synced_at) VALUES(?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET data=excluded.data, synced_at=excluded.synced_at'
    )
  };
  const stmt = statements[name];
  if (!stmt) return 0;
  let n = 0;
  for (const row of (rows || [])) {
    const id = String(row && row.id || '');
    if (!id) continue;
    const data = JSON.stringify(row);
    if (name === 'drivers') {
      stmt.run(id, String(row.name || ''), String(row.phone || ''), String(row.role || ''), data, now);
    } else if (name === 'customers') {
      stmt.run(id, String(row.name || ''), String(row.phone || ''), data, now);
    } else if (name === 'recharge_requests') {
      stmt.run(id, String(row.phone || ''), String(row.userId || ''), data, now);
    } else {
      stmt.run(id, data, now);
    }
    n++;
  }
  return n;
}

function upsertPhotos(photos) {
  const stmt = db.prepare(
    'INSERT INTO photos(collection,doc_id,field,mime,data) VALUES(?,?,?,?,?) ' +
    'ON CONFLICT(collection,doc_id,field) DO UPDATE SET mime=excluded.mime, data=excluded.data'
  );
  let n = 0;
  for (const p of (photos || [])) {
    if (!p || !p.collection || !p.docId || !p.field || !p.base64) continue;
    let buf = null;
    try { buf = Buffer.from(p.base64, 'base64'); } catch (e) { buf = null; }
    if (!buf || !buf.length) continue;
    stmt.run(String(p.collection), String(p.docId), String(p.field), String(p.mime || 'image/jpeg'), buf);
    n++;
  }
  return n;
}

function searchRows(table, col, q) {
  const like = '%' + String(q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  if (table === 'drivers') {
    return db.prepare(
      "SELECT id, name, phone, role FROM drivers WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' LIMIT 50"
    ).all(like, like, like);
  }
  if (table === 'customers') {
    return db.prepare(
      "SELECT id, name, phone FROM customers WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' LIMIT 50"
    ).all(like, like, like);
  }
  if (table === 'recharge_requests') {
    return db.prepare(
      "SELECT id, phone, userId FROM recharge_requests WHERE phone LIKE ? ESCAPE '\\' OR userId LIKE ? ESCAPE '\\' LIMIT 50"
    ).all(like, like, like);
  }
  return [];
}

function photoExists(collection, docId) {
  const r = db.prepare(
    'SELECT COUNT(*) AS c FROM photos WHERE collection=? AND doc_id=?'
  ).get(collection, String(docId));
  return r ? Number(r.c) > 0 : false;
}

function collectPhotos(colName, rows) {
  const out = [];
  for (const r of (rows || [])) {
    if (photoExists(colName, r.id)) {
      const q = db.prepare(
        'SELECT field FROM photos WHERE collection=? AND doc_id=? ORDER BY id'
      ).all(colName, String(r.id));
      const fields = q.map((x) => x.field);
      out.push({ id: r.id, fields: fields });
    }
  }
  return out;
}

function buildServer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost:' + PORT);
    const p = u.pathname;

    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // الصفحة الرئيسية: البحث المحلي
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        const html = fs.existsSync(HTML_PATH) ? fs.readFileSync(HTML_PATH, 'utf8') : '<h1>missing search.html</h1>';
        sendHtml(res, html);
        return;
      }

      // حالة القاعدة
      if (req.method === 'GET' && p === '/api/stats') {
        sendJson(res, 200, {
          ok: true,
          db: path.basename(DB_PATH),
          counts: {
            drivers: countRows('drivers'),
            customers: countRows('customers'),
            recharge_requests: countRows('recharge_requests'),
            rides: countRows('rides'),
            delivery_requests: countRows('delivery_requests')
          },
          photos: countRows('photos'),
          lastSync: getMeta('last_sync') || null
        });
        return;
      }

      // المزامنة من لوحة التحكم
      if (req.method === 'POST' && p === '/api/sync') {
        const body = await readBody(req, 300);
        const payload = JSON.parse(body);
        const collections = payload.collections || {};
        const photos = payload.photos || [];
        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          const counts = {};
          for (const key of ['drivers', 'customers', 'recharge_requests', 'rides', 'delivery_requests']) {
            counts[key] = upsertCollection(key, collections[key], now);
          }
          const photoCount = upsertPhotos(photos);
          setMeta('last_sync', now);
          db.exec('COMMIT');
          sendJson(res, 200, { ok: true, counts: counts, photos: photoCount, at: now });
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch (e2) {}
          throw e;
        }
        return;
      }

      // البحث
      if (req.method === 'GET' && p === '/api/search') {
        const q = String(u.searchParams.get('q') || '').trim();
        const col = String(u.searchParams.get('col') || 'drivers');
        if (!q) { sendJson(res, 200, { rows: [], photos: [] }); return; }
        const rows = searchRows(col, col, q);
        const photoMap = collectPhotos(col, rows);
        const photos = rows.map((r) => {
          const ph = photoMap.find((x) => x.id === r.id);
          return { id: r.id, fields: ph ? ph.fields : [] };
        });
        sendJson(res, 200, { rows: rows, photos: photos });
        return;
      }

      // تفاصيل سجل
      if (req.method === 'GET' && p === '/api/detail') {
        const col = String(u.searchParams.get('col') || 'drivers');
        const id = String(u.searchParams.get('id') || '');
        const row = db.prepare('SELECT data FROM ' + col + ' WHERE id=?').get(id);
        let record = null;
        try { record = row ? JSON.parse(row.data) : null; } catch (e) { record = null; }
        const ph = db.prepare('SELECT field, mime FROM photos WHERE collection=? AND doc_id=? ORDER BY id').all(col, id);
        const photos = ph.map((x) => ({
          field: x.field,
          url: '/api/photo?col=' + encodeURIComponent(col) + '&doc=' + encodeURIComponent(id) + '&field=' + encodeURIComponent(x.field)
        }));
        sendJson(res, 200, { record: record, photos: photos });
        return;
      }

      // صورة
      if (req.method === 'GET' && p === '/api/photo') {
        const col = String(u.searchParams.get('col') || '');
        const doc = String(u.searchParams.get('doc') || '');
        const field = String(u.searchParams.get('field') || '');
        const row = db.prepare(
          'SELECT mime, data FROM photos WHERE collection=? AND doc_id=? AND field=?'
        ).get(col, doc, field);
        sendPhoto(res, row);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'غير موجود' });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
  });
}

// بدء التشغيل
initDb();
const server = buildServer();
server.listen(PORT, '127.0.0.1', () => {
  const line = '==============================';
  console.log(line);
  console.log('  شاطر — القاعدة المحلية تعمل');
  console.log('  افتح صفحة البحث: http://localhost:' + PORT);
  console.log('  ملف القاعدة: ' + path.basename(DB_PATH));
  console.log(line);
  // فتح المتصفح تلقائياً
  if (process.platform === 'win32') {
    try { require('node:child_process').exec('start http://localhost:' + PORT); } catch (e) {}
  }
});
