import { db, pool } from '../backend/database';
import { developmentAccessEnabled } from '../backend/developmentAccess';
import { SUPPORT_DEVELOPER } from '../src/rbac';

// No Google identities or sessions are created by this script.
const branch = 'demo-branch';
const profile = {
  fullName: 'Synthetic Support Developer', email: 'support.developer@example.invalid',
  role: SUPPORT_DEVELOPER, active: false, accountStatus: 'pending_activation',
  assignedBranches: [branch], assignedBranchNames: ['Demo Clinic — Development'],
  defaultBranchId: branch, defaultBranchName: 'Demo Clinic — Development',
  developmentOnly: true, synthetic: true, createdAt: new Date().toISOString(),
};
try {
  if (!developmentAccessEnabled()) throw new Error('Requires isolated vine_development / vine_dev database and local development APP_URL');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--google-email' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args[1]))) throw new Error('Usage: npm run dev:access:prepare [-- --google-email dedicated-test-account@example.com]');
  await db.runTransaction(async tx => {
    const fixtures = [
      ['branches', branch, { branchName: 'Demo Clinic — Development', status: 'Active', synthetic: true }],
      ['branches', 'acceptance-branch-b', { branchName: 'Acceptance Clinic B — Development', status: 'Active', synthetic: true }],
      ['users', 'development-support-001', profile],
      ['users', 'demo-doctor-001', { fullName: 'Synthetic Demo Doctor', email: 'doctor@example.invalid', role: 'doctor', active: true, assignedBranches: [branch], synthetic: true }],
      ['patients', 'support-demo-patient', { name: 'Synthetic Support Patient', patientID: 'DEV-SUPPORT-001', email: 'support.patient@example.invalid', homeBranchId: branch, homeBranchName: profile.defaultBranchName, status: 'Active', synthetic: true }],
      ['patients', 'support-acceptance-patient-b', { name: 'Synthetic Restricted Patient B', homeBranchId: 'acceptance-branch-b', status: 'Active', synthetic: true }],
      ['appointments', 'support-demo-appointment', { patientId: 'support-demo-patient', patientName: 'Synthetic Support Patient', branchId: branch, doctorId: 'demo-doctor-001', appointmentDate: '2026-10-15T10:00', visitType: 'Initial Consultation', status: 'Scheduled', synthetic: true }],
      ['appointments', 'support-acceptance-appointment-b', { patientId: 'support-acceptance-patient-b', patientName: 'Synthetic Restricted Patient B', branchId: 'acceptance-branch-b', appointmentDate: '2026-10-15T10:30', visitType: 'Initial Consultation', status: 'Scheduled', synthetic: true }],
    ] as const;
    for (const [collection, id, data] of fixtures) {
      const ref = db.collection(collection).doc(id);
      if (!(await tx.get(ref)).exists) tx.create(ref, data);
    }
    if (!args.length) return;
    const email = args[1].toLowerCase();
    const identities = await tx.sql('SELECT user_id FROM auth_identities WHERE lower(email) = $1', [email]);
    if (identities.rows.length !== 1) throw new Error('Sign in with the dedicated Google test identity first; one verified development identity is required');
    const ref = db.collection('users').doc(identities.rows[0].user_id);
    const old = (await tx.get(ref)).data();
    if (!old || old.active || old.isArchived || old.accountStatus !== 'pending_activation' || !['staff', SUPPORT_DEVELOPER].includes(old.role)) throw new Error('Only a pending inactive test profile can be prepared; existing active or privileged users are preserved');
    tx.update(ref, { ...profile, email: old.email, createdAt: old.createdAt || profile.createdAt });
    tx.create(db.collection('audit_logs').doc(), { action: 'UPDATE', resource: 'User', resourceId: ref.id, timestamp: new Date().toISOString(), source: 'development_access_cli', details: 'Prepared full Support / Developer development account; administrator activation still required' });
    console.log(`Prepared verified pending development profile ${ref.id}; activate in development Settings → User access.`);
  });
  console.log('Synthetic Support / Developer profile and branch fixtures prepared; existing rows preserved. Google sign-in and administrator activation are required.');
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
