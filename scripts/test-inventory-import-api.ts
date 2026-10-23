import { assertCurrentMigrationChain } from './platform-test-support';
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
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_inventory_import_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
  || process.env.NODE_ENV !== 'production' || !new URL(origin).hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use empty disposable loopback vine_inventory_import_test, production middleware, .invalid APP_URL and temporary STORAGE_DIR');
}
let server: ReturnType<typeof app.listen> | undefined, checks = 0;
const sessions = new Map<string, { cookie: string; csrf: string }>();
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
async function request(route: string, method = 'POST', body?: any, actor = 'admin', extra: Record<string, string> = {}) {
  const auth = sessions.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: auth.cookie, Authorization: `Bearer ${auth.csrf}` } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function status(response: { status: number; body: any }, expected: number, label: string) {
  check(response.status === expected, `${label}: expected ${expected}, got ${response.status}: ${JSON.stringify(response.body)?.slice(0, 600)}`); return response.body;
}
const inputRow = (extra: any = {}) => ({ rowNumber: 2, name: 'Synthetic Excel item', sku: 'SYN-XLS-' + randomUUID(), category: '', unit: 'vial', lowStockThreshold: 2, openingQuantity: 5.125, ...extra });
const preview = (rows: any[], branchId = 'A', actor = 'admin') => request('/api/inventory/import/preview', 'POST', { rows, branchId }, actor);
const command = (rows: any[], result: any, extra: any = {}) => ({ branchId: 'A', rows, previewHash: result.previewHash, commandId: randomUUID(), occurredAt: '2039-02-03T04:05:06.000Z', notes: 'Synthetic received through Excel', ...extra });
const commit = (body: any, actor = 'admin') => request('/api/inventory/import/commit', 'POST', body, actor);
const record = async (collection: string, id: string) => JSON.stringify((await pool.query('SELECT data FROM app_records WHERE collection_path=$1 AND id=$2', [collection, id])).rows[0]?.data);
const counts = async () => JSON.stringify((await pool.query(`SELECT
  (SELECT count(*) FROM app_records WHERE collection_path='inventory_items') AS items,
  (SELECT count(*) FROM app_records WHERE collection_path='inventory_stocks') AS stocks,
  (SELECT count(*) FROM inventory_accounts) AS accounts,
  (SELECT count(*) FROM inventory_movements) AS movements,
  (SELECT count(*) FROM inventory_commands) AS commands,
  (SELECT count(*) FROM app_records WHERE collection_path='audit_logs') AS audits`)).rows[0]);
