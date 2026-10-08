import { db, type RecordTransaction } from './database';
import { developmentAccessEnabled } from './developmentAccess';
import { SUPPORT_DEVELOPER } from '../src/rbac';

// Called only AFTER Google has verified the subject, email and OAuth nonce.
// Approval is written by trusted local tooling, never by the browser data API.
export async function findApprovedDevelopmentAccount(transaction: RecordTransaction, verifiedEmail: string) {
  if (!developmentAccessEnabled()) return null;
  const profiles = await transaction.sql(
    "SELECT id FROM app_records WHERE collection_path = 'users' AND lower(data->>'email') = $1",
    [verifiedEmail.toLowerCase()],
  );
  if (!profiles.rows.length) return null;
  if (profiles.rows.length !== 1) throw new Error('Ambiguous development account');
  const ref = db.collection('users').doc(profiles.rows[0].id);
  const profile = (await transaction.get(ref)).data();
  if (!profile?.developmentProvisioned || profile.developmentActivationApproved !== true) return null;
  if (profile.active !== false || profile.accountStatus !== 'pending_activation' || profile.isArchived
      || !['admin', SUPPORT_DEVELOPER].includes(profile.role)) throw new Error('Invalid development account approval');
  return { ref, profile };
}
