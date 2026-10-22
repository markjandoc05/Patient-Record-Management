import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const origin = new URL(process.env.APP_URL || 'https://invalid').origin;
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_inventory_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
  || process.env.NODE_ENV !== 'production' || !new URL(origin).hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use empty disposable loopback vine_inventory_test, production middleware, .invalid APP_URL and temporary STORAGE_DIR');
}
let server: ReturnType<typeof app.listen> | undefined, checks = 0;
const sessions = new Map<string, { cookie: string; csrf: string }>();
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
async function request(route: string, method = 'GET', body?: any, actor = 'admin', extra: Record<string, string> = {}) {
  const auth = sessions.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: auth.cookie, Authorization: `Bearer ${auth.csrf}` } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function status(response: { status: number; body: any }, expected: number, label: string) {
  check(response.status === expected, `${label}: expected ${expected}, got ${response.status}: ${JSON.stringify(response.body)?.slice(0, 650)}`); return response.body;
}
const list = async (branch = 'A', actor = 'admin') => status(await request('/api/inventory?branchId=' + branch, 'GET', undefined, actor), 200, 'read selected branch inventory');
const stock = async (itemId: string, branch = 'A', actor = 'admin') => (await list(branch, actor)).stocks.find((s: any) => s.itemId === itemId && s.branchId === branch);
const history = async (itemId: string, branch = 'A', actor = 'admin', page = 1) => status(await request(`/api/inventory/items/${itemId}/history?branchId=${branch}&page=${page}`, 'GET', undefined, actor), 200, 'read scoped movement history');
const move = (itemId: string, extra: any = {}) => ({ commandId: randomUUID(), action: 'receive', itemId, branchId: 'A', quantity: 10,
  occurredAt: '2038-01-02T03:04:05.000Z', notes: 'Synthetic receiving note', reference: 'SYNTH-REF', ...extra });
const transfer = (itemId: string, extra: any = {}) => ({ commandId: randomUUID(), itemId, fromBranchId: 'A', toBranchId: 'B', quantity: 2,
  occurredAt: '2038-01-03T03:04:05.000Z', notes: 'Synthetic transfer', ...extra });
