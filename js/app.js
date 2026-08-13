// ============================================
// SHATER ADMIN DASHBOARD - app.js (Bootstrap 5)
// Two-click map: pickup + dropoff, auto-fare
// ============================================

let db = null;
let firebaseReady = false;
let commissionPercent = 10;

// ============================================
// CUSTOMER PRODUCTS (realtime cache)
// ============================================
let allCustomerProducts = [];
let customerProductsListener = null;

// ============================================
// AUTH CHECK
// ============================================
if (sessionStorage.getItem('SHATER_admin_logged_in') !== 'true') {
    window.location.href = 'index.html';
}

// Also verify with Firebase Auth if available
try {
    firebase.auth().onAuthStateChanged(function(user) {
        if (!user && sessionStorage.getItem('SHATER_admin_logged_in') === 'true') {
            // Firebase session expired but local session exists — keep it for now
            console.warn('Firebase auth expired, using local session');
        }
    });
} catch (e) {}

document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('SHATER_admin_logged_in');
    sessionStorage.removeItem('SHATER_admin_name');
    sessionStorage.removeItem('SHATER_admin_role');
    sessionStorage.removeItem('SHATER_admin_perms');
    sessionStorage.removeItem('SHATER_admin_username');
    try { firebase.auth().signOut(); } catch (e) {}
    window.location.href = 'index.html';
});

// ============================================
// FIREBASE INIT
// ============================================
const firebaseConfig = {
    apiKey: "AIzaSyDsO_-6QFQKgIMF7VROzZYK22kyKyjQ_ZM",
    authDomain: "shater-cars.firebaseapp.com",
    projectId: "shater-cars",
    storageBucket: "shater-cars.firebasestorage.app",
    messagingSenderId: "891304990952",
    appId: "1:891304990952:web:6b356e9da561b57fc7915d"
};

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
} catch (e) {
    console.error("Firebase init failed:", e);
}
firebaseReady = true;

function requireDb(caller) {
    if (!firebaseReady || !db) {
        if (caller) showStatus(caller, 'خطأ: Firebase غير مُعد.', 'error');
        return false;
    }
    return true;
}

// ============================================
// PERMISSIONS (صلاحيات المهام للمشرفين)
// ============================================
const PERMISSION_KEYS = {
    map: 'الخريطة المباشرة',
    reports: 'التقارير والإحصائيات',
    drivers: 'إدارة السائقين (عرض)',
    drivers_add: 'تسجيل سائق جديد',
    drivers_edit: 'تعديل بيانات السائقين',
    drivers_delete: 'حذف سائق',
    drivers_service: 'التحكم بالخدمة عن بُعد',
    drivers_credit: 'تعديل رصيد السائق',
    customers: 'إدارة الزبائن (عرض)',
    customers_add: 'تسجيل زبون جديد',
    customers_edit: 'تعديل بيانات الزبائن',
    customers_delete: 'حذف زبون',
    customers_credit: 'تعديل رصيد الزبون',
    recharge_approve: 'الموافقة على طلبات الاشتراك',
    deliveries: 'طلبات التوصيل',
    rides: 'سجل الرحلات',
    unregistered: 'الزبناء غير المسجلين',
    devices: 'الأجهزة',
    messages: 'الرسائل',
    announcements: 'إعلانات السائقين',
    customer_announcements: 'إعلانات الزبائن',
    promotions: 'العروض والنشاطات',
    products: 'المتجر والمنتجات',
    stores: 'المتاجر الذكية',
    ladies: 'متجر السيدات',
    settings: 'الإعدادات',
    admins: 'إدارة المشرفين'
};

const PAGE_PERM = {
    overview: null,
    map: 'map', reports: 'reports', drivers: 'drivers', customers: 'customers',
    'customer-subscriptions': 'recharge_approve',
    'driver-subscriptions': 'recharge_approve',
    'delivery-subscriptions': 'recharge_approve',
    'driver-registrations': 'drivers',
    'delivery-drivers': 'drivers',
    'unregistered-customers': 'unregistered', devices: 'devices', deliveries: 'deliveries',
    rides: 'rides', settings: 'settings', messages: 'messages', announcements: 'announcements',
    'customer-announcements': 'customer_announcements', admins: 'admins'
};

const ALL_PERMISSIONS = Object.keys(PERMISSION_KEYS);

// الصلاحية الفرعية تمنح صفحتها تلقائياً (مثال: customers_add تعطي صفحة الزبائن)
const PARENT_PAGE = {
    drivers_add: 'drivers', drivers_edit: 'drivers', drivers_delete: 'drivers',
    drivers_service: 'drivers', drivers_credit: 'drivers',
    customers_add: 'customers', customers_edit: 'customers', customers_delete: 'customers',
    customers_credit: 'customers', recharge_approve: 'customers'
};

const PAGE_ORDER = [
    'overview', 'map', 'customers', 'customer-subscriptions',
    'drivers', 'driver-registrations', 'driver-subscriptions',
    'delivery-drivers', 'deliveries', 'delivery-subscriptions',
    'rides', 'reports', 'messages', 'announcements',
    'customer-announcements', 'devices', 'unregistered-customers',
    'settings', 'admins'
];

function adminRole() {
    return sessionStorage.getItem('SHATER_admin_role') || 'admin';
}

function adminPermissions() {
    if (adminRole() === 'admin') return ALL_PERMISSIONS.slice();
    let p = [];
    try { p = JSON.parse(sessionStorage.getItem('SHATER_admin_perms') || '[]'); } catch (e) { p = []; }
    if (!Array.isArray(p) || p.length === 0) return ALL_PERMISSIONS.slice();
    return p;
}

function effectivePermissions() {
    const base = adminPermissions();
    const out = new Set(base);
    base.forEach(p => { if (PARENT_PAGE[p]) out.add(PARENT_PAGE[p]); });
    return Array.from(out);
}

function canPerm(perm) {
    return effectivePermissions().indexOf(perm) !== -1;
}

function firstAllowedPage() {
    for (const p of PAGE_ORDER) {
        if (!PAGE_PERM[p] || canPerm(PAGE_PERM[p])) return p;
    }
    return null;
}

function goToDefaultPage() {
    const p = firstAllowedPage();
    if (p) { navigateToPage(p); return; }
    document.querySelectorAll('.sidebar-link').forEach(n => n.classList.remove('active'));
    ARAalert('لا توجد أي صفحة متاحة لك حالياً. راجع مدير النظام.', 'warning');
}

function guardPerm(perm, msg) {
    if (canPerm(perm)) return true;
    ARAalert(msg || 'ليست لديك صلاحية لتنفيذ هذا الإجراء', 'warning');
    return false;
}

function buildPermCheckboxes(containerId, selectedArr) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = ALL_PERMISSIONS.map(k => {
        const checked = (selectedArr || []).indexOf(k) !== -1 ? ' checked' : '';
        return `<div class="col-md-4 col-6">
            <div class="form-check">
                <input class="form-check-input perm-cb" type="checkbox" value="${k}" id="${containerId}_${k}"${checked}>
                <label class="form-check-label small" for="${containerId}_${k}">${PERMISSION_KEYS[k]}</label>
            </div>
        </div>`;
    }).join('');
}

function collectPerms(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.perm-cb:checked')).map(cb => cb.value);
}

function togglePermsPanel(role, wrapId, containerId, selectedArr) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    if (role === 'admin') {
        wrap.style.display = 'none';
    } else {
        wrap.style.display = '';
        buildPermCheckboxes(containerId, selectedArr || []);
    }
}

// ============================================
// CUSTOM MODAL (replace alert/confirm)
// ============================================
function ARAalert(message, type) {
    return new Promise(function (resolve) {
        var overlay = document.getElementById('shtModalOverlay');
        if (!overlay) { console.log(message); resolve(); return; }
        var icon = document.getElementById('shtModalIcon');
        var title = document.getElementById('shtModalTitle');
        var msg = document.getElementById('shtModalMessage');
        var btns = document.getElementById('shtModalButtons');
        var types = { info: ['info', 'bi-info-circle'], warning: ['warning', 'bi-exclamation-triangle'], error: ['error', 'bi-x-circle'], success: ['success', 'bi-check-circle'] };
        var t = types[type] || types.info;
        icon.className = 'sht-modal-icon ' + t[0];
        icon.innerHTML = '<i class="bi ' + t[1] + '"></i>';
        title.textContent = type === 'error' ? 'خطأ' : type === 'success' ? 'تم بنجاح' : type === 'warning' ? 'تنبيه' : 'معلومات';
        msg.textContent = message;
        btns.innerHTML = '<button class="btn btn-ok" id="shtModalOk">حسناً</button>';
        overlay.classList.add('show');
        document.getElementById('shtModalOk').onclick = function () { overlay.classList.remove('show'); resolve(); };
        overlay.onclick = function (e) { if (e.target === overlay) { overlay.classList.remove('show'); resolve(); } };
    });
}

function ARAconfirm(message) {
    return new Promise(function (resolve) {
        var overlay = document.getElementById('shtModalOverlay');
        if (!overlay) { console.error('ARAconfirm: لم يتم العثور على النافذة المخصصة'); resolve(false); return; }
        var icon = document.getElementById('shtModalIcon');
        var title = document.getElementById('shtModalTitle');
        var msg = document.getElementById('shtModalMessage');
        var btns = document.getElementById('shtModalButtons');
        icon.className = 'sht-modal-icon question';
        icon.innerHTML = '<i class="bi bi-question-circle"></i>';
        title.textContent = 'تأكيد';
        msg.textContent = message;
        btns.innerHTML = '<button class="btn btn-cancel" id="shtModalCancel">إلغاء</button><button class="btn btn-ok" id="shtModalConfirm">تأكيد</button>';
        overlay.classList.add('show');
        document.getElementById('shtModalConfirm').onclick = function () { overlay.classList.remove('show'); resolve(true); };
        document.getElementById('shtModalCancel').onclick = function () { overlay.classList.remove('show'); resolve(false); };
        overlay.onclick = function (e) { if (e.target === overlay) { overlay.classList.remove('show'); resolve(false); } };
    });
}

function ARAprompt(title, placeholder, initial) {
    return new Promise(function (resolve) {
        var overlay = document.getElementById('shtModalOverlay');
        var inputWrap = document.getElementById('shtModalInputWrap');
        var input = document.getElementById('shtModalInput');
        var icon = document.getElementById('shtModalIcon');
        var titleEl = document.getElementById('shtModalTitle');
        var msgEl = document.getElementById('shtModalMessage');
        var btns = document.getElementById('shtModalButtons');
        if (!overlay || !inputWrap || !input) { console.error('ARAprompt: لم يتم العثور على النافذة المخصصة'); resolve(null); return; }
        icon.className = 'sht-modal-icon warning';
        icon.innerHTML = '<i class="bi bi-chat-left-text"></i>';
        titleEl.textContent = title;
        msgEl.textContent = '';
        inputWrap.classList.remove('d-none');
        input.value = (initial !== undefined && initial !== null) ? String(initial) : '';
        input.placeholder = placeholder || '';
        btns.innerHTML = '<button class="btn btn-cancel" id="shtModalPromptCancel">إلغاء</button><button class="btn btn-ok" id="shtModalPromptOk">موافق</button>';
        overlay.classList.add('show');
        input.focus();
        function done(val) {
            overlay.classList.remove('show');
            inputWrap.classList.add('d-none');
            input.value = '';
            resolve(val);
        }
        document.getElementById('shtModalPromptOk').onclick = function () { done(input.value); };
        document.getElementById('shtModalPromptCancel').onclick = function () { done(null); };
        overlay.onclick = function (e) { if (e.target === overlay) { done(null); } };
        input.onkeydown = function (e) { if (e.key === 'Enter') { done(input.value); } };
    });
}

// ============================================
// IMAGE TO BASE64 HELPERS
// ============================================
function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
        var MAX_W = 640, MAX_H = 640, QUALITY = 0.3, SIZE_LIMIT = 100 * 1024;
        if (file.size <= SIZE_LIMIT) {
            var reader = new FileReader();
            reader.onload = function (e) { resolve(e.target.result); };
            reader.onerror = function () { reject(new Error('فشل قراءة الملف')); };
            reader.readAsDataURL(file);
            return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            var w = img.width, h = img.height;
            if (w > MAX_W || h > MAX_H) {
                var ratio = Math.min(MAX_W / w, MAX_H / h);
                w = Math.round(w * ratio); h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(function (blob) {
                URL.revokeObjectURL(url);
                if (blob) {
                    var r = new FileReader();
                    r.onload = function (e) { resolve(e.target.result); };
                    r.readAsDataURL(blob);
                } else {
                    var r = new FileReader();
                    r.onload = function (e) { resolve(e.target.result); };
                    r.readAsDataURL(file);
                }
            }, 'image/jpeg', QUALITY);
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            var reader = new FileReader();
            reader.onload = function (e) { resolve(e.target.result); };
            reader.readAsDataURL(file);
        };
        img.src = url;
    });
}

function filesToBase64(files, maxCount) {
    maxCount = maxCount || 10;
    var results = [];
    var chain = Promise.resolve();
    var count = Math.min(files.length, maxCount);
    for (var i = 0; i < count; i++) {
        (function (file, idx) {
            chain = chain.then(function () {
                console.log('Converting image ' + (idx + 1) + '/' + count + ' name=' + file.name + ' size=' + file.size);
                return fileToBase64(file).then(function (b64) {
                    results.push(b64);
                    var kb = (b64.length / 1024).toFixed(0);
                    console.log('Image ' + (idx + 1) + ' OK: ' + kb + 'KB');
                }).catch(function (e) {
                    console.warn('Image ' + (idx + 1) + ' failed:', e ? e.message : 'unknown error');
                });
            });
        })(files[i], i);
    }
    return chain.then(function () { return results; });
}

function showToast(message, type) {
    var container = document.getElementById('toastContainer');
    if (!container) { console.log(message); return; }
    var toast = document.createElement('div');
    toast.className = 'toast align-items-center text-white bg-' + (type || 'info') + ' border-0';
    toast.role = 'alert';
    toast.innerHTML = '<div class="d-flex"><div class="toast-body">' + message + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    container.appendChild(toast);
    var bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    setTimeout(function () { toast.remove(); }, 5000);
}

// ============================================
// STATE
// ============================================
let map = null;
let driversMap = {};
let customersMap = {};
let allDrivers = [];
let allCustomers = [];
let allRides = [];
let ridesListUnsubscribe = null;
let deliveriesUnsubscribe = null;
let customerSubsUnsubscribe = null;
let driverSubsUnsubscribe = null;
let deliverySubsUnsubscribe = null;
let driversInfoCache = {};
let currentPage = 'map';

// ============================================
// PRICING CONFIG  (قابل للضبط من صفحة الإعدادات — مطابق لخوارزمية التطبيق)
// الأسعار الافتراضية مخصومة ~3% لتنافس ClassRide ومقرّبة لأقرب 5 أوقية.
// التخزين: settings/app_config → pricing  (تُحمَّل في loadPricingConfig)
// سيارة: 1كم=70، 3كم=95، 5كم=125، 8كم=165، 12كم=225، 20كم=310، 30كم=435، +19/كم
// توصيل: 1كم=85، 3كم=105، 5كم=125، 8كم=155، 12كم=195، 20كم=245، سقف 250
// الليل (00:00–05:00): سيارة ×1.5، توصيل ×1.3
// المؤقت (مفتوح): بدء 75 + 10/كم + 15 لكل 5 دقائق
// ============================================
function defaultPricing() {
    return {
        car: { maxKm: [1, 3, 5, 8, 12, 20, 30], prices: [70, 95, 125, 165, 225, 310, 435], perExtraKm: 19 },
        delivery: { maxKm: [1, 3, 5, 8, 12, 20], prices: [85, 105, 125, 155, 195, 245], perExtraKm: 20, max: 250 },
        night: { startHour: 0, endHour: 5, carMultiplier: 1.5, deliveryMultiplier: 1.3 },
        open: { start: 75, perHour: 400 }
    };
}
let pricingCfg = defaultPricing();

function deepMerge(base, over) {
    if (typeof over !== 'object' || over === null) return over === undefined ? base : over;
    if (Array.isArray(over)) return over;
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
}

async function loadPricingConfig() {
    if (!db) return;
    try {
        const doc = await db.collection('settings').doc('app_config').get();
        const p = doc.exists ? doc.data().pricing : null;
        if (p && typeof p === 'object') pricingCfg = deepMerge(pricingCfg, p);
        fillPricingSettingsForm();
    } catch (e) { console.log('Pricing config load error'); }
}

function bandPrice(km, maxKm, prices, perKm) {
    for (let i = 0; i < maxKm.length; i++) if (km <= maxKm[i]) return prices[i];
    const last = maxKm.length - 1;
    return prices[last] + (km - maxKm[last]) * perKm;
}

function isNightTime() {
    const h = new Date().getHours();
    return h >= pricingCfg.night.startHour && h < pricingCfg.night.endHour;
}

function applyNight(amount) {
    return isNightTime() ? Math.round(amount * pricingCfg.night.carMultiplier) : amount;
}

function calculateFare(distanceKm) {
    if (!distanceKm || distanceKm <= 0) return applyNight(pricingCfg.car.prices[0]);
    return applyNight(Math.round(bandPrice(distanceKm, pricingCfg.car.maxKm, pricingCfg.car.prices, pricingCfg.car.perExtraKm)));
}

function roundFare5(n) { return Math.round(n / 5) * 5; }

// ============================================
// PRICING SETTINGS (إعدادات التسعير من صفحة الإعدادات)
// ============================================
function fillPricingSettingsForm() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const c = pricingCfg;
    c.car.maxKm.forEach((v, i) => set('carMaxKm' + (i + 1), v));
    c.car.prices.forEach((v, i) => set('carPrice' + (i + 1), v));
    set('carPerExtraKm', c.car.perExtraKm);
    c.delivery.maxKm.forEach((v, i) => set('delMaxKm' + (i + 1), v));
    c.delivery.prices.forEach((v, i) => set('delPrice' + (i + 1), v));
    set('delPerExtraKm', c.delivery.perExtraKm);
    set('delMax', c.delivery.max);
    set('nightStart', c.night.startHour);
    set('nightEnd', c.night.endHour);
    set('carMult', c.night.carMultiplier);
    set('delMult', c.night.deliveryMultiplier);
    set('openStart', c.open.start);
    set('openPerHour', c.open.perHour);
}

window.savePricingConfig = async function () {
    if (!requireDb()) return;
    const num = (id, d) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? d : v; };
    const carMax = [1, 3, 5, 8, 12, 20, 30];
    const carPr = [70, 95, 125, 165, 225, 310, 435];
    const delMax = [1, 3, 5, 8, 12, 20];
    const delPr = [85, 105, 125, 155, 195, 245];
    const cfg = {
        pricing: {
            car: {
                maxKm: carMax.map((_, i) => num('carMaxKm' + (i + 1), carMax[i])),
                prices: carPr.map((_, i) => num('carPrice' + (i + 1), carPr[i])),
                perExtraKm: num('carPerExtraKm', 19)
            },
            delivery: {
                maxKm: delMax.map((_, i) => num('delMaxKm' + (i + 1), delMax[i])),
                prices: delPr.map((_, i) => num('delPrice' + (i + 1), delPr[i])),
                perExtraKm: num('delPerExtraKm', 20),
                max: num('delMax', 250)
            },
            night: {
                startHour: num('nightStart', 0),
                endHour: num('nightEnd', 5),
                carMultiplier: num('carMult', 1.5),
                deliveryMultiplier: num('delMult', 1.3)
            },
            open: {
                start: num('openStart', 75),
                perHour: num('openPerHour', 400)
            }
        }
    };
    try {
        await db.collection('settings').doc('app_config').set(cfg, { merge: true });
        pricingCfg = cfg.pricing;
        ARAalert('تم حفظ إعدادات التسعير بنجاح', 'success');
    } catch (e) {
        ARAalert('خطأ: ' + e.message, 'error');
    }
};

// استعادة الأسعار الافتراضية (الخصم ~3%) — كل شيء من اللوحة، لا مستندات ولا ملفات
window.resetPricingConfig = async function () {
    if (!requireDb()) return;
    if (!(await ARAconfirm('استعادة الأسعار الافتراضية (الخصم ~3%)؟ سيُحذف تخصيصك الحالي.'))) return;
    try {
        await db.collection('settings').doc('app_config').set(
            { pricing: firebase.firestore.FieldValue.delete() },
            { merge: true }
        );
        pricingCfg = defaultPricing();
        fillPricingSettingsForm();
        ARAalert('تمت استعادة الأسعار الافتراضية بنجاح', 'success');
    } catch (e) {
        ARAalert('خطأ: ' + e.message, 'error');
    }
};

// ============================================
// MAP INIT
// ============================================
function initMap() {
    map = L.map('map', { zoomControl: false }).setView([18.0735, -15.9582], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Street layers share a dedicated pane styled in high-contrast
    // black/white/dirt (see .leaflet-bwPane in style.css); the satellite
    // layer keeps the default (colorful) pane.
    map.createPane('bwPane').style.zIndex = 200;
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19, pane: 'bwPane'
    });
    const esriStreetsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri', maxZoom: 19, pane: 'bwPane'
    });
    const esriImageryLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery © Esri', maxZoom: 19
    });

    esriStreetsLayer.addTo(map);

    L.control.layers({
        'الشوارع (Esri)': esriStreetsLayer,
        'الخريطة العادية (OSM)': osmLayer,
        'الأقمار الصناعية (Esri)': esriImageryLayer
    }, null, { position: 'topright' }).addTo(map);

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
}

/* Local Nouakchott places dataset (from OpenStreetMap/Overpass, ~3500 places).
   Searched first because Nominatim coverage in Nouakchott is weak. */
let NOUAKCHOTT_PLACES = null;
function loadNouakchottPlaces() {
    if (NOUAKCHOTT_PLACES) return Promise.resolve(NOUAKCHOTT_PLACES);
    return fetch('js/nouakchott_places.json?v=20260812n')
        .then(r => r.json())
        .then(d => { NOUAKCHOTT_PLACES = d; return d; })
        .catch(() => { NOUAKCHOTT_PLACES = []; return NOUAKCHOTT_PLACES; });
}

/* Uploads the dataset to Firestore so the mobile app fetches it from the
   database (light APK, always up-to-date) instead of bundling it. Runs
   automatically from the dashboard when the local version is newer. */
const NOUAKCHOTT_PLACES_VERSION = 20260818;
async function syncNouakchottPlaces() {
    try {
        const places = await loadNouakchottPlaces();
        if (!places || !places.length) return;
        const ref = db.collection('settings').doc('nouakchott_places');
        const snap = await ref.get();
        const stored = snap.exists ? (snap.data().updatedAt || 0) : 0;
        if (NOUAKCHOTT_PLACES_VERSION > stored) {
            // Stored as a single JSON string: a Firestore array of 4400+ maps
            // would exceed the 1MiB document limit.
            await ref.set({ data: JSON.stringify(places), updatedAt: NOUAKCHOTT_PLACES_VERSION }, { merge: true });
            console.log('[places] uploaded ' + places.length + ' places to Firestore');
        }
    } catch (e) { console.error('[places] sync failed:', e); }
}

/* Arabic/Unicode normalization for fuzzy prefix search. */
function normAr(s) {
    return (s || '').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0671]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/[«»"'().,-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* Scores a place against the typed query: whole-name prefix strongly,
   then each typed token against the name and the category (so typing
   "بقالة" surfaces all groceries, and "بقالة عباد" ranks its stores). */
function scorePlace(p, tokens, normQuery) {
    const names = [p.n, p.a, p.f].filter(Boolean).map(normAr).join(' ');
    const cats = [p.c, p.cf, p.ce].filter(Boolean).map(normAr).join(' ');
    let score = 0;
    if (normQuery.length) {
        if (names.startsWith(normQuery)) score += 40;
        else if (names.includes(normQuery)) score += 25;
    }
    const nameWords = names.split(' ');
    for (const t of tokens) {
        if (!t.length) continue;
        if (nameWords.includes(t)) score += 20;
        if (names.startsWith(t)) score += 14;
        else if (names.includes(t)) score += 8;
        if (cats.startsWith(t)) score += 10;
        else if (cats.includes(t)) score += 6;
    }
    return score;
}

document.getElementById('darkModeBtn').addEventListener('click', () => {
    document.body.classList.toggle('map-dark');
    const icon = document.querySelector('#darkModeBtn i');
    if (icon) icon.className = document.body.classList.contains('map-dark') ? 'bi bi-brightness-high' : 'bi bi-moon-stars';
});

// ============================================
// STATS BAR COLLAPSE (طي مؤشرات اللوحة)
// ============================================
let statsCollapsed = localStorage.getItem('araStatsCollapsed') === '1';

function applyStatsCollapsed() {
    const body = document.getElementById('statsBody');
    const btn = document.getElementById('statsToggleBtn');
    const label = document.getElementById('statsToggleLabel');
    const icon = btn ? btn.querySelector('i') : null;
    document.body.classList.toggle('stats-collapsed', statsCollapsed);
    if (body) body.style.display = statsCollapsed ? 'none' : '';
    if (label) label.textContent = statsCollapsed ? 'إظهار المؤشرات' : 'طي المؤشرات';
    if (icon) icon.className = statsCollapsed ? 'bi bi-chevron-down' : 'bi bi-chevron-up';
    if (btn) btn.title = statsCollapsed ? 'إظهار مؤشرات اللوحة' : 'طي مؤشرات اللوحة';
    resizeMapForStats();
}

function resizeMapForStats() {
    const mapWrap = document.getElementById('mapWrapper');
    if (!mapWrap) return;
    const header = document.querySelector('.top-bar');
    const statsBar = document.getElementById('statsBar');
    let h = header ? header.offsetHeight : 0;
    if (statsBar) h += statsBar.offsetHeight;
    mapWrap.style.height = Math.max(window.innerHeight - h, 200) + 'px';
    if (typeof map !== 'undefined' && map) {
        setTimeout(() => map.invalidateSize(), 60);
    }
}

document.getElementById('statsToggleBtn')?.addEventListener('click', () => {
    statsCollapsed = !statsCollapsed;
    localStorage.setItem('araStatsCollapsed', statsCollapsed ? '1' : '0');
    applyStatsCollapsed();
});
applyStatsCollapsed();
window.addEventListener('resize', resizeMapForStats);

// ============================================
// SOUND NOTIFICATION
// ============================================
let audioCtx = null;

function playNotificationSound() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        [800, 1000, 1200, 1000, 800].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.15);
            osc.start(audioCtx.currentTime + i * 0.15);
            osc.stop(audioCtx.currentTime + i * 0.15 + 0.15);
        });
    } catch (e) {}
}

function requestAudioPermission() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        gain.gain.value = 0;
        osc.start(); osc.stop(audioCtx.currentTime + 0.01);
    } catch (e) {}
}
document.addEventListener('click', requestAudioPermission, { once: true });

// ============================================
// DESKTOP NOTIFICATIONS + BACKGROUND ALERT
// ============================================
let notifPermGranted = false;

function initDesktopNotifications() {
    if (!('Notification' in window)) { updateNotifPermButton(); return; }
    notifPermGranted = Notification.permission === 'granted';
    updateNotifPermButton();
}

async function requestDesktopNotifications() {
    if (!('Notification' in window)) {
        ARAalert('متصفحك لا يدعم إشعارات سطح المكتب', 'warning');
        return;
    }
    if (Notification.permission === 'denied') {
        ARAalert('تم رفض الإذن مسبقاً — افتح إعدادات الموقع واسمح بالإشعارات', 'warning');
        return;
    }
    const perm = await Notification.requestPermission();
    notifPermGranted = perm === 'granted';
    updateNotifPermButton();
    if (notifPermGranted) {
        showDesktopNotification('تم تفعيل التنبيهات', 'ستصلك تنبيهات فورية عند قدوم أي طلب جديد حتى أثناء وجود المتصفح في الخلفية');
        ARAalert('تم تفعيل إشعارات سطح المكتب بنجاح', 'success');
    } else {
        ARAalert('لم يتم منح إذن الإشعارات', 'warning');
    }
}

function updateNotifPermButton() {
    const btn = document.getElementById('enableDesktopNotifBtn');
    if (!btn) return;
    const supported = 'Notification' in window;
    const show = supported && !notifPermGranted && Notification.permission !== 'denied';
    btn.classList.toggle('d-none', !show);
}

function showDesktopNotification(title, body) {
    if (!notifPermGranted) return;
    try {
        const n = new Notification(title, {
            body: body,
            icon: 'img/logo.png',
            tag: 'shater-alert'
        });
        n.onclick = function () { window.focus(); n.close(); };
    } catch (e) {}
}

function flashTab(prefix) {
    const originalTitle = document.title;
    const alertTitle = (prefix ? prefix + ' ' : '') + originalTitle;
    let flashes = 0;
    const interval = setInterval(function () {
        document.title = (flashes++ % 2 === 0) ? alertTitle : originalTitle;
        if (flashes >= 10) { clearInterval(interval); document.title = originalTitle; }
    }, 600);
}

// ============================================
// CLOCK
// ============================================
function updateClock() {
    const now = new Date();
    const el = document.getElementById('currentTime');
    if (el) el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ============================================
// NAVIGATION
// ============================================
const pageTitles = {
    overview: 'نظرة عامة',
    map: 'تتبع مباشر للسائقين',
    drivers: 'سائقو السيارات',
    'driver-registrations': 'طلبات تسجيل السائقين',
    'driver-subscriptions': 'اشتراكات السائقين',
    'delivery-drivers': 'سائقو التوصيل',
    'delivery-subscriptions': 'اشتراكات التوصيل',
    customers: 'الزبائن',
    'customer-subscriptions': 'اشتراكات الزبائن',
    deliveries: 'التوصيلات',
    'unregistered-customers': 'الزبناء غير المسجلين',
    devices: 'الأجهزة',
    rides: 'سجل الرحلات',
    settings: 'الإعدادات',
    messages: 'الرسائل',
    reports: 'التقارير والإحصائيات',
    announcements: 'الإعلانات',
    'customer-announcements': 'إعلانات الزبائن',
    admins: 'إدارة المشرفين'
};

function navigateToPage(page) {
    if (PAGE_PERM[page] && !canPerm(PAGE_PERM[page])) {
        ARAalert('ليست لديك صلاحية للوصول إلى هذه الصفحة', 'warning');
        return;
    }
    document.querySelectorAll('.sidebar-link').forEach(n => n.classList.remove('active'));
    document.querySelectorAll(`.sidebar-link[data-page="${page}"]`).forEach(n => n.classList.add('active'));
    document.querySelectorAll('.page-content').forEach(p => p.classList.add('d-none'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.remove('d-none');
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = pageTitles[page] || '';
    const titleMobile = document.getElementById('pageTitleMobile');
    if (titleMobile) titleMobile.textContent = (pageTitles[page] || '').substring(0, 20);
    const liveBadge = document.getElementById('liveBadge');
    if (liveBadge) liveBadge.classList.toggle('d-none', page !== 'map');
    currentPage = page;
    if (page === 'deliveries') { unreadDeliveries = 0; updateNavBadges(); }
    if (page === 'rides') { unreadRides = 0; updateNavBadges(); }
    if (page === 'drivers') { unreadDriverEvents = 0; updateNavBadges(); }
    if (page === 'customer-subscriptions') { unreadCustomerSubs = 0; updateNavBadges(); }
    if (page === 'driver-subscriptions') { unreadDriverSubs = 0; updateNavBadges(); }
    if (page === 'delivery-subscriptions') { unreadDeliverySubs = 0; updateNavBadges(); }
    if (page === 'driver-registrations') { unreadDriverRegs = 0; updateNavBadges(); }
    if (page === 'delivery-drivers') { unreadDeliveryDrivers = 0; updateNavBadges(); }
    if (page !== 'rides' && ridesListUnsubscribe) { ridesListUnsubscribe(); ridesListUnsubscribe = null; }
    if (page !== 'deliveries' && deliveriesUnsubscribe) { deliveriesUnsubscribe(); deliveriesUnsubscribe = null; }
    if (page !== 'customer-subscriptions' && customerSubsUnsubscribe) { customerSubsUnsubscribe(); customerSubsUnsubscribe = null; }
    if (page !== 'driver-subscriptions' && driverSubsUnsubscribe) { driverSubsUnsubscribe(); driverSubsUnsubscribe = null; }
    if (page !== 'delivery-subscriptions' && deliverySubsUnsubscribe) { deliverySubsUnsubscribe(); deliverySubsUnsubscribe = null; }
    if (page === 'overview') loadOverview();
    if (page === 'drivers') loadDriversList();
    if (page === 'customers') loadCustomersList();
    if (page === 'devices') loadDevices();
    if (page === 'deliveries') initDeliveriesListener();
    if (page === 'unregistered-customers') loadUnregisteredCustomers();
    if (page === 'rides') loadRidesList();
    if (page === 'settings') { loadCommission(); loadPricingConfig(); }
    if (page === 'admins') loadAdminsList();
    if (page === 'messages') { loadMsgRecipients(); loadSentMessages(); loadSentCustomerMessages(); }
    if (page === 'announcements') loadAnnouncements();
    if (page === 'customer-announcements') loadCustomerAnnouncements();
    if (page === 'customer-subscriptions') loadSubscriptionTable('customer');
    if (page === 'driver-subscriptions') loadSubscriptionTable('driver');
    if (page === 'delivery-subscriptions') loadSubscriptionTable('delivery');
    if (page === 'driver-registrations') loadDriverRegistrations();
    if (page === 'delivery-drivers') loadDeliveryDrivers();
    if (page === 'reports') loadReports();
    if (page === 'map') setTimeout(() => { if (map) map.invalidateSize(); }, 80);
}

document.querySelectorAll('.sidebar-link').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToPage(item.dataset.page);
    });
});

// Initial page load: التوجيه التلقائي لأول صفحة يملك المستخدم صلاحية الوصول إليها
goToDefaultPage();

// ============================================
// COMMISSION
// ============================================
async function loadCommission() {
    if (!requireDb()) return;
    try {
        const doc = await db.collection('settings').doc('app_config').get();
        if (doc.exists) commissionPercent = doc.data().commissionPercent || 10;
        document.getElementById('currentCommission').textContent = `${commissionPercent}%`;
        document.getElementById('newCommission').value = commissionPercent;
    } catch (e) {
        console.log('Commission load error');
    }
}

window.saveCommission = async function () {
    if (!requireDb()) return;
    const val = parseFloat(document.getElementById('newCommission').value);
    if (isNaN(val) || val < 0 || val > 100) {
        ARAalert('يرجى إدخال نسبة صحيحة (0-100)', 'warning');
        return;
    }
    try {
        await db.collection('settings').doc('app_config').set({ commissionPercent: val }, { merge: true });
        commissionPercent = val;
        document.getElementById('currentCommission').textContent = `${val}%`;
        ARAalert('تم حفظ النسبة بنجاح', 'success');
    } catch (e) {
        ARAalert('خطأ: ' + e.message, 'error');
    }
};

