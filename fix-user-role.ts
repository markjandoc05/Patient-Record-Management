import admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

const db = admin.firestore();

async function setRoleForUser(email: string, role: string) {
    const users = await admin.auth().listUsers();
    const user = users.users.find(u => u.email === email);
    
    if (user) {
        await db.collection("users").doc(user.uid).set({
            email: email,
            role: role
        }, { merge: true });
        console.log(`User ${email} (UID: ${user.uid}) set to ${role} role.`);
    } else {
        console.log(`User ${email} not found.`);
    }
}

setRoleForUser('hello@aiph.tech', 'admin').catch(console.error);
