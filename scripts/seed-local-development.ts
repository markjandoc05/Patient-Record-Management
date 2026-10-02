import { db, pool } from '../backend/database';
import { developmentAccessEnabled } from '../backend/developmentAccess';
import { SUPPORT_DEVELOPER } from '../src/rbac';

// Optional fixtures, separate from migrations. No patients, identities or sessions.
try {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
  if (!developmentAccessEnabled() || url.port !== '55439' || process.env.NODE_ENV !== 'development') {
    throw Error('Fixtures require the isolated local Vine development database');
  }
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--activate-support')) {
    throw Error('Usage: npm run dev:fixtures [-- --activate-support]');
  }
  if (args[0] === '--activate-support') {
    // Uses the committed Google callback's verified identity; never invents one.
    const activated = await db.runTransaction(async tx => {
      const identities = await tx.sql('SELECT user_id FROM auth_identities WHERE lower(email)=$1', ['markjandoc@gmail.com']);
      if (identities.rows.length !== 1) throw Error('Sign in with the authorized development Google account first; one verified identity is required');
      const ref = db.collection('users').doc(identities.rows[0].user_id);
      const profile = (await tx.get(ref)).data();
      if (profile?.active === true && profile.role === SUPPORT_DEVELOPER && profile.accountStatus === 'active' && !profile.isArchived) return false;
      if (!profile || profile.isArchived || profile.active !== false || profile.accountStatus !== 'pending_activation'
          || !['staff', SUPPORT_DEVELOPER].includes(profile.role)) throw Error('Only the verified pending local Support account can be activated');
      tx.update(ref, { role: SUPPORT_DEVELOPER, active: true, accountStatus: 'active', developmentOnly: true, activatedAt: new Date().toISOString() });
      await tx.sql('DELETE FROM auth_sessions WHERE user_id=$1', [ref.id]);
      tx.create(db.collection('audit_logs').doc(), {
        action: 'UPDATE', resource: 'User', resourceId: ref.id, timestamp: new Date().toISOString(),
        source: 'local_development_cli', details: 'Activated the authorized local Support profile after verified Google sign-in',
      });
      return true;
    });
    console.log(activated ? 'Verified local Support profile ready. Sign in again; previous sessions were revoked.' : 'Verified local Support profile already active; no changes made.');
  } else {
    await db.runTransaction(async tx => {
      const branches = [
        ['local-branch-a', 'Local Development Branch A'],
        ['local-branch-b', 'Local Development Branch B'],
      ];
      for (const [id, branchName] of branches) {
        const ref = db.collection('branches').doc(id);
        if (!(await tx.get(ref)).exists) tx.create(ref, { branchName, status: 'Active', synthetic: true, developmentOnly: true });
      }
      const branding = db.collection('settings').doc('branding');
      if (!(await tx.get(branding)).exists) tx.create(branding, { appName: 'Vine', appShortName: 'Vine', browserTitle: 'Vine Development', synthetic: true });
      // Unlinked placeholder cannot collide with a real Google registration.
      const support = db.collection('users').doc('local-support-developer');
      if (!(await tx.get(support)).exists) tx.create(support, {
        email: 'support.developer@example.invalid', fullName: 'Synthetic Support Developer', role: SUPPORT_DEVELOPER,
        active: false, accountStatus: 'pending_activation',
        developmentOnly: true, synthetic: true,
        assignedBranches: branches.map(([id]) => id), assignedBranchNames: branches.map(([, name]) => name),
        defaultBranchId: branches[0][0], defaultBranchName: branches[0][1],
        createdAt: new Date().toISOString(),
      });
    });
    console.log('Minimal local branches, branding and Support profile ready; existing records preserved.');
    console.log('Support activation still requires verified Google sign-in. No patients, appointments, identities or sessions seeded.');
  }
} catch (error: any) {
  console.error(error.message); process.exitCode = 1;
} finally { await pool.end(); }
