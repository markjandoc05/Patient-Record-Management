type User = { uid: string; email: string; displayName: string; emailVerified: boolean; providerData: any[]; getRequestToken: () => Promise<string> };
let csrfToken = '';
const listeners = new Set<(user: User | null) => void>();
export const auth: { currentUser: User | null; ready: Promise<void>; onAuthStateChanged: (callback: (user: User | null) => void) => () => void } = {
  currentUser: null,
  ready: Promise.resolve(),
  onAuthStateChanged(callback) {
    listeners.add(callback); void auth.ready.then(() => { if (listeners.has(callback)) callback(auth.currentUser); });
    return () => { listeners.delete(callback); };
  },
};
async function refreshSession(initial = false) {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok && response.status !== 401) throw new Error('Session service unavailable');
    const body = await response.json();
    const previous = auth.currentUser?.uid;
    csrfToken = body.csrfToken || '';
    auth.currentUser = body.user ? { ...body.user, getRequestToken: async () => csrfToken } : null;
    if (!initial && previous !== auth.currentUser?.uid) listeners.forEach(callback => callback(auth.currentUser));
  } catch (error) { console.error('Unable to refresh app session', error); }
}
auth.ready = refreshSession(true);
setInterval(() => void refreshSession(), 30_000);
export function signInWithGoogle() { window.location.assign('/api/auth/google'); return Promise.resolve(); }
export const onAuthStateChanged = (_auth: any, callback: (user: User | null) => void) => auth.onAuthStateChanged(callback);
export async function signOut(_auth: any) {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Authorization: `Bearer ${csrfToken}` } });
  if (!response.ok && response.status !== 401) throw new Error('Unable to sign out');
  auth.currentUser = null; csrfToken = ''; listeners.forEach(callback => callback(null));
}
export async function updateProfile(user: User, updates: { displayName: string }) {
  // The persisted profile was already updated by UserSettings through the API.
  user.displayName = updates.displayName;
}
