import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, pool } from '../backend/database';
import { developmentAccessEnabled } from '../backend/developmentAccess';
import { SUPPORT_DEVELOPER, hasAdministrativeAccess } from '../src/rbac';

// Explicit user-authorized assignments, limited to the isolated development DB.
// No password, Google subject or authentication session is generated here.
const accounts = [
  { email: 'markjandoc@gmail.com', role: SUPPORT_DEVELOPER, fullName: 'Mark Jandoc' },
  { email: 'vineaesthetics.marketing@gmail.com', role: 'admin', fullName: 'Vine Aesthetics Marketing' },
] as const;
const verifyOnly = process.argv.slice(2).includes('--verify');
if (process.argv.slice(2).some(arg => arg !== '--verify')) throw new Error('Usage: npm run dev:accounts:configure [-- --verify]');
try {
  if (!developmentAccessEnabled()) throw new Error('Isolated local development environment required');
  const results = await db.runTransaction(async tx => {
    const branch = (await tx.get(db.collection('branches').doc('demo-branch'))).data();
    if (branch?.status !== 'Active') throw new Error('Active demo-branch is required');
    const results: any[] = [];
    for (const account of accounts) {
      const profiles = await tx.sql("SELECT id FROM app_records WHERE collection_path='users' AND lower(data->>'email')=$1", [account.email]);
      const identities = await tx.sql('SELECT user_id FROM auth_identities WHERE lower(email)=$1', [account.email]);
      if (profiles.rows.length > 1 || identities.rows.length > 1) throw new Error(`Duplicate development account: ${account.email}`);
      const existingId = profiles.rows[0]?.id;
      const identityId = identities.rows[0]?.user_id;
      if (existingId && identityId && existingId !== identityId) throw new Error('Development identity/profile mismatch');
      const id = existingId || identityId || randomUUID();
      const ref = db.collection('users').doc(id);
      const old = (await tx.get(ref)).data();
      if (old?.isArchived) throw new Error(`Archived account requires an explicit restore: ${account.email}`);
      const scope = account.role === SUPPORT_DEVELOPER
        ? { assignedBranches: ['demo-branch'], assignedBranchNames: [branch.branchName], defaultBranchId: 'demo-branch', defaultBranchName: branch.branchName }
        : { assignedBranches: old?.assignedBranches || [], assignedBranchNames: old?.assignedBranchNames || [], defaultBranchId: old?.defaultBranchId || null, defaultBranchName: old?.defaultBranchName || null };
      const now = new Date().toISOString();
      const data = {
        ...scope, email: account.email, role: account.role,
        fullName: old?.fullName || account.fullName,
        active: !!identityId, accountStatus: identityId ? 'active' : 'pending_activation',
        developmentOnly: true, developmentProvisioned: true,
        developmentActivationApproved: !identityId,
        accessConfiguredAt: now, accessConfigurationSource: 'user_requested_development_cli',
        ...(identityId ? { activatedAt: old?.activatedAt || now } : {}),
      };
      if (verifyOnly) {
        assert.equal(old?.role, account.role);
        assert.equal(old?.active, !!identityId);
        assert.equal(old?.accountStatus, identityId ? 'active' : 'pending_activation');
        if (!identityId) assert.equal(old?.developmentActivationApproved, true);
        if (account.role === SUPPORT_DEVELOPER) { assert.deepEqual(old?.assignedBranches, ['demo-branch']); assert.equal(old?.defaultBranchId, 'demo-branch'); }
      } else {
        if (old) tx.update(ref, data);
        else tx.create(ref, { ...data, createdAt: now });
        // Existing sessions must reauthenticate after the requested role change.
        if (old && (old.role !== account.role || JSON.stringify(old.assignedBranches || []) !== JSON.stringify(scope.assignedBranches))) await tx.sql('DELETE FROM auth_sessions WHERE user_id=$1', [id]);
        tx.create(db.collection('audit_logs').doc(), { action: 'UPDATE', resource: 'User', resourceId: id, timestamp: now, source: 'development_account_cli', eventType: 'development_access_configured', details: `User-requested ${account.role} development assignment; ${identityId ? 'verified identity active' : 'activation approved pending verified Google sign-in'}`, changes: ['role', 'assignedBranches', 'accountStatus'].map(field => ({ field })) });
      }
      results.push({ email: account.email, role: account.role, status: data.accountStatus, verifiedGoogleIdentity: !!identityId, assignedBranches: scope.assignedBranches, branchAccess: hasAdministrativeAccess(account.role) ? 'all branches' : 'assigned branches' });
    }
    return results;
  });
  console.log(JSON.stringify({ developmentOnly: true, mode: verifyOnly ? 'verified' : 'configured', accounts: results }, null, 2));
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
