
import admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

const db = admin.firestore();

async function setAdminRole() {
    const adminEmail = 'markjandoc@gmail.com';
    const users = await admin.auth().listUsers();
    const user = users.users.find(u => u.email === adminEmail);
    
    if (user) {
        await db.collection("users").doc(user.uid).set({
            email: adminEmail,
            role: "admin"
        });
        console.log(`User ${adminEmail} set to admin role.`);
    } else {
        console.log(`User ${adminEmail} not found.`);
    }
}

setAdminRole().catch(console.error);
