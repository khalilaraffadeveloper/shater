const firebaseConfig = {
    apiKey: "AIzaSyDsO_-6QFQKgIMF7VROzZYK22kyKyjQ_ZM",
    authDomain: "shater-cars.firebaseapp.com",
    projectId: "shater-cars",
    storageBucket: "shater-cars.firebasestorage.app",
    messagingSenderId: "891304990952",
    appId: "1:891304990952:web:6b356e9da561b57fc7915d"
};

let db = null;
let auth = null;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
} catch (e) {
    console.error("Firebase init failed:", e);
}

firebase.auth().onAuthStateChanged(function(user) {
    if (user && sessionStorage.getItem('ARAVA_admin_logged_in') === 'true') {
        window.location.href = 'dashboard.html';
    }
});

const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

document.getElementById('loginPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
});
document.getElementById('loginUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginPass').focus();
});
loginBtn.addEventListener('click', doLogin);

async function doLogin() {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();

    if (!user || !pass) {
        loginError.textContent = 'يرجى إدخال اسم المستخدم وكلمة المرور';
        return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>جاري التحقق...';
    loginError.textContent = '';

    let matched = null;
    let role = 'supervisor';

    // 1. Try Firebase Authentication (Email/Password)
    if (auth) {
        try {
            const email = user.includes('@') ? user : `${user}@shater.app`;
            await auth.signInWithEmailAndPassword(email, pass);
            const firebaseUser = auth.currentUser;
            if (firebaseUser) {
                // Check Firestore for admin role
                try {
                    const adminDoc = await db.collection('admins').where('authUid', '==', firebaseUser.uid).limit(1).get();
                    if (!adminDoc.empty) {
                        const data = adminDoc.docs[0].data();
                        matched = { name: data.name || user, isFirebase: true, role: data.role || 'supervisor', permissions: data.permissions || [] };
                    } else {
                        // Check by username
                        const byUser = await db.collection('admins').where('username', '==', user).limit(1).get();
                        if (!byUser.empty) {
                            const data = byUser.docs[0].data();
                            matched = { name: data.name || user, isFirebase: true, role: data.role || 'supervisor', permissions: data.permissions || [] };
                        } else {
                            matched = { name: user, isFirebase: true, role: 'supervisor', permissions: [] };
                        }
                    }
                } catch (e) {
                    matched = { name: user, isFirebase: true, role: 'supervisor', permissions: [] };
                }
            }
            // مزامنة: إذا عُدّلت كلمة المرور من اللوحة (حقل Firestore)، تُرفض كلمة مرور حساب المصادقة القديمة
            // (اللوحة تسمح للمالك بتغيير كلمة مرور أي مشرف عبر تحديث حقل password في Firestore)
            if (firebaseUser && matched) {
                try {
                    const syncQ = await db.collection('admins').where('authUid', '==', firebaseUser.uid).limit(1).get();
                    if (!syncQ.empty) {
                        const storedPass = syncQ.docs[0].data().password;
                        if (storedPass && storedPass !== pass) matched = null;
                    }
                } catch (e) {}
            }
        } catch (authErr) {
            console.log('Firebase Auth failed:', authErr.code);
        }
    }

    // 2. Fallback: Firestore 'admins' collection (legacy)
    if (!matched && db) {
        try {
            const snapshot = await db.collection('admins')
                .where('username', '==', user)
                .where('password', '==', pass)
                .limit(1)
                .get();
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const data = doc.data();
                matched = { username: user, name: data.name || user, role: data.role || 'supervisor', permissions: data.permissions || [] };
                // Migrate to Firebase Auth
                if (auth) {
                    try {
                        const email = `${user}@shater.app`;
                        await auth.createUserWithEmailAndPassword(email, pass);
                        const firebaseUser = auth.currentUser;
                        if (firebaseUser) {
                            await doc.ref.update({ authUid: firebaseUser.uid });
                        }
                    } catch (e) {
                        if (e.code === 'auth/email-already-in-use') {
                            try {
                                await auth.signInWithEmailAndPassword(email, pass);
                                const firebaseUser = auth.currentUser;
                                if (firebaseUser) {
                                    await doc.ref.update({ authUid: firebaseUser.uid });
                                }
                            } catch (e2) {}
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('Firestore admin check failed:', err.message);
        }
    }

    if (matched) {
        sessionStorage.setItem('ARAVA_admin_logged_in', 'true');
        sessionStorage.setItem('ARAVA_admin_name', matched.name || matched.username || user);
        sessionStorage.setItem('ARAVA_admin_role', matched.role || 'supervisor');
        sessionStorage.setItem('ARAVA_admin_perms', JSON.stringify(matched.permissions || []));
        sessionStorage.setItem('ARAVA_admin_username', matched.username || matched.name || user);
        window.location.href = 'dashboard.html';
    } else {
        if (auth) {
            try { await auth.signOut(); } catch (e) {}
        }
        loginError.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة';
        document.getElementById('loginPass').value = '';
        document.getElementById('loginPass').focus();
    }

    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-left me-2"></i>تسجيل الدخول';
}
