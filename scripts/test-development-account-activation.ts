import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { OAuth2Client } from 'google-auth-library';

process.env.NODE_ENV = 'development';
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgresql://vine_dev@127.0.0.1/vine_development';
const { db, pool, DocumentReference, DocumentSnapshot, resolveData } = await import('../backend/database');
const { mountAuth } = await import('../backend/auth');
const originals = { get: DocumentReference.prototype.get, transaction: db.runTransaction, query: pool.query, getToken: OAuth2Client.prototype.getToken, verify: OAuth2Client.prototype.verifyIdToken };
const records = new Map<string, any>();
const identities = new Map<string, { id: string; email: string }>();
const sessions = new Map<string, { id: string; csrf: string }>();
let payload: any;
let checks = 0;
let attemptValid = true;
const nonce = 'synthetic-oauth-nonce';
const state = 'synthetic-oauth-state';
const copy = (value: any) => value === undefined ? undefined : structuredClone(value);
const check = (condition: any, message: string) => { assert.ok(condition, message); checks++; };
const prepared = (id: string, email: string, extra = {}) => records.set(`users/${id}`, {
  email, fullName: 'Prepared Test Account', role: 'admin', active: false,
  accountStatus: 'pending_activation', assignedBranches: [], developmentProvisioned: true,
  developmentActivationApproved: true, ...extra,
});
DocumentReference.prototype.get = async function () { return new DocumentSnapshot(this.id, copy(records.get(this.path))); };
db.runTransaction = (async (callback: any) => {
  const oldRecords = new Map([...records].map(([key, value]) => [key, copy(value)]));
  const oldIdentities = new Map(identities);
  const oldSessions = new Map(sessions);
  const tx: any = {
    get: (ref: any) => ref.get(),
    sql: async (sql: string, values: any[]) => {
      if (sql.startsWith('DELETE FROM auth_sessions')) return { rows: [] };
      if (sql.startsWith('INSERT INTO auth_sessions')) { sessions.set(values[0], { id: values[1], csrf: values[2] }); return { rows: [] }; }
      if (sql.startsWith('SELECT user_id FROM auth_identities')) {
        const identity = identities.get(values[0]); return { rows: identity ? [{ user_id: identity.id }] : [] };
      }
      if (sql.startsWith('SELECT id FROM app_records')) return { rows: [...records].filter(([path, data]) => path.startsWith('users/') && data.email?.toLowerCase() === values[0]).map(([path]) => ({ id: path.slice(6) })) };
      if (sql.startsWith('INSERT INTO auth_identities')) {
        if (identities.has(values[0]) || [...identities.values()].some(identity => identity.id === values[1])) throw new Error('Duplicate identity');
        identities.set(values[0], { id: values[1], email: values[2] }); return { rows: [] };
      }
      throw new Error('Unexpected test transaction SQL');
    },
    update: (ref: any, data: any) => records.set(ref.path, resolveData(data, records.get(ref.path))),
    create: (ref: any, data: any) => { if (records.has(ref.path)) throw new Error('Duplicate test record'); records.set(ref.path, copy(data)); },
  };
  try { return await callback(tx); }
  catch (error) { records.clear(); for (const row of oldRecords) records.set(...row); identities.clear(); for (const row of oldIdentities) identities.set(...row); sessions.clear(); for (const row of oldSessions) sessions.set(...row); throw error; }
}) as any;
pool.query = (async (sql: string, values: any[]) => {
  if (sql.includes('DELETE FROM oauth_attempts')) return { rows: attemptValid && values[0] === createHash('sha256').update(state).digest('hex') ? [{ verifier: 'synthetic-verifier', nonce }] : [] };
  if (sql.startsWith('DELETE FROM auth_sessions')) return { rows: [] };
  if (sql.startsWith('INSERT INTO auth_sessions')) { sessions.set(values[0], { id: values[1], csrf: values[2] }); return { rows: [] }; }
  if (sql.includes('FROM auth_sessions s')) {
    const session = sessions.get(values[0]); const identity = [...identities.values()].find(identity => identity.id === session?.id);
    return { rows: session && identity ? [{ user_id: session.id, csrf_token: session.csrf, email: identity.email, google_subject: 'verified-test-subject', data: records.get(`users/${session.id}`) }] : [] };
  }
  if (sql.includes('SELECT csrf_token FROM auth_sessions')) return { rows: [{ csrf_token: sessions.get(values[0])!.csrf }] };
  throw new Error('Unexpected test session SQL');
}) as any;
OAuth2Client.prototype.getToken = (async () => ({ tokens: { id_token: 'provider-test-token' } })) as any;
OAuth2Client.prototype.verifyIdToken = (async () => ({ getPayload: () => payload })) as any;
const app = express(); app.use(express.json()); mountAuth(app);
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function callback(email: string, extra = {}, cookieState = state) {
  payload = { email, sub: `subject-${email}`, email_verified: true, nonce, ...extra };
  return fetch(`${base}/api/auth/google/callback?state=${state}&code=synthetic-provider-code`, { headers: { Cookie: `vine_oauth=${cookieState}` }, redirect: 'manual' });
}
try {
  const email = 'approved@example.invalid'; prepared('approved-admin', email);
  const success = await callback(email);
  check(success.status === 302 && success.headers.get('location') === 'http://localhost:3000/', 'Approved development profile completes normal OAuth callback');
  check(records.get('users/approved-admin').active === true && records.get('users/approved-admin').role === 'admin', 'Approved administrator activated');
  check(records.get('users/approved-admin').developmentActivationApproved === false, 'Approval consumed after sign-in');
  check([...records].filter(([path, data]) => path.startsWith('users/') && data.email === email).length === 1, 'Prepared profile reused without duplicate');
  check(identities.get(`subject-${email}`)?.id === 'approved-admin', 'Verified subject linked to prepared account');
  const sessionCookie = success.headers.getSetCookie().find(cookie => cookie.startsWith('vine_session='))!.split(';')[0];
  const session = await fetch(base + '/api/auth/session', { headers: { Cookie: sessionCookie } });
  check(session.status === 200 && (await session.json()).user.email === email, 'New session passes normal session endpoint');
  check((await callback(email)).headers.get('location') === 'http://localhost:3000/', 'Existing identity uses unchanged sign-in path');
  check([...records].filter(([path, data]) => path.startsWith('users/') && data.email === email).length === 1, 'Repeat sign-in does not duplicate profile');

  for (const [tag, extra, cookieState, valid] of [
    ['unverified', { email_verified: false }, state, true],
    ['bad-nonce', { nonce: 'wrong' }, state, true],
    ['missing-subject', { sub: undefined }, state, true],
    ['bad-state', {}, 'wrong', true],
    ['expired', {}, state, false],
  ] as const) {
    const rejectedEmail = `${tag}@example.invalid`; prepared(tag, rejectedEmail); attemptValid = valid;
    const response = await callback(rejectedEmail, extra, cookieState); attemptValid = true;
    check(response.headers.get('location')?.includes('auth_error='), `${tag} OAuth rejected`);
    check(records.get(`users/${tag}`).active === false && !identities.has(`subject-${rejectedEmail}`), `${tag} cannot activate or acquire identity`);
  }
  const normal = 'normal@example.invalid';
  await callback(normal);
  const normalAccount = records.get(`users/${identities.get(`subject-${normal}`)!.id}`);
  check(normalAccount.role === 'staff' && normalAccount.active === false, 'Unapproved user keeps normal pending staff registration');
  prepared('no-approval', 'no-approval@example.invalid', { developmentActivationApproved: false });
  await callback('no-approval@example.invalid');
  check(records.get('users/no-approval').active === false, 'Missing approval cannot activate reserved profile');
  check(records.get(`users/${identities.get('subject-no-approval@example.invalid')!.id}`).role === 'staff', 'Missing approval cannot grant reserved administrator role');
  prepared('archived', 'archived@example.invalid', { isArchived: true });
  check((await callback('archived@example.invalid')).headers.get('location')?.includes('auth_error='), 'Archived approved profile rejected');
  prepared('invalid-role', 'invalid-role@example.invalid', { role: 'support_developer' });
  check((await callback('invalid-role@example.invalid')).headers.get('location')?.includes('auth_error='), 'Legacy privileged role cannot be preapproved by this path');
  prepared('duplicate-1', 'duplicate@example.invalid'); prepared('duplicate-2', 'duplicate@example.invalid');
  check((await callback('duplicate@example.invalid')).headers.get('location')?.includes('auth_error='), 'Duplicate matching profiles fail closed');
  prepared('restricted', 'restricted@example.invalid', { role: 'SUPPORT_DEVELOPER', assignedBranches: ['demo-branch'], defaultBranchId: 'demo-branch' });
  records.set('branches/demo-branch', { status: 'Active' });
  check((await callback('restricted@example.invalid')).headers.get('location') === 'http://localhost:3000/' && records.get('users/restricted').active === true, 'Full developer role completes approved activation');
  prepared('revoked-branch', 'revoked-branch@example.invalid', { role: 'SUPPORT_DEVELOPER', assignedBranches: ['inactive-branch'], defaultBranchId: 'inactive-branch' });
  check((await callback('revoked-branch@example.invalid')).headers.get('location') === 'http://localhost:3000/', 'Full developer role does not depend on assigned branches');
  prepared('production-admin', 'production@example.invalid'); process.env.NODE_ENV = 'production';
  await callback('production@example.invalid'); process.env.NODE_ENV = 'development';
  check(records.get('users/production-admin').active === false, 'Development preapproval disabled in production');
  check(records.get(`users/${identities.get('subject-production@example.invalid')!.id}`).role === 'staff', 'Production normal registration remains pending staff');
  console.log(`${checks} development activation checks passed (real local HTTP routes, simulated Google provider and in-memory persistence).`);
} finally {
  server.close(); await once(server, 'close');
  DocumentReference.prototype.get = originals.get; db.runTransaction = originals.transaction; pool.query = originals.query;
  OAuth2Client.prototype.getToken = originals.getToken; OAuth2Client.prototype.verifyIdToken = originals.verify;
  await pool.end();
}
