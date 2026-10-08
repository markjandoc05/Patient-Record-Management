import { db, pool } from '../backend/database';
import { administrativeRoles } from '../src/rbac';
const email = process.argv[2];
if (!email) throw new Error('Usage: npm run admin:bootstrap -- verified-admin@example.com');
try {
  await db.runTransaction(async tx => {
    const existing = await tx.get(db.collection('users').where('active', '==', true).where('role', 'in', [...administrativeRoles]));
    if (!existing.empty) throw new Error('An active administrator already exists; use the app to manage access');
    const users = await tx.get(db.collection('users').where('email', '==', email));
    if (users.size !== 1) throw new Error('Sign in with Google once first; a unique pending profile is required');
    const user = users.docs[0];
    const identity = await tx.sql('SELECT 1 FROM auth_identities WHERE user_id = $1', [user.id]);
    if (!identity.rowCount) throw new Error('Verified Google identity required');
    tx.update(db.collection('users').doc(user.id), { role: 'admin', active: true, accountStatus: 'active' });
    tx.create(db.collection('audit_logs').doc(), { action: 'UPDATE', resource: 'User', resourceId: user.id, timestamp: new Date().toISOString(), source: 'bootstrap_cli', details: 'Bootstrapped initial administrator' });
  });
  console.log('Initial administrator activated.');
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