// ============================================
// CUSTOMER RIDE COMMISSION (المخصومة من رصيد الزبون عند قبول السعر)
// ============================================
async function loadCustomerCommission() {
    if (!requireDb()) return;
    try {
        const doc = await db.collection('settings').doc('app_config').get();
        const pct = doc.exists ? (doc.data().customerRideCommissionPercent || 5) : 5;
        document.getElementById('currentCustomerCommission').textContent = `${pct}%`;
        document.getElementById('newCustomerCommission').value = pct;
    } catch (e) {
        console.log('Customer commission load error');
    }
}

window.saveCustomerCommission = async function () {
    if (!requireDb()) return;
    const val = parseFloat(document.getElementById('newCustomerCommission').value);
    if (isNaN(val) || val < 0 || val > 100) {
        ARAalert('يرجى إدخال نسبة صحيحة (0-100)', 'warning');
        return;
    }
    try {
        await db.collection('settings').doc('app_config').set({ customerRideCommissionPercent: val }, { merge: true });
        document.getElementById('currentCustomerCommission').textContent = `${val}%`;
        ARAalert('تم حفظ نسبة عمولة الزبون بنجاح', 'success');
    } catch (e) {
        ARAalert('خطأ: ' + e.message, 'error');
    }
};

// ============================================
// DIGITS + DATE HELPERS
// ============================================
const ARABIC_DIGIT_MAP = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
function normalizeDigits(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[٠-٩۰-۹]/g, ch => ARABIC_DIGIT_MAP[ch] || ch);
}
function parseNum(str) {
    const cleaned = normalizeDigits(str).replace(/[^\d.\-]/g, '');
    if (cleaned === '') return NaN;
    const v = parseFloat(cleaned);
    return isNaN(v) ? NaN : v;
}

// ============================================
// DRIVER SEARCH
// ============================================
let lastSearchedDriverId = null;

window.searchDriverByPhone = async function () {
    if (!requireDb()) return;
    const phone = document.getElementById('searchDriverPhone').value.trim();
    if (!phone) { ARAalert('أدخل رقم الهاتف', 'warning'); return; }
    const resultEl = document.getElementById('searchDriverResult');
    resultEl.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split"></i> جاري البحث...</div>';

    try {
        const snapshot = await db.collection('drivers').where('phone', '==', phone).get();
        if (snapshot.empty) {
            lastSearchedDriverId = null;
            resultEl.innerHTML = '<div class="alert alert-danger py-2">لم يتم العثور على سائق</div>';
            return;
        }
        const doc = snapshot.docs[0];
        lastSearchedDriverId = doc.id;
        renderDriverSearchResult(doc.id, doc.data());
    } catch (e) {
        resultEl.innerHTML = `<div class="alert alert-danger py-2">${e.message}</div>`;
    }
};

function renderDriverSearchResult(id, d) {
    const resultEl = document.getElementById('searchDriverResult');
    if (!resultEl) return;
    const safeName = (d.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const disabled = !!d.disabled;
    const canEdit = canPerm('drivers_edit');
    const canCredit = canPerm('drivers_credit');
    const canDel = canPerm('drivers_delete');
    resultEl.innerHTML = `
        <div class="bg-light rounded-3 p-3">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                <div>
                    <p class="fw-bold mb-1">${d.name || '-'}</p>
                    <p class="text-muted small mb-1">الهاتف: <span dir="ltr">${d.phone || '-'}</span> | الرصيد: <strong class="text-gold">${d.credit || 0} MRU</strong></p>
                </div>
                <span class="badge ${disabled ? 'bg-danger' : 'bg-success'}">${disabled ? 'معطّل' : 'مفعّل'}</span>
            </div>
            <div class="d-flex gap-1 flex-wrap mt-2">
                ${canEdit ? `<button class="btn-action btn-action-edit" onclick="openEditModal('${id}','${safeName}','${d.phone||''}','${disabled?"disabled":"active"}')">تعديل</button>` : ''}
                ${canCredit ? `<button class="btn-action btn-action-edit" style="background:#fff3cd;border-color:#ffc107;color:#856404" onclick="openEditCreditModal('${id}','${safeName}',${d.credit||0})">تعديل الرصيد</button>` : ''}
                ${canEdit ? `<button class="btn-action btn-action-toggle" onclick="toggleDriverStatus('${id}',${disabled})">${disabled ? 'تفعيل' : 'تعطيل'}</button>` : ''}
                ${canDel ? `<button class="btn-action btn-action-delete" onclick="openDeleteModal('${id}','${safeName}')">حذف</button>` : ''}
            </div>
        </div>`;
}

window.refreshDriverSearchResult = async function () {
    if (!lastSearchedDriverId) return;
    const resultEl = document.getElementById('searchDriverResult');
    if (!resultEl) return;
    try {
        const snap = await db.collection('drivers').doc(lastSearchedDriverId).get();
        if (snap.exists) {
            renderDriverSearchResult(snap.id, snap.data());
        } else {
            lastSearchedDriverId = null;
            resultEl.innerHTML = '<div class="alert alert-warning py-2">تم حذف هذا السائق من قاعدة البيانات</div>';
        }
    } catch (e) { console.error('Search refresh error:', e); }
};

// ============================================
// REAL-TIME LISTENERS
// ============================================
let activeRidesMap = {};

// ============================================
// NAV BADGES (red mark on incoming-notification buttons)
// ============================================
let unreadDeliveries = 0;
let unreadRides = 0;
let unreadDriverEvents = 0;
let unreadCustomerSubs = 0;
let unreadDriverSubs = 0;
let unreadDeliverySubs = 0;
let unreadDriverRegs = 0;
let unreadDeliveryDrivers = 0;

function setNavBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count > 99 ? '99+' : count;
    el.classList.toggle('show', count > 0);
}

function updateNavBadges() {
    setNavBadge('deliveriesNavBadge', unreadDeliveries);
    setNavBadge('deliveriesNavBadgeMobile', unreadDeliveries);
    setNavBadge('ridesNavBadge', unreadRides);
    setNavBadge('ridesNavBadgeMobile', unreadRides);
    setNavBadge('driversNavBadge', unreadDriverEvents);
    setNavBadge('driversNavBadgeMobile', unreadDriverEvents);
    setNavBadge('customerSubsNavBadge', unreadCustomerSubs);
    setNavBadge('customerSubsNavBadgeMobile', unreadCustomerSubs);
    setNavBadge('driverSubsNavBadge', unreadDriverSubs);
    setNavBadge('driverSubsNavBadgeMobile', unreadDriverSubs);
    setNavBadge('deliverySubsNavBadge', unreadDeliverySubs);
    setNavBadge('deliverySubsNavBadgeMobile', unreadDeliverySubs);
    setNavBadge('driverRegsNavBadge', unreadDriverRegs);
    setNavBadge('driverRegsNavBadgeMobile', unreadDriverRegs);
    setNavBadge('deliveryDriversNavBadge', unreadDeliveryDrivers);
    setNavBadge('deliveryDriversNavBadgeMobile', unreadDeliveryDrivers);
}

// ============================================
// نظام التنبيه الموحد (حدث من مستخدم → لوحة التحكم)
// يعرض التنبيه فوراً، وإذا كان المشرف يعدّل (نافذة مفتوحة أو كتابة في حقل)
// يؤجَّل التنبيه حتى يخرج من التعديل الحالي.
// ============================================
var pendingEventAlerts = [];
var selfTouched = {};

function markSelfTouched(id) { selfTouched[id] = Date.now(); }

function isSelfTouched(id) {
    if (selfTouched[id] && (Date.now() - selfTouched[id]) < 8000) { delete selfTouched[id]; return true; }
    return false;
}

function isAdminEditing() {
    const araOverlay = document.getElementById('shtModalOverlay');
    if (araOverlay && araOverlay.classList.contains('show')) return true;
    if (document.querySelector('.modal.show')) return true;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
    return false;
}

function deliverEventAlert(a) {
    playNotificationSound();
    if (a.title && a.body) showDesktopNotification(a.title, a.body);
    if (a.tab) flashTab(a.tab);
    if (a.popup) ARAalert(a.popup, a.type || 'info');
    if (a.log) addNotifLog(a.log.tag, a.log.msg);
}

function queueEventAlert(a) {
    if (isAdminEditing()) { pendingEventAlerts.push(a); return; }
    deliverEventAlert(a);
}

function flushPendingEventAlerts() {
    if (isAdminEditing()) return;
    while (pendingEventAlerts.length) deliverEventAlert(pendingEventAlerts.shift());
}
document.addEventListener('hidden.bs.modal', function () { setTimeout(flushPendingEventAlerts, 60); });
document.addEventListener('focusout', function () { setTimeout(flushPendingEventAlerts, 120); });
document.addEventListener('click', function () { setTimeout(flushPendingEventAlerts, 80); });

// ============================================
// مراقبو الأحداث الواردة (دائمون حتى خارج الصفحات)
// يلتقطون كل حدث صادر من زبون أو سائق نحو اللوحة
// ============================================
var deliveryWatchFirst = true;
var rideWatchFirst = true;
var rideWatchStatus = {};
var rechargeWatchFirst = true;
var rechargeSeen = {};
var driverRegWatchFirst = true;
var driverRegSeen = {};
var driverStatusFirst = true;
var driverStatusCache = {};
var productsWatchFirst = true;
var productsSeen = {};

function initEventWatchers() {
    if (!db) return;

    // 1) طلب توصيل جديد من زبون
    db.collection('delivery_requests').where('status', '==', 'new')
        .onSnapshot(snap => {
            if (deliveryWatchFirst) { deliveryWatchFirst = false; return; }
            snap.docChanges().forEach(ch => {
                if (ch.type !== 'added') return;
                const d = ch.doc.data();
                if (isSelfTouched(ch.doc.id)) return;
                unreadDeliveries++;
                updateNavBadges();
                const from = d.customerName || d.customerPhone || 'زبون';
                const to = d.receiverDistrict || d.receiverPhone || '-';
                const dist = d.senderDistrict || '-';
                const body = `من: ${from} — المستلم: ${to} — الحي: ${dist}`;
                queueEventAlert({
                    title: '🚚 طلب توصيل جديد',
                    body: body,
                    tab: '🔴',
                    popup: `طلب توصيل جديد!\nمن: ${from}\nالمستلم: ${to}\nالحي: ${dist}`,
                    type: 'info',
                    log: { tag: 'delivery_new', msg: `🚚 طلب توصيل جديد من ${from} — المستلم: ${to} — الحي: ${dist}` }
                });
            });
        }, err => { console.log('delivery watcher error', err); });

    // 2) أحداث الرحلات (قبول/إنجاز/إلغاء...) من السائق
    db.collection('rides').orderBy('createdAt', 'desc').limit(100)
        .onSnapshot(snap => {
            const labels = { pending: 'قيد الانتظار', accepted: 'مقبولة', in_progress: 'جارية', completed: 'مكتملة', cancelled: 'ملغاة', expired: 'منتهٍ', no_drivers: 'بلا سائق' };
            const statusIcons = { pending: '⏳', accepted: '✅', in_progress: '🛵', completed: '🏁', cancelled: '❌', expired: '⌛', no_drivers: '🚫' };
            if (rideWatchFirst) {
                snap.forEach(d => { rideWatchStatus[d.id] = d.data().status; });
                rideWatchFirst = false;
                return;
            }
            snap.docChanges().forEach(ch => {
                const id = ch.doc.id;
                const rd = ch.doc.data();
                const curr = rd.status || '';
                const prev = rideWatchStatus[id];
                if (isSelfTouched(id)) { rideWatchStatus[id] = curr; return; }
                if (ch.type === 'added' && prev === undefined && curr !== 'pending' && curr !== 'no_drivers') {
                    unreadRides++;
                    updateNavBadges();
                    queueEventAlert({
                        title: `🚀 رحلة جديدة: ${rd.passengerName || 'زبون'}`,
                        body: `${labels[curr] || curr} — ${rd.fare || 0} MRU`,
                        tab: '🚀',
                        popup: `🚀 رحلة جديدة!\n${rd.passengerName || 'زبون'}\n${labels[curr] || curr} — ${rd.fare || 0} MRU`,
                        type: 'info',
                        log: { tag: 'ride_' + curr, msg: `${statusIcons[curr] || '📌'} ${labels[curr] || curr}: ${rd.passengerName || 'زبون'} — ${rd.fare || 0} MRU` }
                    });
                } else if (ch.type === 'modified' && prev !== undefined && prev !== curr) {
                    unreadRides++;
                    updateNavBadges();
                    queueEventAlert({
                        title: `${statusIcons[curr] || '📌'} ${labels[curr] || curr}: ${rd.passengerName || 'زبون'}`,
                        body: `${rd.fare || 0} MRU — ${rd.pickupAddress || ''} → ${rd.dropoffAddress || ''}`,
                        tab: '🔔',
                        popup: `${statusIcons[curr] || '📌'} ${labels[curr] || curr}\n${rd.passengerName || 'زبون'} — ${rd.fare || 0} MRU`,
                        type: 'info',
                        log: { tag: 'ride_' + curr, msg: `${statusIcons[curr] || '📌'} ${labels[curr] || curr}: ${rd.passengerName || 'زبون'} — ${rd.fare || 0} MRU` }
                    });
                }
                rideWatchStatus[id] = curr;
            });
        }, err => { console.log('ride watcher error', err); });

    // 3) طلب اشتراك / تجديد جديد من زبون أو سائق أو توصيل
    db.collection('recharge_requests').where('status', '==', 'pending')
        .onSnapshot(snap => {
            if (rechargeWatchFirst) {
                snap.forEach(d => { rechargeSeen[d.id] = true; });
                rechargeWatchFirst = false;
                return;
            }
            snap.docChanges().forEach(ch => {
                if (ch.type !== 'added' || rechargeSeen[ch.doc.id]) return;
                rechargeSeen[ch.doc.id] = true;
                const r = ch.doc.data();
                if (r.type !== 'subscription') return;
                const roleKey = r.userRole || r.role || 'customer';
                const who = roleKey === 'driver' ? (r.driverName || r.name || 'سائق')
                    : roleKey === 'delivery' ? (r.driverName || r.name || 'سائق توصيل')
                    : (r.customerName || r.userName || r.name || 'زبون');
                if (roleKey === 'customer') unreadCustomerSubs++;
                else if (roleKey === 'delivery') unreadDeliverySubs++;
                else unreadDriverSubs++;
                updateNavBadges();
                queueEventAlert({
                    title: '⭐ طلب اشتراك جديد',
                    body: `${who} — ${r.amount || 0} MRU (${roleKey === 'customer' ? 'اشتراك سنوي' : 'اشتراك شهري'})`,
                    tab: '⭐',
                    popup: `طلب اشتراك جديد!\n${who}\nالمبلغ: ${r.amount || 0} MRU`,
                    type: 'info',
                    log: { tag: 'sub_new', msg: `⭐ طلب اشتراك ${r.amount || 0} MRU من ${who}` }
                });
            });
        }, err => { console.log('recharge watcher error', err); });

    // 4) اتصال / انقطاع سائق
    db.collection('drivers').onSnapshot(snap => {
        if (driverStatusFirst) {
            snap.forEach(d => { driverStatusCache[d.id] = d.data().isOnline === true; });
            driverStatusFirst = false;
            return;
        }
        snap.docChanges().forEach(ch => {
            if (ch.type !== 'added' && ch.type !== 'modified') return;
            const id = ch.doc.id;
            const d = ch.doc.data();
            const online = d.isOnline === true;
            const prev = driverStatusCache[id];
            if (prev === undefined || prev === online) { driverStatusCache[id] = online; return; }
            driverStatusCache[id] = online;
            unreadDriverEvents++;
            updateNavBadges();
            queueEventAlert({
                title: online ? '🛵 سائق متصل الآن' : '🛑 سائق غير متصل',
                body: `${d.name || 'سائق'} ${online ? 'أصبح متاحاً' : 'أصبح غير متاح'}`,
                tab: online ? '🟢' : '🔴',
                popup: `${d.name || 'سائق'} ${online ? 'أصبح متاحاً الآن' : 'أصبح غير متاح الآن'}`,
                type: online ? 'success' : 'warning',
                log: { tag: online ? 'driver_online' : 'driver_offline', msg: `${d.name || 'سائق'} ${online ? 'متصل' : 'غير متصل'}` }
            });
        });
        }, err => { console.log('driver status watcher error', err); });

    // 5) طلب تسجيل سائق جديد (قيد المراجعة)
    db.collection('drivers').where('pendingRegistration', '==', true)
        .onSnapshot(snap => {
            if (driverRegWatchFirst) {
                snap.forEach(d => { driverRegSeen[d.id] = true; });
                driverRegWatchFirst = false;
                return;
            }
            snap.docChanges().forEach(ch => {
                if (ch.type !== 'added' || driverRegSeen[ch.doc.id]) return;
                driverRegSeen[ch.doc.id] = true;
                const d = ch.doc.data();
                unreadDriverRegs++;
                updateNavBadges();
                queueEventAlert({
                    title: '📝 طلب تسجيل سائق جديد',
                    body: `${d.name || 'سائق'} — ${d.vehicleType || 'سيارة'}`,
                    tab: '📝',
                    popup: `طلب تسجيل جديد!\n${d.name || 'سائق'}\n${d.vehicleType || 'سيارة'}`,
                    type: 'info',
                    log: { tag: 'reg_new', msg: `📝 طلب تسجيل من ${d.name || 'سائق'}` }
                });
            });
        }, err => { console.log('driver reg watcher error', err); });
}

function initRealtimeListeners() {
    if (!db) return;

    db.collection('rides').where('status', 'in', ['accepted', 'in_progress'])
        .onSnapshot(snapshot => {
            document.getElementById('rideCount').textContent = snapshot.size;
            document.getElementById('statActiveRides').textContent = snapshot.size;
            const mobileCount = document.querySelector('.rideCount-mobile');
            if (mobileCount) mobileCount.textContent = snapshot.size;

            const activeIds = new Set();
            snapshot.forEach(doc => {
                const r = doc.data();
                const id = doc.id;
                activeIds.add(id);
                if (!r.pickupLat || !r.pickupLng) return;
                if (activeRidesMap[id]) {
                    activeRidesMap[id].marker.setLatLng([r.pickupLat, r.pickupLng]);
                } else {
                    const icon = L.divIcon({
                        className: 'ride-marker-wrapper',
                        html: `<div style="background:${r.status==='in_progress'?'#2E7D32':'#E65100'};border:3px solid white;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.3);color:white;font-size:18px;">🎫</div>`,
                        iconSize: [38, 38], iconAnchor: [19, 19]
                    });
                    const statusLabel = r.status === 'in_progress' ? 'جارية' : 'مقبولة';
                    const marker = L.marker([r.pickupLat, r.pickupLng], { icon })
                        .bindPopup(`<div style="font-family:Cairo;text-align:center;direction:rtl;"><strong>${r.passengerName || 'زبون'}</strong><br><small>${r.pickupAddress || ''} → ${r.dropoffAddress || ''}</small><br><strong>${r.finalPrice || r.fare || 0} MRU</strong><br><span style="color:${r.status==='in_progress'?'#2E7D32':'#E65100'};">● ${statusLabel}</span></div>`)
                        .addTo(map);
                    activeRidesMap[id] = { marker, data: r };
                }
            });

            Object.keys(activeRidesMap).forEach(id => {
                if (!activeIds.has(id)) { map.removeLayer(activeRidesMap[id].marker); delete activeRidesMap[id]; }
            });
        }, err => {
            console.error('Active rides listener error:', err);
        });

    db.collection('drivers').where('isOnline', '==', true)
        .onSnapshot(snapshot => {
            const onlineIds = new Set();
            snapshot.forEach(doc => {
                const data = doc.data();
                const id = doc.id;
                if (!data.lat || !data.lng) return;
                onlineIds.add(id);
                const isDelivery = data.role === 'delivery' || data.vehicleType === 'bike';
                const vehicleLabel = isDelivery ? 'توصيل' : 'سيارة';
                if (driversMap[id]) {
                    driversMap[id].marker.setLatLng([data.lat, data.lng]);
                    if (driversMap[id].isDelivery !== isDelivery) {
                        const icon = L.divIcon({
                            className: 'driver-marker-wrapper',
                            html: `<div style="background:${isDelivery ? '#6A1B9A' : '#0B1849'};border:3px solid white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.3);color:white;font-size:18px;">${isDelivery ? '🛵' : '🚗'}</div>`,
                            iconSize: [36, 36], iconAnchor: [18, 18]
                        });
                        driversMap[id].marker.setIcon(icon);
                        driversMap[id].isDelivery = isDelivery;
                    }
                } else {
                    const icon = L.divIcon({
                        className: 'driver-marker-wrapper',
                        html: `<div style="background:${isDelivery ? '#6A1B9A' : '#0B1849'};border:3px solid white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.3);color:white;font-size:18px;">${isDelivery ? '🛵' : '🚗'}</div>`,
                        iconSize: [36, 36], iconAnchor: [18, 18]
                    });
                    const marker = L.marker([data.lat, data.lng], { icon }).addTo(map)
                        .bindPopup(`<div style="font-family:Cairo;text-align:center;direction:rtl;"><strong>${data.name || 'سائق'}</strong><br><small>${vehicleLabel} | رصيد: ${data.credit || 0} MRU</small><br><span style="color:#2E7D32;">● متاح</span></div>`);
                    driversMap[id] = { marker, data, isDelivery };
                }
            });
            Object.keys(driversMap).forEach(id => {
                if (!onlineIds.has(id)) { map.removeLayer(driversMap[id].marker); delete driversMap[id]; }
            });
            document.getElementById('onlineCount').textContent = onlineIds.size;
            document.getElementById('statOnlineDrivers').textContent = onlineIds.size;
            const mobileCount = document.querySelector('.onlineCount-mobile');
            if (mobileCount) mobileCount.textContent = onlineIds.size;
        });

    db.collection('customers').where('lastSeen', '>=', new Date(Date.now() - 10 * 60 * 1000))
        .onSnapshot(snapshot => {
        const seenIds = new Set();
        const now = Date.now();
        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            if (!data.lat || !data.lng) return;
            const lastSeen = data.lastSeen && data.lastSeen.toDate
                ? data.lastSeen.toDate().getTime() : now;
            if (now - lastSeen > 5 * 60 * 1000) return;
            seenIds.add(id);
            if (customersMap[id]) {
                customersMap[id].marker.setLatLng([data.lat, data.lng]);
            } else {
                const icon = L.divIcon({
                    className: 'customer-marker-wrapper',
                    html: '<div style="background:#D4A843;border:3px solid white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.3);color:white;font-size:17px;">🧑</div>',
                    iconSize: [34, 34], iconAnchor: [17, 17]
                });
                const marker = L.marker([data.lat, data.lng], { icon }).addTo(map)
                    .bindPopup(`<div style="font-family:Cairo;text-align:center;direction:rtl;"><strong>${data.name || 'زبون'}</strong><br><small>${data.phone || ''} | رصيد: ${data.credit || 0} MRU</small></div>`);
                customersMap[id] = { marker, data };
            }
        });
        Object.keys(customersMap).forEach(id => {
            if (!seenIds.has(id)) { map.removeLayer(customersMap[id].marker); delete customersMap[id]; }
        });
    });
}

