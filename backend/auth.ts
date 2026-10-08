import type express from 'express';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, pool, type RecordTransaction } from './database';
import { findApprovedDevelopmentAccount } from './developmentAccountActivation';
export interface SessionIdentity { uid: string; email: string; name: string; googleSubject: string; provider: 'google'; }
const appOrigin = new URL(process.env.APP_URL || 'http://localhost:3000').origin;
const secure = appOrigin.startsWith('https://');
const sessionCookie = secure ? '__Host-vine_session' : 'vine_session';
const stateCookie = secure ? '__Host-vine_oauth' : 'vine_oauth';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
function cookie(req: express.Request, key: string) {
  const value = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(key + '='));
  return value?.slice(key.length + 1) || '';
}
function setCookie(res: express.Response, key: string, value: string, maxAge: number) {
  res.cookie(key, value, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
}
export function trustedWriteOrigin(req: express.Request) { return req.headers.origin === appOrigin; }
export async function sessionIdentity(req: express.Request, transaction?: RecordTransaction): Promise<SessionIdentity> {
  const token = cookie(req, sessionCookie);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Unauthorized');
  const query = transaction ? transaction.sql.bind(transaction) : pool.query.bind(pool);
  const result = await query(`SELECT s.user_id, s.csrf_token, i.email, i.google_subject, r.data FROM auth_sessions s
    JOIN auth_identities i ON i.user_id = s.user_id
    LEFT JOIN app_records r ON r.collection_path = 'users' AND r.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp()`, [hash(token)]);
  const record = result.rows[0];
  if (!record) throw new Error('Unauthorized');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const csrf = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const expected = Buffer.from(record.csrf_token); const supplied = Buffer.from(csrf);
    if (!trustedWriteOrigin(req) || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Invalid request origin or CSRF token');
  }
  return { uid: record.user_id, email: record.email, name: record.data?.fullName || '', googleSubject: record.google_subject, provider: 'google' };
}
export async function revokeSessions(userId: string) { await db.runTransaction(async tx => { await tx.sql('DELETE FROM auth_sessions WHERE user_id = $1', [userId]); }); }
export function mountAuth(app: express.Express) {
  const oauth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${appOrigin}/api/auth/google/callback`);
  app.get('/api/auth/google', async (_req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).json({ error: 'Google sign-in is not configured' });
    try {
      const state = random(); const verifier = random(); const nonce = random();
      await pool.query('DELETE FROM oauth_attempts WHERE expires_at < now()');
      await pool.query(`INSERT INTO oauth_attempts VALUES ($1, $2, $3, now() + interval '10 minutes')`, [hash(state), verifier, nonce]);
      setCookie(res, stateCookie, state, 600_000);
      res.redirect(oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' as any }));
    } catch { res.status(503).json({ error: 'Sign-in is temporarily unavailable' }); }
  });
  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!state || state !== cookie(req, stateCookie) || typeof req.query.code !== 'string') throw new Error('Invalid OAuth callback');
      const attempt = await pool.query('DELETE FROM oauth_attempts WHERE state_hash = $1 AND expires_at > now() RETURNING verifier, nonce', [hash(state)]);
      if (!attempt.rows[0]) throw new Error('Expired OAuth attempt');
      setCookie(res, stateCookie, '', 0);
      const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: attempt.rows[0].verifier });
      if (!tokens.id_token) throw new Error('Missing identity token');
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || !payload.email_verified || (payload as any).nonce !== attempt.rows[0].nonce) throw new Error('Unverified identity');
      const identity = await db.runTransaction(async tx => {
        // Uses the same transaction client as the record mutation.
        const existing = await tx.sql('SELECT user_id FROM auth_identities WHERE google_subject = $1', [payload.sub]);
        if (existing.rows[0]) return existing.rows[0].user_id as string;
        const approved = await findApprovedDevelopmentAccount(tx, payload.email);
        const userId = approved?.ref.id || randomUUID();
        await tx.sql('INSERT INTO auth_identities (google_subject, user_id, email) VALUES ($1, $2, $3)', [payload.sub, userId, payload.email]);
        if (approved) {
          const now = new Date().toISOString();
          tx.update(approved.ref, { active: true, accountStatus: 'active', developmentActivationApproved: false, activatedAt: now, activationSource: 'preapproved_development_google_sign_in' });
          tx.create(db.collection('audit_logs').doc(), { action: 'UPDATE', resource: 'User', resourceId: userId, timestamp: now, source: 'trusted_server', eventType: 'user_activated', details: 'Verified Google sign-in completed previously approved development activation' });
        } else {
          tx.create(db.collection('users').doc(userId), { email: payload.email, fullName: payload.name || payload.email, role: 'staff', active: false, accountStatus: 'pending_activation', assignedBranches: [], assignedBranchNames: [], defaultBranchId: null, defaultBranchName: null, createdAt: new Date().toISOString() });
        }
        return userId;
      });
      const token = random(); const csrf = random();
      await db.runTransaction(async tx => {
        const profile = (await tx.get(db.collection('users').doc(identity))).data();
        if (!profile || profile.isArchived || profile.accountStatus === 'inactive') throw new Error('Account unavailable');
        await tx.sql('DELETE FROM auth_sessions WHERE expires_at < now()', []);
        await tx.sql(`INSERT INTO auth_sessions (token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '12 hours')`, [hash(token), identity, csrf]);
      });
      setCookie(res, sessionCookie, token, 12 * 60 * 60 * 1000);
      res.redirect(appOrigin + '/');
    } catch { res.redirect(appOrigin + '/?auth_error=google_sign_in_failed'); }
  });
  app.get('/api/auth/session', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await sessionIdentity(req);
      const result = await pool.query('SELECT csrf_token FROM auth_sessions WHERE token_hash = $1', [hash(cookie(req, sessionCookie))]);
      res.json({ user: { uid: identity.uid, email: identity.email, displayName: identity.name, emailVerified: true, providerData: [{ providerId: 'google.com', email: identity.email }] }, csrfToken: result.rows[0].csrf_token });
    } catch { res.status(401).json({ user: null }); }
  });
  app.post('/api/auth/logout', async (req, res) => {
    try {
      await db.runTransaction(async tx => {
        await sessionIdentity(req, tx);
        await tx.sql('DELETE FROM auth_sessions WHERE token_hash = $1', [hash(cookie(req, sessionCookie))]);
      });
      setCookie(res, sessionCookie, '', 0); res.json({ ok: true });
    } catch { res.status(401).json({ error: 'Unauthorized' }); }
  });
}
