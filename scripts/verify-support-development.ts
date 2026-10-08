import assert from 'node:assert/strict';
import { db, pool } from '../backend/database';
import { developmentAccessEnabled } from '../backend/developmentAccess';
import { assertAppointmentRead, scopeAppointmentRead } from '../backend/appointmentReadAccess';
import { SUPPORT_DEVELOPER, RBAC, isSupportDeveloper, hasAdministrativeAccess } from '../src/rbac';

// Read-only verification of the prepared fixtures using real PostgreSQL.
try {
  if (!developmentAccessEnabled()) throw new Error('Verification requires isolated local development');
  await db.runTransaction(async tx => {
    const uid = 'development-support-001';
    const profile = (await tx.get(db.collection('users').doc(uid))).data()!;
    assert.equal(profile.role, SUPPORT_DEVELOPER);
    assert.equal(profile.active, false);
    assert.equal(profile.accountStatus, 'pending_activation');
    assert.equal(profile.synthetic, true);
    assert.deepEqual(profile.assignedBranches, ['demo-branch']);
    const identities = await tx.sql('SELECT count(*)::int AS count FROM auth_identities WHERE user_id = $1', [uid]);
    assert.equal(identities.rows[0].count, 0);
    assert.deepEqual(RBAC[SUPPORT_DEVELOPER], RBAC.support_developer);
    assert.equal(isSupportDeveloper(profile.role), true);
    assert.equal(hasAdministrativeAccess(profile.role), true);
    const appointments = await tx.get(scopeAppointmentRead(db.collection('appointments'), profile));
    assert.ok(appointments.docs.some(doc => doc.id === 'support-demo-appointment'));
    assert.ok(appointments.docs.some(doc => doc.id === 'support-acceptance-appointment-b'));
    const restricted = (await tx.get(db.collection('appointments').doc('support-acceptance-appointment-b'))).data()!;
    assert.doesNotThrow(() => assertAppointmentRead(profile, restricted));
    const patients = await tx.get(db.collection('patients'));
    assert.ok(patients.docs.some(doc => doc.id === 'support-demo-patient'));
    assert.ok(patients.docs.some(doc => doc.id === 'support-acceptance-patient-b'));
    const mark = await tx.sql("SELECT id FROM app_records WHERE collection_path='users' AND lower(data->>'email')=$1", ['markjandoc@gmail.com']);
    assert.equal(mark.rows.length, 1);
    const actualProfile = (await tx.get(db.collection('users').doc(mark.rows[0].id))).data()!;
    assert.equal(actualProfile.role, SUPPORT_DEVELOPER); assert.equal(actualProfile.active, true);
    assert.ok((await tx.get(scopeAppointmentRead(db.collection('appointments'), actualProfile))).docs.some(doc => doc.id === 'support-acceptance-appointment-b'));
    console.log('Development PostgreSQL verification passed: Mark has the full Support / Developer grants and global branch reads. Synthetic placeholder remains inactive; no identity/session created or activated.');
  });
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