// ============================================
// REGISTER DRIVER
// ============================================
document.getElementById('registerDriverBtn').addEventListener('click', async () => {
    const statusEl = 'registerDriverStatus';
    if (!requireDb(statusEl)) return;
    if (!guardPerm('drivers_add', 'ليست لديك صلاحية تسجيل سائقين')) return;
    const name = document.getElementById('newDriverName').value.trim();
    const phone = document.getElementById('newDriverPhone').value.trim();
    const password = document.getElementById('newDriverPassword').value.trim();
    const vehicle = document.getElementById('newDriverVehicle')?.value || 'car';
    const credit = parseNum(document.getElementById('newDriverCredit').value) || 0;

    if (!name) { showStatus(statusEl, 'أدخل اسم السائق', 'error'); return; }
    if (!phone) { showStatus(statusEl, 'أدخل رقم الهاتف', 'error'); return; }
    if (!password) { showStatus(statusEl, 'أدخل كلمة السر', 'error'); return; }

    const btn = document.getElementById('registerDriverBtn');
    btn.disabled = true; btn.textContent = 'جاري التسجيل...';
    try {
        const dup = await db.collection('drivers').where('phone', '==', phone).get();
        if (!dup.empty) {
            const existing = dup.docs[0].data().name || 'سائق آخر';
            showStatus(statusEl, 'رقم الهاتف ' + phone + ' مسجل بالفعل للسائق: ' + existing, 'error');
            btn.disabled = false; btn.textContent = 'تسجيل السائق';
            return;
        }
        await db.collection('drivers').add({
            name, phone, password, vehicleType: vehicle,
            role: vehicle === 'bike' ? 'delivery' : 'driver', credit,
            lat: 18.0735, lng: -15.9582, geohash: '',
            isOnline: false, disabled: false, currentRideId: null,
            rating: 5.0, totalRides: 0, fcmToken: '',
            subscription: { active: false, type: vehicle === 'bike' ? 'monthly' : 'monthly', period: 'month' },
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus(statusEl, 'تم التسجيل بنجاح!', 'success');
        document.getElementById('newDriverName').value = '';
        document.getElementById('newDriverPhone').value = '';
        document.getElementById('newDriverPassword').value = '';
        document.getElementById('newDriverCredit').value = '0';
        loadDriversList();
        if (vehicle === 'bike') loadDeliveryDrivers();
    } catch (err) {
        showStatus(statusEl, 'خطأ: ' + err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'تسجيل السائق';
});

// ============================================
// DRIVERS LIST
// ============================================
async function loadDriversList() {
    if (!requireDb()) return;
    const tbody = document.getElementById('driversTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل السائقين...</div></td></tr>';
    try {
        const snapshot = await db.collection('drivers').get();
        allDrivers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.role === 'delivery') return;
            allDrivers.push({ id: doc.id, ...data });
        });
        renderDriversList(allDrivers);
    } catch (err) {
        console.error('Load drivers error:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

function buildDriverRow(d) {
    const status = d.disabled ? 'disabled' : (d.isOnline ? 'online' : 'offline');
    const label = d.disabled ? 'معطّل' : (d.isOnline ? 'متاح' : 'غير متاح');
    const badgeClass = `badge bg-${status === 'online' ? 'success' : status === 'disabled' ? 'danger' : 'secondary'}`;
    const safeName = (d.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const canEdit = canPerm('drivers_edit');
    const canCredit = canPerm('drivers_credit');
    const canDel = canPerm('drivers_delete');
    const canService = canPerm('drivers_service');
    return `<tr>
        <td><strong>${d.name || '-'}</strong></td>
        <td><span dir="ltr">${d.phone || '-'}</span></td>
        <td><span class="text-muted">${d.password ? '••••' : '-'}</span> ${canEdit ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="openPasswordModal('${d.id}','${safeName}')"><i class="bi bi-key"></i></button>` : ''}</td>
        <td><strong>${d.credit || 0}</strong> MRU</td>
        <td><span class="${badgeClass}">${label}</span></td>
        <td>
            <div class="d-flex gap-1 flex-wrap">
                ${canEdit ? `<button class="btn-action btn-action-edit" onclick="openEditModal('${d.id}','${safeName}','${d.phone||''}','${d.disabled?"disabled":"active"}')">تعديل</button>` : ''}
                ${canCredit ? `<button class="btn-action btn-action-edit" style="background:#fff3cd;border-color:#ffc107;color:#856404" onclick="openEditCreditModal('${d.id}','${safeName}',${d.credit||0})">تعديل الرصيد</button>` : ''}
                ${canEdit ? `<button class="btn-action btn-action-toggle" onclick="toggleDriverStatus('${d.id}',${d.disabled||false})">${d.disabled ? 'تفعيل' : 'تعطيل'}</button>` : ''}
                ${canService && !d.disabled ? `<button class="btn-action ${d.isOnline ? 'btn-action-delete' : 'btn-action-on'}" onclick="toggleDriverService('${d.id}','${safeName}',${!d.isOnline})">${d.isOnline ? 'إيقاف الخدمة' : 'تشغيل الخدمة'}</button>` : ''}
                ${canDel ? `<button class="btn-action btn-action-delete" onclick="openDeleteModal('${d.id}','${safeName}')">حذف</button>` : ''}
            </div>
        </td>
    </tr>`;
}

function renderDriversList(drivers) {
    const tbody = document.getElementById('driversTableBody');
    document.getElementById('totalDriversCount').textContent = drivers.length;
    if (drivers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">لا يوجد سائقون</td></tr>';
        return;
    }
    tbody.innerHTML = drivers.map(buildDriverRow).join('');
}

// ============================================
// DELIVERY DRIVERS (سائقو التوصيل - دراجة)
// ============================================
let deliveryDrivers = [];

async function loadDeliveryDrivers() {
    if (!requireDb()) return;
    const tbody = document.getElementById('deliveryDriversTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل سائقي التوصيل...</div></td></tr>';
    try {
        const snapshot = await db.collection('drivers').where('role', '==', 'delivery').get();
        deliveryDrivers = [];
        snapshot.forEach(doc => deliveryDrivers.push({ id: doc.id, ...doc.data() }));
        renderDeliveryDriversList(deliveryDrivers);
    } catch (err) {
        console.error('Load delivery drivers error:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

function renderDeliveryDriversList(drivers) {
    const tbody = document.getElementById('deliveryDriversTableBody');
    document.getElementById('totalDeliveryDriversCount').textContent = drivers.length;
    if (drivers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">لا يوجد سائقو توصيل</td></tr>';
        return;
    }
    tbody.innerHTML = drivers.map(buildDriverRow).join('');
}

function filterDeliveryDrivers() {
    const query = document.getElementById('searchDeliveryDrivers').value;
    renderDeliveryDriversList(deliveryDrivers.filter(d => {
        const name = (d.name || '');
        const phone = (d.phone || '');
        return !query || name.includes(query) || phone.includes(query);
    }));
}

let pendingServiceAction = null;

function buildServiceNotification(id, on) {
    return {
        userId: id,
        read: false,
        type: 'generic',
        title: on ? 'الخدمة مفعّلة' : 'الخدمة متوقفة',
        body: on ? 'تم تشغيل خدمتك من لوحة التحكم. أنت الآن متاح لاستقبال الرحلات.' : 'تم إيقاف خدمتك من لوحة التحكم.',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

function openServiceConfirm(title, text, hint, on, action) {
    const header = document.getElementById('serviceConfirmHeader');
    const icon = document.getElementById('serviceConfirmIcon');
    const btn = document.getElementById('confirmServiceBtn');
    document.getElementById('serviceConfirmTitle').textContent = title;
    document.getElementById('serviceConfirmText').innerHTML = text;
    document.getElementById('serviceConfirmHint').textContent = hint || '';
    header.className = 'modal-header text-white border-bottom ' + (on ? 'bg-success' : 'bg-danger');
    icon.className = 'bi bi-power fs-1 mb-2 ' + (on ? 'text-success' : 'text-danger');
    btn.className = 'btn fw-bold ' + (on ? 'btn-success' : 'btn-danger');
    btn.textContent = on ? 'نعم، شغّل' : 'نعم، أوقف';
    pendingServiceAction = action;
    serviceConfirmModal.show();
}

async function setServiceForAll(on) {
    if (!requireDb()) return;
    if (!guardPerm('drivers_service', 'ليست لديك صلاحية التحكم بالخدمة')) return;
    const statusEl = document.getElementById('serviceStatus');
    const notify = document.getElementById('serviceNotifyDrivers').checked;
    statusEl.className = 'text-primary fw-semibold mt-2';
    statusEl.textContent = on ? 'جاري احتساب السائقين...' : 'جاري احتساب السائقين...';
    try {
        const snap = await db.collection('drivers').get();
        let changed = 0;
        snap.forEach(doc => {
            const d = doc.data();
            if (d.disabled) return;
            if (!!d.isOnline === on) return;
            changed++;
        });
        if (changed === 0) {
            statusEl.className = 'text-warning fw-semibold mt-2';
            statusEl.textContent = on ? 'جميع السائقين الخدمة مفعّلة بالفعل.' : 'جميع السائقين الخدمة متوقفة بالفعل.';
            return;
        }
        const label = on ? 'تشغيل الخدمة للجميع' : 'إيقاف الخدمة للجميع';
        const text = `سيتم <strong>${on ? 'تشغيل' : 'إيقاف'}</strong> الخدمة لـ <strong>${changed} سائق</strong> من لوحة التحكم. هل أنت متأكد؟`;
        const hint = notify ? 'سيُرسل إشعار صوتي للسائقين المتأثرين.' : 'لن يُرسل أي إشعار للسائقين.';
        statusEl.textContent = '';
        openServiceConfirm(label, text, hint, on, { kind: 'all', on });
    } catch (err) {
        console.error('Set service error:', err);
        statusEl.className = 'text-danger fw-semibold mt-2';
        statusEl.textContent = 'خطأ: ' + err.message;
    }
}

async function toggleDriverService(id, name, on) {
    if (!requireDb()) return;
    if (!guardPerm('drivers_service', 'ليست لديك صلاحية التحكم بالخدمة')) return;
    const notify = document.getElementById('serviceNotifyDrivers').checked;
    const label = on ? 'تشغيل الخدمة' : 'إيقاف الخدمة';
    const text = `هل أنت متأكد من <strong>${on ? 'تشغيل' : 'إيقاف'}</strong> الخدمة للسائق <strong>«${name}»</strong>؟`;
    const hint = notify ? 'سيُرسل إشعار صوتي للسائق.' : 'لن يُرسل أي إشعار للسائق.';
    openServiceConfirm(label, text, hint, on, { kind: 'single', id, name, on });
}

document.getElementById('confirmServiceBtn').addEventListener('click', async () => {
    if (!requireDb() || !pendingServiceAction) return;
    if (!guardPerm('drivers_service', 'ليست لديك صلاحية التحكم بالخدمة')) return;
    const action = pendingServiceAction;
    const notify = document.getElementById('serviceNotifyDrivers').checked;
    const statusEl = document.getElementById('serviceStatus');
    try {
        if (action.kind === 'single') {
            const batch = db.batch();
            batch.update(db.collection('drivers').doc(action.id), { isOnline: action.on });
            if (notify) batch.set(db.collection('notifications').doc(), buildServiceNotification(action.id, action.on));
            await batch.commit();
            serviceConfirmModal.hide();
            pendingServiceAction = null;
            loadDriversList();
        } else {
            serviceConfirmModal.hide();
            pendingServiceAction = null;
            statusEl.className = 'text-primary fw-semibold mt-2';
            statusEl.textContent = action.on ? 'جاري تشغيل الخدمة للجميع...' : 'جاري إيقاف الخدمة للجميع...';
            const snap = await db.collection('drivers').get();
            const batch = db.batch();
            let changed = 0;
            snap.forEach(doc => {
                const d = doc.data();
                if (d.disabled) return;
                if (!!d.isOnline === action.on) return;
                batch.update(doc.ref, { isOnline: action.on });
                if (notify) batch.set(db.collection('notifications').doc(), buildServiceNotification(doc.id, action.on));
                changed++;
            });
            await batch.commit();
            statusEl.className = 'text-success fw-semibold mt-2';
            statusEl.textContent = `تم ${action.on ? 'تشغيل' : 'إيقاف'} الخدمة لـ ${changed} سائق${notify ? ' مع إرسال إشعار صوتي' : ''}.`;
            loadDriversList();
        }
    } catch (err) {
        console.error('Service action error:', err);
        serviceConfirmModal.hide();
        pendingServiceAction = null;
        statusEl.className = 'text-danger fw-semibold mt-2';
        statusEl.textContent = 'خطأ: ' + err.message;
    }
});

document.getElementById('searchDrivers').addEventListener('input', filterDrivers);
document.getElementById('filterDriverStatus').addEventListener('change', filterDrivers);

function filterDrivers() {
    const query = document.getElementById('searchDrivers').value;
    const status = document.getElementById('filterDriverStatus').value;
    renderDriversList(allDrivers.filter(d => {
        const name = (d.name || '');
        const phone = (d.phone || '');
        const matchQ = !query || name.includes(query) || phone.includes(query) ||
            name.localeCompare(query, 'ar', { sensitivity: 'base' }) === 0;
        let matchS = true;
        if (status === 'online') matchS = d.isOnline && !d.disabled;
        else if (status === 'offline') matchS = !d.isOnline && !d.disabled;
        else if (status === 'disabled') matchS = d.disabled;
        return matchQ && matchS;
    }));
}

// ============================================
// UNREGISTERED CUSTOMERS
// ============================================
let allUnregisteredCustomers = [];

async function loadUnregisteredCustomers() {
    if (!requireDb()) return;
    const tbody = document.getElementById('unregCustomersTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل البيانات...</div></td></tr>';
    try {
        const [ridesSnap, custSnap] = await Promise.all([
            db.collection('rides').orderBy('createdAt', 'desc').limit(500).get(),
            db.collection('customers').get()
        ]);
        const registered = new Set();
        custSnap.forEach(c => {
            const cc = c.data();
            if (cc.phone) registered.add(normalizeDigits(cc.phone).replace(/[^\d]/g, ''));
        });
        const agg = {};
        ridesSnap.forEach(doc => {
            const r = doc.data();
            const phone = normalizeDigits(r.passengerPhone || '').replace(/[^\d]/g, '');
            if (!phone || registered.has(phone)) return;
            if (!agg[phone]) agg[phone] = { name: r.passengerName || 'زبون', phone, rides: 0, total: 0, last: null };
            agg[phone].rides++;
            const fare = parseNum(r.fare);
            agg[phone].total += (isNaN(fare) ? 0 : fare);
            const t = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
            if (t && (!agg[phone].last || t > agg[phone].last)) {
                agg[phone].last = t;
                agg[phone].name = r.passengerName || agg[phone].name;
            }
        });
        allUnregisteredCustomers = Object.values(agg).sort((a, b) => b.rides - a.rides);
        renderUnregisteredCustomers(allUnregisteredCustomers);
    } catch (err) {
        console.error('Load unregistered customers error:', err);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

function renderUnregisteredCustomers(list) {
    const tbody = document.getElementById('unregCustomersTableBody');
    document.getElementById('totalUnregCustomersCount').textContent = list.length;
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">لا يوجد زبناء غير مسجلين</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(c => `<tr>
        <td><strong>${c.name || '-'}</strong></td>
        <td><span dir="ltr">${c.phone}</span></td>
        <td>${c.rides}</td>
        <td><strong>${c.total || 0}</strong> MRU</td>
        <td><small>${c.last ? c.last.toLocaleString('ar-MA') : '-'}</small></td>
    </tr>`).join('');
}

document.getElementById('searchUnregCustomers').addEventListener('input', () => {
    const q = document.getElementById('searchUnregCustomers').value.trim();
    renderUnregisteredCustomers(allUnregisteredCustomers.filter(c => {
        return !q || (c.name || '').includes(q) || c.phone.includes(q) ||
            (c.name || '').localeCompare(q, 'ar', { sensitivity: 'base' }) === 0;
    }));
});

window.exportUnregisteredCustomersCSV = function () {
    if (!allUnregisteredCustomers.length) { ARAalert('لا توجد بيانات للتصدير', 'warning'); return; }
    const rows = [['الاسم', 'الهاتف', 'عدد الرحلات', 'إجمالي المبالغ', 'آخر رحلة']];
    allUnregisteredCustomers.forEach(c => {
        rows.push([c.name || '', c.phone, c.rides, c.total || 0, c.last ? c.last.toLocaleString('ar-MA') : '']);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'unregistered_customers.csv';
    a.click();
};

// ============================================
// CUSTOMERS LIST
// ============================================
async function loadCustomersList() {
    if (!requireDb()) return;
    const tbody = document.getElementById('customersTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل الزبائن...</div></td></tr>';
    try {
        const snapshot = await db.collection('customers').get();
        allCustomers = [];
        snapshot.forEach(doc => allCustomers.push({ id: doc.id, ...doc.data() }));
        renderCustomersList(allCustomers);
    } catch (err) {
        console.error('Load customers error:', err);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

function renderCustomersList(customers) {
    const tbody = document.getElementById('customersTableBody');
    document.getElementById('totalCustomersCount').textContent = customers.length;
    if (customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">لا يوجد زبائن</td></tr>';
        return;
    }
    tbody.innerHTML = customers.map(c => {
        const status = c.isOnline ? 'online' : 'offline';
        const label = c.isOnline ? 'متصل' : 'غير متصل';
        const badgeClass = `badge bg-${status === 'online' ? 'success' : 'secondary'}`;
        const safeName = (c.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const canEditC = canPerm('customers_edit');
        const canCreditC = canPerm('customers_credit');
        const canDelC = canPerm('customers_delete');
        return `<tr>
            <td><strong>${c.name || '-'}</strong></td>
            <td><span dir="ltr">${c.phone || '-'}</span></td>
            <td><span dir="ltr">${c.whatsapp || '-'}</span></td>
            <td><span class="text-muted">${c.password ? '••••' : '-'}</span> ${canEditC ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="openCustomerPasswordModal('${c.id}','${safeName}')"><i class="bi bi-key"></i></button>` : ''}</td>
            <td><strong>${c.credit || 0}</strong> MRU</td>
            <td><span class="${badgeClass}">${label}</span></td>
            <td>${c.totalRides || 0}</td>
            <td>
                <div class="d-flex gap-1 flex-wrap">
                    ${canEditC ? `<button class="btn-action btn-action-edit" onclick="openEditCustomerModal('${c.id}','${safeName}','${c.phone||''}','${c.whatsapp||''}')">تعديل</button>` : ''}
                    ${canCreditC ? `<button class="btn-action btn-action-edit" style="background:#fff3cd;border-color:#ffc107;color:#856404" onclick="openEditCustomerCreditModal('${c.id}','${safeName}',${c.credit||0})">تعديل الرصيد</button>` : ''}
                    ${canDelC ? `<button class="btn-action btn-action-delete" onclick="openDeleteCustomerModal('${c.id}','${safeName}')">حذف</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

document.getElementById('searchCustomers').addEventListener('input', filterCustomers);
document.getElementById('filterCustomerStatus').addEventListener('change', filterCustomers);

function filterCustomers() {
    const query = document.getElementById('searchCustomers').value;
    const statusFilter = document.getElementById('filterCustomerStatus').value;
    renderCustomersList(allCustomers.filter(c => {
        const name = (c.name || '');
        const phone = (c.phone || '');
        const matchQ = !query || name.includes(query) || phone.includes(query) ||
            name.localeCompare(query, 'ar', { sensitivity: 'base' }) === 0;
        let matchS = true;
        if (statusFilter === 'online') matchS = c.isOnline;
        else if (statusFilter === 'offline') matchS = !c.isOnline;
        return matchQ && matchS;
    }));
}

// ============================================
// CUSTOMER PROFILE SEARCH (بحث عن زبون وعرض كامل معلوماته)
// ============================================
let customerSearchResults = [];

async function searchCustomerProfile() {
    if (!requireDb()) return;
    if (!guardPerm('customers', 'ليست لديك صلاحية عرض الزبائن')) return;
    const resultEl = document.getElementById('customerProfileResult');
    const phone = document.getElementById('searchCustomerProfilePhone').value.trim();
    const name = document.getElementById('searchCustomerProfileName').value.trim();

    if (!phone && !name) {
        resultEl.innerHTML = '<div class="text-danger fw-semibold py-2"><i class="bi bi-exclamation-circle me-1"></i>أدخل رقم الهاتف أو الاسم للبحث</div>';
        return;
    }

    resultEl.innerHTML = '<div class="text-muted py-3"><div class="SHATER-spinner d-inline-block me-2"></div>جاري البحث...</div>';

    try {
        let candidates = [];

        // 1) بحث بالهاتف (مطابقة تامة ثم جزئية)
        if (phone) {
            const exact = (allCustomers || []).filter(c => String(c.phone || '') === phone);
            if (exact.length) candidates = exact;
            else {
                const partial = (allCustomers || []).filter(c => String(c.phone || '').includes(phone));
                if (partial.length) candidates = partial;
                else {
                    const snap = await db.collection('customers').where('phone', '==', phone).limit(5).get();
                    snap.forEach(d => candidates.push({ id: d.id, ...d.data() }));
                }
            }
        }

        // 2) بحث بالاسم (إن لم يُعثر بالهاتف)
        if (!candidates.length && name) {
            const norm = name.trim().toLowerCase();
            const exact = (allCustomers || []).filter(c => (c.name || '').toLowerCase() === norm);
            if (exact.length) candidates = exact;
            else {
                const partial = (allCustomers || []).filter(c => (c.name || '').includes(name));
                if (partial.length) candidates = partial;
                else {
                    const snap = await db.collection('customers').where('name', '==', name).limit(5).get();
                    snap.forEach(d => candidates.push({ id: d.id, ...d.data() }));
                }
            }
        }

        if (!candidates.length) {
            resultEl.innerHTML = '<div class="text-warning fw-semibold py-2"><i class="bi bi-search me-1"></i>لم يتم العثور على زبون مطابق</div>';
            return;
        }

        if (candidates.length === 1) {
            showCustomerProfile(candidates[0]);
        } else {
            customerSearchResults = candidates;
            resultEl.innerHTML = `
                <div class="border rounded-3 p-3 bg-light">
                    <h6 class="fw-bold text-dark-blue mb-3"><i class="bi bi-people me-1 text-gold"></i>تم العثور على ${candidates.length} زبون متطابق — اختر واحداً:</h6>
                    ${candidates.map((c, i) => `<button class="btn btn-outline-dark-blue btn-sm me-1 mb-1" onclick="showCustomerMatch(${i})"><i class="bi bi-person me-1"></i>${escapeHtmlStr(c.name || 'زبون')} <span dir="ltr" class="text-muted">${escapeHtmlStr(c.phone || '')}</span></button>`).join('')}
                </div>`;
        }
    } catch (err) {
        console.error('Customer profile search error:', err);
        resultEl.innerHTML = '<div class="text-danger fw-semibold py-2">حدث خطأ أثناء البحث: ' + escapeHtmlStr(err.message) + '</div>';
    }
}

function showCustomerMatch(index) {
    if (!customerSearchResults[index]) return;
    showCustomerProfile(customerSearchResults[index]);
}

async function showCustomerProfile(customer) {
    const resultEl = document.getElementById('customerProfileResult');
    resultEl.innerHTML = '<div class="text-muted py-3"><div class="SHATER-spinner d-inline-block me-2"></div>جاري تحميل سجل الرحلات...</div>';

    // تحميل سجل الرحلات (بمعرّف الزبون أو رقم هاتفه)
    const ridesMap = {};
    try {
        const [byId, byPhone] = await Promise.all([
            db.collection('rides').where('customerId', '==', customer.id).get().catch(() => null),
            db.collection('rides').where('passengerPhone', '==', customer.phone || '').get().catch(() => null)
        ]);
        [byId, byPhone].forEach(snap => {
            if (!snap) return;
            snap.forEach(d => { const r = { id: d.id, ...d.data() }; if (!ridesMap[r.id]) ridesMap[r.id] = r; });
        });
    } catch (_) {}

    const rides = Object.keys(ridesMap).map(k => ridesMap[k])
        .sort((a, b) => {
            const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
        })
        .slice(0, 15);

    renderCustomerProfile(customer, rides);
}

function renderCustomerProfile(c, rides) {
    const resultEl = document.getElementById('customerProfileResult');
    const isOn = !!c.isOnline;
    const created = c.createdAt && c.createdAt.toDate ? fmtDate(c.createdAt.toDate()) : '-';
    const lastUpd = c.lastUpdated && c.lastUpdated.toDate ? fmtDate(c.lastUpdated.toDate()) : '-';
    const rideLabels = { pending: 'قيد الانتظار', accepted: 'مقبولة', in_progress: 'جارية', completed: 'مكتملة', cancelled: 'ملغاة', expired: 'منتهٍ', no_drivers: 'بلا سائق' };
    const rideColors = { pending: 'warning', accepted: 'primary', in_progress: 'success', completed: 'purple', cancelled: 'danger', expired: 'dark', no_drivers: 'secondary' };

    const ridesHtml = rides.length === 0
        ? '<div class="text-muted text-center py-3">لا توجد رحلات مسجّلة لهذا الزبون</div>'
        : `<div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
                <thead class="table-dark-blue text-white">
                    <tr>
                        <th>من</th>
                        <th>إلى</th>
                        <th>المسافة</th>
                        <th>السعر</th>
                        <th>الحالة</th>
                        <th>التاريخ</th>
                    </tr>
                </thead>
                <tbody>
                    ${rides.map(r => {
                        const createdR = r.createdAt && r.createdAt.toDate ? fmtDate(r.createdAt.toDate()) : '-';
                        return `<tr>
                            <td><small>${escapeHtmlStr(r.pickupAddress || '')}</small></td>
                            <td><small>${escapeHtmlStr(r.dropoffAddress || '')}</small></td>
                            <td><small>${r.realDistanceKm ? r.realDistanceKm + ' كم' : '-'}</small></td>
                            <td><strong>${r.fare || 0}</strong> MRU</td>
                            <td><span class="badge bg-${rideColors[r.status] || 'secondary'}">${rideLabels[r.status] || r.status || '-'}</span></td>
                            <td><small>${createdR}</small></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;

    const location = (c.lat != null && c.lng != null)
        ? Number(c.lat).toFixed(5) + ', ' + Number(c.lng).toFixed(5)
        : '-';

    resultEl.innerHTML = `
        <div class="border rounded-3 p-3 bg-light">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <h6 class="fw-bold mb-0 text-dark-blue"><i class="bi bi-person-circle me-1 text-gold"></i>${escapeHtmlStr(c.name || 'زبون')}</h6>
                <span class="badge ${isOn ? 'bg-success' : 'bg-secondary'}">${isOn ? 'متصل' : 'غير متصل'}</span>
            </div>
            <div class="row g-2 mb-3">
                <div class="col-md-4 col-6"><small class="text-muted d-block">الهاتف</small><span dir="ltr" class="fw-semibold">${escapeHtmlStr(c.phone || '-')}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">الواتساب</small><span dir="ltr" class="fw-semibold">${escapeHtmlStr(c.whatsapp || '-')}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">كلمة السر</small><span dir="ltr" class="fw-semibold">${escapeHtmlStr(c.password || '-')}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">الرصيد</small><span class="fw-bold text-dark-blue">${c.credit || 0} MRU</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">عدد الرحلات</small><span class="fw-semibold">${c.totalRides || 0}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">تاريخ التسجيل</small><span class="fw-semibold">${created}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">آخر تحديث</small><span class="fw-semibold">${lastUpd}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">معرّف الجهاز</small><span dir="ltr" class="fw-semibold small">${escapeHtmlStr(c.deviceId || '-')}</span></div>
                <div class="col-md-4 col-6"><small class="text-muted d-block">الموقع الأخير</small><span dir="ltr" class="fw-semibold small">${location}</span></div>
            </div>
            <h6 class="fw-bold text-dark-blue mb-2"><i class="bi bi-clock-history me-1 text-gold"></i>سجل الرحلات</h6>
            ${ridesHtml}
        </div>`;
}

// Register customer
document.getElementById('registerCustomerBtn').addEventListener('click', async () => {
    const statusEl = 'registerCustomerStatus';
    if (!requireDb(statusEl)) return;
    if (!guardPerm('customers_add', 'ليست لديك صلاحية تسجيل زبائن')) return;
    const name = document.getElementById('newCustomerName').value.trim();
    const phone = document.getElementById('newCustomerPhone').value.trim();
    const whatsapp = document.getElementById('newCustomerWhatsapp').value.trim();
    const password = document.getElementById('newCustomerPassword').value.trim();
    const credit = parseNum(document.getElementById('newCustomerCredit').value) || 0;

    if (!name) { showStatus(statusEl, 'أدخل اسم الزبون', 'error'); return; }
    if (!phone) { showStatus(statusEl, 'أدخل رقم الهاتف', 'error'); return; }
    if (!password) { showStatus(statusEl, 'أدخل كلمة السر', 'error'); return; }

    const btn = document.getElementById('registerCustomerBtn');
    btn.disabled = true; btn.textContent = 'جاري التسجيل...';
    try {
        await db.collection('customers').add({
            name, phone, whatsapp, password, credit,
            lat: 18.0735, lng: -15.9582, geohash: '',
            isOnline: false, totalRides: 0, fcmToken: '', deviceId: '',
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus(statusEl, 'تم التسجيل بنجاح!', 'success');
        document.getElementById('newCustomerName').value = '';
        document.getElementById('newCustomerPhone').value = '';
        document.getElementById('newCustomerWhatsapp').value = '';
        document.getElementById('newCustomerPassword').value = '';
        document.getElementById('newCustomerCredit').value = '0';
        loadCustomersList();
    } catch (err) {
        showStatus(statusEl, 'خطأ: ' + err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'تسجيل الزبون';
});

// ============================================
// BOOTSTRAP MODALS
// ============================================
const editModal = new bootstrap.Modal(document.getElementById('editDriverModal'));
const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
const passwordModal = new bootstrap.Modal(document.getElementById('passwordModal'));
const editCreditModal = new bootstrap.Modal(document.getElementById('editCreditModal'));
const serviceConfirmModal = new bootstrap.Modal(document.getElementById('serviceConfirmModal'));

// Customer modals
const editCustomerModal = new bootstrap.Modal(document.getElementById('editCustomerModal'));
const deleteCustomerModal = new bootstrap.Modal(document.getElementById('deleteCustomerModal'));
const customerPasswordModal = new bootstrap.Modal(document.getElementById('customerPasswordModal'));
const editCustomerCreditModal = new bootstrap.Modal(document.getElementById('editCustomerCreditModal'));
const editAdminModal = new bootstrap.Modal(document.getElementById('editAdminModal'));

window.openPasswordModal = function(id, name) {
    if (!guardPerm('drivers_edit', 'ليست لديك صلاحية تغيير كلمة سر السائق')) return;
    document.getElementById('passwordDriverId').value = id;
    document.getElementById('passwordDriverName').textContent = name;
    document.getElementById('newPasswordValue').value = '';
    passwordModal.show();
};

document.getElementById('savePasswordBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    const id = document.getElementById('passwordDriverId').value;
    const newPass = document.getElementById('newPasswordValue').value.trim();
    if (!newPass) { ARAalert('أدخل كلمة السر الجديدة', 'warning'); return; }
    try {
        await db.collection('drivers').doc(id).update({ password: newPass });
        passwordModal.hide();
        loadDriversList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
});

window.openEditCreditModal = function(id, name, current) {
    document.getElementById('editCreditDriverId').value = id;
    document.getElementById('editCreditDriverName').textContent = name;
    document.getElementById('editCreditCurrent').textContent = current;
    document.getElementById('editCreditNewValue').value = current;
    editCreditModal.show();
};

document.getElementById('confirmEditCreditBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('drivers_credit', 'ليست لديك صلاحية تعديل رصيد السائق')) return;
    const id = document.getElementById('editCreditDriverId').value;
    const newVal = parseNum(document.getElementById('editCreditNewValue').value);
    if (newVal === null || newVal === undefined || isNaN(newVal) || newVal < 0) {
        ARAalert('أدخل رصيد صحيح', 'warning'); return;
    }
    try {
        await db.collection('drivers').doc(id).update({ credit: newVal });
        editCreditModal.hide();
        loadDriversList();
        refreshDriverSearchResult();
        notifyUser('drivers', id, {
            type: 'credit_update',
            title: 'تم تحديث رصيدك',
            body: `أصبح رصيدك ${newVal} MRU`,
            balance: String(newVal)
        });
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
});

window.openEditModal = function(id, name, phone, status) {
    document.getElementById('editDriverId').value = id;
    document.getElementById('editDriverName').value = name;
    document.getElementById('editDriverPhone').value = phone;
    document.getElementById('editDriverStatus').value = status;
    editModal.show();
};

document.getElementById('saveEditBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('drivers_edit', 'ليست لديك صلاحية تعديل بيانات السائقين')) return;
    const id = document.getElementById('editDriverId').value;
    const name = document.getElementById('editDriverName').value.trim();
    const phone = document.getElementById('editDriverPhone').value.trim();
    const status = document.getElementById('editDriverStatus').value;
    if (!name) return;
    try {
        const dup = await db.collection('drivers').where('phone', '==', phone).get();
        const dupDoc = dup.docs.find(d => d.id !== id);
        if (dupDoc) {
            const existing = dupDoc.data().name || 'سائق آخر';
            ARAalert('رقم الهاتف ' + phone + ' مسجل بالفعل للسائق: ' + existing, 'error');
            return;
        }
        await db.collection('drivers').doc(id).update({ name, phone, disabled: status === 'disabled' });
        editModal.hide();
        loadDriversList();
        refreshDriverSearchResult();
    } catch (err) { console.error('Edit error:', err); }
});

window.toggleDriverStatus = async function(id, currentlyDisabled) {
    if (!requireDb()) return;
    if (!guardPerm('drivers_edit', 'ليست لديك صلاحية تعطيل/تفعيل السائقين')) return;
    try {
        await db.collection('drivers').doc(id).update({ disabled: !currentlyDisabled, isOnline: false });
        loadDriversList();
        refreshDriverSearchResult();
    } catch (err) { console.error('Toggle error:', err); }
};

window.openDeleteModal = function(id, name) {
    document.getElementById('deleteDriverId').value = id;
    document.getElementById('deleteDriverName').textContent = name;
    deleteModal.show();
};

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('drivers_delete', 'ليست لديك صلاحية حذف السائقين')) return;
    const id = document.getElementById('deleteDriverId').value;
    try {
        await db.collection('drivers').doc(id).delete();
        deleteModal.hide();
        loadDriversList();
        refreshDriverSearchResult();
    } catch (err) { console.error('Delete error:', err); }
});

window.openCustomerPasswordModal = function(id, name) {
    document.getElementById('customerPasswordId').value = id;
    document.getElementById('customerPasswordName').textContent = name;
    document.getElementById('newCustomerPasswordValue').value = '';
    customerPasswordModal.show();
};

document.getElementById('saveCustomerPasswordBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('customers_edit', 'ليست لديك صلاحية تغيير كلمة سر الزبون')) return;
    const id = document.getElementById('customerPasswordId').value;
    const newPass = document.getElementById('newCustomerPasswordValue').value.trim();
    if (!newPass) { ARAalert('أدخل كلمة السر الجديدة', 'warning'); return; }
    try {
        await db.collection('customers').doc(id).update({ password: newPass });
        customerPasswordModal.hide();
        loadCustomersList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
});

window.openEditCustomerCreditModal = function(id, name, current) {
    document.getElementById('editCustomerCreditId').value = id;
    document.getElementById('editCustomerCreditName').textContent = name;
    document.getElementById('editCustomerCreditCurrent').textContent = current;
    document.getElementById('editCustomerCreditNewValue').value = current;
    editCustomerCreditModal.show();
};

document.getElementById('confirmEditCustomerCreditBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('customers_credit', 'ليست لديك صلاحية تعديل رصيد الزبون')) return;
    const id = document.getElementById('editCustomerCreditId').value;
    const newVal = parseNum(document.getElementById('editCustomerCreditNewValue').value);
    if (newVal === null || newVal === undefined || isNaN(newVal) || newVal < 0) {
        ARAalert('أدخل رصيد صحيح', 'warning'); return;
    }
    try {
        await db.collection('customers').doc(id).update({ credit: newVal });
        editCustomerCreditModal.hide();
        loadCustomersList();
        notifyUser('customers', id, {
            type: 'credit_update',
            title: 'تم تحديث رصيدك',
            body: `أصبح رصيدك ${newVal} MRU`,
            balance: String(newVal)
        });
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
});

window.openEditCustomerModal = function(id, name, phone, whatsapp) {
    document.getElementById('editCustomerId').value = id;
    document.getElementById('editCustomerName').value = name;
    document.getElementById('editCustomerPhone').value = phone;
    document.getElementById('editCustomerWhatsapp').value = whatsapp;
    editCustomerModal.show();
};

document.getElementById('saveEditCustomerBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('customers_edit', 'ليست لديك صلاحية تعديل بيانات الزبائن')) return;
    const id = document.getElementById('editCustomerId').value;
    const name = document.getElementById('editCustomerName').value.trim();
    const phone = document.getElementById('editCustomerPhone').value.trim();
    const whatsapp = document.getElementById('editCustomerWhatsapp').value.trim();
    if (!name) return;
    try {
        await db.collection('customers').doc(id).update({ name, phone, whatsapp });
        editCustomerModal.hide();
        loadCustomersList();
    } catch (err) { console.error('Edit customer error:', err); }
});

window.openDeleteCustomerModal = function(id, name) {
    document.getElementById('deleteCustomerId').value = id;
    document.getElementById('deleteCustomerName').textContent = name;
    deleteCustomerModal.show();
};

document.getElementById('confirmDeleteCustomerBtn').addEventListener('click', async () => {
    if (!requireDb()) return;
    if (!guardPerm('customers_delete', 'ليست لديك صلاحية حذف الزبائن')) return;
    const id = document.getElementById('deleteCustomerId').value;
    try {
        await db.collection('customers').doc(id).delete();
        deleteCustomerModal.hide();
        loadCustomersList();
    } catch (err) { console.error('Delete customer error:', err); }
});

async function resolveRechargeNames(docs) {
    const nameMap = {};
    const grouped = {};
    docs.forEach(({ r }) => {
        if (r.type !== 'subscription' || r.userName || r.name) return;
        if (!r.userId) return;
        const coll = (r.userRole || 'customer') === 'customer' ? 'customers' : 'drivers';
        if (!grouped[coll]) grouped[coll] = [];
        grouped[coll].push(r.userId);
    });
    for (const coll of Object.keys(grouped)) {
        const ids = grouped[coll];
        for (let i = 0; i < ids.length; i += 10) {
            const chunk = ids.slice(i, i + 10);
            try {
                const snap = await db.collection(coll)
                    .where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get();
                snap.forEach(doc => { nameMap[doc.id] = (doc.data().name || '—'); });
            } catch (e) { console.error('Resolve names error:', e); }
        }
    }
    return nameMap;
}

window.openImageModal = function (imgEl) {
    const modal = document.getElementById('imageViewerModal');
    if (!modal || !imgEl) return;
    const caption = document.getElementById('imageViewerCaption');
    if (caption) caption.textContent = imgEl.alt || imgEl.title || 'معاينة';
    document.getElementById('imageViewerImg').src = imgEl.src;
    const bs = bootstrap.Modal.getOrCreateInstance(modal);
    bs.show();
};

window.openDriverDocuments = async function (driverId) {
    if (!requireDb()) return;
    const modal = document.getElementById('driverDocsModal');
    const body = document.getElementById('driverDocsBody');
    if (!modal || !body) return;
    body.innerHTML = '<div class="text-center py-4"><div class="SHATER-spinner mx-auto"></div></div>';
    const bs = bootstrap.Modal.getOrCreateInstance(modal);
    bs.show();
    try {
        const snap = await db.collection('drivers').doc(driverId).get();
        if (!snap.exists) {
            body.innerHTML = '<div class="text-center text-muted py-4">السائق غير موجود</div>';
            return;
        }
        const d = snap.data() || {};
        const docs = [
            { label: 'الصورة الشخصية', url: d.photoUrl || '' },
            { label: 'البطاقة الشخصية', url: d.identityPhotoUrl || d.identityPhoto || '' },
            { label: 'البطاقة الرمادية', url: d.licensePhotoUrl || d.licensePhoto || '' },
            { label: 'التأمين على المركبة', url: d.insurancePhotoUrl || '' }
        ].filter(x => x.url);

        // ---- Subscription payment request (proof + amount) for this driver ----
        let subHtml = '';
        let subReq = null;
        try {
            const subsSnap = await db.collection('recharge_requests')
                .where('type', '==', 'subscription')
                .get();
            subsSnap.forEach(r => {
                const rd = r.data() || {};
                if (rd.userId !== driverId && rd.driverId !== driverId) return;
                const t = rd.createdAt && rd.createdAt.toDate ? rd.createdAt.toDate().getTime() : 0;
                if (!subReq || t > subReq.time) subReq = { time: t, ...rd };
            });
            if (subReq) {
                const statusLabels = { pending: 'قيد الانتظار', approved: 'مقبول', rejected: 'مرفوض' };
                const badgeCls = { pending: 'badge bg-warning text-dark', approved: 'badge bg-success', rejected: 'badge bg-danger' };
                const proof = subReq.proofImageUrl
                    ? `<img src="${subReq.proofImageUrl}" class="img-fluid rounded-3" style="max-height:220px;cursor:zoom-in;" onclick="openImageModal(this)" title="عرض لقطة دفع الاشتراك">`
                    : (subReq.screenshotBase64
                        ? `<img src="data:image/jpeg;base64,${subReq.screenshotBase64}" class="img-fluid rounded-3" style="max-height:220px;cursor:zoom-in;" onclick="openImageModal(this)" title="عرض لقطة دفع الاشتراك">`
                        : '<div class="text-muted small">لا توجد لقطة إثبات</div>');
                const subTime = subReq.createdAt && subReq.createdAt.toDate
                    ? subReq.createdAt.toDate().toLocaleString('ar-MA')
                    : '-';
                subHtml = `
                <div class="mt-4 pt-3 border-top">
                    <div class="d-flex align-items-center mb-2">
                        <i class="bi bi-credit-card-2-front text-primary fs-5 me-2"></i>
                        <strong class="text-dark">دفع الاشتراك الشهري</strong>
                        <span class="ms-auto"><span class="${badgeCls[subReq.status] || 'badge bg-secondary'}">${statusLabels[subReq.status] || subReq.status}</span></span>
                    </div>
                    <div class="row g-2 small text-muted">
                        <div class="col-4"><span class="fw-bold text-dark">المبلغ:</span> ${subReq.amount || 0} MRU</div>
                        <div class="col-4"><span class="fw-bold text-dark">الوسيلة:</span> ${subReq.paymentMethod || '—'}</div>
                        <div class="col-4"><span class="fw-bold text-dark">التاريخ:</span> ${subTime}</div>
                    </div>
                    <div class="mt-2">${proof}</div>
                </div>`;
            } else {
                subHtml = '<div class="mt-4 pt-3 border-top"><div class="text-muted small">لم يُرفع إثبات دفع الاشتراك بعد</div></div>';
            }
        } catch (err) {
            console.error('Load driver subscription error:', err);
            subHtml = '<div class="mt-4 pt-3 border-top"><div class="text-danger small">خطأ في تحميل بيانات الاشتراك</div></div>';
        }

        if (docs.length === 0 && !subReq) {
            body.innerHTML = '<div class="text-center text-muted py-4">لا توجد وثائق مرفوعة</div>';
            return;
        }
        body.innerHTML = `<div class="row g-3">${docs.map(x => `
            <div class="col-6 col-md-3">
                <div class="card h-100 border-0 shadow-sm rounded-3">
                    <img src="${x.url}" class="card-img-top rounded-top-3" style="height:130px;object-fit:cover;cursor:zoom-in;" onclick="openImageModal(this)" alt="${x.label}" title="${x.label}">
                    <div class="card-body py-2 px-2 text-center">
                        <small class="fw-bold text-dark">${x.label}</small>
                    </div>
                </div>
            </div>`).join('')}</div>${subHtml}`;
    } catch (err) {
        console.error('Open driver documents error:', err);
        body.innerHTML = '<div class="text-center text-danger py-4">خطأ في تحميل الوثائق</div>';
    }
};

window.approveRechargeRequest = async function(requestId) {
    if (!requireDb()) return;
    if (!guardPerm('recharge_approve', 'ليست لديك صلاحية الموافقة على الطلبات')) return;
    let reqDoc;
    try {
        reqDoc = await db.collection('recharge_requests').doc(requestId).get();
    } catch (e) { ARAalert('خطأ: ' + e.message, 'error'); return; }
    if (!reqDoc.exists) { ARAalert('الطلب غير موجود', 'error'); return; }
    const r = reqDoc.data() || {};
    if (r.type !== 'subscription') { ARAalert('هذا الطلب ليس اشتراكاً', 'warning'); return; }
    const roleKey = r.userRole || r.role || 'customer';
    const isDriver = roleKey === 'driver' || roleKey === 'delivery';
    const targetColl = isDriver ? 'drivers' : 'customers';
    const targetId = r.userId || (isDriver ? r.driverId : r.customerId);
    const amount = r.amount || 0;
    if (!targetId) { ARAalert('بيانات الطلب ناقصة', 'warning'); return; }

    // ---- Activate / renew subscription (yearly for customers, monthly for drivers/delivery) ----
    const label = roleKey === 'customer' ? 'الزبون' : (roleKey === 'delivery' ? 'سائق التوصيل' : 'السائق');
    const isYearly = roleKey === 'customer';
    const months = isYearly ? 12 : 1;
    const planLabel = isYearly ? 'اشتراك سنوي (12 شهر)' : 'اشتراك شهري (شهر واحد)';
    const now = new Date();
    let base = now;
    try {
        const targetDoc = await db.collection(targetColl).doc(targetId).get();
        const cur = targetDoc.exists ? (targetDoc.data() || {}).subscription : null;
        const curExp = cur && cur.expiresAt && cur.expiresAt.toDate ? cur.expiresAt.toDate() : null;
        if (cur && cur.active === true && curExp && curExp > now) base = curExp;
    } catch (e) { console.error('Read subscription base error:', e); }
    const expires = new Date(base);
    expires.setMonth(expires.getMonth() + months);
    const expLabel = expires.toLocaleDateString('ar-MA');
    const isRenewal = base > now;
    if (!(await ARAconfirm(`${isRenewal ? 'سيتم تجديد' : 'سيتم تفعيل'} الاشتراك (${planLabel} — ${amount} MRU) لـ ${label} حتى ${expLabel}. تأكيد؟`))) return;
    try {
        await db.collection(targetColl).doc(targetId).update({
            'subscription.active': true,
            'subscription.type': isYearly ? 'yearly' : 'monthly',
            'subscription.period': isYearly ? 'year' : 'month',
            'subscription.amount': amount,
            'subscription.activatedAt': firebase.firestore.FieldValue.serverTimestamp(),
            'subscription.lastPaidAt': firebase.firestore.FieldValue.serverTimestamp(),
            'subscription.expiresAt': expires,
            status: 'active'
        });
        await db.collection('recharge_requests').doc(requestId).update({
            status: 'approved',
            processedAt: firebase.firestore.FieldValue.serverTimestamp(),
            processedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
        });
        if (isDriver) loadDriversList(); else loadCustomersList();
        let notifBody = `${isRenewal ? 'تم تجديد' : 'تم تفعيل'} اشتراكك (${planLabel}) بنجاح حتى ${expLabel}`;
        const notifExtra = { amount: String(amount) };
        if (!isRenewal) {
            let targetData = {};
            try {
                const tDoc = await db.collection(targetColl).doc(targetId).get();
                if (tDoc.exists) targetData = tDoc.data() || {};
            } catch (e) { console.error('Read target for notification error:', e); }
            const phone = targetData.phone || r.phone || '';
            const password = targetData.password || '';
            if (phone || password) {
                notifBody += ` بيانات الدخول الخاصة بك: رقم الهاتف: ${phone} — كلمة المرور: ${password}.`;
                notifExtra.sound = 'approval';
            }
        }
        await notifyUser(targetColl, targetId, {
            type: 'subscription_approved',
            title: isRenewal ? 'تم تجديد اشتراكك' : 'تم اعتماد تسجيلك واشتراكك',
            body: notifBody,
            ...notifExtra
        });
        ARAalert(isRenewal ? 'تم تجديد الاشتراك' : 'تم تفعيل الاشتراك', 'success');
    } catch (err) { console.error('Approve subscription error:', err); ARAalert('خطأ: ' + err.message, 'error'); }
};

window.rejectRechargeRequest = async function(requestId) {
    if (!requireDb()) return;
    if (!guardPerm('recharge_approve', 'ليست لديك صلاحية رفض طلبات الاشتراك')) return;
    const reason = await ARAprompt('سبب الرفض', 'أدخل سبب الرفض (سيصل للزبون/السائق)');
    if (reason === null || reason.trim() === '') { ARAalert('تم إلغاء الرفض: لم يُدخل سبب', 'warning'); return; }
    if (!(await ARAconfirm('سيتم رفض طلب الاشتراك وإرسال السبب للزبون. تأكيد؟'))) return;
    try {
        const reqDoc = await db.collection('recharge_requests').doc(requestId).get();
        if (!reqDoc.exists) { ARAalert('الطلب غير موجود', 'error'); return; }
        const reqData = reqDoc.data() || {};
        if (reqData.type !== 'subscription') { ARAalert('هذا الطلب ليس اشتراكاً', 'warning'); return; }
        const roleKey = reqData.userRole || reqData.role || 'customer';
        const isDriver = roleKey === 'driver' || roleKey === 'delivery';
        const targetId = reqData.userId || (isDriver ? reqData.driverId : reqData.customerId);
        const amount = reqData.amount || 0;
        await db.collection('recharge_requests').doc(requestId).update({
            status: 'rejected',
            rejectionReason: reason,
            processedAt: firebase.firestore.FieldValue.serverTimestamp(),
            processedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
        });
        if (targetId) {
            await notifyUser(isDriver ? 'drivers' : 'customers', targetId, {
                type: 'subscription_rejected',
                title: 'تم رفض طلب اشتراكك',
                body: `تم رفض طلب اشتراكك (${amount} MRU). السبب: ${reason}`,
                amount: String(amount),
                rejectionReason: reason
            });
        }
        if (isDriver) loadDriversList(); else loadCustomersList();
        ARAalert('تم رفض الطلب وإرسال السبب', 'info');
    } catch (err) { console.error('Reject subscription error:', err); ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteSubscriptionRequest = async function (requestId) {
    if (!requireDb()) return;
    if (!guardPerm('recharge_approve', 'ليست لديك صلاحية إدارة سجل الاشتراكات')) return;
    if (!(await ARAconfirm('سيتم حذف طلب الاشتراك من السجل نهائياً. حساب المستخدم واشتراكه الفعّال لن يتأثرا. تأكيد؟'))) return;
    try {
        await db.collection('recharge_requests').doc(requestId).delete();
        ARAalert('تم حذف الطلب من السجل', 'success');
    } catch (err) { console.error('Delete subscription request error:', err); ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// SUBSCRIPTION TABLES (اشتراكات الزبائن / السائقين / التوصيل)
// ============================================
function loadSubscriptionTable(role) {
    if (!requireDb()) return;
    const map = {
        customer: { tbody: 'customerSubsTableBody', count: 'customerSubsCount', unsubKey: 'customerSubsUnsubscribe', label: 'زبون', badge: 'customerSubsNavBadge' },
        driver: { tbody: 'driverSubsTableBody', count: 'driverSubsCount', unsubKey: 'driverSubsUnsubscribe', label: 'سائق', badge: 'driverSubsNavBadge' },
        delivery: { tbody: 'deliverySubsTableBody', count: 'deliverySubsCount', unsubKey: 'deliverySubsUnsubscribe', label: 'توصيل', badge: 'deliverySubsNavBadge' }
    };
    const cfg = map[role];
    if (!cfg) return;
    let currentUnsub = role === 'customer' ? customerSubsUnsubscribe
        : role === 'driver' ? driverSubsUnsubscribe
        : deliverySubsUnsubscribe;
    if (currentUnsub) { currentUnsub(); currentUnsub = null; }
    const setUnsub = (h) => {
        if (role === 'customer') customerSubsUnsubscribe = h;
        else if (role === 'driver') driverSubsUnsubscribe = h;
        else deliverySubsUnsubscribe = h;
    };
    const tbody = document.getElementById(cfg.tbody);
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-3"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل الاشتراكات...</div></td></tr>';
    const labels = { pending: 'قيد الانتظار', approved: 'مقبول', rejected: 'مرفوض' };
    const badgeCls = { pending: 'badge bg-warning text-dark', approved: 'badge bg-success', rejected: 'badge bg-danger' };
    try {
        const handle = db.collection('recharge_requests')
            .where('type', '==', 'subscription')
            .onSnapshot(snapshot => {
                const docs = [];
                let pendingCount = 0;
                snapshot.forEach(d => {
                    const r = d.data();
                    if (r.userRole !== role) return;
                    if (r.status === 'pending') pendingCount++;
                    docs.push({ id: d.id, r });
                });
                docs.sort((a, b) => {
                    const ta = a.r.createdAt && a.r.createdAt.toDate ? a.r.createdAt.toDate().getTime() : 0;
                    const tb = b.r.createdAt && b.r.createdAt.toDate ? b.r.createdAt.toDate().getTime() : 0;
                    return tb - ta;
                });
                const recent = docs.slice(0, 100);
                document.getElementById(cfg.count).textContent = recent.length;
                const pendingBadge = document.getElementById(cfg.badge);
                if (pendingBadge) {
                    pendingBadge.textContent = pendingCount > 99 ? '99+' : pendingCount;
                    pendingBadge.classList.toggle('show', pendingCount > 0);
                }
                if (recent.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">لا توجد طلبات اشتراك</td></tr>';
                    return;
                }
                resolveRechargeNames(recent).then(nameMap => {
                    tbody.innerHTML = recent.map(({ id, r }) => {
                        const time = r.createdAt && r.createdAt.toDate
                            ? r.createdAt.toDate().toLocaleString('ar-MA')
                            : '-';
                        const name = r.userName || r.name || (r.userRole === 'customer' ? r.customerName : r.driverName) || nameMap[r.userId] || '—';
                        const phone = r.phone || (r.userRole === 'customer' ? r.customerPhone : r.driverPhone) || '-';
                        const safeName = String(name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        const plan = role === 'customer' ? 'سنة' : 'شهر';
                        const proof = r.screenshotBase64
                            ? `<img src="data:image/jpeg;base64,${r.screenshotBase64}" class="recharge-thumb" onclick="openImageModal(this)" title="عرض لقطة الشاشة">`
                            : (r.proofImageUrl
                                ? `<img src="${r.proofImageUrl}" class="recharge-thumb" onclick="openImageModal(this)" title="عرض إثبات الدفع">`
                                : `<span class="text-muted small">${r.transactionRef || 'لا يوجد'}</span>`);
                        let actions = '';
                        if (r.status === 'pending') {
                            actions = `<button class="btn-action btn-action-edit" onclick="approveRechargeRequest('${id}')">تفعيل</button>
                                       <button class="btn-action btn-action-delete" onclick="rejectRechargeRequest('${id}')">رفض</button>`;
                        } else {
                            actions = '<span class="text-muted small">تمت المعالجة</span>';
                        }
                        actions += `<button class="btn-action btn-action-delete" onclick="deleteSubscriptionRequest('${id}')" title="حذف من السجل"><i class="bi bi-trash"></i></button>`;
                        return `<tr>
                            <td><strong>${safeName}</strong></td>
                            <td><span dir="ltr">${phone}</span>${r.transactionRef ? `<br><small class="text-muted" dir="ltr">مرجع: ${r.transactionRef}</small>` : ''}</td>
                            <td><strong>${r.amount || 0}</strong> MRU<br><small class="text-muted">${r.paymentMethod || '—'} • ${plan}</small></td>
                            <td>${proof}</td>
                            <td class="small text-muted">${time}</td>
                            <td><span class="${badgeCls[r.status] || 'badge bg-secondary'}">${labels[r.status] || r.status}</span></td>
                            <td><div class="d-flex gap-1 flex-wrap">${actions}</div></td>
                        </tr>`;
                    }).join('');
                });
            }, err => {
                console.error('Subscription table error:', err);
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">خطأ في تحميل الاشتراكات</td></tr>';
            });
        setUnsub(handle);
    } catch (err) {
        console.error('Load subscription table error:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">خطأ في تحميل الاشتراكات</td></tr>';
    }
}

// ============================================
// DRIVER REGISTRATIONS (طلبات تسجيل السائقين)
// ============================================
async function loadDriverRegistrations() {
    if (!requireDb()) return;
    const tbody = document.getElementById('driverRegsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل الطلبات...</div></td></tr>';
    try {
        const snapshot = await db.collection('drivers').where('pendingRegistration', '==', true).get();
        const docs = [];
        snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
        document.getElementById('driverRegsCount').textContent = docs.length;
        if (docs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">لا توجد طلبات تسجيل جديدة</td></tr>';
            return;
        }
        const statusBadges = { true: '<span class="badge bg-warning text-dark">قيد المراجعة</span>' };
        tbody.innerHTML = docs.map(d => {
            const time = d.createdAt && d.createdAt.toDate
                ? d.createdAt.toDate().toLocaleString('ar-MA')
                : '-';
            const safeName = (d.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const isDelivery = d.role === 'delivery' || d.vehicleType === 'bike';
            const hasDocs = !!(d.photoUrl || d.identityPhotoUrl || d.identityPhoto || d.licensePhotoUrl || d.licensePhoto || d.insurancePhotoUrl);
            const docInfo = hasDocs
                ? `<button class="btn-action btn-action-edit" onclick="openDriverDocuments('${d.id}')">عرض الوثائق</button>`
                : '<span class="text-muted small">—</span>';
            const answers = (d.answers && typeof d.answers === 'object')
                ? `<small class="text-muted">${(Object.values(d.answers)).join(' • ') || '—'}</small>`
                : '<span class="text-muted small">—</span>';
            return `<tr>
                <td><strong>${safeName}</strong></td>
                <td><span dir="ltr">${d.phone || '-'}</span></td>
                <td>${isDelivery
                    ? '<span class="badge bg-success">توصيل (دراجة)</span>'
                    : '<span class="badge bg-info">سائق سيارة</span>'}</td>
                <td>${docInfo}</td>
                <td>${answers}</td>
                <td class="small text-muted">${time}</td>
                <td>${statusBadges[d.pendingRegistration] || '<span class="badge bg-secondary">معالج</span>'}</td>
                <td><div class="d-flex gap-1 flex-wrap">
                    <button class="btn-action btn-action-edit" onclick="approveDriverRegistration('${d.id}')">قبول</button>
                    <button class="btn-action btn-action-delete" onclick="rejectDriverRegistration('${d.id}')">رفض</button>
                </div></td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Load driver registrations error:', err);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">خطأ في تحميل الطلبات</td></tr>';
    }
}

window.approveDriverRegistration = async function (driverId) {
    if (!requireDb()) return;
    if (!guardPerm('drivers', 'ليست لديك صلاحية إدارة السائقين')) return;
    try {
        const docRef = db.collection('drivers').doc(driverId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) { ARAalert('السائق غير موجود', 'error'); return; }
        const data = docSnap.data() || {};
        if (!(await ARAconfirm(`سيتم قبول طلب تسجيل السائق «${data.name || '—'}» وفتح حساب له. تأكيد؟`))) return;
        await docRef.update({
            pendingRegistration: false,
            registrationApproved: true,
            registrationApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const phone = data.phone || '';
        const password = data.password || '';
        await notifyUser('drivers', driverId, {
            type: 'registration_approved',
            title: 'تم قبول تسجيلك — أهلاً بك في شاطر',
            body: `تمت الموافقة على طلب تسجيلك. بيانات الدخول الخاصة بك: رقم الهاتف: ${phone} — كلمة المرور: ${password}. يمكنك الآن تسجيل الدخول وتفعيل اشتراكك.`,
            sound: 'approval'
        });
        ARAalert('تم قبول السائق وإشعاره', 'success');
        loadDriverRegistrations();
        loadDriversList();
        if ((data.role || '') === 'delivery') loadDeliveryDrivers();
    } catch (err) { console.error('Approve driver registration error:', err); ARAalert('خطأ: ' + err.message, 'error'); }
};

window.rejectDriverRegistration = async function (driverId) {
    if (!requireDb()) return;
    if (!guardPerm('drivers', 'ليست لديك صلاحية إدارة السائقين')) return;
    const reason = await ARAprompt('سبب الرفض', 'أدخل سبب الرفض (سيصل للسائق)');
    if (reason === null || reason.trim() === '') { ARAalert('تم إلغاء الرفض: لم يُدخل سبب', 'warning'); return; }
    try {
        const docRef = db.collection('drivers').doc(driverId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) { ARAalert('السائق غير موجود', 'error'); return; }
        const data = docSnap.data() || {};
        if (!(await ARAconfirm(`سيتم رفض تسجيل السائق «${data.name || '—'}» وإرسال السبب إليه. تأكيد؟`))) return;
        await docRef.update({
            pendingRegistration: false,
            registrationApproved: false,
            disabled: true,
            rejectionReason: reason
        });
        await notifyUser('drivers', driverId, {
            type: 'registration_rejected',
            title: 'تم رفض طلب تسجيلك',
            body: `تم رفض طلب تسجيلك. السبب: ${reason}`,
            rejectionReason: reason
        });
        ARAalert('تم رفض السائق وإرسال السبب', 'info');
        loadDriverRegistrations();
    } catch (err) { console.error('Reject driver registration error:', err); ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// OVERVIEW (نظرة عامة)
// ============================================
async function loadOverview() {
    if (!requireDb()) return;
    try {
        const [custSnap, driverSnap, subsSnap, regsSnap, ridesSnap] = await Promise.all([
            db.collection('customers').get(),
            db.collection('drivers').get(),
            db.collection('recharge_requests').where('type', '==', 'subscription').get(),
            db.collection('drivers').where('pendingRegistration', '==', true).get(),
            db.collection('rides').get()
        ]);
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('ovCustomers', custSnap.size);
        let pendingSubs = 0;
        subsSnap.forEach(doc => { if (doc.data().status === 'pending') pendingSubs++; });
        set('ovPendingSubs', pendingSubs);
        set('ovPendingRegs', regsSnap.size);
        let activeCustSubs = 0, activeDriverSubs = 0, deliveryCount = 0, activeDeliverySubs = 0, driverCount = 0;
        custSnap.forEach(doc => { const s = doc.data().subscription || {}; if (s.active && (!s.expiresAt || s.expiresAt.toDate() > new Date())) activeCustSubs++; });
        driverSnap.forEach(doc => {
            const d = doc.data();
            if (d.role === 'delivery') {
                deliveryCount++;
                const s = d.subscription || {};
                if (s.active && (!s.expiresAt || s.expiresAt.toDate() > new Date())) activeDeliverySubs++;
            } else {
                driverCount++;
                const s = d.subscription || {};
                if (s.active && (!s.expiresAt || s.expiresAt.toDate() > new Date())) activeDriverSubs++;
            }
        });
        set('ovCustomerSubs', activeCustSubs);
        set('ovDrivers', driverCount);
        set('ovDriverSubs', activeDriverSubs);
        set('ovDeliveryDrivers', deliveryCount);
        set('ovDeliverySubs', activeDeliverySubs);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let todayRides = 0;
        ridesSnap.forEach(doc => {
            const r = doc.data();
            const t = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
            if (t && t >= today) todayRides++;
        });
        set('ovTodayRides', todayRides);
    } catch (err) {
        console.error('Load overview error:', err);
    }
}

// Export customers CSV
window.exportCustomersCSV = function () {
    if (allCustomers.length === 0) { ARAalert('لا يوجد زبائن للتصدير', 'info'); return; }
    let csv = '\uFEFF' + 'الاسم,الهاتف,الواتساب,الرصيد,الحالة,الرحلات\n';
    allCustomers.forEach(c => {
        const status = c.isOnline ? 'متصل' : 'غير متصل';
        csv += `${c.name||''},${c.phone||''},${c.whatsapp||''},${c.credit||0},${status},${c.totalRides||0}\n`;
    });
    downloadCSV(csv, 'shater_customers.csv');
};

// ============================================
// RIDES LIST
// ============================================
async function loadRidesList() {
    if (!requireDb()) return;
    if (ridesListUnsubscribe) { ridesListUnsubscribe(); ridesListUnsubscribe = null; }
    const tbody = document.getElementById('ridesTableBody');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل الرحلات...</div></td></tr>';
    try {
        ridesListUnsubscribe = db.collection('rides').orderBy('createdAt', 'desc').limit(100)
            .onSnapshot(snapshot => {
                allRides = [];
                snapshot.forEach(doc => allRides.push({ id: doc.id, ...doc.data() }));
                enrichRidesWithDrivers(allRides, () => {
                    const currentFilter = document.getElementById('filterRideStatus')?.value || 'all';
                    if (currentFilter === 'all') renderRidesList(allRides);
                    else renderRidesList(allRides.filter(r => r.status === currentFilter));
                });
            }, err => {
                console.error('Rides listener error:', err);
                tbody.innerHTML = '<tr><td colspan="12" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
            });
    } catch (err) {
        console.error('Load rides error:', err);
        tbody.innerHTML = '<tr><td colspan="12" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

async function enrichRidesWithDrivers(rides, done) {
    const ids = [...new Set(rides.map(r => r.assignedDriverId).filter(Boolean))];
    const missing = ids.filter(id => !driversInfoCache[id]);
    for (let i = 0; i < missing.length; i += 10) {
        const chunk = missing.slice(i, i + 10);
        try {
            const snap = await db.collection('drivers').where('__name__', 'in', chunk).get();
            snap.forEach(d => {
                const dd = d.data();
                driversInfoCache[d.id] = { name: dd.name || 'سائق', phone: dd.phone || '-' };
            });
        } catch (e) { console.error('Driver lookup error:', e); }
    }
    if (done) done();
}

function renderRidesList(rides) {
    const tbody = document.getElementById('ridesTableBody');
    if (rides.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-4">لا توجد رحلات</td></tr>';
        return;
    }
    const labels = { pending: 'قيد الانتظار', accepted: 'مقبولة', in_progress: 'جارية', completed: 'مكتملة', cancelled: 'ملغاة', expired: 'منتهٍ', no_drivers: 'بلا سائق' };
    const colors = { pending: 'warning', accepted: 'primary', in_progress: 'success', completed: 'purple', cancelled: 'danger', expired: 'dark', no_drivers: 'secondary' };
    const canCancel = ['pending', 'accepted', 'in_progress'];
    tbody.innerHTML = rides.map(r => {
        const created = r.createdAt?.toDate ? fmtDate(r.createdAt.toDate()) : '-';
        const fare = r.finalPrice || r.fare || 0;
        const comm = r.commissionAmount || Math.round(fare * commissionPercent / 100);
        const commPct = r.commissionPercent || commissionPercent;
        const dist = r.realDistanceKm ? `${r.realDistanceKm} كم` : '-';
        const isOpen = r.rideKind === 'open' || r.rideType === 'open';
        const rideTypeBadge = isOpen
            ? '<span class="badge bg-info text-dark"><i class="bi bi-stopwatch me-1"></i>جولة مفتوحة</span>'
            : '<span class="badge bg-secondary"><i class="bi bi-sign-turn-right me-1"></i>محددة</span>';
        const driver = r.assignedDriverId ? (driversInfoCache[r.assignedDriverId] || null) : null;
        const driverName = driver ? driver.name : (r.assignedDriverId ? '...' : '-');
        const driverPhone = driver ? driver.phone : '-';
        const actionBtn = canCancel.includes(r.status)
            ? `<button class="btn-action btn-action-delete mt-1" onclick="cancelRide('${r.id}')">إلغاء</button> `
            : '';
        const deleteBtn = `<button class="btn-action btn-action-delete mt-1" onclick="deleteRide('${r.id}')" title="حذف السجل"><i class="bi bi-trash"></i></button>`;
        return `<tr>
            <td><strong>${r.passengerName || '-'}</strong></td>
            <td class="d-none d-md-table-cell"><small dir="ltr">${r.passengerPhone || '-'}</small></td>
            <td class="d-none d-md-table-cell">${r.pickupAddress || '-'}</td>
            <td class="d-none d-md-table-cell">${r.dropoffAddress || '-'}</td>
            <td>${rideTypeBadge}</td>
            <td><small>${dist}</small></td>
            <td><strong>${fare}</strong> MRU</td>
            <td><strong class="text-danger">${comm}</strong> MRU <small class="text-muted">(${commPct}%)</small></td>
            <td><strong>${driverName}</strong></td>
            <td class="d-none d-lg-table-cell"><small dir="ltr">${driverPhone}</small></td>
            <td><span class="badge bg-${colors[r.status] || 'secondary'}">${labels[r.status] || r.status}</span></td>
            <td class="d-none d-lg-table-cell"><small>${created}</small></td>
            <td>${actionBtn}${deleteBtn}</td>
        </tr>`;
    }).join('');
}

window.cancelRide = async function (rideId) {
    if (!(await ARAconfirm('هل أنت متأكد من إلغاء هذه الرحلة؟'))) return;
    if (!requireDb()) return;
    try {
        markSelfTouched(rideId);
        const snap = await db.collection('rides').doc(rideId).get();
        let deliveryId = null;
        if (snap.exists) deliveryId = snap.data().deliveryId || null;
        await db.collection('rides').doc(rideId).update({
            status: 'cancelled',
            cancelledBy: 'admin',
            cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (deliveryId) {
            const dSnap = await db.collection('delivery_requests').doc(deliveryId).get();
            if (dSnap.exists) {
                const dSt = dSnap.data().status || '';
                if (!['completed', 'cancelled'].includes(dSt)) {
                    await db.collection('delivery_requests').doc(deliveryId).update({ status: 'accepted' });
                }
            }
            notifyDeliveryCustomer(deliveryId, {
                title: 'تم إلغاء رحلتك',
                body: 'قام المشرف بإلغاء رحلتك. يمكننا إعادة تفعيلها عند الطلب، أو يمكنك تقديم طلب جديد في أي وقت.',
                data: { status: 'cancelled', cancelledBy: 'admin' }
            });
        }
        if (currentPage === 'rides') loadRidesList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteRide = async function (rideId) {
    if (!(await ARAconfirm('حذف هذا السجل نهائياً من سجل الرحلات؟'))) return;
    if (!requireDb()) return;
    try {
        const snap = await db.collection('rides').doc(rideId).get();
        if (!snap.exists) return;
        const r = snap.data() || {};
        if (['accepted', 'in_progress'].includes(r.status)) {
            ARAalert('لا يمكن حذف رحلة نشطة — ألغها أولاً ثم احذف سجلها', 'warning');
            return;
        }
        await db.collection('rides').doc(rideId).delete();
        const deliveryId = r.deliveryId;
        if (deliveryId) {
            const dSnap = await db.collection('delivery_requests').doc(deliveryId).get();
            if (dSnap.exists && dSnap.data().rideId === rideId) {
                const curSt = dSnap.data().status || '';
                let newSt = curSt;
                if (curSt === 'launched' || curSt === 'in_progress') newSt = 'accepted';
                const upd = { rideId: firebase.firestore.FieldValue.delete() };
                if (newSt !== curSt) upd.status = newSt;
                await db.collection('delivery_requests').doc(deliveryId).update(upd);
            }
        }
        addNotifLog('system', `🗑️ تم حذف سجل الرحلة ${rideId}`);
        if (currentPage === 'rides') loadRidesList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

document.getElementById('filterRideStatus').addEventListener('change', () => {
    const s = document.getElementById('filterRideStatus').value;
    renderRidesList(s === 'all' ? allRides : allRides.filter(r => r.status === s));
});

// ============================================
// HELPERS (Latin digits + dates)
// ============================================
function fmtDate(d) {
    try {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + mi;
    } catch (e) { return '-'; }
}

function fmtNum(n) {
    if (n == null) return '';
    return String(n).replace(/[٠-٩۰-۹]/g, function (ch) {
        return String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(ch) % 10);
    });
}

function escapeHtmlStr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// DELIVERIES (from Customer App)
// ============================================
const deliveryStatusLabels = { new: 'جديد', price_sent: 'سعر مرسل', accepted: 'نشط (مقبول)', launched: 'في الطريق', in_progress: 'جارية', completed: 'مكتملة', cancelled: 'ملغاة' };
const deliveryStatusColors = { new: 'warning', price_sent: 'info', accepted: 'primary', launched: 'success', in_progress: 'success', completed: 'purple', cancelled: 'danger' };
let allDeliveries = [];

function initDeliveriesListener() {
    if (!requireDb()) return;
    if (deliveriesUnsubscribe) { deliveriesUnsubscribe(); deliveriesUnsubscribe = null; }
    const tbody = document.getElementById('deliveriesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل التوصيلات...</div></td></tr>';
    try {
        deliveriesUnsubscribe = db.collection('delivery_requests').orderBy('createdAt', 'desc').limit(150)
            .onSnapshot(snap => {
                allDeliveries = [];
                snap.forEach(doc => {
                    allDeliveries.push({ id: doc.id, ...doc.data() });
                });
                const s = document.getElementById('filterDeliveryStatus')?.value || 'all';
                loadDeliveriesList(s);
            }, err => {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
            });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

function loadDeliveriesList(forceFilter) {
    const s = forceFilter || document.getElementById('filterDeliveryStatus')?.value || 'all';
    renderDeliveriesList(s === 'all' ? allDeliveries : allDeliveries.filter(d => d.status === s));
}

function renderDeliveriesList(deliveries) {
    const tbody = document.getElementById('deliveriesTableBody');
    if (!tbody) return;
    if (deliveries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">لا توجد توصيلات</td></tr>';
        return;
    }
    const q = (document.getElementById('searchDeliveries')?.value || '').trim();
    const filtered = q ? deliveries.filter(d => (d.customerPhone || '').includes(q) || (d.receiverPhone || '').includes(q) || (d.customerName || '').includes(q)) : deliveries;
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">لا توجد نتائج</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(d => {
        const created = d.createdAt?.toDate ? fmtDate(d.createdAt.toDate()) : '-';
        const price = d.pendingPrice != null ? d.pendingPrice : (d.fare != null ? d.fare : '-');
        const safeName = (d.customerName || d.customerPhone || '').replace(/'/g, '');
        const safeRecv = (d.receiverPhone || '').replace(/'/g, '');
        let actions = '';
        if (d.status === 'new' || d.status === 'price_sent') {
            actions += `<button class="btn-action btn-action-edit" onclick="setDeliveryStatus('${d.id}','accepted')">قبول (نشط)</button> `;
        }
        if (d.status === 'accepted' || d.status === 'launched' || d.status === 'in_progress') {
            actions += `<button class="btn-action btn-action-credit" onclick="setDeliveryStatus('${d.id}','completed')">مكتملة</button> `;
        }
        if (d.status !== 'completed' && d.status !== 'cancelled') {
            actions += `<button class="btn-action btn-action-toggle" onclick="setDeliveryStatus('${d.id}','cancelled')">إلغاء</button> `;
        }
        actions += `<button class="btn-action btn-action-delete" onclick="deleteDelivery('${d.id}')"><i class="bi bi-trash"></i></button>`;
        return `<tr>
            <td><strong>${d.customerName || '-'}</strong><br><small class="text-muted">${fmtNum(d.customerPhone || '')}</small></td>
            <td><strong>${fmtNum(d.receiverPhone || '-')}</strong></td>
            <td class="d-none d-md-table-cell">${d.senderDistrict || fmtNum(d.senderPhone || '-')}</td>
            <td class="d-none d-md-table-cell">${d.receiverDistrict || '-'}</td>
            <td class="d-none d-lg-table-cell" style="max-width:220px;">${d.voiceNote ? '<span class="badge bg-info text-dark me-1" title="يوجد تسجيل صوتي"><i class="bi bi-mic-fill"></i></span>' : ''}${escapeHtmlStr(d.notes) || '<span class="text-muted">-</span>'}</td>
            <td><strong class="text-gold">${price} MRU</strong></td>
            <td><span class="badge bg-${deliveryStatusColors[d.status] || 'secondary'}">${deliveryStatusLabels[d.status] || d.status}</span></td>
            <td class="d-none d-lg-table-cell"><small>${created}</small></td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

window.setDeliveryStatus = async function (id, status) {
    if (!(await ARAconfirm('تحديث حالة التوصيلة إلى "' + (deliveryStatusLabels[status] || status) + '"؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('delivery_requests').doc(id).update({ status });
        if (status === 'accepted') addNotifLog('delivery_accepted', '✅ توصيل نشط (مقبول): ' + id);
        else if (status === 'completed') addNotifLog('delivery_completed', '🏁 اكتمل التوصيل: ' + id);
        else if (status === 'cancelled') {
            addNotifLog('delivery_cancelled', '❌ أُلغيت التوصيلة: ' + id);
            // إلغاء الرحلة المرتبطة إن وُجدت ليُعلم السائق والزبون معاً
            const dSnap = await db.collection('delivery_requests').doc(id).get();
            const rideId = dSnap.exists ? dSnap.data().rideId : null;
            if (rideId) {
                const rSnap = await db.collection('rides').doc(rideId).get();
                if (rSnap.exists) {
                    const rSt = rSnap.data().status || '';
                    if (['pending', 'accepted', 'in_progress', 'launched'].includes(rSt)) {
                        markSelfTouched(rideId);
                        await db.collection('rides').doc(rideId).update({
                            status: 'cancelled',
                            cancelledBy: 'admin',
                            cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
            }
            notifyDeliveryCustomer(id, {
                title: 'تم إلغاء التوصيل',
                body: 'قام المشرف بإلغاء توصيلتك. يمكنك تقديم طلب جديد في أي وقت.',
                data: { status: 'cancelled', cancelledBy: 'admin' }
            });
        }
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteDelivery = async function (id) {
    if (!(await ARAconfirm('حذف هذه التوصيلة نهائياً؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('delivery_requests').doc(id).delete();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.exportDeliveriesCSV = function () {
    const rows = [['الزبون', 'هاتف الزبون', 'المستلم', 'الانطلاق', 'الوجهة', 'السعر', 'الحالة']];
    allDeliveries.forEach(d => {
        rows.push([d.customerName || '', d.customerPhone || '', d.receiverPhone || '', d.senderDistrict || '', d.receiverDistrict || '', d.pendingPrice != null ? d.pendingPrice : (d.fare != null ? d.fare : ''), deliveryStatusLabels[d.status] || d.status]);
    });
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deliveries.csv';
    a.click();
};

document.getElementById('searchDeliveries')?.addEventListener('input', () => loadDeliveriesList());

// ============================================
// STATISTICS
// ============================================
async function loadStats() {
    if (!requireDb()) return;
    try {
        const driversSnap = await db.collection('drivers').get();
        const allDrivs = [];
        driversSnap.forEach(d => allDrivs.push(d.data()));
        const onlineCount = allDrivs.filter(d => d.isOnline && !d.disabled).length;
        document.getElementById('statOnlineDrivers').textContent = onlineCount;
        document.getElementById('statTotalDrivers').textContent = allDrivs.length;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTs = firebase.firestore.Timestamp.fromDate(today);

        const todayRidesSnap = await db.collection('rides')
            .where('createdAt', '>=', todayTs).get();
        document.getElementById('statTodayRides').textContent = todayRidesSnap.size;

        let totalComm = 0;
        let cancelledComm = 0;
        let totalRidesCount = 0;
        let activeCount = 0;
        let completedCount = 0;
        const allRidesSnap = await db.collection('rides').get();
        allRidesSnap.forEach(doc => {
            const r = doc.data();
            totalRidesCount++;
            if (r.status === 'completed') {
                completedCount++;
                if (r.commissionAmount) totalComm += r.commissionAmount;
            } else if (r.status === 'cancelled' && (r.cancelledBy === 'driver' || r.cancelledBy === 'driver_cancel')) {
                if (r.commissionAmount) {
                    totalComm += r.commissionAmount;
                    cancelledComm += r.commissionAmount;
                }
            }
            if (r.status === 'accepted' || r.status === 'in_progress') activeCount++;
        });
        document.getElementById('statTotalRides').textContent = totalRidesCount;
        document.getElementById('statTotalComm').innerHTML = `${totalComm} <small>MRU</small>${cancelledComm > 0 ? `<br><small class="d-block" style="font-size:10px;color:#e53935;">منها ${cancelledComm} MRU من رحلات ألغاها السائق</small>` : ''}`;
        document.getElementById('statActiveRides').textContent = activeCount;

        const custSnap = await db.collection('customers').get();
        document.getElementById('statTotalCustomers').textContent = custSnap.size;
    } catch (e) {
        console.error('Stats load error:', e);
    }
}

// ============================================
// EXPORT CSV
// ============================================
window.exportDriversCSV = function () {
    if (allDrivers.length === 0) { ARAalert('لا يوجد سائقون للتصدير', 'info'); return; }
    let csv = '\uFEFF' + 'الاسم,الهاتف,الرصيد,الحالة,المجموعات\n';
    allDrivers.forEach(d => {
        const status = d.disabled ? 'معطّل' : (d.isOnline ? 'متاح' : 'غير متاح');
        csv += `${d.name||''},${d.phone||''},${d.credit||0},${status},${d.totalRides||0}\n`;
    });
    downloadCSV(csv, 'shater_drivers.csv');
};

window.exportRidesCSV = function () {
    if (allRides.length === 0) { ARAalert('لا توجد رحلات للتصدير', 'info'); return; }
    let csv = '\uFEFF' + 'الزبون,هاتف الزبون,نقطة الانطلاق,الوجهة,المسافة,السعر,العمولة,اسم السائق,هاتف السائق,الحالة,التاريخ\n';
    allRides.forEach(r => {
        const created = r.createdAt?.toDate ? fmtDate(r.createdAt.toDate()) : '';
        const fare = r.finalPrice || r.fare || 0;
        const comm = r.commissionAmount || Math.round(fare * commissionPercent / 100);
        const driver = r.assignedDriverId ? (driversInfoCache[r.assignedDriverId] || null) : null;
        const driverName = driver ? driver.name : '';
        const driverPhone = driver ? driver.phone : '';
        csv += `${r.passengerName||''},${r.passengerPhone||''},${r.pickupAddress||''},${r.dropoffAddress||''},${r.realDistanceKm||''},${fare},${comm},${driverName},${driverPhone},${r.status||''},${created}\n`;
    });
    downloadCSV(csv, 'shater_rides.csv');
};

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// ============================================
// FCM NOTIFICATIONS (stub)
// ============================================
async function sendFCMNotifications(tokens, rideId, passengerName, fare, lat, lng, pickup, dropoff, radius, extra, dropLat, dropLng) {
    console.log(`FCM: ${tokens.length} tokens, ride ${rideId}`);
    if (tokens.length === 0) {
        addNotifLog('system', `FCM: لا توجد رموز إشعار متوفرة`);
        return;
    }
    const dLat = dropLat != null ? dropLat : lat;
    const dLng = dropLng != null ? dropLng : lng;
    const data = Object.assign({
        type: 'ride_request',
        rideId,
        passengerName,
        passengerPhone: '',
        pickupLat: String(lat || ''),
        pickupLng: String(lng || ''),
        pickupAddress: pickup || '',
        dropoffLat: String(dLat || ''),
        dropoffLng: String(dLng || ''),
        dropoffAddress: dropoff || '',
        distanceKm: String(radius || 0),
        rideType: extra?.rideType || 'fixed',
        openPerMin: String(extra?.openPerMin || 4),
        fare: String(fare || 0),
        estimatedFare: String(fare || 0)
    }, extra || {});
    try {
        const res = await fetch('/api/send-fcm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tokens,
                title: 'طلب رحلة جديد!',
                body: `سعر: ${fare || 0} MRU`,
                data
            })
        });
        const json = await res.json();
        if (json.success) {
            addNotifLog('system', `FCM: تم إرسال إشعار ${json.successCount} سائق بنجاح`);
        } else {
            addNotifLog('system', `FCM: فشل الإرسال (${json.error || 'unknown'})`);
        }
    } catch (e) {
        addNotifLog('system', `FCM: تعذر الوصول للخادم — الطلب سيصل للسائقين المفتوحين فقط (${e.message})`);
    }
}

// ============================================
// DELIVERY CUSTOMER PUSH (popup + sound on ride actions)
// ============================================
async function notifyDeliveryCustomer(deliveryId, payload) {
    try {
        const snap = await db.collection('delivery_requests').doc(deliveryId).get();
        if (!snap.exists) return;
        const d = snap.data() || {};
        let customerId = d.customerId;
        if (!customerId && d.customerPhone) {
            const cq = await db.collection('customers').where('phone', '==', d.customerPhone).limit(1).get();
            if (!cq.empty) customerId = cq.docs[0].id;
        }
        if (!customerId) return;
        const cSnap = await db.collection('customers').doc(customerId).get();
        if (!cSnap.exists) return;
        const token = cSnap.data().fcmToken || '';
        if (!token) return;
        const title = payload.title || 'حالة التوصيل';
        const body = payload.body || 'هناك تحديث في طلبك';
        const data = Object.assign({ type: 'delivery_update', deliveryId, status: '', cancelledBy: '' }, payload.data || {}, { title, body });
        const res = await fetch('/api/send-fcm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokens: [token], title, body, data })
        });
        const json = await res.json();
        if (json.success) {
            addNotifLog('system', `إشعار زبون (${deliveryId}): ${title}`);
        } else {
            addNotifLog('system', `فشل إشعار زبون (${json.error || 'unknown'})`);
        }
    } catch (e) {
        addNotifLog('system', `فشل إشعار زبون (${e.message})`);
    }
}

// ============================================
// SINGLE-USER PUSH (customer / driver)
// type: credit_update | product_status | customer_announcement
// ============================================
async function notifyUser(collectionName, docId, payload) {
    if (!requireDb()) return;
    try {
        const snap = await db.collection(collectionName).doc(docId).get();
        if (!snap.exists) return;
        const docData = snap.data() || {};
        const { title, body, ...data } = payload;
        await db.collection('notifications').add({
            userId: docId,
            read: false,
            type: data.type || 'generic',
            title,
            body,
            amount: data.amount || '',
            balance: data.balance || '',
            sound: data.sound || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        addNotifLog('system', `تمت كتابة إشعار لـ ${collectionName}: ${title}`);
        const token = docData.fcmToken || '';
        if (!token) {
            addNotifLog('system', `لا يوجد رمز إشعارات لـ ${collectionName} (${docId})`);
            return;
        }
        try {
            const res = await fetch('/api/send-fcm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens: [token], title, body, data })
            });
            const json = await res.json();
            if (json.success) {
                addNotifLog('system', `تم إرسال إشعار لـ ${collectionName}: ${title}`);
            } else {
                addNotifLog('system', `فشل إرسال إشعار (${json.error || 'unknown'})`);
            }
        } catch (e) {
            addNotifLog('system', `تعذر إرسال إشعار (${e.message})`);
        }
    } catch (e) {
        addNotifLog('system', `تعذر كتابة إشعار (${e.message})`);
    }
}

// ============================================
// NOTIFICATION LOG
// ============================================
let notifLog = [];

function addNotifLog(type, message) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = now.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
    notifLog.unshift({ type, message, time, date });
    if (notifLog.length > 100) notifLog = notifLog.slice(0, 100);
    renderNotifLog();
}

function renderNotifLog() {
    const container = document.getElementById('notifLogContainer');
    const countEl = document.getElementById('notifLogCount');
    if (!container) return;
    if (countEl) countEl.textContent = notifLog.length;
    if (notifLog.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-4 small">لا توجد إشعارات بعد</div>';
        return;
    }
    const badgeMap = {
        'new_ride': { cls: 'log-badge-warning', label: 'رحلة جديدة' },
        'ride_accepted': { cls: 'log-badge-success', label: 'تم القبول' },
        'ride_completed': { cls: 'log-badge-info', label: 'اكتملت' },
        'ride_cancelled': { cls: 'log-badge-danger', label: 'ملغاة' },
        'ride_in_progress': { cls: 'log-badge-success', label: 'جارية' },
        'dispatch': { cls: 'log-badge-info', label: 'إرسال' },
        'delivery_dispatch': { cls: 'log-badge-warning', label: 'توصيل' },
        'system': { cls: 'log-badge-info', label: 'نظام' },
    };
    container.innerHTML = notifLog.map(n => {
        const badge = badgeMap[n.type] || { cls: 'log-badge-info', label: n.type };
        return `<div class="log-entry d-flex align-items-center gap-2">
            <span class="log-time">${n.date} ${n.time}</span>
            <span class="log-badge ${badge.cls}">${badge.label}</span>
            <span class="flex-grow-1">${n.message}</span>
        </div>`;
    }).join('');
}

window.clearNotifLog = function () {
    notifLog = [];
    renderNotifLog();
};

window.confirmResetAllData = async function () {
    if (sessionStorage.getItem('SHATER_admin_role') !== 'admin') {
        ARAalert('هذا الإجراء متاح فقط لصلاحية مدير عام', 'warning');
        return;
    }
    if (!(await ARAconfirm('⚠️ تحذير! سيتم حذف جميع البيانات (الرحلات، السائقين، الزبائن، الرسائل، الإعلانات، طلبات الاشتراك، الإشعارات) بشكل نهائي. حساب المالك وسجلات المشرفين تبقى كما هي. هل أنت متأكد؟'))) return;
    if (!(await ARAconfirm('❌ تأكيد نهائي: لا يمكن التراجع عن هذا الإجراء، وسيبقى حساب المالك فقط محفوظاً. هل تريد المتابعة؟'))) return;
    const status = document.getElementById('resetStatus');
    status.innerHTML = '<span class="text-danger"><i class="bi bi-hourglass-split me-1"></i>جاري مسح البيانات...</span>';
    requireDb('resetStatus');
    // ملاحظة: مجموعة 'admins' مستبعدة عمداً حتى لا يمكن مسح حساب المالك أو أي مشرف بهذا الزر.
    const collections = [
        'rides', 'drivers', 'customers', 'messages', 'customer_messages',
        'announcements', 'customer_announcements', 'promotions', 'products',
        'customer_products', 'ladies_products', 'stores_promotion',
        'delivery_requests', 'recharge_requests', 'notifications'
    ];
    let completed = 0;
    for (const col of collections) {
        try {
            const snapshot = await db.collection(col).get();
            const ids = snapshot.docs.map(d => d.id);
            for (let i = 0; i < ids.length; i += 500) {
                const batch = db.batch();
                const chunk = ids.slice(i, i + 500);
                chunk.forEach(id => batch.delete(db.collection(col).doc(id)));
                await batch.commit();
            }
            completed++;
            if (completed === collections.length) {
                status.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-check-circle-fill me-1"></i>تم مسح جميع البيانات بنجاح، وبقي حساب المالك كما هو!</span>';
                setTimeout(() => location.reload(), 2000);
            }
        } catch (e) {
            status.innerHTML = `<span class="text-danger">خطأ في ${col}: ${e.message}</span>`;
        }
    }
};

// ============================================
// FIND NEARBY DRIVERS
// ============================================
function findNearbyDrivers(lat, lng, radiusKm) {
    return new Promise(resolve => {
        db.collection('drivers').where('isOnline', '==', true).get()
            .then(snapshot => {
                const drivers = [];
                snapshot.forEach(doc => {
                    const d = doc.data();
                    if (d.lat && d.lng) {
                        const dist = haversine(lat, lng, d.lat, d.lng);
                        if (dist <= radiusKm) drivers.push({ id: doc.id, distance: dist, ...d });
                    }
                });
                resolve(drivers.sort((a, b) => a.distance - b.distance));
            })
            .catch(() => resolve([]));
    });
}

function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function showStatus(elId, msg, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.className = type === 'error' ? 'text-danger fw-semibold mt-2' : 'text-success fw-semibold mt-2';
    setTimeout(() => { el.textContent = ''; el.className = ''; }, 6000);
}

// ============================================
// MESSAGING SYSTEM
// ============================================
let selectedMsgDrivers = [];

function initMsgTypeSwitch() {
    const typeEl = document.getElementById('msgType');
    if (!typeEl) return;
    typeEl.addEventListener('change', () => {
        const t = typeEl.value;
        document.getElementById('msgTextGroup').classList.toggle('d-none', t !== 'text');
        document.getElementById('msgImageGroup').classList.toggle('d-none', t !== 'image');
        document.getElementById('msgAudioGroup').classList.toggle('d-none', t !== 'audio');
    });

    const imgFile = document.getElementById('msgImageFile');
    if (imgFile) imgFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 500000) { ARAalert('الصورة كبيرة جداً. الحد الأقصى 500KB', 'warning'); e.target.value = ''; return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('msgImagePreview').innerHTML =
                `<img src="${ev.target.result}" style="max-width:200px;max-height:200px;border-radius:8px;" class="img-fluid">`;
        };
        reader.readAsDataURL(file);
    });

    const audioFile = document.getElementById('msgAudioFile');
    if (audioFile) audioFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 500000) { ARAalert('الملف الصوتي كبير جداً. الحد الأقصى 500KB', 'warning'); e.target.value = ''; return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('msgAudioPreview').innerHTML =
                `<audio controls src="${ev.target.result}" style="width:100%;"></audio>`;
        };
        reader.readAsDataURL(file);
    });
}
initMsgTypeSwitch();

let msgSelectAllChecked = false;

function updateMsgRecipientsCount() {
    const sel = document.getElementById('msgRecipients');
    const counter = document.getElementById('msgSelectAllCount');
    if (!sel || !counter) return;
    const total = sel.options.length;
    const selected = Array.from(sel.options).filter(o => o.selected).length;
    counter.textContent = `المحدد: ${selected} من ${total}`;
}

function handleMsgSelectAll(cb) {
    if (!cb) return;
    const checked = cb.checked;
    msgSelectAllChecked = checked;
    const sel = document.getElementById('msgRecipients');
    if (sel) {
        Array.from(sel.options).forEach(o => { o.selected = checked; });
    }
    updateMsgRecipientsCount();
}

function syncMsgSelectAllCheckbox() {
    const sel = document.getElementById('msgRecipients');
    const cb = document.getElementById('msgSelectAll');
    if (!sel || !cb) return;
    const all = sel.options.length > 0 && Array.from(sel.options).every(o => o.selected);
    cb.checked = all;
    msgSelectAllChecked = all;
    updateMsgRecipientsCount();
}

document.getElementById('msgRecipients')?.addEventListener('change', () => {
    syncMsgSelectAllCheckbox();
});

async function loadMsgRecipients() {
    if (!requireDb()) return;
    const sel = document.getElementById('msgRecipients');
    if (!sel) return;
    const typeSel = document.getElementById('msgRecipientType');
    const type = typeSel ? typeSel.value : 'drivers';
    sel.innerHTML = '';
    if (type === 'customers') {
        sel.innerHTML = '<option value="all">جميع الزبائن</option>';
        try {
            const snap = await db.collection('customers').get();
            snap.forEach(doc => {
                const c = doc.data();
                sel.innerHTML += `<option value="${c.phone || doc.id}">${c.name || 'زبون'} (${fmtNum(c.phone || '')})</option>`;
            });
        } catch (e) { console.log('Customers recipients load error'); }
    } else {
        sel.innerHTML = '<option value="all">جميع السائقين</option>';
        try {
            const snap = await db.collection('drivers').get();
            snap.forEach(doc => {
                const d = doc.data();
                sel.innerHTML += `<option value="${doc.id}">${d.name || 'سائق'} (${fmtNum(d.phone || '')})</option>`;
            });
        } catch (e) { console.log('Recipients load error'); }
    }
    if (msgSelectAllChecked) {
        Array.from(sel.options).forEach(o => { o.selected = true; });
    }
    updateMsgRecipientsCount();
}

document.getElementById('msgRecipientType')?.addEventListener('change', loadMsgRecipients);

document.getElementById('sendMsgBtn')?.addEventListener('click', async () => {
    if (!requireDb('msgSendStatus')) return;
    const type = document.getElementById('msgType').value;
    const recipientsSel = document.getElementById('msgRecipients');
    const recipientIds = Array.from(recipientsSel.selectedOptions).map(o => o.value);
    const typeSel = document.getElementById('msgRecipientType');
    const recipientKind = typeSel ? typeSel.value : 'drivers';
    const senderName = sessionStorage.getItem('SHATER_admin_name') || 'المدير';
    const msg = { type, sentBy: senderName, readBy: [], timestamp: firebase.firestore.FieldValue.serverTimestamp(), recipientKind };

    if (recipientIds.includes('all') || msgSelectAllChecked) {
        if (recipientKind === 'customers') {
            const snap = await db.collection('customers').get();
            msg.recipients = snap.docs.map(d => (d.data().phone || d.id));
            msg.recipientLabel = 'جميع الزبائن';
        } else {
            const snap = await db.collection('drivers').get();
            msg.recipients = snap.docs.map(d => d.id);
            msg.recipientLabel = 'جميع السائقين';
        }
    } else {
        msg.recipients = recipientIds;
        msg.recipientLabel = recipientKind === 'customers' ? `${recipientIds.length} زبون` : `${recipientIds.length} سائق`;
    }

    if (msg.recipients.length === 0) {
        showStatus('msgSendStatus', 'لا يوجد مستلمون', 'error');
        return;
    }

    if (type === 'text') {
        msg.content = document.getElementById('msgText').value.trim();
        if (!msg.content) { showStatus('msgSendStatus', 'اكتب نص الرسالة', 'error'); return; }
    } else if (type === 'image') {
        const fileInput = document.getElementById('msgImageFile');
        if (!fileInput.files[0]) { showStatus('msgSendStatus', 'اختر صورة', 'error'); return; }
        showStatus('msgSendStatus', 'جاري ضغط الصورة وإرسالها...', '');
        const b64 = await fileToBase64(fileInput.files[0]);
        if (!b64) { showStatus('msgSendStatus', 'فشل قراءة الصورة', 'error'); return; }
        msg.content = b64;
        await sendMsgToFirestore(msg);
        return;
    } else if (type === 'audio') {
        const fileInput = document.getElementById('msgAudioFile');
        if (!fileInput.files[0]) { showStatus('msgSendStatus', 'اختر ملف صوتي', 'error'); return; }
        if (fileInput.files[0].size > 600 * 1024) {
            showStatus('msgSendStatus', 'الملف الصوتي كبير جداً (الحد 600KB) - مستندات Firestore محدودة بحجم 1MB', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (ev) => {
            msg.content = ev.target.result;
            await sendMsgToFirestore(msg);
        };
        reader.readAsDataURL(fileInput.files[0]);
        return;
    }

    await sendMsgToFirestore(msg);
});

async function sendMsgToFirestore(msg) {
    try {
        if (typeof msg.content === 'string' && msg.content.length > 900 * 1024) {
            showStatus('msgSendStatus', 'الرسالة كبيرة جداً (أكثر من 900KB) - اختر صورة/مقطع أصغر أو قلّل عدد الصور', 'error');
            return;
        }
        if (msg.recipientKind === 'customers') {
            const custMsg = { type: msg.type, content: msg.content, recipients: msg.recipients, sentBy: msg.sentBy, readBy: [], timestamp: firebase.firestore.FieldValue.serverTimestamp() };
            await db.collection('customer_messages').add(custMsg);
            showStatus('msgSendStatus', `تم إرسال الرسالة لـ ${msg.recipientLabel} بنجاح!`, 'success');
            document.getElementById('msgText').value = '';
            document.getElementById('msgImageFile').value = '';
            document.getElementById('msgAudioFile').value = '';
            document.getElementById('msgImagePreview').innerHTML = '';
            document.getElementById('msgAudioPreview').innerHTML = '';
            loadSentCustomerMessages();
        } else {
            await db.collection('messages').add(msg);
            showStatus('msgSendStatus', `تم إرسال الرسالة لـ ${msg.recipientLabel} بنجاح!`, 'success');
            document.getElementById('msgText').value = '';
            document.getElementById('msgImageFile').value = '';
            document.getElementById('msgAudioFile').value = '';
            document.getElementById('msgImagePreview').innerHTML = '';
            document.getElementById('msgAudioPreview').innerHTML = '';
            loadSentMessages();
        }
    } catch (err) {
        showStatus('msgSendStatus', 'خطأ: ' + err.message, 'error');
    }
}

async function loadSentMessages() {
    if (!requireDb()) return;
    const container = document.getElementById('msgListContainer');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-4"><div class="SHATER-spinner"></div></div>';

    try {
        const snap = await db.collection('messages').orderBy('timestamp', 'desc').limit(50).get();
        document.getElementById('msgCount').textContent = snap.size;

        if (snap.empty) {
            container.innerHTML = '<div class="text-center text-muted py-4 small">لا توجد رسائل بعد</div>';
            return;
        }

        const typeIcons = { text: 'bi-chat-left-text-fill', image: 'bi-image-fill', audio: 'bi-mic-fill' };
        const typeLabels = { text: 'نص', image: 'صورة', audio: 'صوت' };

        container.innerHTML = snap.docs.map(doc => {
            const m = doc.data();
            const time = m.timestamp?.toDate ? fmtDate(m.timestamp.toDate()) : '';
            const readCount = (m.readBy || []).length;
            const totalCount = (m.recipients || []).length;
            const allRead = readCount >= totalCount;

            let contentPreview = '';
            if (m.type === 'text') {
                contentPreview = `<p class="mb-1">${m.content || ''}</p>`;
            } else if (m.type === 'image') {
                contentPreview = `<img src="${m.content}" style="max-width:120px;max-height:80px;border-radius:6px;" class="img-fluid">`;
            } else if (m.type === 'audio') {
                contentPreview = `<audio controls src="${m.content}" style="height:32px;max-width:200px;"></audio>`;
            }

            return `<div class="log-entry p-3 border-bottom">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="badge bg-info"><i class="bi ${typeIcons[m.type] || 'bi-envelope'}"></i> ${typeLabels[m.type] || m.type}</span>
                    <small class="text-muted">${time}</small>
                </div>
                <div class="mb-1">${contentPreview}</div>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted"><i class="bi bi-people"></i> ${m.recipientLabel || totalCount + ' سائق'} | <i class="bi bi-eye"></i> ${readCount}/${totalCount} قراءة</small>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSentMsg('${doc.id}')"><i class="bi bi-trash"></i></button>
                </div>
                ${allRead && totalCount > 0 ? '<div class="mt-1"><span class="badge bg-success">تمت القراءة من الجميع</span></div>' : ''}
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div class="text-center text-danger py-4">خطأ في تحميل الرسائل</div>';
    }
}

async function loadSentCustomerMessages() {
    if (!requireDb()) return;
    const container = document.getElementById('msgListContainerCustomers');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-4"><div class="SHATER-spinner"></div></div>';

    try {
        const snap = await db.collection('customer_messages').orderBy('timestamp', 'desc').limit(50).get();
        document.getElementById('msgCountCustomers').textContent = snap.size;

        if (snap.empty) {
            container.innerHTML = '<div class="text-center text-muted py-4 small">لا توجد رسائل للزبائن بعد</div>';
            return;
        }

        const typeIcons = { text: 'bi-chat-left-text-fill', image: 'bi-image-fill', audio: 'bi-mic-fill' };
        const typeLabels = { text: 'نص', image: 'صورة', audio: 'صوت' };

        container.innerHTML = snap.docs.map(doc => {
            const m = doc.data();
            const time = m.timestamp?.toDate ? fmtDate(m.timestamp.toDate()) : '';
            const readCount = (m.readBy || []).length;
            const totalCount = (m.recipients || []).length;
            const allRead = totalCount > 0 && readCount >= totalCount;

            let contentPreview = '';
            if (m.type === 'text') {
                contentPreview = `<p class="mb-1">${m.content || ''}</p>`;
            } else if (m.type === 'image') {
                contentPreview = `<img src="${m.content}" style="max-width:120px;max-height:80px;border-radius:6px;" class="img-fluid">`;
            } else if (m.type === 'audio') {
                contentPreview = `<audio controls src="${m.content}" style="height:32px;max-width:200px;"></audio>`;
            }

            return `<div class="log-entry p-3 border-bottom">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="badge bg-warning text-dark"><i class="bi ${typeIcons[m.type] || 'bi-envelope'}"></i> ${typeLabels[m.type] || m.type}</span>
                    <small class="text-muted">${time}</small>
                </div>
                <div class="mb-1">${contentPreview}</div>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted"><i class="bi bi-people"></i> ${totalCount} زبون | <i class="bi bi-eye"></i> ${readCount}/${totalCount} قراءة</small>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSentCustomerMsg('${doc.id}')"><i class="bi bi-trash"></i></button>
                </div>
                ${allRead ? '<div class="mt-1"><span class="badge bg-success">تمت القراءة من الجميع</span></div>' : ''}
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div class="text-center text-danger py-4">خطأ في تحميل الرسائل</div>';
    }
}

window.deleteSentCustomerMsg = async function (id) {
    if (!(await ARAconfirm('هل تريد حذف هذه الرسالة؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('customer_messages').doc(id).delete();
        loadSentCustomerMessages();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteSentMsg = async function(id) {
    if (!(await ARAconfirm('هل تريد حذف هذه الرسالة؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('messages').doc(id).delete();
        loadSentMessages();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.clearOldMessages = async function() {
    if (!(await ARAconfirm('حذف جميع الرسائل القديمة؟'))) return;
    if (!requireDb()) return;
    try {
        const snap = await db.collection('messages').get();
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        loadSentMessages();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// ANNOUNCEMENTS (BROADCAST TO ALL DRIVERS)
// ============================================
window.sendAnnouncement = async function () {
    if (!requireDb('annSendStatus')) return;
    const title = document.getElementById('annTitle').value.trim();
    const content = document.getElementById('annContent').value.trim();
    if (!title && !content) { showStatus('annSendStatus', 'اكتب عنوان الإعلان أو نصه', 'error'); return; }
    if (!content) { showStatus('annSendStatus', 'اكتب نص الإعلان', 'error'); return; }

    const senderName = sessionStorage.getItem('SHATER_admin_name') || 'المدير';
    try {
        await db.collection('announcements').add({
            title: title || 'إعلان من الإدارة',
            content: content,
            sentBy: senderName,
            readBy: [],
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus('annSendStatus', 'تم إرسال الإعلان لجميع السائقين بنجاح!', 'success');
        document.getElementById('annTitle').value = '';
        document.getElementById('annContent').value = '';
        loadAnnouncements();
    } catch (err) {
        showStatus('annSendStatus', 'خطأ: ' + err.message, 'error');
    }
};

async function loadAnnouncements() {
    if (!requireDb()) return;
    const container = document.getElementById('annListContainer');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-4"><div class="SHATER-spinner"></div></div>';

    try {
        const snap = await db.collection('announcements').orderBy('timestamp', 'desc').limit(50).get();
        document.getElementById('annCount').textContent = snap.size;

        if (snap.empty) {
            container.innerHTML = '<div class="text-center text-muted py-4 small">لا توجد إعلانات بعد</div>';
            return;
        }

        container.innerHTML = snap.docs.map(doc => {
            const a = doc.data();
            const time = a.timestamp?.toDate ? new Date(a.timestamp.toDate()).toLocaleString('ar-MA') : '';
            const readCount = (a.readBy || []).length;
            const totalDrivers = 0;
            return `<div class="log-entry p-3 border-bottom">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="badge bg-warning text-dark"><i class="bi bi-bullhorn-fill me-1"></i>${a.title || 'إعلان'}</span>
                    <small class="text-muted">${time}</small>
                </div>
                <div class="mb-1">${a.content || ''}</div>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted"><i class="bi bi-person"></i> ${a.sentBy || 'المدير'} | <i class="bi bi-eye"></i> ${readCount} قراءة</small>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteAnnouncement('${doc.id}')"><i class="bi bi-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div class="text-center text-danger py-4">خطأ في تحميل الإعلانات</div>';
    }
}

window.deleteAnnouncement = async function (id) {
    if (!(await ARAconfirm('هل تريد حذف هذا الإعلان؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('announcements').doc(id).delete();
        loadAnnouncements();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.clearOldAnnouncements = async function () {
    if (!(await ARAconfirm('حذف جميع الإعلانات القديمة؟'))) return;
    if (!requireDb()) return;
    try {
        const snap = await db.collection('announcements').get();
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        loadAnnouncements();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// CUSTOMER ANNOUNCEMENTS (BROADCAST TO ALL CUSTOMERS)
// ============================================
window.sendCustomerAnnouncement = async function () {
    if (!requireDb('custAnnSendStatus')) return;
    const title = document.getElementById('custAnnTitle').value.trim();
    const content = document.getElementById('custAnnContent').value.trim();
    if (!title && !content) { showStatus('custAnnSendStatus', 'اكتب عنوان الإعلان أو نصه', 'error'); return; }
    if (!content) { showStatus('custAnnSendStatus', 'اكتب نص الإعلان', 'error'); return; }

    const senderName = sessionStorage.getItem('SHATER_admin_name') || 'المدير';
    try {
        await db.collection('customer_announcements').add({
            title: title || 'إعلان من الإدارة',
            content: content,
            sentBy: senderName,
            readBy: [],
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus('custAnnSendStatus', 'تم إرسال الإعلان لجميع الزبائن بنجاح!', 'success');
        document.getElementById('custAnnTitle').value = '';
        document.getElementById('custAnnContent').value = '';
        loadCustomerAnnouncements();
    } catch (err) {
        showStatus('custAnnSendStatus', 'خطأ: ' + err.message, 'error');
    }
};

async function loadCustomerAnnouncements() {
    if (!requireDb()) return;
    const container = document.getElementById('custAnnListContainer');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-4"><div class="SHATER-spinner"></div></div>';

    try {
        const snap = await db.collection('customer_announcements').orderBy('timestamp', 'desc').limit(50).get();
        document.getElementById('custAnnCount').textContent = snap.size;

        if (snap.empty) {
            container.innerHTML = '<div class="text-center text-muted py-4 small">لا توجد إعلانات بعد</div>';
            return;
        }

        container.innerHTML = snap.docs.map(doc => {
            const a = doc.data();
            const time = a.timestamp?.toDate ? new Date(a.timestamp.toDate()).toLocaleString('ar-MA') : '';
            const readCount = (a.readBy || []).length;
            return `<div class="log-entry p-3 border-bottom">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="badge bg-warning text-dark"><i class="bi bi-bullhorn-fill me-1"></i>${a.title || 'إعلان'}</span>
                    <small class="text-muted">${time}</small>
                </div>
                <div class="mb-1">${a.content || ''}</div>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted"><i class="bi bi-person"></i> ${a.sentBy || 'المدير'} | <i class="bi bi-eye"></i> ${readCount} قراءة</small>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCustomerAnnouncement('${doc.id}')"><i class="bi bi-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div class="text-center text-danger py-4">خطأ في تحميل الإعلانات</div>';
    }
}

window.deleteCustomerAnnouncement = async function (id) {
    if (!(await ARAconfirm('هل تريد حذف هذا الإعلان؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('customer_announcements').doc(id).delete();
        loadCustomerAnnouncements();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.clearOldCustomerAnnouncements = async function () {
    if (!(await ARAconfirm('حذف جميع إعلانات الزبائن القديمة؟'))) return;
    if (!requireDb()) return;
    try {
        const snap = await db.collection('customer_announcements').get();
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        loadCustomerAnnouncements();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// ADMINS MANAGEMENT
// ============================================
async function loadAdminsList() {
    if (!requireDb()) return;
    const tbody = document.getElementById('adminsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل المشرفين...</div></td></tr>';
    try {
        const snapshot = await db.collection('admins').get();
        const admins = [];
        snapshot.forEach(doc => admins.push({ id: doc.id, ...doc.data() }));
        document.getElementById('totalAdminsCount').textContent = admins.length;
        if (admins.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">لا يوجد مشرفون</td></tr>';
            return;
        }
        const roleLabels = { admin: 'مدير عام', supervisor: 'مشرف' };
        const roleBadge = { admin: 'bg-primary', supervisor: 'bg-secondary' };
        tbody.innerHTML = admins.map(a => {
            const safeName = (a.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `<tr>
            <td><strong>${a.name || '-'}</strong></td>
            <td>${a.username || '-'}</td>
            <td><span class="badge ${roleBadge[a.role] || 'bg-secondary'}">${roleLabels[a.role] || a.role}</span></td>
            <td>
                <div class="d-flex gap-1 flex-wrap">
                    <button class="btn-action btn-action-edit" onclick="openEditAdminModal('${a.id}','${safeName}','${a.username||''}','${a.role||'supervisor'}')">تعديل</button>
                    <button class="btn-action btn-action-delete" onclick="deleteAdmin('${a.id}','${safeName}')">حذف</button>
                </div>
            </td>
        </tr>`;
        }).join('');
    } catch (err) {
        console.error('Load admins error:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

let editingAdminData = null;

document.getElementById('newAdminRole')?.addEventListener('change', function () {
    togglePermsPanel(this.value, 'newAdminPermsWrap', 'newAdminPerms', []);
});

document.getElementById('editAdminRole')?.addEventListener('change', function () {
    const selected = collectPerms('editAdminPerms');
    togglePermsPanel(this.value, 'editAdminPermsWrap', 'editAdminPerms', selected);
});

window.openEditAdminModal = function (id, name, username, role) {
    editingAdminData = null;
    document.getElementById('editAdminId').value = id;
    document.getElementById('editAdminUsername').value = username || '';
    document.getElementById('editAdminName').value = name || '';
    document.getElementById('editAdminRole').value = role || 'supervisor';
    document.getElementById('editAdminPassword').value = '';
    document.getElementById('editAdminStatus').textContent = '';
    togglePermsPanel(role || 'supervisor', 'editAdminPermsWrap', 'editAdminPerms', []);
    editAdminModal.show();
    db.collection('admins').doc(id).get().then(snap => {
        if (snap.exists) {
            const data = { id: snap.id, ...snap.data() };
            editingAdminData = data;
            const perms = Array.isArray(data.permissions) ? data.permissions : [];
            togglePermsPanel(data.role || 'supervisor', 'editAdminPermsWrap', 'editAdminPerms', perms);
            document.getElementById('editAdminRole').value = data.role || 'supervisor';
        }
    }).catch(() => {});
};

document.getElementById('saveEditAdminBtn').addEventListener('click', async () => {
    if (!requireDb('editAdminStatus')) return;
    const id = document.getElementById('editAdminId').value;
    const name = document.getElementById('editAdminName').value.trim();
    const role = document.getElementById('editAdminRole').value;
    const permissions = role === 'admin' ? ALL_PERMISSIONS.slice() : collectPerms('editAdminPerms');
    const newPass = document.getElementById('editAdminPassword').value;
    const statusEl = document.getElementById('editAdminStatus');
    if (!name) { statusEl.textContent = 'أدخل الاسم الكامل'; statusEl.className = 'fw-semibold text-danger'; return; }
    if (newPass && newPass.length < 6) { statusEl.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'; statusEl.className = 'fw-semibold text-danger'; return; }
    if (!guardPerm('admins', 'ليست لديك صلاحية إدارة المشرفين')) return;

    try {
        const target = editingAdminData || (await db.collection('admins').doc(id).get()).data();

        // حساب المالك محمي: لا يمكن تغيير دوره إطلاقاً
        if (target.username === 'khalilarafa' && role !== 'admin') {
            statusEl.textContent = 'حساب المالك محمي ولا يمكن تغيير دوره.';
            statusEl.className = 'fw-semibold text-danger';
            return;
        }

        if (target.role === 'admin' && role !== 'admin') {
            const snapshot = await db.collection('admins').get();
            const admins = [];
            snapshot.forEach(doc => admins.push({ id: doc.id, ...doc.data() }));
            const otherAdmins = admins.filter(a => a.id !== id && a.role === 'admin');
            if (otherAdmins.length === 0) {
                statusEl.textContent = 'لا يمكن تغيير دور آخر مشرف بصلاحية مدير عام. يجب أن يبقى مشرف واحد على الأقل.';
                statusEl.className = 'fw-semibold text-danger';
                return;
            }
        }

        await db.collection('admins').doc(id).update({ name, role, permissions });
        let passwordMsg = '';
        if (newPass) {
            const currentUser = firebase.auth().currentUser;
            const myUsername = sessionStorage.getItem('SHATER_admin_username') || '';
            const isSelfUid = !!(target.authUid && currentUser && currentUser.uid === target.authUid);
            const isSelf = isSelfUid || myUsername === target.username;
            if (isSelfUid) {
                try {
                    await currentUser.updatePassword(newPass);
                    await db.collection('admins').doc(id).update({ password: newPass });
                    passwordMsg = ' وتحديث كلمة المرور';
                } catch (e) {
                    passwordMsg = ' (فشل تحديث كلمة مرور المصادقة)';
                }
            } else if (target.username === 'khalilarafa' && !isSelf) {
                passwordMsg = ' (كلمة مرور حساب المالك محمية: لا يمكن تغييرها من حساب آخر)';
            } else {
                await db.collection('admins').doc(id).update({ password: newPass });
                passwordMsg = ' وتغيير كلمة المرور بنجاح';
            }
        }
        const currentUser = firebase.auth().currentUser;
        if (target.authUid && currentUser && currentUser.uid === target.authUid) {
            sessionStorage.setItem('SHATER_admin_role', role);
            sessionStorage.setItem('SHATER_admin_perms', JSON.stringify(permissions));
            sessionStorage.setItem('SHATER_admin_name', name);
            applyRoleVisibility();
        }
        statusEl.className = 'fw-semibold text-success';
        statusEl.textContent = `تم حفظ تعديلات المشرف بنجاح${passwordMsg}`;
        setTimeout(() => { editAdminModal.hide(); }, 900);
        loadAdminsList();
    } catch (err) {
        statusEl.className = 'fw-semibold text-danger';
        statusEl.textContent = 'خطأ: ' + err.message;
    }
});

window.addAdmin = async function () {
    if (!requireDb('addAdminStatus')) return;
    if (!guardPerm('admins', 'ليست لديك صلاحية إدارة المشرفين')) return;
    const username = document.getElementById('newAdminUsername').value.trim();
    const name = document.getElementById('newAdminName').value.trim();
    const password = document.getElementById('newAdminPassword').value.trim();
    const role = document.getElementById('newAdminRole').value;
    const permissions = role === 'admin' ? ALL_PERMISSIONS.slice() : collectPerms('newAdminPerms');

    if (!username) { showStatus('addAdminStatus', 'أدخل اسم المستخدم', 'error'); return; }
    if (!name) { showStatus('addAdminStatus', 'أدخل الاسم الكامل', 'error'); return; }
    if (!password) { showStatus('addAdminStatus', 'أدخل كلمة المرور', 'error'); return; }
    if (password.length < 6) { showStatus('addAdminStatus', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error'); return; }

    try {
        const existing = await db.collection('admins').where('username', '==', username).get();
        if (!existing.empty) {
            showStatus('addAdminStatus', 'اسم المستخدم مستخدم بالفعل', 'error');
            return;
        }

        // Create Firebase Auth account
        let authUid = '';
        try {
            const email = `${username}@shater.app`;
            const userCred = await firebase.auth().createUserWithEmailAndPassword(email, password);
            authUid = userCred.user.uid;
        } catch (authErr) {
            showStatus('addAdminStatus', 'فشل إنشاء حساب المصادقة: ' + authErr.message, 'error');
            return;
        }

        await db.collection('admins').add({
            username, name, password, role, permissions,
            authUid: authUid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus('addAdminStatus', 'تم إضافة المشرف بنجاح!', 'success');
        document.getElementById('newAdminUsername').value = '';
        document.getElementById('newAdminName').value = '';
        document.getElementById('newAdminPassword').value = '';
        if (document.getElementById('newAdminRole').value === 'supervisor') buildPermCheckboxes('newAdminPerms', []);
        loadAdminsList();
    } catch (err) {
        showStatus('addAdminStatus', 'خطأ: ' + err.message, 'error');
    }
};

window.deleteAdmin = async function (id, name) {
    if (!guardPerm('admins', 'ليست لديك صلاحية إدارة المشرفين')) return;
    if (!requireDb()) return;

    // حساب المالك محمي: لا يمكن حذفه إطلاقاً
    const ownerDoc = await db.collection('admins').doc(id).get();
    if (ownerDoc.exists && ownerDoc.data().username === 'khalilarafa') {
        ARAalert('حساب المالك محمي ولا يمكن حذفه.', 'warning');
        return;
    }

    if (!(await ARAconfirm(`هل أنت متأكد من حذف المشرف "${name}"؟`))) return;

    // Prevent deleting the last admin
    try {
        const snapshot = await db.collection('admins').get();
        const admins = [];
        snapshot.forEach(doc => admins.push({ id: doc.id, ...doc.data() }));

        const targetDoc = admins.find(a => a.id === id);
        if (targetDoc && targetDoc.role === 'admin') {
            const otherAdmins = admins.filter(a => a.id !== id && a.role === 'admin');
            if (otherAdmins.length === 0) {
                ARAalert('لا يمكن حذف آخر مشرف بصلاحية مدير عام. يجب أن يبقى مشرف واحد على الأقل بصلاحية كاملة.', 'warning');
                return;
            }
        }
    } catch (err) {
        console.error('Error checking admins before delete:', err);
    }

    try {
        await db.collection('admins').doc(id).delete();
        loadAdminsList();
    } catch (err) {
        ARAalert('خطأ: ' + err.message, 'error');
    }
};

// ============================================
// ROLE-BASED VISIBILITY
// ============================================
const FN_PERM = {
    addAdmin: 'admins', addLadiesProduct: 'ladies', addProduct: 'products',
    addPromotion: 'promotions', addStore: 'stores',
    clearNotifLog: 'settings', clearOldAnnouncements: 'announcements',
    clearOldCustomerAnnouncements: 'customer_announcements', clearOldMessages: 'messages',
    clearStoreLocation: 'stores', confirmResetAllData: 'settings',
    exportCustomersCSV: 'customers', exportDriversCSV: 'drivers', exportRidesCSV: 'rides',
    exportUnregisteredCustomersCSV: 'unregistered',
    openStoreMapPicker: 'stores', saveCommission: 'settings', saveCustomerCommission: 'settings',
    searchCustomerProfile: 'customers', searchDriverByPhone: 'drivers',
    sendAnnouncement: 'announcements', sendCustomerAnnouncement: 'customer_announcements',
    setServiceForAll: 'drivers_service',
    approveCustomerProduct: 'products', approveRechargeRequest: 'recharge_approve',
    cancelRide: 'rides', deleteAdmin: 'admins', deleteAnnouncement: 'announcements',
    deleteCustomerAnnouncement: 'customer_announcements', deleteCustomerProduct: 'products',
    deleteDelivery: 'deliveries', deleteLadiesProduct: 'ladies', deleteProduct: 'products',
    deletePromotion: 'promotions', deleteSentCustomerMsg: 'messages', deleteSentMsg: 'messages',
    deleteStore: 'stores', deleteSubscriptionRequest: 'recharge_approve',
    openCustomerPasswordModal: 'customers_edit', openDeleteCustomerModal: 'customers_delete',
    openDeleteModal: 'drivers_delete',
    openEditAdminModal: 'admins', openEditCreditModal: 'drivers_credit',
    openEditCustomerCreditModal: 'customers_credit', openEditCustomerModal: 'customers_edit',
    openEditModal: 'drivers_edit', openPasswordModal: 'drivers_edit',
    rejectCustomerProduct: 'products', rejectRechargeRequest: 'recharge_approve',
    setDeliveryStatus: 'deliveries', toggleCustomerProduct: 'products',
    toggleDriverService: 'drivers_service', toggleDriverStatus: 'drivers_edit',
    toggleLadiesProduct: 'ladies', toggleStore: 'stores'
};

const ID_PERM = {
    registerDriverBtn: 'drivers_add', registerCustomerBtn: 'customers_add',
    confirmEditCreditBtn: 'drivers_credit',
    confirmEditCustomerCreditBtn: 'customers_credit',
    confirmDeleteBtn: 'drivers_delete', confirmDeleteCustomerBtn: 'customers_delete',
    confirmServiceBtn: 'drivers_service', savePasswordBtn: 'drivers_edit',
    saveCustomerPasswordBtn: 'customers_edit', saveEditBtn: 'drivers_edit',
    saveEditCustomerBtn: 'customers_edit', saveEditAdminBtn: 'admins'
};

function hideByPermission(root) {
    const scope = root || document;
    scope.querySelectorAll('[onclick]').forEach(el => {
        const m = (el.getAttribute('onclick') || '').trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        const fn = m && m[1];
        const req = fn && FN_PERM[fn];
        if (!req) return;
        if (!el.hasAttribute('data-gated')) {
            el.setAttribute('data-gated', '1');
            el.setAttribute('data-gated-orig', el.style.display || '');
        }
        el.style.display = canPerm(req) ? el.getAttribute('data-gated-orig') : 'none';
    });
    Object.keys(ID_PERM).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!el.hasAttribute('data-gated')) {
            el.setAttribute('data-gated', '1');
            el.setAttribute('data-gated-orig', el.style.display || '');
        }
        el.style.display = canPerm(ID_PERM[id]) ? el.getAttribute('data-gated-orig') : 'none';
    });
}

function applyRoleVisibility() {
    const role = adminRole();
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = role === 'admin' ? '' : 'none';
    });
    document.querySelectorAll('[data-perm]').forEach(el => {
        el.style.display = canPerm(el.dataset.perm) ? '' : 'none';
    });
    document.querySelectorAll('.sidebar-link').forEach(link => {
        const page = link.dataset.page;
        const req = PAGE_PERM[page];
        link.style.display = (!req || canPerm(req)) ? '' : 'none';
    });
    const nameEl = document.getElementById('adminName');
    if (nameEl) nameEl.textContent = sessionStorage.getItem('SHATER_admin_name') || '';
    const roleEl = document.getElementById('adminRoleLabel');
    if (roleEl) roleEl.textContent = role === 'admin' ? 'مدير عام' : 'مشرف';
    hideByPermission(document);
}

// إخفاء تلقائي لأي أزرار تُضاف ديناميكياً (بعد أي عملية render)
(function watchDynamicButtons() {
    if (!document.body) return;
    const observer = new MutationObserver(muts => {
        let changed = false;
        for (const m of muts) {
            if (m.type === 'childList' && m.addedNodes.length) { changed = true; break; }
        }
        if (changed) hideByPermission(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();

// ============================================
// PROMOTIONS MANAGEMENT
// ============================================
let promoImageFiles = [];

document.getElementById('promoImages')?.addEventListener('change', function(e) {
    promoImageFiles = Array.from(e.target.files);
    const preview = document.getElementById('promoImagesPreview');
    preview.innerHTML = promoImageFiles.map((f, i) =>
        `<div class="position-relative" style="width:100px;height:100px;">
            <img src="${URL.createObjectURL(f)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;">
            <button class="btn btn-sm btn-danger position-absolute top-0 end-0" style="padding:0 4px;font-size:10px;" onclick="removePromoImage(${i})">&times;</button>
        </div>`
    ).join('');
});

window.removePromoImage = function(idx) {
    promoImageFiles.splice(idx, 1);
    const dt = new DataTransfer();
    promoImageFiles.forEach(f => dt.items.add(f));
    document.getElementById('promoImages').files = dt.files;
    const preview = document.getElementById('promoImagesPreview');
    preview.innerHTML = promoImageFiles.map((f, i) =>
        `<div class="position-relative" style="width:100px;height:100px;">
            <img src="${URL.createObjectURL(f)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;">
            <button class="btn btn-sm btn-danger position-absolute top-0 end-0" style="padding:0 4px;font-size:10px;" onclick="removePromoImage(${i})">&times;</button>
        </div>`
    ).join('');
};

window.addPromotion = async function() {
    if (!requireDb('addPromoStatus')) return;
    const title = document.getElementById('promoTitle').value.trim();
    const type = document.getElementById('promoType').value;
    const description = document.getElementById('promoDescription').value.trim();
    const videoUrl = document.getElementById('promoVideo').value.trim();

    if (!title) { showStatus('addPromoStatus', 'أدخل عنوان العرض', 'error'); return; }

    const btn = document.getElementById('btnAddPromotion');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>جاري الحفظ...';

    try {
        const images = [];
        const urlText = document.getElementById('promoImageUrls')?.value.trim();
        if (urlText) {
            urlText.split('\n').map(u => u.trim()).filter(u => u).forEach(u => images.push(u));
        }
        if (promoImageFiles.length > 0) {
            showStatus('addPromoStatus', 'جاري معالجة ' + promoImageFiles.length + ' صور...', '');
            try {
                const base64Images = await filesToBase64(promoImageFiles, 10);
                base64Images.forEach(function (u) { images.push(u); });
                if (base64Images.length > 0) {
                    showToast('تم رفع ' + base64Images.length + ' صورة', 'success');
                } else {
                    showToast('لم يتم تحويل أي صورة', 'warning');
                }
            } catch (convErr) {
                console.warn('Image conversion failed:', convErr.message);
                showToast('فشل معالجة الصور، جرب صوراً أصغر', 'warning');
            }
        }

        if (promoImageFiles.length > 0 && images.length === 0) {
            showStatus('addPromoStatus', 'فشل رفع الصور. جرب صوراً أصغر أو استخدم رابط مباشر.', 'error');
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة العرض';
            return;
        }

        var promoSize = images.reduce(function (s, u) { return s + (u ? u.length : 0); }, 0);
        if (promoSize > 850 * 1024) {
            showStatus('addPromoStatus', 'الصور كبيرة جداً (' + Math.round(promoSize / 1024) + 'KB) - مستند Firestore محدود بـ 1MB. اختر صوراً أصغر.', 'error');
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة العرض';
            return;
        }

        await db.collection('promotions').add({
            title, type, description, videoUrl, images,
            active: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showStatus('addPromoStatus', 'تم إضافة العرض بنجاح!', 'success');
        document.getElementById('promoTitle').value = '';
        document.getElementById('promoDescription').value = '';
        document.getElementById('promoVideo').value = '';
        document.getElementById('promoImages').value = '';
        document.getElementById('promoImagesPreview').innerHTML = '';
        if (document.getElementById('promoImageUrls')) document.getElementById('promoImageUrls').value = '';
        promoImageFiles = [];
        loadPromotionsList();
    } catch (err) {
        showStatus('addPromoStatus', 'خطأ: ' + err.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة العرض';
};

async function loadPromotionsList() {
    if (!requireDb()) return;
    const list = document.getElementById('promotionsList');
    list.innerHTML = '<div class="col-12 text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري التحميل...</div></div>';
    try {
        const snap = await db.collection('promotions').orderBy('createdAt', 'desc').get();
        document.getElementById('promoCount').textContent = snap.size;
        if (snap.empty) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-4">لا توجد عروض</div>';
            return;
        }
        const typeLabels = { promotion: 'عرض', activity: 'نشاط', offer: 'تخفيض' };
        const typeColors = { promotion: 'bg-primary', activity: 'bg-success', offer: 'bg-danger' };
        list.innerHTML = snap.docs.map(doc => {
            const p = doc.data();
            const time = p.createdAt?.toDate ? fmtDate(p.createdAt.toDate()) : '';
            const imgHtml = p.images && p.images.length > 0
                ? `<div class="d-flex gap-2 mb-2 flex-wrap">${p.images.map(u => `<img src="${u}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;" onerror="this.src='data:image/svg+xml,%253Csvg%2520xmlns%253D%2522http://www.w3.org/2000/svg%2522%2520width%253D%252280%2522%2520height%253D%252280%2522%253E%253Crect%2520fill%253D%2522%2523f0f0f0%2522%2520width%253D%252280%2522%2520height%253D%252280%2522%252F%253E%253Ctext%2520x%253D%252250%2525%2522%2520y%253D%252250%2525%2522%2520text-anchor%253D%2522middle%2522%2520fill%253D%2522%2523999%2522%2520font-size%253D%252230%2522%253E%25E2%259D%258C%253C%252Ftext%253E%253C%252Fsvg%253E'">`).join('')}</div>`
                : '';
            const videoHtml = p.videoUrl ? `<a href="${p.videoUrl}" target="_blank" class="btn btn-sm btn-outline-danger"><i class="bi bi-play-circle"></i> فيديو</a>` : '';
            return `<div class="col-md-4 col-sm-6">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start">
                            <h6 class="fw-bold mb-1">${p.title}</h6>
                            <div class="d-flex gap-1 align-items-center">
                                <span class="badge ${typeColors[p.type] || 'bg-secondary'}">${typeLabels[p.type] || p.type}</span>
                                <span class="badge bg-info">${p.images ? p.images.length : 0} صور</span>
                            </div>
                        </div>
                        ${imgHtml}
                        <p class="small text-muted mb-1">${p.description || ''}</p>
                        <div class="d-flex gap-2 align-items-center">
                            ${videoHtml}
                            <button class="btn btn-sm btn-outline-danger" onclick="deletePromotion('${doc.id}')"><i class="bi bi-trash"></i></button>
                        </div>
                        <small class="text-muted">${time}</small>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        list.innerHTML = '<div class="col-12 text-center text-danger py-4">خطأ في التحميل</div>';
    }
}

window.deletePromotion = async function(id) {
    if (!(await ARAconfirm('حذف هذا العرض؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('promotions').doc(id).delete();
        loadPromotionsList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// PRODUCTS MANAGEMENT
// ============================================
let prodImageFiles = [];

document.getElementById('prodImages')?.addEventListener('change', function(e) {
    prodImageFiles = Array.from(e.target.files);
    const preview = document.getElementById('prodImagesPreview');
    preview.innerHTML = prodImageFiles.map((f, i) =>
        `<div class="position-relative" style="width:100px;height:100px;">
            <img src="${URL.createObjectURL(f)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;">
            <button class="btn btn-sm btn-danger position-absolute top-0 end-0" style="padding:0 4px;font-size:10px;" onclick="removeProdImage(${i})">&times;</button>
        </div>`
    ).join('');
});

window.removeProdImage = function(idx) {
    prodImageFiles.splice(idx, 1);
    const dt = new DataTransfer();
    prodImageFiles.forEach(f => dt.items.add(f));
    document.getElementById('prodImages').files = dt.files;
    const preview = document.getElementById('prodImagesPreview');
    preview.innerHTML = prodImageFiles.map((f, i) =>
        `<div class="position-relative" style="width:100px;height:100px;">
            <img src="${URL.createObjectURL(f)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;">
            <button class="btn btn-sm btn-danger position-absolute top-0 end-0" style="padding:0 4px;font-size:10px;" onclick="removeProdImage(${i})">&times;</button>
        </div>`
    ).join('');
};

window.addProduct = async function() {
    if (!requireDb('addProductStatus')) return;
    const name = document.getElementById('prodName').value.trim();
    const type = document.getElementById('prodType').value;
    const price = parseFloat(document.getElementById('prodPrice').value) || 0;
    const phone = document.getElementById('prodPhone').value.trim();
    const description = document.getElementById('prodDescription').value.trim();
    const videoUrl = document.getElementById('prodVideo').value.trim();

    if (!name) { showStatus('addProductStatus', 'أدخل اسم المنتج', 'error'); return; }
    if (!phone) { showStatus('addProductStatus', 'أدخل رقم هاتف البائع', 'error'); return; }

    const btn = document.getElementById('btnAddProduct');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>جاري الحفظ...';

    try {
        const images = [];
        const urlText = document.getElementById('prodImageUrls')?.value.trim();
        if (urlText) {
            urlText.split('\n').map(u => u.trim()).filter(u => u).forEach(u => images.push(u));
        }
        if (prodImageFiles.length > 0) {
            try {
                const base64Images = await filesToBase64(prodImageFiles, 10);
                base64Images.forEach(function (u) { images.push(u); });
                if (base64Images.length > 0) {
                    showToast('تم رفع ' + base64Images.length + ' صورة', 'success');
                } else {
                    showToast('لم يتم تحويل أي صورة', 'warning');
                }
            } catch (convErr) {
                console.warn('Image conversion failed:', convErr.message);
                showToast('فشل معالجة بعض الصور، جرب صوراً أصغر', 'warning');
            }
        }

        if (prodImageFiles.length > 0 && images.length === 0) {
            showStatus('addProductStatus', 'فشل رفع الصور. جرب صوراً أصغر أو استخدم رابط مباشر.', 'error');
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة المنتج';
            return;
        }

        var prodSize = images.reduce(function (s, u) { return s + (u ? u.length : 0); }, 0);
        if (prodSize > 850 * 1024) {
            showStatus('addProductStatus', 'الصور كبيرة جداً (' + Math.round(prodSize / 1024) + 'KB) - مستند Firestore محدود بـ 1MB. اختر صوراً أصغر.', 'error');
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة المنتج';
            return;
        }

        await db.collection('products').add({
            name, type, price, phone, description, videoUrl, images,
            active: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const alsoCustomer = document.getElementById('prodAlsoCustomer')?.checked;
        if (alsoCustomer) {
            const cpRef = db.collection('customer_products').doc();
            markSelfTouched(cpRef.id);
            await cpRef.set({
                name, type, price, phone, description, videoUrl, images,
                active: true,
                ownerPhone: phone,
                views: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('تمت الإضافة أيضاً إلى متجر الزبائن', 'success');
        }

        showStatus('addProductStatus', 'تم إضافة المنتج بنجاح!', 'success');
        document.getElementById('prodName').value = '';
        document.getElementById('prodPrice').value = '';
        document.getElementById('prodPhone').value = '';
        document.getElementById('prodDescription').value = '';
        document.getElementById('prodVideo').value = '';
        document.getElementById('prodImages').value = '';
        document.getElementById('prodImagesPreview').innerHTML = '';
        if (document.getElementById('prodImageUrls')) document.getElementById('prodImageUrls').value = '';
        prodImageFiles = [];
        loadProductsList();
    } catch (err) {
        showStatus('addProductStatus', 'خطأ: ' + err.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة المنتج';
};

async function loadProductsList() {
    if (!requireDb()) return;
    const list = document.getElementById('productsList');
    list.innerHTML = '<div class="col-12 text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري التحميل...</div></div>';
    try {
        const snap = await db.collection('products').orderBy('createdAt', 'desc').get();
        document.getElementById('productCount').textContent = snap.size;
        if (snap.empty) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-4">لا توجد منتجات</div>';
            return;
        }
        const typeLabels = { car: 'سيارة', other: 'أخرى' };
        const typeIcons = { car: 'bi-car-front-fill', other: 'bi-box-seam' };
        list.innerHTML = snap.docs.map(doc => {
            const p = doc.data();
            const time = p.createdAt?.toDate ? fmtDate(p.createdAt.toDate()) : '';
            const imgHtml = p.images && p.images.length > 0
                ? `<img src="${p.images[0]}" style="width:100%;height:160px;object-fit:cover;border-radius:10px;" class="mb-2" onerror="this.src='data:image/svg+xml,%253Csvg%2520xmlns%253D%2522http://www.w3.org/2000/svg%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%253E%253Crect%2520fill%253D%2522%2523f0f0f0%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%252F%253E%253Ctext%2520x%253D%252250%2525%2522%2520y%253D%252250%2525%2522%2520text-anchor%253D%2522middle%2522%2520fill%253D%2522%2523999%2522%2520font-size%253D%252240%2522%253E%25F0%259F%2596%25BC%253C%252Ftext%253E%253C%252Fsvg%253E'">`
                : `<div class="mb-2" style="width:100%;height:160px;background:#f0f0f0;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="${typeIcons[p.type] || 'bi-box'} fs-1 text-muted"></i></div>`;
            const moreImages = p.images && p.images.length > 1
                ? `<div class="d-flex gap-1 mb-2">${p.images.slice(1, 5).map(u => `<img src="${u}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">`).join('')}</div>`
                : '';
            const videoHtml = p.videoUrl ? `<a href="${p.videoUrl}" target="_blank" class="btn btn-sm btn-outline-danger"><i class="bi bi-play-circle"></i> فيديو</a>` : '';
            return `<div class="col-md-4 col-sm-6">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body">
                        <div class="d-flex gap-1 align-items-center mb-1">
                            <span class="badge ${p.type === 'car' ? 'bg-warning text-dark' : 'bg-info'}"><i class="${typeIcons[p.type]}"></i> ${typeLabels[p.type] || p.type}</span>
                            <span class="badge bg-info">${p.images ? p.images.length : 0} صور</span>
                        </div>
                        ${imgHtml}
                        ${moreImages}
                        <h6 class="fw-bold mb-1">${p.name}</h6>
                        <p class="small text-muted mb-1">${p.description || ''}</p>
                        <h5 class="text-gold fw-bold mb-2">${p.price || 0} MRU</h5>
                        <div class="d-flex gap-2 flex-wrap">
                            <button onclick="callPhone('${p.phone||''}')" class="btn btn-sm btn-success"><i class="bi bi-telephone-fill"></i> اتصال</button>
                            <button onclick="openWhatsApp('222${(p.phone||'').replace(/^0+/, '')}','${encodeURIComponent(p.name||'')}')" class="btn btn-sm btn-success" style="background:#25D366;border-color:#25D366;"><i class="bi bi-whatsapp"></i> واتساب</button>
                            ${videoHtml}
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteProduct('${doc.id}')"><i class="bi bi-trash"></i></button>
                        </div>
                        <small class="text-muted d-block mt-2">${time}</small>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        list.innerHTML = '<div class="col-12 text-center text-danger py-4">خطأ في التحميل</div>';
    }
}

window.deleteProduct = async function(id) {
    if (!(await ARAconfirm('حذف هذا المنتج؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('products').doc(id).delete();
        loadProductsList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

function callPhone(phone) {
    if (!phone) return;
    window.location.href = 'tel:' + phone;
}

function openWhatsApp(phone, name) {
    if (!phone) return;
    var text = 'مرحباً بخصوص ' + decodeURIComponent(name);
    var intentUrl = 'intent://send?phone=' + phone + '&text=' + encodeURIComponent(text) + '#Intent;scheme=smsto;package=com.whatsapp;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.whatsapp;end';
    window.location.href = intentUrl;
}

// ============================================
// INIT
// ============================================
function initDashboard() {
    // The map tiles get priority: the heavy Firestore listeners and stats are
    // started a moment later so the live map appears quickly on slow links.
    initMap();
    loadNouakchottPlaces();
    applyRoleVisibility();
    // Ensure the map re-measures after the layout settles so it always fills
    // the whole container (prevents a partially-rendered map).
    setTimeout(() => { if (map) map.invalidateSize(); }, 350);
    setTimeout(() => {
        syncNouakchottPlaces();
        loadCommission();
        loadCustomerCommission();
        loadPricingConfig();
        loadStats();
        initRealtimeListeners();
        initEventWatchers();
        initDesktopNotifications();
        setInterval(loadStats, 60000);
        addNotifLog('system', 'تم تشغيل لوحة التحكم');
    }, 1200);
}

initDashboard();

// ============================================
// STORES (SMART PROMOTIONS) MANAGEMENT
// ============================================
let storeImageFile = null;

document.getElementById('storeImage')?.addEventListener('change', function(e) {
    storeImageFile = e.target.files[0] || null;
    const preview = document.getElementById('storeImagePreview');
    if (preview) {
        if (storeImageFile) {
            preview.classList.remove('d-none');
            preview.querySelector('img').src = URL.createObjectURL(storeImageFile);
        } else {
            preview.classList.add('d-none');
        }
    }
});

document.getElementById('storeImageUrl')?.addEventListener('input', function(e) {
    const preview = document.getElementById('storeImagePreview');
    if (preview) {
        const url = e.target.value.trim();
        if (url) {
            preview.classList.remove('d-none');
            preview.querySelector('img').src = url;
        } else if (!storeImageFile) {
            preview.classList.add('d-none');
        }
    }
});

// ============================================
// STORE LOCATION MAP PICKER
// ============================================
let storeMap = null;
let storeMapMarker = null;
let storeMapLocation = null;

window.openStoreMapPicker = function() {
    const modalEl = document.getElementById('storeMapModal');
    const pickerEl = document.getElementById('storeMapPicker');
    if (!modalEl || !pickerEl) return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    setTimeout(() => {
        if (storeMap) { storeMap.invalidateSize(); return; }
        storeMap = L.map('storeMapPicker', { zoomControl: true }).setView([18.0735, -15.9582], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap', maxZoom: 19
        }).addTo(storeMap);
        if (storeMapLocation) {
            storeMapMarker = L.marker(storeMapLocation).addTo(storeMap);
            storeMap.setView(storeMapLocation, 15);
        }
        storeMap.on('click', function(e) {
            storeMapLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
            if (storeMapMarker) storeMapMarker.setLatLng(e.latlng);
            else storeMapMarker = L.marker(e.latlng).addTo(storeMap);
            document.getElementById('storeMapCoordsText').textContent =
                'تم التحديد: ' + e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
        });
    }, 150);
};

document.getElementById('confirmStoreLocationBtn')?.addEventListener('click', function() {
    if (!storeMapLocation) { ARAalert('انقر على الخريطة لتحديد موقع المتجر أولاً', 'warning'); return; }
    bootstrap.Modal.getInstance(document.getElementById('storeMapModal'))?.hide();
    document.getElementById('storeLocationText').innerHTML =
        '<i class="bi bi-check-circle text-success me-1"></i>تم تحديد الموقع: ' +
        storeMapLocation.lat.toFixed(5) + ', ' + storeMapLocation.lng.toFixed(5);
    document.getElementById('btnClearStoreLocation').classList.remove('d-none');
});

window.clearStoreLocation = function() {
    storeMapLocation = null;
    if (storeMapMarker) { storeMapMarker.remove(); storeMapMarker = null; }
    document.getElementById('storeLocationText').innerHTML =
        '<i class="bi bi-info-circle me-1"></i>لم يُحدد الموقع بعد — يستطيع السائق توجيه نفسه إلى المتجر';
    document.getElementById('btnClearStoreLocation').classList.add('d-none');
    document.getElementById('storeMapCoordsText').textContent = 'لم يُحدد بعد';
};

window.addStore = async function() {
    if (!requireDb('addStoreStatus')) return;
    const name = document.getElementById('storeName').value.trim();
    const phone = document.getElementById('storePhone').value.trim();
    const district = document.getElementById('storeDistrict').value.trim();
    if (!name) { showStatus('addStoreStatus', 'أدخل اسم المتجر', 'error'); return; }
    if (!phone) { showStatus('addStoreStatus', 'أدخل رقم الهاتف', 'error'); return; }

    const btn = document.getElementById('btnAddStore');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>جاري الحفظ...';

    try {
        const images = [];
        const urlText = document.getElementById('storeImageUrl')?.value.trim();
        if (urlText) images.push(urlText);
        if (storeImageFile) {
            try {
                const b64 = await fileToBase64(storeImageFile);
                if (b64) images.push(b64);
            } catch (convErr) { console.warn('Image conversion failed:', convErr.message); }
        }
        const active = document.getElementById('storeActive').checked;
        await db.collection('stores_promotion').add({
            name, phone, district,
            images,
            active,
            lat: storeMapLocation ? storeMapLocation.lat : null,
            lng: storeMapLocation ? storeMapLocation.lng : null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus('addStoreStatus', 'تم إضافة المتجر بنجاح!', 'success');
        document.getElementById('storeName').value = '';
        document.getElementById('storePhone').value = '';
        document.getElementById('storeDistrict').value = '';
        document.getElementById('storeImage').value = '';
        document.getElementById('storeImageUrl').value = '';
        storeImageFile = null;
        clearStoreLocation();
        loadStoresList();
    } catch (err) {
        showStatus('addStoreStatus', 'خطأ: ' + err.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة المتجر';
};

async function loadStoresList() {
    if (!requireDb()) return;
    const list = document.getElementById('storesList');
    list.innerHTML = '<div class="col-12 text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري التحميل...</div></div>';
    try {
        const snap = await db.collection('stores_promotion').orderBy('createdAt', 'desc').get();
        document.getElementById('storeCount').textContent = snap.size;
        if (snap.empty) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-4">لا توجد متاجر</div>';
            return;
        }
        list.innerHTML = snap.docs.map(doc => {
            const s = doc.data();
            const active = s.active !== false;
            const imgHtml = s.images && s.images.length > 0
                ? `<img src="${s.images[0]}" style="width:100%;height:140px;object-fit:cover;border-radius:10px;" class="mb-2" onerror="this.src='data:image/svg+xml,%253Csvg%2520xmlns%253D%2522http://www.w3.org/2000/svg%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%253E%253Crect%2520fill%253D%2522%2523f0f0f0%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%252F%253E%253Ctext%2520x%253D%252250%2525%2522%2520y%253D%252250%2525%2522%2520text-anchor%253D%2522middle%2522%2520fill%253D%2522%2523999%2522%2520font-size%253D%252240%2522%253E%25F0%259F%259B%258D%253C%252Ftext%253E%253C%252Fsvg%253E'">`
                : `<div class="mb-2" style="width:100%;height:140px;background:#f0f0f0;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="bi bi-shop-window fs-1 text-muted"></i></div>`;
            return `<div class="col-md-4 col-sm-6">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start">
                            <h6 class="fw-bold mb-1">${s.name}</h6>
                            <div class="d-flex gap-1">
                                ${s.lat != null && s.lng != null ? '<span class="badge bg-info" title="له موقع على الخريطة"><i class="bi bi-geo-alt"></i></span>' : ''}
                                <span class="badge ${active ? 'bg-success' : 'bg-secondary'}">${active ? 'ظاهر' : 'مخفي'}</span>
                            </div>
                        </div>
                        ${imgHtml}
                        ${s.district ? `<p class="small text-muted mb-1"><i class="bi bi-geo-alt me-1"></i>${s.district}</p>` : ''}
                        <div class="d-flex gap-2 flex-wrap">
                            <button onclick="callPhone('${s.phone || ''}')" class="btn btn-sm btn-success"><i class="bi bi-telephone-fill"></i> اتصال</button>
                            <button onclick="openWhatsApp('${s.phone || ''}','${encodeURIComponent(s.name || '')}')" class="btn btn-sm btn-success" style="background:#25D366;border-color:#25D366;"><i class="bi bi-whatsapp"></i> واتساب</button>
                            <button class="btn btn-sm ${active ? 'btn-outline-warning' : 'btn-outline-success'}" onclick="toggleStore('${doc.id}', ${active})"><i class="bi ${active ? 'bi-eye-slash' : 'bi-eye'}"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteStore('${doc.id}')"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        list.innerHTML = '<div class="col-12 text-center text-danger py-4">خطأ في التحميل</div>';
    }
}

window.toggleStore = async function(id, currentActive) {
    if (!requireDb()) return;
    try {
        await db.collection('stores_promotion').doc(id).update({ active: !currentActive });
        loadStoresList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteStore = async function(id) {
    if (!(await ARAconfirm('حذف هذا المتجر؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('stores_promotion').doc(id).delete();
        loadStoresList();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// LADIES' STORE PRODUCTS MANAGEMENT
// ============================================
let ladiesImageFiles = [];

document.getElementById('ladiesImages')?.addEventListener('change', function(e) {
    ladiesImageFiles = Array.from(e.target.files);
    const preview = document.getElementById('ladiesImagesPreview');
    preview.innerHTML = ladiesImageFiles.map((f, i) =>
        `<div class="position-relative" style="width:100px;height:100px;">
            <img src="${URL.createObjectURL(f)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;">
            <button class="btn btn-sm btn-danger position-absolute top-0 end-0" style="padding:0 4px;font-size:10px;" onclick="removeLadiesImage(${i})">&times;</button>
        </div>`
    ).join('');
});

window.removeLadiesImage = function(idx) {
    ladiesImageFiles.splice(idx, 1);
    const dt = new DataTransfer();
    ladiesImageFiles.forEach(f => dt.items.add(f));
    document.getElementById('ladiesImages').files = dt.files;
    const preview = document.getElementById('ladiesImagesPreview');
    preview.innerHTML = ladiesImageFiles.map((f, i) =>
        `<div class="position-relative" style="width:100px;height:100px;">
            <img src="${URL.createObjectURL(f)}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;">
            <button class="btn btn-sm btn-danger position-absolute top-0 end-0" style="padding:0 4px;font-size:10px;" onclick="removeLadiesImage(${i})">&times;</button>
        </div>`
    ).join('');
};

window.addLadiesProduct = async function() {
    if (!requireDb('addLadiesStatus')) return;
    const name = document.getElementById('ladiesName').value.trim();
    const price = parseFloat(document.getElementById('ladiesPrice').value) || 0;
    const phone = document.getElementById('ladiesPhone').value.trim();
    const description = document.getElementById('ladiesDescription').value.trim();
    if (!name) { showStatus('addLadiesStatus', 'أدخل اسم المنتج', 'error'); return; }

    const btn = document.getElementById('btnAddLadiesProduct');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>جاري الحفظ...';

    try {
        const images = [];
        const urlText = document.getElementById('ladiesImageUrls')?.value.trim();
        if (urlText) {
            urlText.split('\n').map(u => u.trim()).filter(u => u).forEach(u => images.push(u));
        }
        if (ladiesImageFiles.length > 0) {
            try {
                const base64Images = await filesToBase64(ladiesImageFiles, 10);
                base64Images.forEach(function (u) { images.push(u); });
            } catch (convErr) {
                console.warn('Image conversion failed:', convErr.message);
            }
        }
        if (ladiesImageFiles.length > 0 && images.length === 0) {
            showStatus('addLadiesStatus', 'فشل رفع الصور. جرب صوراً أصغر أو استخدم رابط مباشر.', 'error');
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة المنتج';
            return;
        }

        await db.collection('ladies_products').add({
            name, price, phone, description, images,
            active: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showStatus('addLadiesStatus', 'تم إضافة المنتج بنجاح!', 'success');
        document.getElementById('ladiesName').value = '';
        document.getElementById('ladiesPrice').value = '';
        document.getElementById('ladiesPhone').value = '';
        document.getElementById('ladiesDescription').value = '';
        document.getElementById('ladiesImages').value = '';
        document.getElementById('ladiesImageUrls').value = '';
        document.getElementById('ladiesImagesPreview').innerHTML = '';
        ladiesImageFiles = [];
        loadLadiesProducts();
    } catch (err) {
        showStatus('addLadiesStatus', 'خطأ: ' + err.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>إضافة المنتج';
};

async function loadLadiesProducts() {
    if (!requireDb()) return;
    const list = document.getElementById('ladiesList');
    list.innerHTML = '<div class="col-12 text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري التحميل...</div></div>';
    try {
        const snap = await db.collection('ladies_products').orderBy('createdAt', 'desc').get();
        document.getElementById('ladiesCount').textContent = snap.size;
        if (snap.empty) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-4">لا توجد منتجات</div>';
            return;
        }
        list.innerHTML = snap.docs.map(doc => {
            const p = doc.data();
            const time = p.createdAt?.toDate ? fmtDate(p.createdAt.toDate()) : '';
            const imgHtml = p.images && p.images.length > 0
                ? `<img src="${p.images[0]}" style="width:100%;height:160px;object-fit:cover;border-radius:10px;" class="mb-2" onerror="this.src='data:image/svg+xml,%253Csvg%2520xmlns%253D%2522http://www.w3.org/2000/svg%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%253E%253Crect%2520fill%253D%2522%2523f0f0f0%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%252F%253E%253Ctext%2520x%253D%252250%2525%2522%2520y%253D%252250%2525%2522%2520text-anchor%253D%2522middle%2522%2520fill%253D%2522%2523999%2522%2520font-size%253D%252240%2522%253E%25F0%259F%2591%2597%253C%252Ftext%253E%253C%252Fsvg%253E'">`
                : `<div class="mb-2" style="width:100%;height:160px;background:#f0f0f0;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="bi bi-gem fs-1 text-muted"></i></div>`;
            return `<div class="col-md-4 col-sm-6">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body">
                        <h6 class="fw-bold mb-1">${p.name}</h6>
                        ${imgHtml}
                        <p class="small text-muted mb-1">${p.description || ''}</p>
                        <h5 class="text-gold fw-bold mb-2">${p.price || 0} MRU</h5>
                        <div class="d-flex gap-2 flex-wrap">
                            <button onclick="callPhone('${p.phone || ''}')" class="btn btn-sm btn-success"><i class="bi bi-telephone-fill"></i> اتصال</button>
                            <button class="btn btn-sm btn-outline-warning" onclick="toggleLadiesProduct('${doc.id}')"><i class="bi bi-eye-slash"></i> إخفاء</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteLadiesProduct('${doc.id}')"><i class="bi bi-trash"></i></button>
                        </div>
                        <small class="text-muted d-block mt-2">${time}</small>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        list.innerHTML = '<div class="col-12 text-center text-danger py-4">خطأ في التحميل</div>';
    }
}

window.toggleLadiesProduct = async function(id) {
    if (!requireDb()) return;
    try {
        const snap = await db.collection('ladies_products').doc(id).get();
        if (snap.exists) {
            const active = snap.data().active !== false;
            await db.collection('ladies_products').doc(id).update({ active: !active });
            loadLadiesProducts();
        }
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteLadiesProduct = async function(id) {
    if (!(await ARAconfirm('حذف هذا المنتج؟'))) return;
    if (!requireDb()) return;
    try {
        await db.collection('ladies_products').doc(id).delete();
        loadLadiesProducts();
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// CUSTOMER PRODUCTS (UPLOADED FROM APP) MANAGEMENT
// ============================================
function initCustomerProductsListener() {
    if (!db || customerProductsListener) return;
    customerProductsListener = db.collection('customer_products')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' && !productsSeen[change.doc.id]) {
                    productsSeen[change.doc.id] = true;
                    if (productsWatchFirst || isSelfTouched(change.doc.id)) return;
                    const p = change.doc.data();
                    console.log('new customer product (feature archived):', p.name);
                }
            });
            productsWatchFirst = false;
            allCustomerProducts = [];
            snapshot.forEach(doc => {
                allCustomerProducts.push({ id: doc.id, ...doc.data() });
            });
            const countEl = document.getElementById('customerProductCount');
            if (countEl) countEl.textContent = allCustomerProducts.length;
            if (currentPage === 'products') loadCustomerProductsList();
        }, err => {
            console.log('customer_products listener error', err);
        });
}

function loadCustomerProductsList() {
    const list = document.getElementById('customerProductsList');
    if (!list) return;
    const filter = document.getElementById('customerProductFilter')?.value || 'all';
    let items = allCustomerProducts;
    if (filter !== 'all') {
        items = items.filter(p => {
            const s = p.status || (p.active !== false ? 'approved' : 'hidden');
            return s === filter;
        });
    }
    renderCustomerProductsList(list, items);
}

function renderCustomerProductsList(list, items) {
    if (items.length === 0) {
        list.innerHTML = '<div class="col-12 text-center text-muted py-4">لا توجد منتجات من الزبائن</div>';
        return;
    }
    list.innerHTML = items.map(p => {
        const active = p.active !== false;
        const status = p.status || (active ? 'approved' : 'hidden');
        const time = p.createdAt?.toDate ? fmtDate(p.createdAt.toDate()) : '';
        const statusBadge = status === 'approved'
            ? '<span class="badge bg-success">ظاهر في المتجر</span>'
            : status === 'pending'
                ? '<span class="badge bg-warning text-dark">بانتظار الموافقة</span>'
                : status === 'rejected'
                    ? '<span class="badge bg-danger">مرفوض</span>'
                    : '<span class="badge bg-secondary">مخفي</span>';
        const imgHtml = p.images && p.images.length > 0
            ? `<img src="${p.images[0]}" style="width:100%;height:160px;object-fit:cover;border-radius:10px;" class="mb-2" onerror="this.src='data:image/svg+xml,%253Csvg%2520xmlns%253D%2522http://www.w3.org/2000/svg%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%253E%253Crect%2520fill%253D%2522%2523f0f0f0%2522%2520width%253D%2522200%2522%2520height%253D%2522200%2522%252F%253E%253Ctext%2520x%253D%252250%2525%2522%2520y%253D%252250%2525%2522%2520text-anchor%253D%2522middle%2522%2520fill%253D%2522%2523999%2522%2520font-size%253D%252240%2522%253E%25F0%259F%2596%25BC%253C%252Ftext%253E%253C%252Fsvg%253E'">`
            : `<div class="mb-2" style="width:100%;height:160px;background:#f0f0f0;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="bi bi-box fs-1 text-muted"></i></div>`;
        let actions = '';
        if (status === 'pending') {
            actions += `<button class="btn btn-sm btn-success" onclick="approveCustomerProduct('${p.id}')"><i class="bi bi-check-lg"></i> قبول</button> `;
            actions += `<button class="btn btn-sm btn-outline-danger" onclick="rejectCustomerProduct('${p.id}')"><i class="bi bi-x-lg"></i> رفض</button> `;
        }
        if (active) {
            actions += `<button class="btn btn-sm btn-outline-warning" onclick="toggleCustomerProduct('${p.id}', true)"><i class="bi bi-eye-slash"></i> إخفاء</button> `;
        } else if (status !== 'rejected') {
            actions += `<button class="btn btn-sm btn-outline-success" onclick="toggleCustomerProduct('${p.id}', false)"><i class="bi bi-eye"></i> إظهار</button> `;
        }
        actions += `<button class="btn btn-sm btn-outline-danger" onclick="deleteCustomerProduct('${p.id}')"><i class="bi bi-trash"></i></button>`;
        return `<div class="col-md-4 col-sm-6">
            <div class="card border-0 shadow-sm h-100 ${active ? '' : 'opacity-75'}">
                <div class="card-body">
                    <div class="d-flex gap-1 align-items-center mb-1 flex-wrap">
                        ${statusBadge}
                        <span class="badge bg-info">${p.views || 0} مشاهدة</span>
                    </div>
                    ${imgHtml}
                    <h6 class="fw-bold mb-1">${p.name}</h6>
                    <p class="small text-muted mb-1">${p.description || ''}</p>
                    <h5 class="text-gold fw-bold mb-1">${p.price || 0} MRU</h5>
                    ${p.monthlyPrice ? `<div class="small mb-1">العرض الشهري: <strong>${p.monthlyPrice} MRU</strong></div>` : ''}
                    ${p.ownerPhone ? `<div class="small text-muted mb-1">الزبون: <span dir="ltr">${escapeHtmlStr(p.ownerPhone)}</span></div>` : ''}
                    <div class="d-flex gap-2 flex-wrap">
                        ${p.phone ? `<button onclick="callPhone('${p.phone.replace(/'/g, '')}')" class="btn btn-sm btn-success"><i class="bi bi-telephone-fill"></i> اتصال</button>` : ''}
                        ${actions}
                    </div>
                    <small class="text-muted d-block mt-2">${time}</small>
                </div>
            </div>
        </div>`;
    }).join('');
}

function notifyCustomerProduct(ownerPhone, title, body, status, productName) {
    if (!ownerPhone) return;
    db.collection('customers').where('phone', '==', ownerPhone).get()
        .then(cust => {
            if (!cust.empty) {
                notifyUser('customers', cust.docs[0].id, {
                    type: 'product_status',
                    title: title,
                    body: body,
                    status: status,
                    productName: productName || ''
                });
            }
        })
        .catch(() => {});
}

window.approveCustomerProduct = async function(id) {
    if (!requireDb()) return;
    try {
        const snap = await db.collection('customer_products').doc(id).get();
        const p = snap.data() || {};
        await db.collection('customer_products').doc(id).update({ active: true, status: 'approved' });
        ARAalert('تم قبول المنتج وأصبح ظاهراً في المتجر الذكي', 'success');
        notifyCustomerProduct(p.ownerPhone, 'تمت الموافقة على منتجك', p.name || 'منتجك', 'approved', p.name || '');
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.rejectCustomerProduct = async function(id) {
    if (!(await ARAconfirm('رفض هذا المنتج؟ لن يظهر في المتجر وسيتم إشعار الزبون.'))) return;
    if (!requireDb()) return;
    try {
        const snap = await db.collection('customer_products').doc(id).get();
        const p = snap.data() || {};
        await db.collection('customer_products').doc(id).update({ active: false, status: 'rejected' });
        ARAalert('تم رفض المنتج', 'success');
        notifyCustomerProduct(p.ownerPhone, 'تم رفض منتجك', p.name || 'منتجك', 'rejected', p.name || '');
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.toggleCustomerProduct = async function(id, currentActive) {
    if (!requireDb()) return;
    try {
        const snap = await db.collection('customer_products').doc(id).get();
        const p = snap.data() || {};
        const newActive = !currentActive;
        await db.collection('customer_products').doc(id).update({ active: newActive, status: newActive ? 'approved' : 'hidden' });
        ARAalert(newActive ? 'تم إظهار المنتج في المتجر الذكي' : 'تم إخفاء المنتج', 'success');
        notifyCustomerProduct(p.ownerPhone, newActive ? 'تمت الموافقة على منتجك' : 'تم إخفاء منتجك', p.name || 'منتجك', newActive ? 'approved' : 'hidden', p.name || '');
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

window.deleteCustomerProduct = async function(id) {
    if (!(await ARAconfirm('حذف هذا المنتج نهائياً؟ سيتم إشعار الزبون.'))) return;
    if (!requireDb()) return;
    try {
        const snap = await db.collection('customer_products').doc(id).get();
        const p = snap.data() || {};
        await db.collection('customer_products').doc(id).delete();
        ARAalert('تم حذف المنتج', 'success');
        notifyCustomerProduct(p.ownerPhone, 'تم حذف منتجك', p.name || 'منتجك', 'deleted', p.name || '');
    } catch (err) { ARAalert('خطأ: ' + err.message, 'error'); }
};

// ============================================
// REPORTS & STATISTICS
// ============================================
let reportRangeDays = 7;
let reportCustomFrom = null;
let reportCustomTo = null;
let reportCharts = { daily: null, status: null };

function reportMoney(n) {
    try { return fmtNum(Math.round(n).toLocaleString('en-US')); } catch (e) { return String(Math.round(n)); }
}

function reportDayKey(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm;
}

function reportYMD(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
}

function reportTs(v) {
    if (!v) return null;
    try {
        const d = v.toDate ? v.toDate() : new Date(v);
        return isNaN(d.getTime()) ? null : d;
    } catch (e) { return null; }
}

window.setReportRange = function (days) {
    reportRangeDays = days;
    reportCustomFrom = null;
    reportCustomTo = null;
    document.querySelectorAll('.report-range').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
    loadReports();
};

async function loadReports() {
    if (!requireDb()) return;
    const body = document.getElementById('reportSummaryCards');
    if (!body) return;
    body.innerHTML = '<div class="col-12 text-center text-muted py-5"><i class="bi bi-hourglass-split me-2"></i>جاري تجميع البيانات...</div>';
    try {
        try {
            const cfg = await db.collection('settings').doc('app_config').get();
            if (cfg.exists) commissionPercent = cfg.data().commissionPercent || 10;
        } catch (e) {}

        const to = reportCustomTo || new Date();
        if (!reportCustomTo) to.setHours(23, 59, 59, 999);
        let from = reportCustomFrom;
        if (!from && reportRangeDays > 0) {
            from = new Date();
            from.setDate(from.getDate() - reportRangeDays);
            from.setHours(0, 0, 0, 0);
        }

        const fromInput = document.getElementById('reportFrom');
        const toInput = document.getElementById('reportTo');
        if (fromInput) fromInput.value = from ? reportYMD(from) : '';
        if (toInput) toInput.value = reportYMD(to);

        const driversMap = {};
        const driverNames = {};
        try {
            const ds = await db.collection('drivers').get();
            ds.forEach(d => {
                const dd = d.data();
                driversMap[d.id] = { name: dd.name || 'سائق', phone: dd.phone || '-' };
                driverNames[d.id] = dd.name || 'سائق';
            });
        } catch (e) {}

        const ridesSnap = from ? await db.collection('rides').where('createdAt', '>=', from).get() : await db.collection('rides').get();
        const delSnap = from ? await db.collection('delivery_requests').where('createdAt', '>=', from).get() : await db.collection('delivery_requests').get();
        const recSnap = await db.collection('recharge_requests').where('status', '==', 'approved').get();

        const dayMap = {};
        const statusCount = {};
        const driverAgg = {};
        const pushDay = (t, cb) => {
            if (!t) return;
            const key = reportDayKey(t);
            if (!dayMap[key]) dayMap[key] = { key, rides: 0, fare: 0, comm: 0, deliveries: 0, delFare: 0, recharge: 0 };
            cb(dayMap[key]);
        };

        let totalRides = 0, completedRides = 0, totalFare = 0, totalComm = 0;
        let totalDel = 0, delFare = 0, totalRecharge = 0;
        const uniqCustomers = new Set();

        ridesSnap.forEach(doc => {
            const r = doc.data();
            const t = reportTs(r.createdAt);
            if (!t) return;
            if (to && t > to) return;
            const fare = parseFloat(r.fare) || 0;
            const comm = r.commissionAmount != null ? (parseFloat(r.commissionAmount) || 0) : Math.round(fare * commissionPercent / 100);
            const st = r.status || 'unknown';
            statusCount[st] = (statusCount[st] || 0) + 1;
            totalRides++;
            totalFare += fare;
            totalComm += comm;
            if (st === 'completed') completedRides++;
            if (r.passengerPhone) uniqCustomers.add(r.passengerPhone);
            pushDay(t, x => { x.rides++; x.fare += fare; x.comm += comm; });
            if (r.driverId) {
                if (!driverAgg[r.driverId]) driverAgg[r.driverId] = { id: r.driverId, rides: 0, fare: 0 };
                driverAgg[r.driverId].rides++;
                driverAgg[r.driverId].fare += fare;
            }
        });

        delSnap.forEach(doc => {
            const d = doc.data();
            const t = reportTs(d.createdAt);
            if (!t) return;
            if (to && t > to) return;
            if (d.status === 'cancelled') return;
            const price = parseFloat(d.pendingPrice != null ? d.pendingPrice : (d.fare != null ? d.fare : d.price)) || 0;
            totalDel++; delFare += price;
            pushDay(t, x => { x.deliveries++; x.delFare += price; });
        });

        recSnap.forEach(doc => {
            const r = doc.data();
            const amt = parseFloat(r.amount) || 0;
            const t = reportTs(r.processedAt) || reportTs(r.createdAt);
            if (!t) return;
            if (from && t < from) return;
            if (to && t > to) return;
            totalRecharge += amt;
            pushDay(t, x => { x.recharge += amt; });
        });

        const cards = [
            { label: 'إجمالي الرحلات', value: fmtNum(totalRides.toLocaleString('en-US')), icon: 'bi-journal-text', color: 'text-dark-blue' },
            { label: 'رحلات مكتملة', value: fmtNum(completedRides.toLocaleString('en-US')), icon: 'bi-check-circle', color: 'text-success' },
            { label: 'إيراد الرحلات (MRU)', value: reportMoney(totalFare), icon: 'bi-cash-stack', color: 'text-primary' },
            { label: 'العمولات (MRU)', value: reportMoney(totalComm), icon: 'bi-percent', color: 'text-danger' },
            { label: 'طلبات التوصيل', value: fmtNum(totalDel.toLocaleString('en-US')), icon: 'bi-truck', color: 'text-warning' },
            { label: 'إيراد التوصيل (MRU)', value: reportMoney(delFare), icon: 'bi-cash', color: 'text-warning' },
            { label: 'إيراد الاشتراكات المقبولة (MRU)', value: reportMoney(totalRecharge), icon: 'bi-credit-card', color: 'text-success' },
            { label: 'زبائن فريدون', value: fmtNum(uniqCustomers.size.toLocaleString('en-US')), icon: 'bi-people', color: 'text-info' }
        ];
        body.innerHTML = cards.map(c => `
            <div class="col-6 col-md-3">
                <div class="card border-0 shadow-sm text-center py-2">
                    <div class="fs-2 ${c.color}"><i class="bi ${c.icon}"></i></div>
                    <div class="fs-5 fw-bold">${c.value}</div>
                    <small class="text-muted">${c.label}</small>
                </div>
            </div>`).join('');

        const days = Object.keys(dayMap).sort((a, b) =>
            a.split('/').reverse().join('-').localeCompare(b.split('/').reverse().join('-')));
        renderDailyChart(days, days.map(d => dayMap[d].rides), days.map(d => Math.round(dayMap[d].fare)), days.map(d => Math.round(dayMap[d].comm)));
        renderStatusChart(statusCount);

        const topDrivers = Object.values(driverAgg).sort((a, b) => b.fare - a.fare).slice(0, 10);
        const driversEl = document.getElementById('reportTopDrivers');
        if (driversEl) {
            driversEl.innerHTML = topDrivers.map((dr, i) => {
                const info = driversMap[dr.id] || {};
                return `<tr>
                    <td>${i + 1}</td>
                    <td>${escapeHtmlStr(info.name || driverNames[dr.id] || 'سائق')}</td>
                    <td class="small" dir="ltr">${escapeHtmlStr(info.phone || '-')}</td>
                    <td>${fmtNum(dr.rides.toLocaleString('en-US'))}</td>
                    <td><strong>${reportMoney(dr.fare)}</strong> MRU</td>
                    <td>${info.rating != null ? info.rating : '-'}</td>
                </tr>`;
            }).join('') || '<tr><td colspan="6" class="text-center text-muted py-3">لا توجد رحلات في هذه الفترة</td></tr>';
        }

        const dailyEl = document.getElementById('reportDailyTable');
        if (dailyEl) {
            dailyEl.innerHTML = days.slice().reverse().map(d => {
                const x = dayMap[d];
                return `<tr>
                    <td>${escapeHtmlStr(d)}</td>
                    <td>${fmtNum(x.rides.toLocaleString('en-US'))}</td>
                    <td>${reportMoney(x.fare)} MRU</td>
                    <td>${reportMoney(x.comm)} MRU</td>
                    <td>${fmtNum(x.deliveries.toLocaleString('en-US'))} (${reportMoney(x.delFare)})</td>
                    <td>${reportMoney(x.recharge)} MRU</td>
                </tr>`;
            }).join('') || '<tr><td colspan="6" class="text-center text-muted py-3">لا توجد بيانات في هذه الفترة</td></tr>';
        }
    } catch (e) {
        console.error('Report error:', e);
        body.innerHTML = '<div class="col-12 text-center text-danger py-5">خطأ في توليد التقرير: ' + escapeHtmlStr(e.message) + '</div>';
    }
}

function renderDailyChart(labels, ridesData, fareData, commData) {
    const ctx = document.getElementById('reportDailyChart');
    if (!ctx) return;
    if (reportCharts.daily) reportCharts.daily.destroy();
    reportCharts.daily = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'الرحلات', data: ridesData, backgroundColor: 'rgba(47,125,246,0.7)', borderRadius: 4, yAxisID: 'y' },
                { label: 'الإيراد (MRU)', data: fareData, backgroundColor: 'rgba(22,199,154,0.7)', borderRadius: 4, yAxisID: 'y1' },
                { label: 'العمولات (MRU)', data: commData, backgroundColor: 'rgba(240,72,62,0.7)', borderRadius: 4, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { rtl: true, position: 'top' } },
            scales: {
                y: { beginAtZero: true, position: 'right', grid: { color: 'rgba(0,0,0,0.05)' } },
                y1: { beginAtZero: true, position: 'left', grid: { drawOnChartArea: false } }
            }
        }
    });
}

function renderStatusChart(statusCount) {
    const ctx = document.getElementById('reportStatusChart');
    if (!ctx) return;
    if (reportCharts.status) reportCharts.status.destroy();
    const labelsMap = { pending: 'قيد الانتظار', accepted: 'مقبولة', in_progress: 'جارية', completed: 'مكتملة', cancelled: 'ملغاة', expired: 'منتهٍ', no_drivers: 'بلا سائق', unknown: 'أخرى' };
    const colors = ['#F5A623', '#2F7DF6', '#16C79A', '#8E44AD', '#F0483E', '#9AA5B5', '#CCCCCC'];
    const labels = Object.keys(statusCount).map(s => labelsMap[s] || s);
    const data = Object.values(statusCount);
    reportCharts.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 1 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { rtl: true, position: 'bottom' } }
        }
    });
}

document.querySelectorAll('.report-range').forEach(btn => {
    btn.addEventListener('click', () => setReportRange(Number(btn.dataset.days)));
});

const reportRefreshBtn = document.getElementById('reportRefreshBtn');
if (reportRefreshBtn) {
    reportRefreshBtn.addEventListener('click', () => {
        const fromStr = document.getElementById('reportFrom').value;
        const toStr = document.getElementById('reportTo').value;
        if (fromStr) {
            reportCustomFrom = new Date(fromStr + 'T00:00:00');
            reportCustomTo = toStr ? new Date(toStr + 'T23:59:59') : new Date();
            document.querySelectorAll('.report-range').forEach(b => b.classList.remove('active'));
        }
        loadReports();
    });
}

// ============================================
// DEVICES REPORT
// ============================================
function fmtDevDate(t) {
    if (!t) return '—';
    let d = t;
    if (d && typeof d.toDate === 'function') d = d.toDate();
    else if (typeof t === 'string') d = new Date(t);
    if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadDevices() {
    if (!requireDb()) return;
    const tbody = document.getElementById('devicesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="SHATER-spinner"></div><div class="mt-2 text-muted small">جاري تحميل الأجهزة...</div></td></tr>';
    const setCount = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    try {
        const [sd, sc] = await Promise.all([
            db.collection('drivers').get(),
            db.collection('customers').get()
        ]);

        const devices = new Map();
        const unknownAccounts = [];
        const brandCount = {};
        const canDelDriver = canPerm('drivers_delete');
        const canDelCustomer = canPerm('customers_delete');

        const handle = (doc, role, isDriver) => {
            const d = doc.data();
            const name = d.name || '-';
            const phone = d.phone || '-';
            const credit = (d.credit === undefined || d.credit === null) ? 0 : d.credit;
            const createdAt = d.createdAt || null;
            const disabled = isDriver ? !!d.disabled : null;
            const did = (d.deviceId || '').trim();
            const brand = d.deviceBrand || '';
            const model = d.deviceModel || '';
            if (brand) brandCount[brand] = (brandCount[brand] || 0) + 1;
            if (!did) {
                unknownAccounts.push({ id: doc.id, role, isDriver, name, phone, credit, createdAt, disabled });
                return;
            }
            if (!devices.has(did)) devices.set(did, { deviceId: did, brand, model, roles: new Set(), accounts: [] });
            const dev = devices.get(did);
            dev.roles.add(role);
            if (brand && !dev.brand) dev.brand = brand;
            if (model && !dev.model) dev.model = model;
            dev.accounts.push({ name, phone, credit, createdAt, isDriver, isOnline: isDriver ? !!d.isOnline : null, disabled });
        };

        sd.forEach(doc => handle(doc, 'سائق', true));
        sc.forEach(doc => handle(doc, 'زبون', false));

        let driverDev = 0, customerDev = 0;
        devices.forEach(dev => {
            if (dev.roles.has('سائق')) driverDev++;
            if (dev.roles.has('زبون')) customerDev++;
        });

        setCount('devTotalCount', devices.size);
        setCount('devDriverCount', driverDev);
        setCount('devCustomerCount', customerDev);
        setCount('devUnknownCount', unknownAccounts.length);

        const brandChart = document.getElementById('devBrandChart');
        if (brandChart) {
            const brands = Object.keys(brandCount);
            if (brands.length === 0) {
                brandChart.innerHTML = '<span class="text-muted small">لا توجد بيانات ماركات بعد — تظهر بعد تسجيل الدخول من التطبيق المحدّث.</span>';
            } else {
                brandChart.innerHTML = brands.map(b =>
                    `<span class="badge bg-dark-blue px-3 py-2" style="font-size:13px;">${b}: <strong>${brandCount[b]}</strong></span>`
                ).join('');
            }
        }

        const rows = [];
        devices.forEach(dev => {
            const roleBadge = Array.from(dev.roles).map(r => r === 'سائق'
                ? '<span class="badge bg-success">سائق</span>'
                : '<span class="badge bg-primary">زبون</span>').join(' ');
            const statuses = dev.accounts.map(a => {
                const badges = [];
                if (a.isDriver) {
                    badges.push(a.isOnline
                        ? '<span class="badge bg-success">متاح</span>'
                        : '<span class="badge bg-secondary">غير متاح</span>');
                    if (a.disabled) badges.push('<span class="badge bg-danger">معطّل</span>');
                }
                return `<div class="mb-1"><strong>${escapeHtmlStr(a.name)}</strong> <span dir="ltr">${escapeHtmlStr(a.phone)}</span> ${badges.join(' ')}</div>` +
                    `<div class="small text-muted">الرصيد: <strong class="text-gold">${a.credit} MRU</strong> · سُجّل: ${fmtDevDate(a.createdAt)}</div>`;
            }).join('<div class="my-1 border-top"></div>');
            rows.push(`<tr>
                <td>${rows.length + 1}</td>
                <td><code dir="ltr">${dev.deviceId}</code></td>
                <td>${roleBadge}</td>
                <td>${statuses}</td>
                <td><span dir="ltr">${dev.accounts.map(a => escapeHtmlStr(a.phone)).join(', ')}</span></td>
                <td>${dev.brand ? `<span class="badge bg-info text-dark">${escapeHtmlStr(dev.brand)}</span>` : '<span class="text-muted">—</span>'}</td>
                <td>${dev.model ? `<span class="badge bg-light text-dark border">${escapeHtmlStr(dev.model)}</span>` : '<span class="text-muted">—</span>'}</td>
                <td>${dev.roles.has('سائق') ? (dev.accounts.find(a => a.isDriver)?.isOnline ? '<span class="badge bg-success">متاح</span>' : '<span class="badge bg-secondary">غير متاح</span>') : '<span class="text-muted">—</span>'}</td>
            </tr>`);
        });

        tbody.innerHTML = rows.length
            ? rows.join('')
            : '<tr><td colspan="8" class="text-center text-muted py-4">لا توجد أجهزة مسجلة بعد</td></tr>';

        renderUnknownDevices(unknownAccounts, canDelDriver, canDelCustomer);
    } catch (err) {
        console.error('Load devices error:', err);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

function renderUnknownDevices(accounts, canDelDriver, canDelCustomer) {
    const tbody = document.getElementById('devUnknownTableBody');
    const countEl = document.getElementById('devUnknownListCount');
    if (countEl) countEl.textContent = accounts.length;
    if (!tbody) return;
    if (accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">لا توجد حسابات بلا معرّف جهاز</td></tr>';
        return;
    }
    tbody.innerHTML = accounts.map((a, i) => {
        const roleBadge = a.isDriver ? '<span class="badge bg-success">سائق</span>' : '<span class="badge bg-primary">زبون</span>';
        const canDel = a.isDriver ? canDelDriver : canDelCustomer;
        const safeName = (a.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const delBtn = canDel
            ? `<button class="btn-action btn-action-delete" onclick="deleteDeviceUnknownAccount('${a.id}','${a.isDriver ? 'drivers' : 'customers'}','${safeName}')" title="حذف نهائي"><i class="bi bi-trash"></i></button>`
            : '<span class="text-muted small">بلا صلاحية</span>';
        return `<tr>
            <td>${i + 1}</td>
            <td>${roleBadge}</td>
            <td><strong>${escapeHtmlStr(a.name)}</strong></td>
            <td><span dir="ltr">${escapeHtmlStr(a.phone)}</span></td>
            <td><strong class="text-gold">${a.credit} MRU</strong></td>
            <td>${fmtDevDate(a.createdAt)}</td>
            <td>${delBtn}</td>
        </tr>`;
    }).join('');
}

window.deleteDeviceUnknownAccount = async function (id, collection, name) {
    if (!requireDb()) return;
    if (collection === 'drivers') {
        if (!guardPerm('drivers_delete', 'ليست لديك صلاحية حذف السائقين')) return;
    } else {
        if (!guardPerm('customers_delete', 'ليست لديك صلاحية حذف الزبائن')) return;
    }
    if (!(await ARAconfirm(`سيتم حذف الحساب "${name || ''}" نهائياً من قاعدة البيانات. هل أنت متأكد؟`))) return;
    try {
        await db.collection(collection).doc(id).delete();
        ARAalert('تم حذف الحساب بنجاح', 'success');
        loadDevices();
    } catch (err) { ARAalert('خطأ: ' + (err.message || ''), 'error'); }
};

window.deleteAllUnknownAccounts = async function () {
    if (!requireDb()) return;
    const canDelDriver = canPerm('drivers_delete');
    const canDelCustomer = canPerm('customers_delete');
    if (!canDelDriver && !canDelCustomer) {
        ARAalert('ليست لديك صلاحية حذف الحسابات', 'warning');
        return;
    }
    try {
        const [sd, sc] = await Promise.all([
            db.collection('drivers').get(),
            db.collection('customers').get()
        ]);
        const targets = [];
        sd.forEach(doc => {
            if (canDelDriver && !(doc.data().deviceId || '').trim()) targets.push(doc.ref);
        });
        sc.forEach(doc => {
            if (canDelCustomer && !(doc.data().deviceId || '').trim()) targets.push(doc.ref);
        });
        if (targets.length === 0) { ARAalert('لا توجد حسابات بلا معرّف جهاز', 'info'); return; }
        if (!(await ARAconfirm(`⚠️ تحذير! سيتم حذف ${targets.length} حساباً بلا معرّف جهاز نهائياً. هل أنت متأكد؟`))) return;
        await Promise.all(targets.map(ref => ref.delete()));
        ARAalert(`تم حذف ${targets.length} حساباً بنجاح`, 'success');
        loadDevices();
    } catch (err) { ARAalert('خطأ: ' + (err.message || ''), 'error'); }
};

// ============================================
// DASHBOARD VOICE CALLS (Agora Web RTC)
// The app can call the dashboard directly from the first screen — the admin
// answers right here in the browser. App ID matches shater_driver_app.
// ============================================
const SHATER_AGORA_APP_ID = '9f539745893d4bbb86741430ab9137db';
const SHATER_AGORA_APP_CERT = '4f051a05587648238e6d208198db110f';
let shaterCallListener = null;
let shaterRtcClient = null;
let shaterLocalMicTrack = null;
let shaterRemoteAudioTrack = null;
let shaterCurrentCall = null; // { id, callerName, callerRole, channelName }
let shaterRingtoneAudio = null;
let shaterRingTimer = null;
let shaterMicMuted = false;

// --- Ringtone: project's own soft notification tone, looped ---
function shaterStartRingtone() {
    shaterStopRingtone();
    try {
        shaterRingtoneAudio = new Audio('js/soundreality_notification_tone.mp3');
        shaterRingtoneAudio.loop = true;
        shaterRingtoneAudio.volume = 0.8;
        const p = shaterRingtoneAudio.play();
        if (p && p.catch) p.catch(e => console.warn('Ringtone play error:', e));
    } catch (e) { console.warn('Ringtone error:', e); }
}
function shaterStopRingtone() {
    if (shaterRingtoneAudio) {
        try { shaterRingtoneAudio.pause(); } catch (e) {}
        try { shaterRingtoneAudio.src = ''; } catch (e) {}
        shaterRingtoneAudio = null;
    }
}

// --- Incoming call modal ---
function shaterShowIncomingCall(callId, data) {
    if (shaterCurrentCall) {
        // Defensive: old app builds created the call doc with an empty
        // channelName first and filled it right after — keep the ring but
        // adopt the channel name once it arrives.
        if (!shaterCurrentCall.channelName && data.channelName) {
            shaterCurrentCall.channelName = data.channelName;
        }
        return;
    }
    if (!data.channelName) return; // wait for the channel name to be written
    // Never ring forever: a ring older than 90s means the caller's app was
    // closed or the request is stale — expire it instead of showing it.
    const createdMs = data.createdAt && data.createdAt.seconds
        ? data.createdAt.seconds * 1000 : Date.now();
    if (Date.now() - createdMs > 90000) {
        try {
            db.collection('calls').doc(callId).update({
                status: 'missed',
                endReason: 'expired',
                endedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {}
        return;
    }
    shaterCurrentCall = {
        id: callId,
        callerName: data.callerName || 'ضيف',
        callerRole: data.callerRole || 'guest',
        channelName: data.channelName,
    };
    document.getElementById('shaterIncomingCallInfo').textContent =
        `${shaterCurrentCall.callerName} — ${shaterCurrentCall.callerRole === 'guest' ? 'زائر' : shaterCurrentCall.callerRole}`;
    const modal = new bootstrap.Modal(document.getElementById('shaterIncomingCallModal'));
    modal.show();
    shaterStartRingtone();
    // Auto-miss if the admin does not answer within the ringing window.
    clearTimeout(shaterRingTimer);
    shaterRingTimer = setTimeout(async () => {
        if (shaterCurrentCall && shaterCurrentCall.id === callId) {
            try {
                await db.collection('calls').doc(callId).update({
                    status: 'missed',
                    endReason: 'admin_no_answer',
                    endedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (e) {}
            shaterStopRingtone();
            shaterHideIncomingCall();
            shaterCurrentCall = null;
        }
    }, 60000);
}

/// Ends every currently ringing call (any caller) as missed with an explicit
/// "admin suspended" reason, so the apps see why the call failed and no
/// request stays stuck.
async function shaterSuspendAllCalls() {
    if (!requireDb() || !db) return;
    try {
        const snap = await db.collection('calls').where('status', '==', 'ringing').get();
        const batch = db.batch();
        snap.forEach(doc => {
            batch.update(doc.ref, {
                status: 'missed',
                endReason: 'admin_suspended',
                endedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        });
        await batch.commit();
        ARAalert(`تم تعليق ${snap.size} مكالمة معلقة`, 'success');
    } catch (e) {
        console.error('Suspend calls error:', e);
    }
    shaterStopRingtone();
    shaterHideIncomingCall();
    shaterHideActiveBar();
    if (shaterRtcClient) {
        try { await shaterRtcClient.leave(); } catch (e) {}
        shaterRtcClient = null;
    }
    shaterCurrentCall = null;
}

function shaterHideIncomingCall() {
    shaterStopRingtone();
    const el = document.getElementById('shaterIncomingCallModal');
    const modal = bootstrap.Modal.getInstance(el);
    if (modal) modal.hide();
}

// --- Agora SDK loading helper ---
// The SDK is bundled locally + mirrored on two CDNs (dashboard.html loads it
// automatically). This helper waits for it and, as a last resort, loads it
// dynamically so answering never fails just because the script was still
// downloading or the primary source was blocked.
function shaterLoadAgora(srcs, i) {
    return new Promise(function (resolve, reject) {
        if (i >= srcs.length) { reject(new Error('agora_not_loaded')); return; }
        if (window.AgoraRTC) { resolve(); return; }
        var s = document.createElement('script');
        s.src = srcs[i];
        s.onload = function () { window.__agoraSdkLoaded = true; resolve(); };
        s.onerror = function () {
            shaterLoadAgora(srcs, i + 1).then(resolve, reject);
        };
        document.head.appendChild(s);
    });
}

function shaterWaitForAgora() {
    return new Promise(function (resolve, reject) {
        if (window.AgoraRTC) { resolve(); return; }
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            if (window.AgoraRTC) {
                clearInterval(iv);
                resolve();
            } else if (tries > 50) { // ~10s
                clearInterval(iv);
                shaterLoadAgora([
                    'js/AgoraRTC_N-4.22.0.js',
                    'https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js',
                    'https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.22.0/AgoraRTC_N-production.js'
                ], 0).then(resolve, reject);
            }
        }, 200);
    });
}

// --- Answer: join the Agora channel and publish the mic ---
async function shaterAnswerCall() {
    const call = shaterCurrentCall;
    if (!call) {
        ARAalert('تعذر بدء المكالمة: لا توجد مكالمة واردة', 'error');
        return;
    }
    if (!call.channelName) {
        ARAalert('المكالمة لم تكتمل بياناتها بعد — أعد المحاولة خلال ثانية', 'warning');
        return;
    }
    try {
        await shaterWaitForAgora();
    } catch (err) {
        console.error('Agora SDK load error:', err);
        ARAalert('تعذر تحميل Agora SDK — تأكد من الاتصال بالإنترنت', 'error');
        shaterCloseCallDoc(call.id, 'ended');
        shaterHideIncomingCall();
        shaterCurrentCall = null;
        return;
    }
    try {
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        // Register handlers BEFORE joining so the caller's audio (published
        // while the phone was still ringing) is never missed.
        const shaterSubscribed = new Set();
        const shaterSubscribeUser = async (user) => {
            if (shaterSubscribed.has(user.uid)) return;
            shaterSubscribed.add(user.uid);
            await client.subscribe(user, 'audio');
            shaterRemoteAudioTrack = user.audioTrack;
            if (user.audioTrack) user.audioTrack.play();
        };
        client.on('user-published', async (user, mediaType) => {
            if (mediaType !== 'audio') return;
            try { await shaterSubscribeUser(user); } catch (e) { console.warn('Subscribe error:', e); }
        });
        client.on('user-unpublished', (user, mediaType) => {
            if (mediaType === 'audio' && user.audioTrack) user.audioTrack.stop();
        });
        client.on('user-left', () => { shaterEndCall(true); });
        // Unique uid PER join attempt: Agora rejects a uid that is already in
        // the channel (UID_CONFLICT) when another tab/session/retry uses the
        // same derived-from-username value. The token must embed the same uid.
        const shaterUid = shaterAdminUid();
        const shaterToken = shaterBuildAgoraToken(call.channelName, shaterUid);
        await client.join(SHATER_AGORA_APP_ID, call.channelName, shaterToken, shaterUid);
        // Users already in the channel (the app joined at ring time) may not
        // fire user-published again — subscribe to them explicitly.
        for (const user of client.remoteUsers) {
            if (user.hasAudio && !shaterSubscribed.has(user.uid)) {
                try { await shaterSubscribeUser(user); } catch (e) { console.warn('Subscribe existing user error:', e); }
            }
        }
        try {
            shaterLocalMicTrack = await AgoraRTC.createMicrophoneAudioTrack();
        } catch (micErr) {
            // Usually the page is opened via file:// where browsers block the
            // microphone. Tell the admin how to fix it and close the call.
            console.error('Mic error:', micErr);
            try { await client.leave(); } catch (e) {}
            shaterCloseCallDoc(call.id, 'ended');
            shaterHideIncomingCall();
            shaterCurrentCall = null;
            ARAalert('المتصفح منع الميكروفون. شغّل اللوحة عبر http://localhost أو رابط https مفعّل، واسمح بالميكروفون ثم أعد المحاولة.', 'error');
            return;
        }
        await client.publish([shaterLocalMicTrack]);
        shaterRtcClient = client;
        // Mark the call as ongoing so the app sees it was answered.
        await db.collection('calls').doc(call.id).update({
            status: 'ongoing',
            startedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        shaterHideIncomingCall();
        shaterShowActiveBar();
    } catch (err) {
        console.error('Answer call error:', err);
        ARAalert('خطأ في الرد على المكالمة: ' + (err.message || ''), 'error');
        shaterCloseCallDoc(call.id, 'ended');
        shaterHideIncomingCall();
        shaterCurrentCall = null;
    }
}

function shaterCloseCallDoc(callId, status) {
    if (!callId || !db) return;
    try {
        db.collection('calls').doc(callId).update({
            status: status,
            endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {}
}

function shaterAdminUid() {
    // Random positive uid generated fresh on each join attempt. The uid is
    // purely local to a single client/join and must not be shared, so two
    // admin tabs, repeated answers or a collision with the app's uid can
    // never produce a UID_CONFLICT on the Agora side.
    return 1 + Math.floor(Math.random() * 2147483646);
}

// --- Agora RTC token builder (006) ---
// The new Agora console enables an App Certificate on every project, so the
// SDK rejects empty tokens ("dynamic use static key"). We generate a real
// token in the browser using the same algorithm as Agora's official
// RtcTokenBuilder (AgoraIO/Tools, AccessToken v006) — pure JS, no deps.
const SHATER_SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function shaterSha256(bytes) {
    const l = bytes.length;
    const bitLen = l * 8;
    const extra = (56 - ((l + 1) % 64) + 64) % 64;
    const total = l + 1 + extra + 8;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(total - 4, bitLen >>> 0, false);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);
    for (let i = 0; i < total; i += 64) {
        for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) {
            const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
            const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
        for (let t = 0; t < 64; t++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + SHATER_SHA256_K[t] + w[t]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, h0, false); odv.setUint32(4, h1, false); odv.setUint32(8, h2, false); odv.setUint32(12, h3, false);
    odv.setUint32(16, h4, false); odv.setUint32(20, h5, false); odv.setUint32(24, h6, false); odv.setUint32(28, h7, false);
    return out;
}

function shaterHmacSha256(keyBytes, msgBytes) {
    let key = keyBytes;
    if (key.length > 64) key = shaterSha256(key);
    const k = new Uint8Array(64);
    k.set(key);
    const inner = new Uint8Array(64 + msgBytes.length);
    inner.set(k);
    for (let i = 0; i < 64; i++) inner[i] ^= 0x36;
    inner.set(msgBytes, 64);
    const innerHash = shaterSha256(inner);
    const outer = new Uint8Array(64 + 32);
    outer.set(k);
    for (let i = 0; i < 64; i++) outer[i] ^= 0x5c;
    outer.set(innerHash, 64);
    return shaterSha256(outer);
}

function shaterCrc32(str) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        let bytes;
        if (code < 0x80) bytes = [code];
        else if (code < 0x800) bytes = [0xc0 | (code >> 6), 0x80 | (code & 0x3f)];
        else bytes = [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
        for (let bi = 0; bi < bytes.length; bi++) {
            crc ^= bytes[bi];
            for (let j = 0; j < 8; j++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function shaterBytesBuilder() {
    const chunks = [];
    let len = 0;
    return {
        putUint16(v) {
            const b = new Uint8Array(2);
            new DataView(b.buffer).setUint16(0, v, true);
            chunks.push(b); len += 2;
        },
        putUint32(v) {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setUint32(0, v >>> 0, true);
            chunks.push(b); len += 4;
        },
        putString(arr) {
            this.putUint16(arr.length);
            chunks.push(arr); len += arr.length;
        },
        build() {
            const out = new Uint8Array(len);
            let p = 0;
            for (const c of chunks) { out.set(c, p); p += c.length; }
            return out;
        }
    };
}

function shaterBuildAgoraToken(channelName, uid) {
    const uidStr = uid === 0 ? '' : String(uid);
    const now = Math.floor(Date.now() / 1000);
    const ts = now + 86400;
    const privilegeTs = now + 86400;
    const salt = (Math.random() * 0xFFFFFFFF) >>> 0;

    const mb = shaterBytesBuilder();
    mb.putUint32(salt);
    mb.putUint32(ts);
    mb.putUint16(4); // join + publish audio/video/data
    mb.putUint16(1); mb.putUint32(privilegeTs);
    mb.putUint16(2); mb.putUint32(privilegeTs);
    mb.putUint16(3); mb.putUint32(privilegeTs);
    mb.putUint16(4); mb.putUint32(privilegeTs);
    const m = mb.build();

    const enc = (s) => new TextEncoder().encode(s);
    const parts = [enc(SHATER_AGORA_APP_ID), enc(channelName), enc(uidStr)];
    const toSign = new Uint8Array(parts[0].length + parts[1].length + parts[2].length + m.length);
    let p = 0;
    for (const part of parts) { toSign.set(part, p); p += part.length; }
    toSign.set(m, p);
    const signature = shaterHmacSha256(enc(SHATER_AGORA_APP_CERT), toSign);

    const cb = shaterBytesBuilder();
    cb.putString(signature);
    cb.putUint32(shaterCrc32(channelName));
    cb.putUint32(shaterCrc32(uidStr));
    cb.putString(m);
    const content = cb.build();

    let bin = '';
    for (let i = 0; i < content.length; i++) bin += String.fromCharCode(content[i]);
    return '006' + SHATER_AGORA_APP_ID + btoa(bin);
}

function shaterShowActiveBar() {
    if (shaterCurrentCall) {
        document.getElementById('shaterActiveCallName').textContent = shaterCurrentCall.callerName;
    }
    document.getElementById('shaterActiveCallState').textContent = 'جارية...';
    const bar = document.getElementById('shaterActiveCallBar');
    bar.classList.remove('d-none');
    bar.classList.add('d-flex');
}

function shaterHideActiveBar() {
    const bar = document.getElementById('shaterActiveCallBar');
    bar.classList.add('d-none');
    bar.classList.remove('d-flex');
}

function shaterToggleMute() {
    if (!shaterLocalMicTrack) return;
    shaterMicMuted = !shaterMicMuted;
    try { shaterLocalMicTrack.setEnabled(!shaterMicMuted); } catch (e) {}
    const btn = document.getElementById('shaterMuteCallBtn');
    btn.innerHTML = shaterMicMuted
        ? '<i class="bi bi-mic-mute-fill"></i>'
        : '<i class="bi bi-mic-fill"></i>';
    btn.classList.toggle('btn-outline-light', !shaterMicMuted);
    btn.classList.toggle('btn-warning', shaterMicMuted);
}

// --- End / decline the call ---
async function shaterEndCall(isPeerLeft) {
    const call = shaterCurrentCall;
    shaterStopRingtone();
    shaterHideIncomingCall();
    shaterHideActiveBar();
    if (shaterRtcClient) {
        try {
            await shaterRtcClient.leave();
        } catch (e) {}
        shaterRtcClient = null;
    }
    if (shaterLocalMicTrack) { try { await shaterLocalMicTrack.close(); } catch (e) {} shaterLocalMicTrack = null; }
    if (shaterRemoteAudioTrack) { try { shaterRemoteAudioTrack.stop(); } catch (e) {} shaterRemoteAudioTrack = null; }
    shaterCurrentCall = null;
    if (call && db) {
        try {
            await db.collection('calls').doc(call.id).update({
                status: isPeerLeft ? 'ended' : 'ended',
                endedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {}
    }
}

async function shaterDeclineCall() {
    const call = shaterCurrentCall;
    shaterStopRingtone();
    shaterHideIncomingCall();
    shaterCurrentCall = null;
    if (call && db) {
        try {
            await db.collection('calls').doc(call.id).update({
                status: 'declined',
                endedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {}
    }
}

// --- Listen for calls aimed at the dashboard ---
function shaterListenForCalls() {
    if (!requireDb() || !db) return;
    if (shaterCallListener) return;
    shaterCallListener = db.collection('calls')
        .where('calleeId', '==', 'dashboard')
        .onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                const data = change.doc.data();
                const status = (data.status || '');
                if (change.type === 'added' || change.type === 'modified') {
                    if (status === 'ringing') {
                        shaterShowIncomingCall(change.doc.id, data);
                    } else if (shaterCurrentCall && change.doc.id === shaterCurrentCall.id &&
                        (status === 'ended' || status === 'missed' || status === 'declined')) {
                        // The app cancelled/hung up while the modal was ringing.
                        shaterStopRingtone();
                        shaterHideIncomingCall();
                        shaterHideActiveBar();
                        if (shaterRtcClient) {
                            try { shaterRtcClient.leave(); } catch (e) {}
                            shaterRtcClient = null;
                        }
                        if (shaterLocalMicTrack) { try { shaterLocalMicTrack.close(); } catch (e) {} shaterLocalMicTrack = null; }
                        shaterCurrentCall = null;
                    }
                } else if (change.type === 'removed' && shaterCurrentCall &&
                    change.doc.id === shaterCurrentCall.id) {
                    shaterStopRingtone();
                    shaterHideIncomingCall();
                    shaterHideActiveBar();
                    shaterCurrentCall = null;
                }
            });
        }, err => console.error('Calls listener error:', err));
}

function shaterBindCallButtons() {
    document.getElementById('shaterAnswerCallBtn')?.addEventListener('click', shaterAnswerCall);
    document.getElementById('shaterDeclineCallBtn')?.addEventListener('click', shaterDeclineCall);
    document.getElementById('shaterEndCallBtn')?.addEventListener('click', () => shaterEndCall(false));
    document.getElementById('shaterMuteCallBtn')?.addEventListener('click', shaterToggleMute);
    document.getElementById('shaterSuspendCallsBtn')?.addEventListener('click', shaterSuspendAllCalls);
    shaterListenForCalls();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', shaterBindCallButtons);
} else {
    shaterBindCallButtons();
}

// ============================================
// BOOKING ON BEHALF OF CUSTOMER (حجز نيابةً عن الزبون)
// ينشئ رحلة بنفس صيغة طلبات التطبيق (rides) مع source: 'admin'، ويدير
// البحث عن السائقين من اللوحة: TTL 90 ثانية، جولات 3→5→8→الكل كم.
// السائق يقبل/يبدأ/يُكمل من تطبيقه كالمعتاد.
// ============================================
const BK_TTL_SECONDS = 90;
let bkPickup = null;
let bkDropoff = null;
let bkPickMode = null;
let bkMarkers = {};
let bkActiveRideId = null;
let bkSearchTicker = null;
let bkRounds = { r2: false, r3: false, r4: false };
let bkPendingStartedAt = null;
let bkMapBound = false;

window.toggleBookingPanel = function () {
    const panel = document.getElementById('bookingPanel');
    const txt = document.getElementById('bookingToggleText');
    if (!panel) return;
    const hidden = panel.classList.toggle('d-none');
    if (txt) txt.textContent = hidden ? 'عرض النموذج' : 'إخفاء النموذج';
    if (!hidden) {
        if (!bkMapBound && map) { map.on('click', onBookingMapClick); bkMapBound = true; }
        const f = document.getElementById('bkName');
        if (f) setTimeout(() => f.focus(), 250);
        bkAutoPickup();
    }
};

async function bkAutoPickup() {
    if (!navigator.geolocation || bkPickup) return;
    try {
        const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
        bkPickup = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        bkDrawMarker('pickup', bkPickup);
        bkFillAddress('pickup', bkPickup);
        updateBookingFare();
    } catch (e) {}
}

window.setBookingPickMode = function (mode) {
    if (!map) return;
    if (!bkMapBound) { map.on('click', onBookingMapClick); bkMapBound = true; }
    bkPickMode = mode;
    showStatus('bkStatus',
        mode === 'pickup' ? 'انقر على الخريطة لتحديد نقطة الانطلاق' : 'انقر على الخريطة لتحديد الوجهة', 'success');
};

function onBookingMapClick(ev) {
    if (!bkPickMode || !ev.latlng) return;
    const pt = { lat: ev.latlng.lat, lng: ev.latlng.lng };
    if (bkPickMode === 'pickup') {
        bkPickup = pt;
        bkDrawMarker('pickup', pt);
        bkFillAddress('pickup', pt);
    } else {
        bkDropoff = pt;
        bkDrawMarker('dropoff', pt);
        bkFillAddress('dropoff', pt);
    }
    bkPickMode = null;
    updateBookingFare();
}

function bkDrawMarker(which, pt) {
    const color = which === 'pickup' ? '#2E7D32' : '#C62828';
    if (bkMarkers[which]) { bkMarkers[which].setLatLng([pt.lat, pt.lng]); return; }
    const icon = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.4);"></div>`
    });
    bkMarkers[which] = L.marker([pt.lat, pt.lng], { icon }).addTo(map);
}

async function bkFillAddress(which, pt) {
    const input = document.getElementById(which === 'pickup' ? 'bkPickupAddr' : 'bkDropoffAddr');
    if (!input) return;
    input.value = 'جاري تحديد العنوان...';
    const addr = await reverseGeocode(pt.lat, pt.lng);
    input.value = addr || `موقع على الخريطة (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)})`;
}

async function reverseGeocode(lat, lng) {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ar`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const data = await res.json();
        return (data && data.display_name) ? data.display_name : null;
    } catch (e) { return null; }
}

async function fetchRoadKm(a, b) {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&alternatives=false&steps=false`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.code !== 'Ok' || !data.routes || !data.routes.length) return null;
        const m = data.routes[0].distance;
        return (m && m > 0) ? m / 1000 : null;
    } catch (e) { return null; }
}

async function bkComputeDistance() {
    if (!bkPickup || !bkDropoff) return null;
    const road = await fetchRoadKm(bkPickup, bkDropoff);
    return road || haversine(bkPickup.lat, bkPickup.lng, bkDropoff.lat, bkDropoff.lng);
}

function bkPriceFor(vehicle, km) {
    if (vehicle === 'delivery') {
        const d = pricingCfg.delivery || {};
        const prices = d.prices || [300];
        const base = (km && km > 0)
            ? bandPrice(km, d.maxKm || [30], prices, d.perExtraKm || 20)
            : prices[0];
        const capped = Math.min(base, d.max || 9999);
        return isNightTime() ? Math.round(capped * (pricingCfg.night.deliveryMultiplier || 1.3)) : capped;
    }
    return calculateFare(km);
}

window.updateBookingFare = async function () {
    const type = document.querySelector('input[name="bkType"]:checked')?.value || 'fixed';
    const isOpen = type === 'open';
    const vehicleEl = document.getElementById('bkVehicle');
    const dropRow = document.getElementById('bkDropRow');
    const fareEl = document.getElementById('bkFare');
    const distEl = document.getElementById('bkDistance');
    if (vehicleEl) vehicleEl.disabled = isOpen;
    if (isOpen) {
        if (vehicleEl) vehicleEl.value = 'car';
        if (dropRow) dropRow.classList.add('d-none');
        const open = pricingCfg.open || { start: 75, perHour: 400 };
        if (fareEl) fareEl.textContent = `${open.start} + ${open.perHour} MRU/ساعة`;
        if (distEl) distEl.textContent = '—';
        return;
    }
    if (dropRow) dropRow.classList.remove('d-none');
    if (!vehicleEl) return;
    const km = await bkComputeDistance();
    const fare = bkPriceFor(vehicleEl.value, km);
    if (distEl) distEl.textContent = km ? `${km.toFixed(2)} كم` : '—';
    if (fareEl) fareEl.textContent = (fare != null) ? `${fare} MRU` : '—';
};

window.resetBookingForm = function () {
    ['bkName', 'bkPhone', 'bkPickupAddr', 'bkDropoffAddr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    bkPickup = null;
    bkDropoff = null;
    Object.keys(bkMarkers).forEach(k => { if (bkMarkers[k]) map.removeLayer(bkMarkers[k]); });
    bkMarkers = {};
    const fixed = document.getElementById('bkTypeFixed');
    if (fixed) { fixed.checked = true; }
    const veh = document.getElementById('bkVehicle');
    if (veh) { veh.disabled = false; veh.value = 'car'; }
    const fare = document.getElementById('bkFare');
    if (fare) fare.textContent = '—';
    const dist = document.getElementById('bkDistance');
    if (dist) dist.textContent = '—';
    const st = document.getElementById('bkSearchStatus');
    if (st) st.classList.add('d-none');
    showStatus('bkStatus', '', '');
};

// فلترة السائقين المطابقين — نفس شروط تطبيق السائق (isOnline، غير محظور،
// موافق عليه، اشتراك نشط، غير مشغول برحلة، نوع المركبة).
async function adminFindMatchingDrivers(lat, lng, type, radiusKm, limit) {
    try {
        const snap = await db.collection('drivers').where('isOnline', '==', true).get();
        const results = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d.disabled === true) return;
            if (d.registrationApproved !== true) return;
            const sub = d.subscription;
            if (!sub || typeof sub !== 'object' || sub.active !== true) return;
            const current = d.currentRideId;
            if (typeof current === 'string' && current) return;
            const vehicle = d.vehicleType || 'car';
            const role = d.role || 'driver';
            const isDelivery = vehicle === 'bike' || role === 'delivery';
            if (type === 'car' && isDelivery) return;
            if (type === 'delivery' && !isDelivery) return;
            if (d.lat == null || d.lng == null) return;
            const dist = haversine(lat, lng, d.lat, d.lng);
            if (dist > radiusKm) return;
            results.push({ id: doc.id, name: d.name || '', phone: d.phone || '', lat: d.lat, lng: d.lng, distanceKm: dist, vehicleType: vehicle });
        });
        results.sort((a, b) => a.distanceKm - b.distanceKm);
        return results.slice(0, limit);
    } catch (e) { return []; }
}

// كتابة إشعار الرحلة لكل سائق (notifications) بنفس صيغة تطبيق الزبون —
// sound: 'ride' لفتح نافذة القبول في تطبيق السائق.
async function bkNotifyDrivers(driverIds, rideId, o) {
    if (!driverIds.length) return;
    const batch = db.batch();
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    const title = o.type === 'car' ? 'طلب رحلة جديدة' : 'طلب توصيل جديد';
    const body = o.isOpen
        ? `جولة مفتوحة — بدء ${Math.round(o.openStart)} + ${Math.round(o.openPerHour)} MRU/ساعة`
        : `الوجهة: ${o.dropoffAddress} — الثمن: ${Math.round(o.fare)} MRU`;
    driverIds.forEach(id => {
        const ref = db.collection('notifications').doc();
        batch.set(ref, {
            userId: id,
            title,
            body,
            sound: 'ride',
            read: false,
            data: {
                rideId,
                type: o.type,
                fare: o.fare,
                open: o.isOpen,
                openStart: o.openStart,
                openPerHour: o.openPerHour,
                distanceKm: o.km,
                pickupLat: o.pickup.lat,
                pickupLng: o.pickup.lng,
                pickup: o.pickupAddress,
                dropoffLat: o.dropoff.lat,
                dropoffLng: o.dropoff.lng,
                dropoff: o.dropoffAddress,
                notes: 'حجز من لوحة التحكم (نيابةً عن الزبون)'
            },
            createdAt: ts
        });
    });
    await batch.commit();
}

window.submitBookingRide = async function () {
    if (!requireDb('bkStatus')) return;
    const name = document.getElementById('bkName').value.trim();
    const phone = document.getElementById('bkPhone').value.trim();
    const type = document.querySelector('input[name="bkType"]:checked')?.value || 'fixed';
    const isOpen = type === 'open';
    const vehicle = document.getElementById('bkVehicle').value;
    if (!name || !phone) { showStatus('bkStatus', 'أدخل اسم الزبون وهاتفه', 'error'); return; }
    if (!bkPickup) { showStatus('bkStatus', 'حدد نقطة الانطلاق على الخريطة', 'error'); return; }
    if (!isOpen && !bkDropoff) { showStatus('bkStatus', 'حدد الوجهة على الخريطة', 'error'); return; }

    const btn = document.getElementById('bkSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>جاري إنشاء الطلب...';

    const km = isOpen ? 0 : ((await bkComputeDistance()) || 0);
    const open = pricingCfg.open || { start: 75, perHour: 400 };
    const fare = isOpen ? open.start : bkPriceFor(vehicle, km);
    const pickupAddress = document.getElementById('bkPickupAddr').value ||
        `موقع على الخريطة (${bkPickup.lat.toFixed(5)}, ${bkPickup.lng.toFixed(5)})`;
    const dropoffAddress = isOpen ? ''
        : (document.getElementById('bkDropoffAddr').value ||
            `موقع على الخريطة (${bkDropoff.lat.toFixed(5)}, ${bkDropoff.lng.toFixed(5)})`);

    try {
        const rideRef = await db.collection('rides').add({
            type: vehicle,
            rideKind: isOpen ? 'open' : 'fixed',
            status: 'pending',
            source: 'admin',
            passengerName: name,
            passengerPhone: phone,
            pickupLat: bkPickup.lat,
            pickupLng: bkPickup.lng,
            pickupAddress,
            dropoffLat: isOpen ? bkPickup.lat : bkDropoff.lat,
            dropoffLng: isOpen ? bkPickup.lng : bkDropoff.lng,
            dropoffAddress,
            distanceKm: km,
            fare,
            ...(isOpen ? { openStart: open.start, openPerHour: open.perHour } : {}),
            notes: 'حجز من لوحة التحكم (نيابةً عن الزبون)',
            night: isNightTime(),
            searchRound: 1,
            reassignments: 0,
            notifiedDrivers: [],
            rejectedDrivers: [],
            expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + BK_TTL_SECONDS * 1000),
            requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        markSelfTouched(rideRef.id);

        const drivers = await adminFindMatchingDrivers(bkPickup.lat, bkPickup.lng, vehicle, 3, 5);
        if (drivers.length === 0) {
            await rideRef.update({
                status: 'expired',
                cancelReason: 'no_drivers',
                expiredAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            addNotifLog('dispatch', `حجز ${name}: لا سائقين ضمن 3 كم — انتهى`);
            showStatus('bkStatus', 'لا يوجد سائقون متاحون قريباً — أُلغي الطلب تلقائياً', 'error');
            resetBookingForm();
            return;
        }

        const ids = drivers.map(d => d.id);
        await bkNotifyDrivers(ids, rideRef.id, {
            type: vehicle,
            isOpen,
            fare,
            openStart: open.start,
            openPerHour: open.perHour,
            km,
            pickup: bkPickup,
            dropoff: isOpen ? bkPickup : bkDropoff,
            pickupAddress,
            dropoffAddress
        });
        await rideRef.update({ notifiedDrivers: ids });

        bkActiveRideId = rideRef.id;
        bkRounds = { r2: false, r3: false, r4: false };
        bkPendingStartedAt = Date.now();
        bkStartSearchTicker(rideRef.id);

        addNotifLog('dispatch',
            `حجز ${name} (${phone}): ${pickupAddress} ← ${isOpen ? 'جولة مفتوحة' : dropoffAddress}` +
            ` | ${isOpen ? open.start + ' + ' + open.perHour + '/ساعة' : fare + ' MRU'} | ${ids.length} سائق`);
        resetBookingForm();
        showStatus('bkStatus', `تم إشعار ${ids.length} سائق. البحث جارٍ...`, 'success');
    } catch (err) {
        showStatus('bkStatus', 'خطأ: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send-fill me-1"></i>إنشاء الطلب';
    }
};

function bkStartSearchTicker(rideId) {
    bkStopSearchTicker();
    bkSearchTicker = setInterval(() => bkSearchTick(rideId), 1000);
}

function bkStopSearchTicker() {
    if (bkSearchTicker) { clearInterval(bkSearchTicker); bkSearchTicker = null; }
    const st = document.getElementById('bkSearchStatus');
    if (st) st.classList.add('d-none');
}

window.cancelBookingSearch = async function () {
    const rideId = bkActiveRideId;
    bkStopSearchTicker();
    bkActiveRideId = null;
    if (!rideId) return;
    try {
        const snap = await db.collection('rides').doc(rideId).get();
        if (snap.exists && snap.data().status === 'pending') {
            await db.collection('rides').doc(rideId).update({
                status: 'cancelled',
                cancelReason: 'admin_cancelled',
                canceledAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (e) {}
    showStatus('bkStatus', 'أُلغي البحث عن سائق', 'success');
};

async function bkSearchTick(rideId) {
    try {
        const snap = await db.collection('rides').doc(rideId).get();
        if (!snap.exists) { bkStopSearchTicker(); bkActiveRideId = null; return; }
        const data = snap.data();
        const status = data.status || '';
        if (status !== 'pending') {
            bkStopSearchTicker();
            bkActiveRideId = null;
            if (status === 'accepted' || status === 'arrived' || status === 'in_progress') {
                showStatus('bkStatus', 'قبل السائق الطلب! الرحلة قيد التنفيذ.', 'success');
            }
            return;
        }
        const expiresAt = data.expiresAt;
        if (expiresAt && expiresAt.toMillis() <= Date.now()) {
            bkStopSearchTicker();
            bkActiveRideId = null;
            await db.collection('rides').doc(rideId).update({
                status: 'expired',
                cancelReason: 'timeout',
                expiredAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showStatus('bkStatus', 'انتهت مهلة البحث (90 ث) — لم يتوفر سائق. أُنهي الطلب.', 'error');
            return;
        }
        const elapsed = (Date.now() - (bkPendingStartedAt || Date.now())) / 1000;
        if (!bkRounds.r2 && elapsed >= 20) { bkRounds.r2 = true; adminSearchRound(rideId, 5, 5); }
        if (!bkRounds.r3 && elapsed >= 40) { bkRounds.r3 = true; adminSearchRound(rideId, 8, 5); }
        if (!bkRounds.r4 && elapsed >= 60) { bkRounds.r4 = true; adminSearchRound(rideId, 500, 10); }
        const count = (data.notifiedDrivers || []).length;
        const left = Math.max(0, Math.ceil((expiresAt.toMillis() - Date.now()) / 1000));
        bkShowSearchStatus(`⏳ جاري البحث عن سائق... ${count} سائق أُشعروا | متبقّي ${left} ث`);
    } catch (e) {}
}

// جولة بحث إضافية من اللوحة — توسيع النطاق وإشعار سائقين جدد لم يُطلب منهم
// من قبل (ولا رفضوا). يعيد عدد المُشعَرين.
async function adminSearchRound(rideId, radiusKm, limit) {
    try {
        const snap = await db.collection('rides').doc(rideId).get();
        if (!snap.exists) return 0;
        const data = snap.data();
        if (data.status !== 'pending') return 0;
        if (data.expiresAt && data.expiresAt.toMillis() <= Date.now()) return 0;
        const seen = new Set((data.notifiedDrivers || []).concat(data.rejectedDrivers || []));
        const type = data.type;
        const drivers = await adminFindMatchingDrivers(data.pickupLat, data.pickupLng, type, radiusKm, limit);
        const fresh = drivers.filter(d => !seen.has(d.id));
        if (!fresh.length) return 0;
        const ids = fresh.map(d => d.id);
        const isOpen = data.rideKind === 'open';
        const openStart = data.openStart || 75;
        const openPerHour = data.openPerHour || 400;
        await bkNotifyDrivers(ids, rideId, {
            type,
            isOpen,
            fare: data.fare,
            openStart,
            openPerHour,
            km: data.distanceKm,
            pickup: { lat: data.pickupLat, lng: data.pickupLng },
            dropoff: { lat: data.dropoffLat, lng: data.dropoffLng },
            pickupAddress: data.pickupAddress || '',
            dropoffAddress: data.dropoffAddress || ''
        });
        await db.collection('rides').doc(rideId).update({
            notifiedDrivers: firebase.firestore.FieldValue.arrayUnion(ids),
            searchRound: firebase.firestore.FieldValue.increment(1)
        });
        return ids.length;
    } catch (e) { return 0; }
}

function bkShowSearchStatus(text) {
    const st = document.getElementById('bkSearchStatus');
    const t = document.getElementById('bkSearchText');
    if (!st || !t) return;
    st.classList.remove('d-none');
    t.textContent = text;
}
