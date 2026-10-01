// Compatibility API for existing screens. All persistence is server-side PostgreSQL.
import { auth } from './session';
export type Database = typeof db;
export type QueryConstraint = { type: string; field?: string; operator?: string; value?: any; direction?: string };
export const db = { provider: 'postgresql' };
type Reference = { path: string; kind: 'document' | 'collection'; constraints?: QueryConstraint[] };
export function collection(_db: any, ...segments: string[]): Reference { return { path: segments.join('/'), kind: 'collection' }; }
export function doc(parent: any, ...segments: string[]): Reference {
  return { path: [...(parent.path ? [parent.path] : []), ...segments].join('/') || crypto.randomUUID(), kind: 'document' };
}
export const where = (field: string, operator: string, value: any): QueryConstraint => ({ type: 'where', field, operator, value });
export const orderBy = (field: string, direction = 'asc'): QueryConstraint => ({ type: 'orderBy', field, direction });
export const limit = (value: number): QueryConstraint => ({ type: 'limit', value });
export const query = (ref: Reference, ...constraints: QueryConstraint[]) => ({ ...ref, constraints: [...(ref.constraints || []), ...constraints] });
export const serverTimestamp = () => ({ __operation: 'timestamp' });
export const increment = (value: number) => ({ __operation: 'increment', value });
function hydrate(value: any): any {
  if (value?.__timestamp) return { ...value, toDate: () => new Date(value.__timestamp), toMillis: () => Date.parse(value.__timestamp) };
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hydrate(v)]));
  return value;
}
async function request(endpoint: string, payload: any) {
  await auth.ready;
  const token = auth.currentUser ? await auth.currentUser.getRequestToken() : '';
  const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) { const error = Object.assign(new Error(body.error || 'Data request failed'), { code: response.status === 403 ? 'permission-denied' : 'unavailable' }); throw error; }
  return body;
}
function snapshot(record: any) { return { id: record.id, exists: () => record.data !== null, data: (): Record<string, any> => hydrate(record.data) }; }
export async function getDoc(ref: Reference) { const result = await request('/api/data/query', ref); return snapshot(result.document); }
export async function getDocs(ref: Reference) { const result = await request('/api/data/query', ref); const docs = result.documents.map(snapshot); return { docs, size: docs.length, empty: !docs.length, forEach: (callback: any) => docs.forEach(callback) }; }
export function onSnapshot(ref: Reference, callback: (value: any) => void, onError?: (error: any) => void) {
  let cancelled = false; let previous = ''; let timer: ReturnType<typeof setTimeout>; let errorReported = false;
  const poll = async () => {
    try {
      const value: any = ref.kind === 'document' ? await getDoc(ref) : await getDocs(ref);
      const key = JSON.stringify(ref.kind === 'document' ? value.data() : value.docs.map((d: any) => ({ id: d.id, data: d.data() })));
      if (!cancelled && (key !== previous || errorReported)) { previous = key; errorReported = false; callback(value); }
    } catch (error) { if (!cancelled && !errorReported) { errorReported = true; onError?.(error); } }
    if (!cancelled) timer = setTimeout(poll, 5000);
  };
  void poll(); return () => { cancelled = true; clearTimeout(timer); };
}
type Write = { path: string; mode: string; data?: any; merge?: boolean };
async function writes(operations: Write[]) { return request('/api/data/write', { operations }); }
export const setDoc = (ref: Reference, data: any, options?: { merge?: boolean }) => writes([{ path: ref.path, mode: 'set', data, merge: options?.merge }]);
export const updateDoc = (ref: Reference, data: any) => writes([{ path: ref.path, mode: 'update', data }]);
export async function addDoc(ref: Reference, data: any) { const id = crypto.randomUUID(); await writes([{ path: `${ref.path}/${id}`, mode: 'create', data }]); return { id }; }
export function writeBatch(_db: any) {
  const operations: Write[] = [];
  return {
    set(ref: Reference, data: any, options?: { merge?: boolean }) { operations.push({ path: ref.path, mode: 'set', data, merge: options?.merge }); },
    update(ref: Reference, data: any) { operations.push({ path: ref.path, mode: 'update', data }); },
    delete(ref: Reference) { operations.push({ path: ref.path, mode: 'delete' }); },
    commit: () => writes(operations),
  };
}
