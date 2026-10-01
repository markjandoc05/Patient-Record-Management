import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 30000 });
pool.on('error', () => { console.error('PostgreSQL connection became unavailable'); });
export type RecordData = Record<string, any>;
export const FieldValue = {
  serverTimestamp: () => ({ __operation: 'timestamp' }),
  delete: () => ({ __operation: 'delete' }),
  increment: (value: number) => ({ __operation: 'increment', value }),
};
export function resolveData(input: RecordData, previous: RecordData = {}): RecordData {
  const result = { ...previous };
  for (const [key, value] of Object.entries(input)) {
    if (value?.__operation === 'delete') delete result[key];
    else if (value?.__operation === 'timestamp') result[key] = { __timestamp: new Date().toISOString() };
    else if (value?.__operation === 'increment') result[key] = Number(previous[key] || 0) + Number(value.value);
    else if (value !== undefined) result[key] = value;
  }
  return result;
}
function hydrate(value: any): any {
  if (value && typeof value === 'object' && typeof value.__timestamp === 'string') {
    return { ...value, toDate: () => new Date(value.__timestamp), toMillis: () => Date.parse(value.__timestamp) };
  }
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hydrate(v)]));
  return value;
}
export class DocumentSnapshot {
  constructor(public id: string, private value?: RecordData) {}
  get exists() { return this.value !== undefined; }
  data(): RecordData | undefined { return hydrate(this.value); }
}
export class QuerySnapshot {
  constructor(public docs: DocumentSnapshot[]) {}
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
  forEach(callback: (doc: DocumentSnapshot) => void) { this.docs.forEach(callback); }
}
type Filter = [string, string, any];
export class RecordQuery {
  filters: Filter[] = [];
  ordering?: [string, string];
  maximum?: number;
  constructor(public collectionPath: string, protected client?: PoolClient) {}
  where(field: string, operator: string, value: any) { const q = this.copy(); q.filters.push([field, operator, value]); return q; }
  orderBy(field: string, direction = 'asc') { const q = this.copy(); q.ordering = [field, direction]; return q; }
  limit(maximum: number) { const q = this.copy(); q.maximum = maximum; return q; }
  private copy() { const q = new RecordQuery(this.collectionPath, this.client); q.filters = [...this.filters]; q.ordering = this.ordering; q.maximum = this.maximum; return q; }
  async get(client = this.client): Promise<QuerySnapshot> {
    const values: any[] = [this.collectionPath];
    const clauses = ['collection_path = $1'];
    for (const [field, operator, value] of this.filters) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) throw new Error('Invalid query field');
      values.push(field); const expression = `(data -> $${values.length}::text)`;
      if (operator === 'in') {
        if (!Array.isArray(value)) throw new Error('Invalid in filter');
        values.push(JSON.stringify(value)); clauses.push(`${expression} <@ $${values.length}::jsonb`);
      } else if (operator === 'array-contains') {
        values.push(JSON.stringify([value])); clauses.push(`${expression} @> $${values.length}::jsonb`);
      } else {
        const sqlOperator = ({ '==': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' } as Record<string, string>)[operator];
        if (!sqlOperator) throw new Error('Unsupported query operator');
        values.push(JSON.stringify(value)); clauses.push(`${expression} ${sqlOperator} $${values.length}::jsonb`);
      }
    }
    let sql = `SELECT id, data FROM app_records WHERE ${clauses.join(' AND ')}`;
    if (this.ordering) {
      values.push(this.ordering[0]);
      sql += ` ORDER BY COALESCE(data -> $${values.length}::text ->> '__timestamp', data ->> $${values.length}::text) ${this.ordering[1] === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, id`;
    } else sql += ' ORDER BY id';
    if (this.maximum !== undefined) { values.push(this.maximum); sql += ` LIMIT $${values.length}`; }
    const result = await (client || pool).query(sql, values);
    return new QuerySnapshot(result.rows.map(row => new DocumentSnapshot(row.id, row.data)));
  }
  count() { return { get: async () => {
    const result = await pool.query('SELECT count(*)::integer AS count FROM app_records WHERE collection_path = $1', [this.collectionPath]);
    return { data: () => ({ count: result.rows[0].count }) };
  } }; }
}
export class DocumentReference {
  constructor(public collectionPath: string, public id: string) {}
  get path() { return `${this.collectionPath}/${this.id}`; }
  async get(client?: PoolClient) {
    const result = await (client || pool).query('SELECT data FROM app_records WHERE collection_path = $1 AND id = $2', [this.collectionPath, this.id]);
    return new DocumentSnapshot(this.id, result.rows[0]?.data);
  }
  async set(data: RecordData, options?: { merge?: boolean }) { await db.runTransaction(async tx => { tx.set(this, data, options); }); }
  async update(data: RecordData) { await db.runTransaction(async tx => { tx.update(this, data); }); }
  async delete() { await db.runTransaction(async tx => { tx.delete(this); }); }
}
export class RecordCollection extends RecordQuery {
  doc(id: string = randomUUID()) { return new DocumentReference(this.collectionPath, id); }
  async add(data: RecordData) { const ref = this.doc(); await db.runTransaction(async tx => { tx.create(ref, data); }); return ref; }
}
export class RecordTransaction {
  private readQueue: Promise<unknown> = Promise.resolve();
  private operations: Array<() => Promise<void>> = [];
  constructor(private client: PoolClient) {}
  sql(query: string, values: any[]) { return this.client.query(query, values); }
  get(target: DocumentReference): Promise<DocumentSnapshot>;
  get(target: RecordQuery): Promise<QuerySnapshot>;
  get(target: DocumentReference | RecordQuery): Promise<DocumentSnapshot | QuerySnapshot> {
    const result = this.readQueue.then(async (): Promise<DocumentSnapshot | QuerySnapshot> => target.get(this.client));
    this.readQueue = result;
    return result;
  }
  set(ref: DocumentReference, data: RecordData, options?: { merge?: boolean }) { this.enqueue(ref, data, options?.merge ? 'merge' : 'set'); return this; }
  update(ref: DocumentReference, data: RecordData) { this.enqueue(ref, data, 'update'); return this; }
  create(ref: DocumentReference, data: RecordData) { this.enqueue(ref, data, 'create'); return this; }
  delete(ref: DocumentReference) { this.operations.push(async () => { await this.client.query('DELETE FROM app_records WHERE collection_path = $1 AND id = $2', [ref.collectionPath, ref.id]); }); return this; }
  private enqueue(ref: DocumentReference, data: RecordData, mode: string) {
    this.operations.push(async () => {
      const existing = await ref.get(this.client);
      if (mode === 'update' && !existing.exists) throw new Error('Record not found');
      if (mode === 'create' && existing.exists) throw new Error('Record already exists');
      const next = resolveData(data, mode === 'merge' || mode === 'update' ? existing.data() : {});
      await this.client.query(`INSERT INTO app_records (collection_path, id, data) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (collection_path, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [ref.collectionPath, ref.id, JSON.stringify(next)]);
    });
  }
  async flush() { for (const operation of this.operations) await operation(); }
}
export const db = {
  collection: (collectionPath: string) => new RecordCollection(collectionPath),
  async runTransaction<T>(callback: (tx: RecordTransaction) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Compatibility migration: serialize legacy multi-record mutations to
      // protect counters, collision checks and read-before-write invariants.
      // New relational domains should use scoped row locks instead.
      await client.query('SELECT pg_advisory_xact_lock(78194602)');
      const tx = new RecordTransaction(client); const result = await callback(tx);
      await tx.flush(); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  },
};
