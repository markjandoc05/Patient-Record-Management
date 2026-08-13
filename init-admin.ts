
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId,
    });
}

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

async function setAdminRole() {
    const adminEmail = 'markjandoc@gmail.com';
    const users = await admin.auth().listUsers();
    const user = users.users.find(u => u.email === adminEmail);
    
    if (user) {
        await db.collection("users").doc(user.uid).set({
            email: adminEmail,
            role: "admin",
            active: true
        }, { merge: true });
        console.log(`User ${adminEmail} set to admin role.`);
    } else {
        console.log(`User ${adminEmail} not found.`);
    }
}

setAdminRole().catch(console.error);
