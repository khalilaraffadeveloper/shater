const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const EMULATOR_MODE = process.env.EMULATOR_MODE === 'true';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Admin SDK
const admin = require('firebase-admin');

if (EMULATOR_MODE) {
    // Connect to Firestore emulator on localhost:8080
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    process.env.FIREBASE_MESSAGING_EMULATOR_HOST = 'localhost:9199';

    try {
        admin.initializeApp({ projectId: 'demo-shater' });
        console.log('🔥 EMULATOR MODE: Connecting to local Firestore at localhost:8080');
    } catch (err) {
        console.warn('Emulator init failed:', err.message);
    }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    try {
        const serviceAccount = require('../docs_and_configs/firebase/serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase initialized with service account file');
    } catch (err) {
        console.warn('No Firebase service account found. Dispatch will not work.');
        console.warn('Place serviceAccountKey.json in docs_and_configs/firebase/');
    }
}

const db = admin.firestore();

// API: Dispatch ride to nearby drivers
app.post('/api/dispatch-ride', async (req, res) => {
    try {
        const {
            rideId, passengerName, passengerPhone,
            pickupLat, pickupLng, pickupAddress,
            dropoffLat, dropoffLng, dropoffAddress,
            searchRadiusKm, driverIds
        } = req.body;

        if (!rideId || !pickupLat || !pickupLng || !driverIds || driverIds.length === 0) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Fare: 200 MRU base + 150 MRU per km
        const fare = 200 + (searchRadiusKm * 150);

        // Get FCM tokens for nearby drivers
        const tokenPromises = driverIds.map(id =>
            db.collection('drivers').doc(id).get()
        );
        const driverDocs = await Promise.all(tokenPromises);

        // Only notify drivers with credit > 0
        const eligibleDrivers = driverDocs.filter(doc => {
            if (!doc.exists) return false;
            const data = doc.data();
            const credit = data.credit || 0;
            return credit > 0 && data.fcmToken;
        });

        const tokens = eligibleDrivers.map(doc => doc.data().fcmToken);
        const eligibleIds = eligibleDrivers.map(doc => doc.id);

        if (tokens.length === 0) {
            return res.status(404).json({ error: 'No eligible drivers nearby (credit > 0)' });
        }

        const message = {
            data: {
                type: 'ride_request',
                rideId: rideId,
                passengerName: passengerName,
                passengerPhone: passengerPhone || '',
                pickupLat: pickupLat.toString(),
                pickupLng: pickupLng.toString(),
                pickupAddress: pickupAddress || '',
                dropoffAddress: dropoffAddress || '',
                distanceKm: searchRadiusKm.toFixed(1),
                fare: fare.toFixed(0),
                estimatedFare: fare.toFixed(0)
            },
            android: {
                priority: 'high',
                ttl: '30s'
            },
            tokens: tokens
        };

        const response = await admin.messaging().sendEachForMulticast(message);

        await db.collection('rides').doc(rideId).update({
            notifiedDrivers: eligibleIds,
            notificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
            fare: fare
        });

        console.log(`Dispatch: ${response.successCount} notified, ${response.failureCount} failed`);

        res.json({
            success: true,
            notifiedCount: response.successCount,
            failedCount: response.failureCount,
            fare: fare
        });
    } catch (error) {
        console.error('Dispatch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Send FCM push notification to arbitrary tokens (rides, deliveries, calls)
app.post('/api/send-fcm', async (req, res) => {
    try {
        const { tokens, title, body, data } = req.body;

        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            return res.status(400).json({ error: 'tokens array required' });
        }

        const cleanData = {};
        Object.entries(data || {}).forEach(([k, v]) => {
            if (v !== undefined && v !== null) cleanData[k] = String(v);
        });

        const isRideRequest = cleanData.type === 'ride_request';
        const useApprovalSound = cleanData.sound === 'approval';
        const message = {
            ...(isRideRequest
                ? { data: cleanData }
                : {
                    notification: { title: title || 'شاطر', body: body || 'إشعار جديد' },
                    data: cleanData,
                    android: useApprovalSound ? {
                        priority: 'HIGH',
                        notification: {
                            channelId: 'shater_notifications',
                            sound: 'shatter_approval',
                            priority: 'HIGH'
                        }
                    } : undefined
                }),
            tokens
        };

        if (isRideRequest) {
            // رسالة data فقط عالية الأولوية حتى يُستدعى onMessageReceived
            // ويشتغل الرنين المخصص ومفتاح «التنبيه عند الإغلاق» حتى مع إغلاق التطبيق.
            message.android = {
                priority: 'high',
                ttl: '30s'
            };
        }

        const response = await admin.messaging().sendEachForMulticast(message);

        console.log(`FCM: ${response.successCount} notified, ${response.failureCount} failed`);
        res.json({
            success: true,
            successCount: response.successCount,
            failureCount: response.failureCount
        });
    } catch (error) {
        console.error('FCM send error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Accept ride with Firestore Transaction (race condition protection)
app.post('/api/accept-ride', async (req, res) => {
    try {
        const { rideId, driverId } = req.body;

        if (!rideId || !driverId) {
            return res.status(400).json({ error: 'Missing rideId or driverId' });
        }

        // Check driver credit first
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            return res.status(404).json({ error: 'Driver not found' });
        }

        const driverData = driverDoc.data();
        if ((driverData.credit || 0) <= 0) {
            return res.status(403).json({
                error: 'رصيدك غير كافٍ لاستلام الطلبات، يرجى مراجعة الإدارة لشحن الرصيد'
            });
        }

        // Firestore transaction to prevent race condition
        const result = await db.runTransaction(async (transaction) => {
            const rideRef = db.collection('rides').doc(rideId);
            const rideDoc = await transaction.get(rideRef);

            if (!rideDoc.exists) {
                throw new Error('RIDE_NOT_FOUND');
            }

            const rideData = rideDoc.data();
            if (rideData.status !== 'pending') {
                throw new Error('RIDE_ALREADY_ACCEPTED');
            }

            // Atomic: accept ride + assign driver + deduct credit
            transaction.update(rideRef, {
                status: 'accepted',
                assignedDriverId: driverId,
                acceptedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            transaction.update(db.collection('drivers').doc(driverId), {
                currentRideId: rideId,
                credit: admin.firestore.FieldValue.increment(-1)
            });

            return {
                passengerPhone: rideData.passengerPhone || '',
                passengerName: rideData.passengerName || '',
                pickupAddress: rideData.pickupAddress || '',
                dropoffAddress: rideData.dropoffAddress || '',
                fare: rideData.fare || 0
            };
        });

        res.json({
            success: true,
            rideId,
            driverId,
            status: 'accepted',
            ...result
        });
    } catch (error) {
        if (error.message === 'RIDE_ALREADY_ACCEPTED') {
            return res.status(409).json({
                error: 'عذراً، تم قبول هذه الرحلة من قبل سائق آخر'
            });
        }
        if (error.message === 'RIDE_NOT_FOUND') {
            return res.status(404).json({ error: 'الرحلة لم تعد متاحة' });
        }
        console.error('Accept ride error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Get nearby drivers
app.get('/api/nearby-drivers', async (req, res) => {
    try {
        const { lat, lng, radiusKm = 5 } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ error: 'Missing lat or lng' });
        }

        const snapshot = await db.collection('drivers')
            .where('isOnline', '==', true)
            .get();

        const drivers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.lat && data.lng) {
                const distance = haversineDistance(
                    parseFloat(lat), parseFloat(lng),
                    data.lat, data.lng
                );
                if (distance <= parseFloat(radiusKm)) {
                    drivers.push({
                        id: doc.id,
                        distance: distance.toFixed(2),
                        name: data.name,
                        vehicleType: data.vehicleType,
                        credit: data.credit || 0
                    });
                }
            }
        });

        drivers.sort((a, b) => a.distance - b.distance);
        res.json({ drivers });
    } catch (error) {
        console.error('Nearby drivers error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Update driver credit (admin only)
app.post('/api/update-credit', async (req, res) => {
    try {
        const { driverId, amount } = req.body;

        if (!driverId || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'Missing driverId or invalid amount' });
        }

        await db.collection('drivers').doc(driverId).update({
            credit: admin.firestore.FieldValue.increment(amount)
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Update credit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Register new driver
app.post('/api/register-driver', async (req, res) => {
    try {
        const { name, phone, password, vehicleType, credit } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({ error: 'Name, phone and password are required' });
        }

        const existing = await db.collection('drivers').where('phone', '==', phone).get();
        if (!existing.empty) {
            const owner = existing.docs[0].data().name || 'another driver';
            return res.status(409).json({ error: 'Phone number ' + phone + ' is already registered to: ' + owner });
        }

        const docRef = await db.collection('drivers').add({
            name,
            phone,
            password,
            vehicleType: vehicleType || 'car',
            credit: credit || 0,
            lat: 18.0735,
            lng: -15.9582,
            geohash: '',
            isOnline: false,
            disabled: false,
            currentRideId: null,
            rating: 5.0,
            totalRides: 0,
            fcmToken: '',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, driverId: docRef.id });
    } catch (error) {
        console.error('Register driver error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Update driver info
app.put('/api/update-driver/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, disabled } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (disabled !== undefined) updates.disabled = disabled;

        if (phone !== undefined) {
            const existing = await db.collection('drivers').where('phone', '==', phone).get();
            const dupDoc = existing.docs.find(d => d.id !== id);
            if (dupDoc) {
                const owner = dupDoc.data().name || 'another driver';
                return res.status(409).json({ error: 'Phone number ' + phone + ' is already registered to: ' + owner });
            }
        }

        await db.collection('drivers').doc(id).update(updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Update driver error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Delete driver
app.delete('/api/delete-driver/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('drivers').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Delete driver error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Get all customers
app.get('/api/customers', async (req, res) => {
    try {
        const snapshot = await db.collection('customers').get();
        const customers = [];
        snapshot.forEach(doc => {
            customers.push({ id: doc.id, ...doc.data() });
        });
        res.json({ customers });
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Register new customer
app.post('/api/register-customer', async (req, res) => {
    try {
        const { name, phone, whatsapp, password, credit } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({ error: 'Name, phone and password are required' });
        }

        const docRef = await db.collection('customers').add({
            name,
            phone,
            whatsapp: whatsapp || '',
            password,
            credit: credit || 0,
            lat: 18.0735,
            lng: -15.9582,
            geohash: '',
            isOnline: false,
            totalRides: 0,
            fcmToken: '',
            deviceId: '',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, customerId: docRef.id });
    } catch (error) {
        console.error('Register customer error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Update customer info
app.put('/api/update-customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, whatsapp, disabled } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (whatsapp !== undefined) updates.whatsapp = whatsapp;
        if (disabled !== undefined) updates.disabled = disabled;

        await db.collection('customers').doc(id).update(updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Delete customer
app.delete('/api/delete-customer/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('customers').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Update customer credit (add)
app.post('/api/update-customer-credit', async (req, res) => {
    try {
        const { customerId, amount } = req.body;

        if (!customerId || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'Missing customerId or invalid amount' });
        }

        await db.collection('customers').doc(customerId).update({
            credit: admin.firestore.FieldValue.increment(amount)
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Update customer credit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Set customer credit (overwrite)
app.post('/api/set-customer-credit', async (req, res) => {
    try {
        const { customerId, amount } = req.body;

        if (!customerId || typeof amount !== 'number' || amount < 0) {
            return res.status(400).json({ error: 'Missing customerId or invalid amount' });
        }

        await db.collection('customers').doc(customerId).update({
            credit: amount
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Set customer credit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API: Get all drivers
app.get('/api/drivers', async (req, res) => {
    try {
        const snapshot = await db.collection('drivers').get();
        const drivers = [];
        snapshot.forEach(doc => {
            drivers.push({ id: doc.id, ...doc.data() });
        });
        res.json({ drivers });
    } catch (error) {
        console.error('Get drivers error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

app.listen(PORT, () => {
    console.log(`Shater Dashboard running on http://localhost:${PORT}`);
});
