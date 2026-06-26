import admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

const db = admin.firestore();

async function checkUserRole() {
    const email = 'hello@aiph.tech';
    const users = await admin.auth().listUsers();
    const user = users.users.find(u => u.email === email);
    
    if (user) {
        const userDoc = await db.collection("users").doc(user.uid).get();
        if (userDoc.exists) {
            console.log(`User ${email} (UID: ${user.uid}) has role:`, userDoc.data()?.role);
        } else {
            console.log(`User ${email} (UID: ${user.uid}) has no document in 'users' collection.`);
        }
    } else {
        console.log(`User ${email} not found.`);
    }
}

checkUserRole().catch(console.error);
