import admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

const db = admin.firestore();

async function checkUsers() {
    const usersSnapshot = await db.collection("users").get();
    usersSnapshot.forEach(doc => {
        console.log(`User ID: ${doc.id}, Data:`, doc.data());
    });
}

checkUsers().catch(console.error);