async function ready(rows: any[]) {
  const p = status(await preview(rows), 200, 'preview valid new-item workbook');
  check(p.errorCount === 0 && p.readyCount > 0 && /^[a-f0-9]{64}$/.test(p.previewHash), 'server preview derives valid ready count and opaque hash');
  return p;
}
try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'import suite requires empty disposable database');
  await migrateDatabase(); await migrateDatabase();
  check(await assertCurrentMigrationChain(), 'complete current checksummed migration chain');
  for (const id of ['A', 'B', 'inactive']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic Excel branch ' + id, status: id === 'inactive' ? 'Inactive' : 'Active' });
  for (const [id, fields] of Object.entries({
    admin: { role: 'admin', assignedBranches: ['A', 'B'] },
    viewer: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'inventory.view': 'allow' } },
    granted: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'inventory.view': 'allow', 'inventory.manage': 'allow' } },
    ordinary: { role: 'staff', assignedBranches: ['A'] },
    deniedView: { role: 'admin', permissionOverrides: { 'inventory.view': 'deny' } },
    deniedManage: { role: 'admin', permissionOverrides: { 'inventory.manage': 'deny' } },
    inactive: { role: 'admin', active: false },
  })) {
    await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic Excel ' + id, ...fields });
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  const categoryId = randomUUID();
  await db.collection('inventory_categories').doc(categoryId).set({ name: 'Synthetic Clinical Supplies', active: true, version: 1 });
  await db.collection('inventory_items').doc('retained-item').set({ name: 'Synthetic retained item', sku: 'SYN-RETAINED', category: 'Retained free text', unit: 'bottle', lowStockThreshold: 1, retained: true });
  await db.collection('inventory_stocks').doc('retained-A').set({ itemId: 'retained-item', branchId: 'A', quantity: 8, retained: true });
  await db.collection('inventory_stocks').doc('retained-B').set({ itemId: 'retained-item', branchId: 'B', quantity: 888.125, retained: true });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  status(await request('/api/inventory/movements', 'POST', { commandId: randomUUID(), action: 'receive', itemId: 'retained-item', branchId: 'A', quantity: 2, occurredAt: '2039-01-01T00:00:00.000Z', notes: 'Retained stock history', reference: 'SYN-RETAINED' }), 201, 'establish immutable existing movement history');
  const retainedItem = await record('inventory_items', 'retained-item'), retainedA = await record('inventory_stocks', 'retained-A'), retainedB = await record('inventory_stocks', 'retained-B');
  const retainedHistory = JSON.stringify((await pool.query("SELECT m.* FROM inventory_movements m JOIN inventory_accounts a ON a.id=m.account_id WHERE a.item_id='retained-item' ORDER BY m.id")).rows);
  const rows = [inputRow({ category: ' synthetic  CLINICAL\t supplies ', name: ' Synthetic Excel vial ' }), inputRow({ rowNumber: 3, openingQuantity: 0, lowStockThreshold: 0 })];
  const untouched = await counts();
  status(await request('/api/inventory/import/preview', 'POST', { branchId: 'A', rows }, 'anonymous'), 401, 'preview requires authenticated account');
  for (const actor of ['viewer', 'ordinary', 'deniedView', 'deniedManage', 'inactive']) {
    status(await preview(rows, 'A', actor), 403, actor + ' cannot preview import');
    status(await commit(command(rows, { previewHash: 'a'.repeat(64) }), actor), 403, actor + ' cannot commit import');
  }
  status(await request('/api/inventory/import/preview', 'POST', { branchId: 'A', rows }, 'admin', { Origin: 'https://wrong.invalid' }), 403, 'preview enforces origin');
  status(await request('/api/inventory/import/preview', 'POST', { branchId: 'A', rows }, 'admin', { Authorization: 'Bearer wrong' }), 403, 'preview enforces CSRF');
  status(await preview(rows, 'B', 'granted'), 403, 'preview denies unauthorized branch');
  status(await preview(rows, 'missing'), 404, 'preview rejects missing branch');
  status(await preview(rows, 'inactive'), 400, 'preview rejects inactive branch');
  const p = await ready(rows), approved = command(rows, p);
  check(await counts() === untouched, 'preview, denials and validation are read-only');
  status(await commit({ ...approved, branchId: 'B' }, 'granted'), 403, 'commit independently denies unauthorized branch');
  status(await commit({ ...approved, branchId: 'inactive' }), 400, 'commit independently rejects inactive branch');
  status(await request('/api/inventory/import/commit', 'POST', approved, 'admin', { Origin: 'https://wrong.invalid' }), 403, 'commit enforces origin');
  status(await request('/api/inventory/import/commit', 'POST', approved, 'admin', { Authorization: 'Bearer wrong' }), 403, 'commit enforces CSRF');
  const imported = status(await commit(approved), 201, 'commit creates items and opening stock atomically');
  check(imported.importedCount === 2 && imported.skippedCount === 0 && imported.itemIds.length === 2, 'import result counts new items without exposing foreign data');
  const importedItems = await Promise.all(imported.itemIds.map(async (id: string) => (await db.collection('inventory_items').doc(id).get()).data()));
  check(importedItems[0].name === 'Synthetic Excel vial' && importedItems[0].categoryId === categoryId && importedItems[0].category === 'Synthetic Clinical Supplies', 'import normalizes metadata and freezes authoritative canonical category');
  check(importedItems[1].categoryId === null && importedItems[1].category === '', 'blank category creates explicit uncategorized item');
  const importedAccounts = (await pool.query('SELECT * FROM inventory_accounts WHERE item_id=ANY($1::text[])', [imported.itemIds])).rows;
  check(importedAccounts.length === 1 && importedAccounts[0].branch_id === 'A' && Number(importedAccounts[0].quantity) === 5.125 && importedAccounts[0].version === 1, 'opening receipt uses only chosen branch and exact three-decimal quantity');
  const movement = (await pool.query("SELECT * FROM inventory_movements WHERE account_id=$1 AND kind='receive'", [importedAccounts[0].id])).rows[0];
  check(movement.actor.uid === 'admin' && movement.actor.name === 'Synthetic Excel admin' && movement.reference === 'Excel import' && movement.notes === approved.notes && new Date(movement.occurred_at).toISOString() === approved.occurredAt, 'receipt records trusted actor, Excel reference, notes and treatment-independent supplied date');
  check((await db.collection('audit_logs').where('resourceId', '==', approved.commandId).get()).size === 1, 'import appends attributed batch audit');
  const committedCounts = await counts(), retried = status(await commit(approved), 200, 'lost-response retry replays successful batch');
  check(retried.replayed && JSON.stringify(retried.itemIds) === JSON.stringify(imported.itemIds) && await counts() === committedCounts, 'retry creates no duplicate items, receipts, commands or audits');
  status(await commit({ ...approved, notes: 'Changed request' }), 409, 'same command cannot change request notes');
  status(await commit({ ...approved, rows: [{ ...rows[0], openingQuantity: 6 }, rows[1]] }), 409, 'same command cannot change workbook contents');
  status(await commit(approved, 'granted'), 409, 'command belongs to its original actor');
  await db.collection('inventory_categories').doc(categoryId).update({ active: false, version: 2 });
  status(await commit(approved), 200, 'successful replay survives later category deactivation');
  await db.collection('branches').doc('A').update({ status: 'Inactive' });
  status(await commit(approved), 200, 'successful replay survives later branch deactivation without new write');
  await db.collection('branches').doc('A').update({ status: 'Active' });
  await db.collection('inventory_categories').doc(categoryId).update({ active: true, version: 3 });
  const skippedRow = inputRow({ sku: '  syn-retained  ', name: 'Do not overwrite original', category: 'Unknown category', openingQuantity: 999 });
  const mixed = [skippedRow, inputRow({ rowNumber: 5, category: 'Synthetic Clinical Supplies', openingQuantity: 1 })], mp = await ready(mixed);
  check(mp.rows[0].status === 'skip' && mp.skippedCount === 1 && mp.readyCount === 1, 'existing case/trim SKU is skipped regardless of supplied replacement metadata');
  const mr = status(await commit(command(mixed, mp)), 201, 'mixed workbook imports only new SKU');
  check(mr.importedCount === 1 && mr.skippedCount === 1, 'mixed commit reports skipped existing SKU');
  const onlySkip = status(await preview([skippedRow]), 200, 'all-existing workbook may be previewed');
  status(await commit(command([skippedRow], onlySkip)), 400, 'all-existing workbook cannot create empty import');
  for (const invalidRows of [[], Array.from({ length: 251 }, (_, i) => inputRow({ rowNumber: i + 2 })), [inputRow({ rowNumber: 1 })], [inputRow({ rowNumber: 2.5 })], [inputRow(), inputRow()], [null]]) {
    status(await preview(invalidRows), 400, 'invalid batch size or Excel row numbering rejected');
  }
  for (const extra of [{ name: '' }, { name: 'x'.repeat(201) }, { sku: '' }, { sku: 'x'.repeat(81) }, { unit: '' }, { unit: 'x'.repeat(41) }, { lowStockThreshold: -1 }, { lowStockThreshold: '2' }, { lowStockThreshold: 0.0001 }, { openingQuantity: -1 }, { openingQuantity: '5' }, { openingQuantity: null }, { openingQuantity: 1_000_000_001 }, { openingQuantity: 0.0001 }, { category: 'Unknown category' }, { category: 'x'.repeat(81) }]) {
    const invalid = [inputRow(extra)], ip = status(await preview(invalid), 200, 'invalid cell appears in authoritative row preview');
    check(ip.errorCount === 1 && ip.rows[0].status === 'error' && typeof ip.rows[0].message === 'string', 'invalid cell has clear row error');
    const before = await counts();
    status(await commit(command(invalid, ip)), 400, 'row error prevents commit');
    check(await counts() === before, 'invalid cell creates no partial writes');
  }
  const duplicated = [inputRow({ sku: 'SYN-DUPLICATE' }), inputRow({ rowNumber: 3, sku: '  syn-duplicate  ' })];
  const dp = status(await preview(duplicated), 200, 'duplicate workbook SKU preview');
  check(dp.errorCount === 2 && dp.readyCount === 0, 'all repeated workbook SKUs error after case/trim matching');
  status(await commit(command(duplicated, dp)), 400, 'duplicate workbook SKUs never import');
  const partial = [inputRow(), inputRow({ rowNumber: 3, unit: '' })], pp = status(await preview(partial), 200, 'partly invalid workbook preview');
  check(pp.readyCount === 1 && pp.errorCount === 1, 'preview distinguishes ready row from invalid row');
  const partialBefore = await counts();
  status(await commit(command(partial, pp)), 400, 'one row error prevents whole batch');
  check(await counts() === partialBefore, 'valid row is not partially created');
  const categoryRace = [inputRow({ category: 'Synthetic Clinical Supplies' })], cp = await ready(categoryRace);
  await db.collection('inventory_categories').doc(categoryId).update({ version: 4 });
  const changed = await commit(command(categoryRace, cp));
  check(status(changed, 409, 'category version change requires new preview').code === 'IMPORT_PREVIEW_CHANGED', 'category version is part of preview binding');
  const freshCategory = await ready(categoryRace);
  await db.collection('inventory_categories').doc(categoryId).update({ active: false, version: 5 });
  check(status(await commit(command(categoryRace, freshCategory)), 409, 'category deactivation invalidates preview').code === 'IMPORT_PREVIEW_CHANGED', 'deactivation never silently remaps category');
  const inactivePreview = status(await preview(categoryRace), 200, 'inactive category is a row error');
  check(inactivePreview.errorCount === 1, 'inactive canonical category cannot be newly imported');
  await db.collection('inventory_categories').doc(categoryId).update({ active: true, version: 6 });
  const duplicateCategoryId = randomUUID();
  await db.collection('inventory_categories').doc(duplicateCategoryId).set({ name: ' synthetic  CLINICAL supplies ', active: true, version: 1 });
  check(status(await preview(categoryRace), 200, 'ambiguous canonical category preview').errorCount === 1, 'nonunique normalized canonical categories require review');
  await db.collection('inventory_categories').doc(duplicateCategoryId).delete();
  const skuRace = [inputRow()], sp = await ready(skuRace);
  status(await request('/api/inventory/items', 'POST', { id: randomUUID(), ...skuRace[0], categoryId: null }), 201, 'concurrent ordinary create establishes same SKU');
  check(status(await commit(command(skuRace, sp)), 409, 'newly existing SKU invalidates old ready preview').code === 'IMPORT_PREVIEW_CHANGED', 'commit cannot silently import a reduced batch');
  const concurrentRows = [inputRow()], concurrentPreview = await ready(concurrentRows);
  const competing = await Promise.all([commit(command(concurrentRows, concurrentPreview)), commit(command(concurrentRows, concurrentPreview))]);
  check(competing.filter(r => r.status === 201).length === 1 && competing.filter(r => r.status === 409 && r.body.code === 'IMPORT_PREVIEW_CHANGED').length === 1, 'simultaneous distinct commands create one SKU and receipt');
  const retryRows = [inputRow()], retryPreview = await ready(retryRows), same = command(retryRows, retryPreview);
  const sameCommand = await Promise.all([commit(same), commit(same)]);
  check(sameCommand.filter(r => r.status === 201).length === 1 && sameCommand.filter(r => r.status === 200 && r.body.replayed).length === 1 && sameCommand[0].body.itemIds[0] === sameCommand[1].body.itemIds[0], 'simultaneous same-command retries resolve one import');
  for (const extra of [{ previewHash: undefined }, { previewHash: 'invalid' }, { commandId: 'invalid' }, { occurredAt: '2039-02-31T04:05:06.000Z' }, { notes: 'x'.repeat(2001) }]) {
    status(await commit({ ...same, commandId: randomUUID(), ...extra }), 400, 'invalid commit envelope rejected');
  }
  const revokedRows = [inputRow()], revokedPreview = await ready(revokedRows);
  const lock = await pool.connect();
  try {
    await lock.query('BEGIN; SELECT pg_advisory_xact_lock(78194602)');
    const queued = commit(command(revokedRows, revokedPreview), 'granted');
    let waiting = false;
    for (let i = 0; i < 200; i++) {
      waiting = Number((await pool.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count) > 0;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    check(waiting, 'import save queues at real transaction permission boundary');
    await pool.query("UPDATE app_records SET data=data||'{\"permissionOverrides\":{\"inventory.view\":\"allow\",\"inventory.manage\":\"deny\"},\"accessRevision\":2}'::jsonb WHERE collection_path='users' AND id='granted'");
    await lock.query('COMMIT'); status(await queued, 403, 'queued import rechecks revoked current management permission');
  } finally { await lock.query('ROLLBACK'); lock.release(); }
  check((await db.collection('inventory_items').where('sku', '==', revokedRows[0].sku).get()).empty, 'revoked queued import creates no item');
  await db.collection('users').doc('admin').update({ permissionOverrides: { 'inventory.manage': 'deny' } });
  status(await commit(approved), 403, 'successful import retry still requires current management capability');
  await db.collection('users').doc('admin').update({ permissionOverrides: {} });
  check(await record('inventory_items', 'retained-item') === retainedItem && await record('inventory_stocks', 'retained-A') === retainedA && await record('inventory_stocks', 'retained-B') === retainedB, 'imports preserve exact existing item metadata and both branch balances');
  check(JSON.stringify((await pool.query("SELECT m.* FROM inventory_movements m JOIN inventory_accounts a ON a.id=m.account_id WHERE a.item_id='retained-item' ORDER BY m.id")).rows) === retainedHistory, 'imports preserve immutable historical stock movements');
  check((await db.collection('inventory_items').where('sku', '==', revokedRows[0].sku).get()).empty, 'final denied imports do not backfill missing records');
  console.log(`Inventory import API: ${checks} checks passed (real HTTP, guarded synthetic PostgreSQL; no production access).`);
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await pool.end(); }
