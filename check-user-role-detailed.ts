import admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

const db = admin.firestore();

async function checkUser() {
    const email = 'markjandoc@gmail.com';
    const usersSnapshot = await db.collection("users").where('email', '==', email).get();
    
    if (usersSnapshot.empty) {
        console.log(`User ${email} not found in 'users' collection.`);
    } else {
        usersSnapshot.forEach(doc => {
            console.log(`User ID: ${doc.id}, Data:`, doc.data());
        });
    }
}

checkUser().catch(console.error);
