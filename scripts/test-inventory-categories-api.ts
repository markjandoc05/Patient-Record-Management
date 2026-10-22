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
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_inventory_categories_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
  || process.env.NODE_ENV !== 'production' || !new URL(origin).hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use empty disposable loopback vine_inventory_categories_test, production middleware, .invalid APP_URL and temporary STORAGE_DIR');
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
const overview = async (branch = 'A', actor = 'admin') => status(await request('/api/inventory?branchId=' + branch, 'GET', undefined, actor), 200, 'read authorized inventory overview');
const categoryInput = (name = 'Synthetic supplies') => ({ id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, name, active: true });
const update = (category: any, extra: any = {}) => ({ id: category.id, commandId: randomUUID(), expectedVersion: category.version, name: category.name, active: category.active, ...extra });
const itemInput = (categoryId: string | null, extra: any = {}) => ({ id: randomUUID(), name: 'Synthetic categorized supply', sku: 'SYN-' + randomUUID(), categoryId, unit: 'vial', lowStockThreshold: 2, ...extra });
const record = async (collection: string, id: string) => JSON.stringify((await pool.query('SELECT data FROM app_records WHERE collection_path=$1 AND id=$2', [collection, id])).rows[0]?.data);
const storedCategory = async (id: string) => (await db.collection('inventory_categories').doc(id).get()).data();
const generic = (operations: any[], actor = 'admin') => request('/api/data/write', 'POST', { operations }, actor);
try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'category suite requires empty disposable database');
  await migrateDatabase(); await migrateDatabase();
  check((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count === '7', 'category management reuses existing001–007 schema without new migrations');
  check((await db.collection('inventory_categories').get()).empty, 'migrations do not automatically seed categories');
  for (const id of ['A', 'B']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic category branch ' + id, status: 'Active' });
  for (const [id, fields] of Object.entries({
    admin: { role: 'admin', assignedBranches: ['A', 'B'] },
    viewer: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'inventory.view': 'allow' } },
    granted: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'], permissionOverrides: { 'inventory.view': 'allow', 'inventory.manage': 'allow' } },
    ordinary: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] },
    deniedView: { role: 'admin', permissionOverrides: { 'inventory.view': 'deny' } },
    deniedManage: { role: 'admin', permissionOverrides: { 'inventory.manage': 'deny' } },
    inactive: { role: 'admin', active: false },
  })) {
    await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic category ' + id, ...fields });
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  await db.collection('inventory_items').doc('legacy-item').set({ name: 'Synthetic retained supply', sku: 'SYN-LEGACY-CATEGORY', category: 'Original free text', unit: 'bottle', lowStockThreshold: 1, originalField: 'preserve' });
  await db.collection('inventory_stocks').doc('legacy-stock').set({ itemId: 'legacy-item', branchId: 'A', quantity: 8, originalField: true });
  await db.collection('inventory_stocks').doc('foreign-stock').set({ itemId: 'legacy-item', branchId: 'B', quantity: 888.125 });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  status(await request('/api/inventory/movements', 'POST', { commandId: randomUUID(), action: 'receive', itemId: 'legacy-item', branchId: 'A', quantity: 2, occurredAt: '2039-01-02T03:04:05.000Z', notes: 'Retained synthetic receipt', reference: 'SYNTH-CAT' }), 201, 'establish retained movement history');
  const legacyItem = await record('inventory_items', 'legacy-item'), legacyStock = await record('inventory_stocks', 'legacy-stock');
  const legacyHistory = JSON.stringify((await pool.query('SELECT * FROM inventory_movements ORDER BY id')).rows);
  const grantsBefore = await record('users', 'granted'), ordinaryBefore = await record('users', 'ordinary');
  check((await overview()).categories.length === 0, 'legacy category text is not automatically converted into definitions');
  status(await request('/api/inventory', 'GET', undefined, 'anonymous'), 401, 'category overview requires authentication');
  for (const actor of ['ordinary', 'deniedView', 'inactive']) status(await request('/api/inventory', 'GET', undefined, actor), 403, actor + ' cannot view categories');
  const raw = categoryInput('  Synthetic   clinical\t supplies  ');
  status(await request('/api/inventory/categories', 'POST', raw, 'anonymous'), 401, 'category creation requires session');
  for (const actor of ['viewer', 'ordinary', 'deniedManage', 'inactive']) status(await request('/api/inventory/categories', 'POST', raw, actor), 403, actor + ' cannot create categories');
  status(await request('/api/inventory/categories', 'POST', raw, 'admin', { Origin: 'https://wrong.invalid' }), 403, 'category creation enforces origin');
  status(await request('/api/inventory/categories', 'POST', raw, 'admin', { Authorization: 'Bearer wrong' }), 403, 'category creation enforces CSRF');
  let category = status(await request('/api/inventory/categories', 'POST', raw), 201, 'create canonical category');
  check(category.id === raw.id && category.name === 'Synthetic clinical supplies' && category.active === true && category.version === 1, 'server normalizes name and derives category version');
  const replay = status(await request('/api/inventory/categories', 'POST', raw), 200, 'same category creation retries safely');
  check(replay.replayed && (await db.collection('inventory_categories').get()).size === 1, 'create replay makes one category');
  status(await request('/api/inventory/categories', 'POST', { ...raw, name: 'Different request' }), 409, 'same command with different content conflicts');
  status(await request('/api/inventory/categories', 'POST', raw, 'granted'), 409, 'command replay remains bound to actor');
  status(await request('/api/inventory/categories', 'POST', { ...raw, commandId: randomUUID() }), 409, 'new command cannot reuse category ID');
  status(await request('/api/inventory/categories', 'POST', categoryInput('synthetic CLINICAL    supplies')), 409, 'canonical name uniqueness folds case and whitespace');
  for (const extra of [{ name: ' ' }, { name: 'x'.repeat(81) }, { active: 'yes' }, { id: 'invalid' }, { commandId: 'invalid' }, { expectedVersion: undefined }, { expectedVersion: 1 }]) {
    status(await request('/api/inventory/categories', 'POST', { ...categoryInput(), ...extra }), 400, 'invalid category command rejected');
  }
  const twoCreates = await Promise.all([request('/api/inventory/categories', 'POST', categoryInput('Synthetic concurrent category')), request('/api/inventory/categories', 'POST', categoryInput('  synthetic CONCURRENT category  '))]);
  check(twoCreates.filter(r => r.status === 201).length === 1 && twoCreates.filter(r => r.status === 409).length === 1, 'simultaneous duplicate names create one definition');
  const scoped = await overview('A', 'viewer');
  check(scoped.categories.some((c: any) => c.id === category.id) && scoped.stocks.every((s: any) => s.branchId === 'A') && scoped.branches.every((b: any) => b.id === 'A')
    && !JSON.stringify(scoped).includes('888.125'), 'global category lookup retains private branch stock boundaries');
  status(await request('/api/inventory?branchId=B', 'GET', undefined, 'viewer'), 403, 'category visibility grants no foreign branch access');
  const genericRead = status(await request('/api/data/query', 'POST', { kind: 'collection', path: 'inventory_categories' }, 'viewer'), 200, 'generic category collection read enforces inventory view');
  check(genericRead.documents.some((d: any) => d.id === category.id), 'authorized generic read preserves category compatibility');
  for (const actor of ['ordinary', 'deniedView']) status(await request('/api/data/query', 'POST', { kind: 'document', path: 'inventory_categories/' + category.id }, actor), 403, actor + ' generic category read denied');
  const linked = itemInput(category.id, { category: 'Spoofed category name' });
  status(await request('/api/inventory/items', 'POST', linked), 201, 'create item using canonical category');
  const linkedStored = (await db.collection('inventory_items').doc(linked.id).get()).data()!;
  check(linkedStored.categoryId === category.id && linkedStored.category === category.name, 'item category name derives from authoritative definition rather than client text');
  const noCategory = itemInput(null, { category: 'Spoofed unlinked category' });
  status(await request('/api/inventory/items', 'POST', noCategory), 201, 'explicit uncategorized item supported');
  check((await db.collection('inventory_items').doc(noCategory.id).get()).data()?.category === '', 'explicit null category does not accept spoofed free text');
  const oldClient = { ...itemInput(null), category: 'Retained old-client free text' } as any; delete oldClient.categoryId;
  status(await request('/api/inventory/items', 'POST', oldClient), 201, 'old client free-text item creation remains compatible');
  check((await db.collection('inventory_items').doc(oldClient.id).get()).data()?.category === oldClient.category, 'old-client free text retained without auto-conversion');
  status(await request('/api/inventory/categories/' + category.id, 'PATCH', update(category, { name: 'synthetic CONCURRENT category' })), 409, 'rename cannot collide with another canonical category');
  const rename = update(category, { name: 'Synthetic renamed supplies' });
  for (const actor of ['viewer', 'ordinary', 'deniedManage']) status(await request('/api/inventory/categories/' + category.id, 'PATCH', rename, actor), 403, actor + ' cannot rename category');
  category = status(await request('/api/inventory/categories/' + category.id, 'PATCH', rename), 200, 'rename category');
  check(category.version === 2 && category.name === rename.name, 'rename advances category version');
  status(await request('/api/inventory/categories/' + category.id, 'PATCH', rename), 200, 'rename retry uses original command');
  status(await request('/api/inventory/categories/' + category.id, 'PATCH', { ...rename, commandId: randomUUID() }), 409, 'new stale edit rejected');
  const renamedItems = (await overview()).items;
  check(renamedItems.find((i: any) => i.id === linked.id).category === category.name, 'linked item displays current category name after rename');
  check((await db.collection('inventory_items').doc(linked.id).get()).data()?.category === linkedStored.category, 'rename preserves existing stored category snapshot');
  const deactivation = update(category, { active: false });
  category = status(await request('/api/inventory/categories/' + category.id, 'PATCH', deactivation), 200, 'soft-deactivate category');
  check(category.version === 3 && category.active === false && (await storedCategory(category.id))?.active === false, 'deactivation retains definition with next version');
  status(await request('/api/inventory/categories/' + category.id, 'PATCH', rename), 200, 'completed rename retry survives later deactivation');
  status(await request('/api/inventory/items', 'POST', linked), 200, 'successful linked-item retry survives later category rename/deactivation');
  const inactiveItem = itemInput(category.id), unknownItem = itemInput(randomUUID());
  status(await request('/api/inventory/items', 'POST', inactiveItem), 409, 'inactive category cannot be newly selected');
  status(await request('/api/inventory/items', 'POST', unknownItem), 404, 'unknown category cannot be newly selected');
  check(!(await db.collection('inventory_items').doc(inactiveItem.id).get()).exists && !(await db.collection('inventory_items').doc(unknownItem.id).get()).exists, 'denied selections create no inventory items');
  check((await overview()).items.find((i: any) => i.id === linked.id).category === category.name, 'existing item remains readable when its category is inactive');
  status(await request('/api/inventory/categories', 'POST', categoryInput(category.name.toUpperCase())), 409, 'inactive categories continue reserving their canonical names');
  const categoryBeforeGeneric = await record('inventory_categories', category.id);
  for (const mode of ['create', 'set', 'update', 'delete']) {
    status(await generic([{ mode, path: 'inventory_categories/' + (mode === 'create' ? randomUUID() : category.id), data: { name: 'Bypass category', active: true, version: 99 } }]), 403, 'generic ' + mode + ' cannot bypass category endpoint');
  }
  check(await record('inventory_categories', category.id) === categoryBeforeGeneric, 'generic denial preserves canonical definition');
  for (const categoryId of [category.id, null]) {
    const value = itemInput(categoryId);
    status(await generic([{ mode: 'create', path: 'inventory_items/' + value.id, data: value }]), 403, 'generic item create rejects canonical category metadata');
    check(!(await db.collection('inventory_items').doc(value.id).get()).exists, 'generic canonical bypass creates no item');
  }
  status(await generic([{ mode: 'update', path: 'inventory_items/' + linked.id, data: { categoryId: null, category: 'Bypass' } }]), 403, 'generic item update cannot unlink category');
  const reactivated = update(category, { active: true });
  category = status(await request('/api/inventory/categories/' + category.id, 'PATCH', reactivated), 200, 'reactivate category');
  check(category.version === 4 && category.active, 'reactivation retains ID and advances version');
  const concurrentEdits = await Promise.all([
    request('/api/inventory/categories/' + category.id, 'PATCH', update(category, { name: 'Synthetic winning rename' })),
    request('/api/inventory/categories/' + category.id, 'PATCH', update(category, { active: false })),
  ]);
  check(concurrentEdits.filter(r => r.status === 200).length === 1 && concurrentEdits.filter(r => r.status === 409).length === 1, 'simultaneous rename/deactivation cannot silently overwrite one another');
  const delegated = status(await request('/api/inventory/categories', 'POST', categoryInput('Synthetic delegated category'), 'granted'), 201, 'explicit inventory management grant permits category management');
  check(delegated.version === 1 && await record('users', 'granted') === grantsBefore && await record('users', 'ordinary') === ordinaryBefore, 'managing categories does not grant or rewrite account permissions');
  status(await request('/api/inventory?branchId=B', 'GET', undefined, 'granted'), 403, 'category manager remains restricted to assigned stock branches');
  check(await record('inventory_items', 'legacy-item') === legacyItem && await record('inventory_stocks', 'legacy-stock') === legacyStock, 'category changes preserve exact historical item text and stock quantity');
  check(JSON.stringify((await pool.query('SELECT * FROM inventory_movements ORDER BY id')).rows) === legacyHistory, 'category changes do not rewrite stock movement history');
  check((await overview()).items.find((i: any) => i.id === 'legacy-item').category === 'Original free text', 'legacy category text remains visible unchanged');
  const lock = await pool.connect();
  try {
    await lock.query('BEGIN; SELECT pg_advisory_xact_lock(78194602)');
    const queued = request('/api/inventory/categories', 'POST', categoryInput('Synthetic revoked queued category'), 'granted');
    let waiting = false;
    for (let i = 0; i < 200; i++) {
      waiting = Number((await pool.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count) > 0;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    check(waiting, 'category permission revocation is queued at a real transaction boundary');
    await pool.query("UPDATE app_records SET data=data||'{\"permissionOverrides\":{\"inventory.view\":\"allow\",\"inventory.manage\":\"deny\"},\"accessRevision\":2}'::jsonb WHERE collection_path='users' AND id='granted'");
    await lock.query('COMMIT'); status(await queued, 403, 'queued category write rechecks revoked management permission');
  } finally { await lock.query('ROLLBACK'); lock.release(); }
  check((await db.collection('inventory_categories').where('name', '==', 'Synthetic revoked queued category').get()).empty, 'revoked queued category creates no definition');
  console.log(`Inventory categories API: ${checks} checks passed (real HTTP, guarded synthetic PostgreSQL; no production access).`);
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await pool.end(); }