const getLegacy = async (collection: string, id: string) => JSON.stringify((await db.collection(collection).doc(id).get()).data());
async function createItem(name = 'Synthetic clinic supply', extra: any = {}) {
  const input = { id: randomUUID(), name, sku: 'SYN-' + randomUUID(), category: 'Synthetic consumables', unit: 'vial', lowStockThreshold: 2, ...extra };
  status(await request('/api/inventory/items', 'POST', input), 201, 'create stock item'); return input;
}
try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'API suite requires empty disposable database');
  await migrateDatabase(); await migrateDatabase();
  check((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count === '7', 'complete checksummed migration chain001–007');
  for (const [id, branchStatus] of [['A', 'Active'], ['B', 'Active'], ['I', 'Inactive']]) await db.collection('branches').doc(id).set({ branchName: 'Synthetic branch ' + id, status: branchStatus });
  const grants = { 'inventory.view': 'allow', 'inventory.manage': 'allow', 'inventory.transfer': 'allow' };
  for (const [id, fields] of Object.entries({
    admin: { role: 'admin', assignedBranches: ['A', 'B'] },
    staffA: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'], permissionOverrides: grants },
    staffB: { role: 'staff', staffDesignation: 'Medical Staff', assignedBranches: ['B'], permissionOverrides: grants },
    staffAB: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A', 'B'], permissionOverrides: grants },
    ordinary: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] },
    viewer: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'inventory.view': 'allow' } },
    deniedView: { role: 'admin', permissionOverrides: { 'inventory.view': 'deny' } },
    deniedManage: { role: 'admin', permissionOverrides: { 'inventory.manage': 'deny' } },
    deniedTransfer: { role: 'admin', permissionOverrides: { 'inventory.transfer': 'deny' } },
    inactive: { role: 'admin', active: false },
  })) {
    await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic ' + id, ...fields });
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  await db.collection('patients').doc('legacy-patient').set({ name: 'Synthetic retained patient', originalField: 'unchanged' });
  await db.collection('visits').doc('legacy-visit').set({ patientId: 'legacy-patient', notes: 'Original synthetic Visit notes', treatment: 'Original treatment text' });
  await db.collection('inventory_items').doc('legacy-item').set({ name: 'Synthetic legacy cream', sku: 'SYN-LEGACY', category: 'Historical', unit: 'bottle', lowStockThreshold: 2, originalField: true });
  await db.collection('inventory_stocks').doc('legacy-stock-A').set({ itemId: 'legacy-item', branchId: 'A', quantity: 12.125, originalField: true });
  await db.collection('inventory_stocks').doc('legacy-stock-B').set({ itemId: 'legacy-item', branchId: 'B', quantity: 5 });
  await db.collection('stock_transfers').doc('legacy-pending').set({ itemId: 'legacy-item', fromBranchId: 'A', toBranchId: 'B', quantity: 2, status: 'pending', createdBy: 'admin', createdAt: { __timestamp: '2037-01-01T00:00:00.000Z' } });
  await db.collection('stock_transfers').doc('legacy-completed').set({ itemId: 'legacy-item', fromBranchId: 'B', toBranchId: 'A', quantity: 1, status: 'completed', createdBy: 'admin', completedBy: 'admin', completedAt: '2037-01-01T00:00:00.000Z' });
  const oldPatient = await getLegacy('patients', 'legacy-patient'), oldVisit = await getLegacy('visits', 'legacy-visit'), oldItem = await getLegacy('inventory_items', 'legacy-item');
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  status(await request('/api/inventory', 'GET', undefined, 'anonymous'), 401, 'inventory requires session');
  for (const actor of ['ordinary', 'deniedView', 'inactive']) status(await request('/api/inventory?branchId=A', 'GET', undefined, actor), 403, actor + ' cannot view inventory');
  const unselected = status(await request('/api/inventory', 'GET', undefined, 'staffA'), 200, 'branchless catalogue lookup');
  check(unselected.stocks.length === 0 && unselected.transfers.length === 0 && unselected.branches.every((b: any) => b.id === 'A'), 'branchless lookup exposes no quantities and only authorized branches');
  const scoped = await list('A', 'staffA');
  check(scoped.stocks.every((s: any) => s.branchId === 'A') && scoped.transfers.length === 0, 'restricted branch scope excludes foreign balances and transfers requiring both endpoints');
  check(scoped.branches.every((b: any) => b.id === 'A'), 'restricted branch directory contains no foreign clinic');
  status(await request('/api/inventory?branchId=B', 'GET', undefined, 'staffA'), 403, 'foreign branch inventory denied');
  status(await request('/api/inventory/items/legacy-item/history?branchId=B', 'GET', undefined, 'staffA'), 403, 'foreign branch history denied');
  check((await stock('legacy-item')).quantity === 12.125 && (await stock('legacy-item')).version === 0, 'legacy quantity initially readable without rewriting');
  const oldStock = await getLegacy('inventory_stocks', 'legacy-stock-A');
  await history('legacy-item');
  check(await getLegacy('inventory_stocks', 'legacy-stock-A') === oldStock, 'read/history does not mutate old stock JSONB');
  const itemInput = { id: randomUUID(), name: 'Synthetic forbidden item', sku: 'SYN-DENY', category: 'Synthetic', unit: 'piece', lowStockThreshold: 1 };
  for (const actor of ['ordinary', 'viewer', 'deniedManage', 'inactive']) status(await request('/api/inventory/items', 'POST', itemInput, actor), 403, actor + ' cannot create item');
  status(await request('/api/inventory/items', 'POST', itemInput, 'admin', { Origin: 'https://wrong.invalid' }), 403, 'item writes enforce origin');
  status(await request('/api/inventory/items', 'POST', itemInput, 'admin', { Authorization: 'Bearer wrong' }), 403, 'item writes enforce CSRF');
  for (const extra of [{ name: ' ' }, { sku: '' }, { unit: '' }, { lowStockThreshold: -1 }, { lowStockThreshold: 0.0001 }, { lowStockThreshold: '2' }]) {
    status(await request('/api/inventory/items', 'POST', { ...itemInput, id: randomUUID(), ...extra }), 400, 'invalid item rejected');
  }
  const item = await createItem();
  const supplier = { id: randomUUID(), name: 'Synthetic supplier', contactPerson: 'Synthetic contact', email: 'supplier@example.invalid', phone: '0000000' };
  status(await request('/api/inventory/suppliers', 'POST', supplier), 201, 'create supplier');
  status(await request('/api/inventory/suppliers', 'POST', { ...supplier, id: randomUUID() }, 'viewer'), 403, 'viewer cannot create supplier');
  const received = move(item.id, { quantity: 10.125, supplierId: supplier.id });
  status(await request('/api/inventory/movements', 'POST', received, 'viewer'), 403, 'read-only viewer cannot receive');
  status(await request('/api/inventory/movements', 'POST', received, 'deniedManage'), 403, 'explicit manage denial blocks receiving');
  status(await request('/api/inventory/movements', 'POST', { ...received, branchId: 'B' }, 'staffA'), 403, 'receiving enforces branch scope');
  status(await request('/api/inventory/movements', 'POST', { ...received, branchId: 'I' }), 400, 'receiving inactive branch denied');
  status(await request('/api/inventory/movements', 'POST', received), 201, 'receive stock');
  check((await stock(item.id)).quantity === 10.125 && (await stock(item.id)).version === 1, 'receiving produces authoritative quantity/version');
  const firstHistory = await history(item.id);
  const receipt = firstHistory.movements.find((m: any) => m.kind === 'receive');
  check(receipt.quantity === 10.125 && receipt.balanceAfter === 10.125 && receipt.occurredAt === received.occurredAt && receipt.actor.uid === 'admin', 'receipt records signed movement, balance, actual date/time and authenticated actor');
  check(receipt.notes === received.notes && receipt.reference === received.reference && Date.parse(receipt.recordedAt) > 0, 'receipt preserves notes/reference and separate recorded time');
  const movementCount = Number((await pool.query('SELECT count(*) FROM inventory_movements')).rows[0].count);
  status(await request('/api/inventory/movements', 'POST', received), 200, 'receipt retry succeeds idempotently');
  check(Number((await pool.query('SELECT count(*) FROM inventory_movements')).rows[0].count) === movementCount && (await stock(item.id)).quantity === 10.125, 'retry creates no movement or stock duplication');
  status(await request('/api/inventory/movements', 'POST', { ...received, quantity: 11 }), 409, 'command reuse with changed quantity conflicts');
  status(await request('/api/inventory/movements', 'POST', received, 'staffAB'), 409, 'command identity cannot be reused by another actor');
  for (const extra of [ { action: 'unknown' }, { quantity: 0 }, { quantity: -1 }, { quantity: '1' }, { quantity: 0.0001 }, { quantity: 1000000001 },
    { commandId: 'not-a-uuid' }, { occurredAt: 'not-a-date' }, { occurredAt: '2038-02-30T10:00:00Z' }, { occurredAt: '2038-01-01T25:00:00Z' }, { notes: 'x'.repeat(2001) } ]) {
    status(await request('/api/inventory/movements', 'POST', move(item.id, extra)), 400, 'invalid movement rejected');
  }
  for (const extra of [{ branchId: 'missing' }, { itemId: 'missing' }, { supplierId: 'missing' }]) status(await request('/api/inventory/movements', 'POST', move(item.id, extra)), 404, 'missing stock resource rejected');
  const used = move(item.id, { action: 'use', quantity: 2.125, notes: 'Synthetic actual use' });
  status(await request('/api/inventory/movements', 'POST', used, 'staffA'), 201, 'explicitly granted Nurse records authorized branch usage');
  check((await stock(item.id)).quantity === 8, 'usage deducts submitted amount');
  const usageHistory = await history(item.id);
  check(usageHistory.movements.some((m: any) => m.kind === 'use' && m.quantity === -2.125 && m.balanceAfter === 8 && m.actor.uid === 'staffA'), 'usage is negative, attributed and historical');
  status(await request('/api/inventory/movements', 'POST', move(item.id, { action: 'use', quantity: 9 })), 400, 'stock cannot go negative');
  const concurrent = await Promise.all([request('/api/inventory/movements', 'POST', move(item.id, { action: 'use', quantity: 5 })), request('/api/inventory/movements', 'POST', move(item.id, { action: 'use', quantity: 5 }))]);
  check(concurrent.filter(r => r.status === 201).length === 1 && concurrent.filter(r => r.status === 400).length === 1, 'concurrent usage cannot overspend stock');
  check((await stock(item.id)).quantity === 3, 'concurrent deductions preserve exact remaining balance');
  let current = await stock(item.id);
  const adjust = move(item.id, { action: 'adjust', quantity: 2, expectedVersion: current.version, notes: 'Synthetic physical count correction' });
  status(await request('/api/inventory/movements', 'POST', adjust, 'staffAB'), 403, 'delegated management does not grant administrative correction');
  status(await request('/api/inventory/movements', 'POST', { ...adjust, notes: '' }), 400, 'correction requires reason');
  status(await request('/api/inventory/movements', 'POST', { ...adjust, expectedVersion: undefined }), 400, 'correction requires expected version');
  status(await request('/api/inventory/movements', 'POST', { ...adjust, expectedVersion: current.version - 1 }), 409, 'stale correction cannot overwrite new quantity');
  status(await request('/api/inventory/movements', 'POST', adjust), 201, 'Admin correction appends movement');
  check((await stock(item.id)).quantity === 5, 'positive correction changes authoritative balance');
  current = await stock(item.id);
  status(await request('/api/inventory/movements', 'POST', move(item.id, { action: 'adjust', quantity: -1, expectedVersion: current.version, notes: 'Synthetic negative correction' })), 201, 'negative correction supported without editing history');
  check((await stock(item.id)).quantity === 4, 'negative correction has signed effect');
  const draftTransfer = transfer(item.id, { fromBranchName: 'Spoofed source', toBranchName: 'Spoofed destination' });
  for (const actor of ['viewer', 'deniedTransfer', 'staffA', 'staffB']) status(await request('/api/inventory/transfers/create', 'POST', draftTransfer, actor), 403, actor + ' cannot transfer without capability and both branches');
  const createdTransfer = status(await request('/api/inventory/transfers/create', 'POST', draftTransfer, 'staffAB'), 200, 'create pending transfer between authorized branches');
  const transferRow = (await list('A', 'staffAB')).transfers.find((t: any) => t.id === createdTransfer.id);
  check(typeof transferRow?.createdAt === 'string' && Number.isFinite(Date.parse(transferRow.createdAt)), 'transfer response exposes a renderable ISO creation time');
  check(transferRow.fromBranchName === 'Synthetic branch A' && transferRow.toBranchName === 'Synthetic branch B', 'authorized transfer overview uses server-derived branch names and ignores spoofed input');
  check((await stock(item.id)).quantity === 4, 'pending transfer does not silently deduct stock');
  const transferReplay = status(await request('/api/inventory/transfers/create', 'POST', draftTransfer, 'staffAB'), 200, 'transfer create retry returns original');
  check(transferReplay.id === createdTransfer.id, 'transfer retry creates one pending record');
  status(await request('/api/inventory/transfers/create', 'POST', { ...draftTransfer, quantity: 1 }, 'staffAB'), 409, 'transfer command content reuse conflicts');
  const completions = await Promise.all([request('/api/inventory/transfers/complete', 'POST', { id: createdTransfer.id }, 'staffAB'), request('/api/inventory/transfers/complete', 'POST', { id: createdTransfer.id }, 'staffAB')]);
  completions.forEach(r => status(r, 200, 'concurrent completion is repeat-safe'));
  check((await stock(item.id)).quantity === 2 && (await stock(item.id, 'B')).quantity === 2, 'atomic completion deducts and receives exactly once');
  const sourceHistory = await history(item.id), targetHistory = await history(item.id, 'B');
  check(sourceHistory.movements.some((m: any) => m.kind === 'transfer_out' && m.quantity === -2 && m.transferId === createdTransfer.id)
    && targetHistory.movements.some((m: any) => m.kind === 'transfer_in' && m.quantity === 2 && m.transferId === createdTransfer.id), 'matching transfer movements are recorded at both branches');
  for (const value of [sourceHistory, targetHistory]) {
    const movement = value.movements.find((m: any) => m.transferId === createdTransfer.id);
    check(movement.fromBranchName === 'Synthetic branch A' && movement.toBranchName === 'Synthetic branch B', 'authorized source and destination history show matching transfer branch names');
  }
  await db.collection('branches').doc('A').update({ branchName: 'Synthetic renamed branch A' });
  await db.collection('branches').doc('B').update({ branchName: 'Synthetic renamed branch B' });
  const stableTransfer = (await list('A', 'staffAB')).transfers.find((t: any) => t.id === createdTransfer.id);
  const stableMovement = (await history(item.id)).movements.find((m: any) => m.transferId === createdTransfer.id);
  check(stableTransfer.fromBranchName === 'Synthetic branch A' && stableTransfer.toBranchName === 'Synthetic branch B'
    && stableMovement.fromBranchName === 'Synthetic branch A' && stableMovement.toBranchName === 'Synthetic branch B', 'new transfer branch-name snapshots survive directory renames in overview and history');
  const oldOverview = (await list()).transfers.find((t: any) => t.id === 'legacy-pending');
  check(oldOverview.fromBranchName === 'Synthetic renamed branch A' && oldOverview.toBranchName === 'Synthetic renamed branch B', 'legacy overview without snapshots uses authorized directory fallback');
  await db.collection('branches').doc('A').update({ branchName: 'Synthetic branch A' });
  await db.collection('branches').doc('B').update({ branchName: 'Synthetic branch B' });
  check((await list('A', 'staffA')).transfers.length === 0 && (await list('B', 'staffB')).transfers.length === 0, 'one-endpoint users cannot read completed transfer details');
  status(await request('/api/inventory/transfers/complete', 'POST', { id: createdTransfer.id }, 'staffA'), 403, 'completed replay still checks both endpoint permissions');
  const legacyDoneBefore = await getLegacy('stock_transfers', 'legacy-completed');
  status(await request('/api/inventory/transfers/complete', 'POST', { id: 'legacy-completed' }), 200, 'historical completed transfer remains safely replayable');
  check(await getLegacy('stock_transfers', 'legacy-completed') === legacyDoneBefore && (await stock('legacy-item')).quantity === 12.125, 'old completion replay never reapplies stock');
  status(await request('/api/inventory/transfers/complete', 'POST', { id: 'legacy-pending' }), 200, 'existing pending transfer can finish without conversion');
  check((await stock('legacy-item')).quantity === 10.125 && (await stock('legacy-item', 'B')).quantity === 7, 'legacy transfer preserves opening stock and applies once');
  const legacyMovement = (await history('legacy-item')).movements.find((m: any) => m.transferId === 'legacy-pending');
  check(legacyMovement.fromBranchName === 'Synthetic branch A' && legacyMovement.toBranchName === 'Synthetic branch B', 'old pending transfer history falls back to authorized current branch names');
  const opening = (await history('legacy-item')).movements.filter((m: any) => m.kind === 'opening');
  check(opening.length === 1 && opening[0].quantity === 12.125 && opening[0].balanceAfter === 12.125, 'legacy opening is identified without inventing older receipts');
  check(await getLegacy('inventory_items', 'legacy-item') === oldItem, 'legacy item fields are retained exactly');
  check(await getLegacy('patients', 'legacy-patient') === oldPatient && await getLegacy('visits', 'legacy-visit') === oldVisit, 'inventory operations preserve historical patient and Visit data');
  const contestedTransfer = status(await request('/api/inventory/transfers/create', 'POST', transfer(item.id)), 200, 'create pending transfer before competing usage');
  status(await request('/api/inventory/movements', 'POST', move(item.id, { action: 'use', quantity: 1 })), 201, 'record usage after pending transfer');
  status(await request('/api/inventory/transfers/complete', 'POST', { id: contestedTransfer.id }), 400, 'completion rechecks source balance after other usage');
  check((await stock(item.id)).quantity === 1 && (await stock(item.id, 'B')).quantity === 2
    && (await db.collection('stock_transfers').doc(contestedTransfer.id).get()).data()?.status === 'pending', 'failed completion leaves both balances and pending transfer unchanged');
  status(await request('/api/inventory/movements', 'POST', move(item.id, { quantity: 1 })), 201, 'receive replacement stock');
  status(await request('/api/inventory/transfers/complete', 'POST', { id: contestedTransfer.id }), 200, 'retry pending transfer after replenishment');
  check((await stock(item.id)).quantity === 0 && (await stock(item.id, 'B')).quantity === 4, 'retried pending transfer applies paired balances once');
  const beforeCorrection = await stock(item.id);
  status(await request('/api/inventory/movements', 'POST', move(item.id, { quantity: 1 })), 201, 'another receipt advances correction version');
  status(await request('/api/inventory/movements', 'POST', move(item.id, { action: 'adjust', quantity: 2, expectedVersion: beforeCorrection.version, notes: 'Stale physical count' })), 409, 'real intervening receipt invalidates previously loaded correction');
  check((await stock(item.id)).quantity === 1, 'stale correction preserves intervening receipt');
  const capped = await createItem('Synthetic upper-bound stock');
  await db.collection('inventory_stocks').doc('capped-stock').set({ itemId: capped.id, branchId: 'A', quantity: 1_000_000_000 });
  status(await request('/api/inventory/movements', 'POST', move(capped.id, { quantity: 0.001 })), 400, 'balance addition rejects overflow even when individual quantity is valid');
  check((await stock(capped.id)).quantity === 1_000_000_000 && (await history(capped.id)).total === 0, 'rejected overflow rolls back opening adoption and stock changes');
  for (const collection of ['inventory_stocks', 'stock_transfers', 'inventory_movements', 'inventory_accounts', 'inventory_commands']) {
    status(await request('/api/data/write', 'POST', { operations: [{ mode: 'set', path: collection + '/forbidden', data: { itemId: item.id, branchId: 'A', quantity: 999 } }] }), 403, 'generic writes cannot bypass ' + collection);
  }
  for (const [id, quantity] of [['bad-string', '3'], ['bad-negative', -1], ['bad-precision', 1.0001]] as const) {
    await db.collection('inventory_items').doc(id).set({ name: 'Synthetic malformed legacy', sku: id, unit: 'piece', lowStockThreshold: 1 });
    await db.collection('inventory_stocks').doc(id).set({ itemId: id, branchId: 'A', quantity });
    const untouched = await getLegacy('inventory_stocks', id);
    const value = await stock(id); check(value.quantity === null && value.issue, 'malformed legacy is visible as issue without invented quantity');
    status(await request('/api/inventory/movements', 'POST', move(id)), 409, 'malformed legacy cannot receive silent correction');
    check(await getLegacy('inventory_stocks', id) === untouched, 'malformed legacy row remains untouched');
  }
  await db.collection('inventory_items').doc('duplicate-item').set({ name: 'Synthetic ambiguous legacy', sku: 'SYN-DUP', unit: 'piece', lowStockThreshold: 1 });
  for (const id of ['duplicate-1', 'duplicate-2']) await db.collection('inventory_stocks').doc(id).set({ itemId: 'duplicate-item', branchId: 'A', quantity: 2 });
  check((await stock('duplicate-item')).quantity === null && (await stock('duplicate-item')).issue, 'duplicate legacy balances surface a review issue');
  status(await request('/api/inventory/movements', 'POST', move('duplicate-item')), 409, 'ambiguous duplicates are never automatically merged');
  await assert.rejects(db.collection('inventory_stocks').doc('legacy-stock-A').update({ quantity: 999 }), (error: any) => error.code === '23514'); checks++;
  check((await stock('legacy-item')).quantity === 10.125, 'database rejects direct mirror overwrite and preserves accounted stock');
  const lock = await pool.connect();
  try {
    await lock.query('BEGIN; SELECT pg_advisory_xact_lock(78194602)');
    const pending = request('/api/inventory/movements', 'POST', move(item.id, { quantity: 1 }), 'staffA');
    let waiting = false;
    for (let i = 0; i < 200; i++) {
      waiting = Number((await pool.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count) > 0;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    check(waiting, 'permission revocation race queued at real transaction lock');
    await pool.query("UPDATE app_records SET data=data||'{\"permissionOverrides\":{\"inventory.view\":\"allow\",\"inventory.manage\":\"deny\"},\"accessRevision\":2}'::jsonb WHERE collection_path='users' AND id='staffA'");
    await lock.query('COMMIT'); status(await pending, 403, 'queued stock command rechecks permission after lock');
  } finally { await lock.query('ROLLBACK'); lock.release(); }
  const ownHistory = await history(item.id, 'A', 'viewer');
  const ownTransfer = ownHistory.movements.find((m: any) => m.kind === 'transfer_out');
  check(ownTransfer && !ownTransfer.transferId && !ownTransfer.notes && !ownTransfer.reference, 'single-branch movement history retains own quantity but redacts cross-branch transfer metadata');
  check(!Object.hasOwn(ownTransfer, 'fromBranchName') && !Object.hasOwn(ownTransfer, 'toBranchName')
    && !Object.hasOwn(ownTransfer, 'fromBranchId') && !Object.hasOwn(ownTransfer, 'toBranchId')
    && !JSON.stringify(ownHistory).includes('Synthetic branch B'), 'restricted history never exposes foreign branch names or IDs');
  await assert.rejects(db.collection('inventory_stocks').doc('legacy-stock-A').delete(), (error: any) => error.code === '23514'); checks++;
  await assert.rejects(db.collection('inventory_stocks').doc('duplicate-after-adoption').set({ itemId: 'legacy-item', branchId: 'A', quantity: 10.125 }), (error: any) => error.code === '23514'); checks++;
  const existingMovement = (await pool.query('SELECT id FROM inventory_movements LIMIT 1')).rows[0];
  for (const sql of ['UPDATE inventory_movements SET notes=\'Rewrite\' WHERE id=$1', 'DELETE FROM inventory_movements WHERE id=$1']) {
    await assert.rejects(pool.query(sql, [existingMovement.id]), (error: any) => error.code === '23514'); checks++;
  }
  const existingCommand = (await pool.query('SELECT command_id FROM inventory_commands LIMIT 1')).rows[0];
  for (const sql of ["UPDATE inventory_commands SET result='{}' WHERE command_id=$1", 'DELETE FROM inventory_commands WHERE command_id=$1']) {
    await assert.rejects(pool.query(sql, [existingCommand.command_id]), (error: any) => error.code === '23514'); checks++;
  }
  check((await history(item.id)).total >= sourceHistory.total, 'history remains readable after rejected rewrites');
  console.log(`Inventory API: ${checks} checks passed (real HTTP, production middleware, isolated synthetic PostgreSQL; no production access).`);
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await pool.end(); }
