import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { assertCurrentMigrationChain } from './platform-test-support';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const origin = new URL(process.env.APP_URL || 'https://invalid').origin;
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_package_catalogue_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
  || process.env.NODE_ENV !== 'production' || !new URL(origin).hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use empty disposable loopback vine_package_catalogue_test, production middleware, .invalid APP_URL and temporary STORAGE_DIR');
}
let server: ReturnType<typeof app.listen> | undefined, checks = 0, slot = 0;
const sessions = new Map<string, { cookie: string; csrf: string }>();
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
async function request(route: string, method = 'GET', body?: any, actor = 'admin', extra: Record<string, string> = {}) {
  const auth = sessions.get(actor);
  const r = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: auth.cookie, Authorization: `Bearer ${auth.csrf}` } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function status(r: { status: number; body: any }, expected: number, label: string) {
  check(r.status === expected, `${label}: expected ${expected}, got ${r.status}: ${JSON.stringify(r.body)?.slice(0, 700)}`); return r.body;
}
const base = '/api/records/patients/patient/treatment-ledger';
const current = async (id: string, branchId = 'A', actor = 'admin') => status(await request(`/api/packages/${id}?branchId=${branchId}`, 'GET', undefined, actor), 200, 'read package detail');
const ledger = async (actor = 'admin') => status(await request(base, 'GET', undefined, actor), 200, 'read ledger');
const savedPurchase = (value: any, id: string) => value.purchases.find((p: any) => p.id === id);
const purchaseBody = (p: any, branchId = 'A', extra: any = {}) => ({ commandId: randomUUID(), expectedVersion: 0, branchId, purchaseDate: '2037-01-02', notes: 'Synthetic purchase notes',
  catalogueSelection: { packageId: p.id, expectedVersion: p.version, serviceVersions: p.lines.map((l: any) => ({ serviceId: l.serviceId, expectedServiceVersion: l.currentServiceVersion })) }, ...extra });
const edit = (p: any, extra: any = {}) => ({ id: p.id, commandId: randomUUID(), expectedVersion: p.version, name: p.name, description: p.description, active: p.active,
  lines: p.lines.map((l: any) => ({ serviceId: l.serviceId, expectedServiceVersion: l.currentServiceVersion, sessions: l.sessions })), ...extra });
const visit = (service: any, line: any, sessions = 1) => {
  const index = slot++;
  return { clientVisitId: randomUUID(), patientId: 'patient', branchId: 'B', doctorId: null, performedByUserId: 'nurse',
    visitType: 'Treatment Session', visitDate: `2037-02-01T${String(10 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
    notes: 'Synthetic Visit note', serviceSelection: { serviceId: service.serviceId, expectedVersion: service.currentServiceVersion },
    sessionUsage: { commandId: randomUUID(), lineId: line.id, sessions, expectedLineVersion: line.version, expectedUsageVersion: 0 } };
};
try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'API suite requires an empty disposable database');
  await migrateDatabase(); await migrateDatabase();
  check(await assertCurrentMigrationChain(), 'complete current checksummed migration chain');
  for (const [id, state] of [['A', 'Active'], ['B', 'Active'], ['I', 'Inactive']]) await db.collection('branches').doc(id).set({ branchName: 'Synthetic clinic ' + id, status: state });
  for (const [id, fields] of Object.entries({
    admin: { role: 'admin', assignedBranches: ['A', 'B'] },
    staffA: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] },
    staffB: { role: 'staff', staffDesignation: 'Medical Staff', assignedBranches: ['B'] },
    doctor: { role: 'doctor', assignedBranches: ['A'] },
    inactive: { role: 'admin', active: false, assignedBranches: ['A'] },
    deniedView: { role: 'admin', permissionOverrides: { 'packages.view': 'deny' } },
    deniedServices: { role: 'admin', permissionOverrides: { 'services.view': 'deny' } },
    deniedManage: { role: 'admin', permissionOverrides: { 'packages.manage': 'deny' } },
    deniedClinical: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'clinical.view': 'deny' } },
    granted: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'packages.manage': 'allow' } },
  })) {
    await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic ' + id, ...fields });
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  await db.collection('users').doc('nurse').set({ role: 'staff', staffDesignation: 'Nurse', active: true, fullName: 'Synthetic performer', assignedBranches: ['A', 'B'] });
  await db.collection('patients').doc('patient').set({ name: 'Synthetic package patient', patientID: 'SYNTHETIC', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const services = [];
  for (const name of ['Synthetic facial', 'Synthetic laser']) {
    services.push(status(await request('/api/services', 'POST', { id: randomUUID(), name, description: '', defaultDurationMinutes: 30, standardPrice: { mode: 'free' },
      branchSettings: [{ branchId: 'A', available: true, price: { mode: 'inherit' } }, { branchId: 'B', available: true, price: { mode: 'priced', amount: '9876543.21' } }] }), 201, 'create synthetic Service'));
  }
  const payload = { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, name: '  Synthetic   starter package  ', description: 'Original synthetic terms', active: true,
    lines: services.map((s, i) => ({ serviceId: s.id, expectedServiceVersion: s.version, sessions: i ? 2 : 3 })) };
  status(await request('/api/packages', 'GET', undefined, 'anonymous'), 401, 'catalogue requires session');
  for (const actor of ['inactive', 'deniedView', 'deniedServices']) status(await request('/api/packages', 'GET', undefined, actor), 403, actor + ' cannot read catalogue');
  for (const actor of ['staffA', 'staffB', 'doctor', 'deniedManage']) status(await request('/api/packages', 'POST', payload, actor), 403, actor + ' cannot manage definitions');
  status(await request('/api/packages', 'POST', payload, 'admin', { Origin: 'https://wrong.invalid' }), 403, 'package write enforces origin');
  status(await request('/api/packages', 'POST', payload, 'admin', { Authorization: 'Bearer wrong' }), 403, 'package write enforces CSRF');
  let p = status(await request('/api/packages', 'POST', payload), 201, 'create package');
  check(p.version === 1 && p.name === 'Synthetic starter package' && p.lines.length === 2 && p.actor.uid === 'admin', 'server derives version/author and normalizes package name');
  check(!JSON.stringify(p).includes('9876543.21') && !Object.hasOwn(p, 'price'), 'catalogue exposes no branch price amounts');
  const replay = status(await request('/api/packages', 'POST', payload), 200, 'repeat create returns original command');
  check(replay.replayed && (await pool.query('SELECT count(*) FROM package_catalogue_versions')).rows[0].count === '1', 'create retry makes one immutable version');
  status(await request('/api/packages', 'POST', { ...payload, name: 'Changed command content' }), 409, 'command reuse with changed content conflicts');
  status(await request('/api/packages', 'POST', { ...payload, commandId: randomUUID() }), 409, 'same identifier cannot create another definition');
  status(await request('/api/packages', 'POST', { ...payload, id: randomUUID(), commandId: randomUUID(), name: 'synthetic STARTER\tpackage' }), 409, 'canonical name uniqueness includes whitespace/case');
  for (const extra of [ { price: 99 }, { name: ' ' }, { description: 'x'.repeat(2001) }, { active: 'yes' },
    { lines: [] }, { lines: [{ ...payload.lines[0], sessions: 0 }] }, { lines: [{ ...payload.lines[0], sessions: 1.5 }] },
    { lines: [{ ...payload.lines[0], sessions: 10001 }] }, { lines: [payload.lines[0], payload.lines[0]] },
    { lines: [{ ...payload.lines[0], serviceNameSnapshot: 'Spoofed' }] }, { expectedVersion: undefined } ]) {
    status(await request('/api/packages', 'POST', { ...payload, id: randomUUID(), commandId: randomUUID(), name: 'Synthetic invalid ' + randomUUID(), ...extra }), 400, 'invalid catalogue fields rejected');
  }
  status(await request('/api/packages', 'POST', { ...payload, id: randomUUID(), commandId: randomUUID(), name: 'Synthetic stale', lines: [{ ...payload.lines[0], expectedServiceVersion: 999 }] }), 409, 'Service versions verified for definition');
  const list = status(await request('/api/packages?branchId=A&selectableOnly=true', 'GET', undefined, 'staffA'), 200, 'authorized eligible package list');
  check(list.total === 1 && list.packages[0].eligible === true && !JSON.stringify(list).includes('9876543.21'), 'eligible list is filtered and has no unauthorized prices');
  status(await request('/api/packages?branchId=B', 'GET', undefined, 'staffA'), 403, 'foreign branch list denied');
  status(await request(`/api/packages/${p.id}?branchId=B`, 'GET', undefined, 'staffA'), 403, 'foreign branch detail denied');
  status(await request('/api/packages?selectableOnly=true'), 400, 'selectable lookup requires branch');
  status(await request('/api/packages?branchId=I&selectableOnly=true'), 200, 'inactive clinic can return empty eligibility list');
  check(status(await request('/api/packages?branchId=I&selectableOnly=true'), 200, 'read inactive clinic eligibility').total === 0, 'inactive clinic has no newly selectable packages');
  check(status(await request('/api/packages?q=not-matched'), 200, 'search packages').total === 0, 'name search filters');
  p = await current(p.id);
  const manualInput = { commandId: randomUUID(), expectedVersion: 0, packageName: 'Existing manual arrangement', purchaseDate: '2036-12-31', branchId: 'A', notes: 'Old manual note',
    lines: [{ serviceId: services[0].id, expectedServiceVersion: services[0].version, purchasedSessions: 7 }] };
  const manualResult = status(await request(base + '/purchases', 'POST', manualInput), 201, 'manual purchase unchanged');
  const manual = manualResult.purchases[0]; check(manual.catalogue === null && manual.lines[0].remainingSessions === 7, 'manual source needs no conversion');
  const originalManual = JSON.stringify(manual);
  status(await request(base + '/purchases', 'POST', purchaseBody(p, 'B'), 'staffA'), 403, 'catalogue permission does not grant branch purchase scope');
  status(await request(base + '/purchases', 'POST', purchaseBody(p), 'doctor'), 403, 'catalogue viewing does not grant Ledger purchase');
  status(await request(base + '/purchases', 'POST', purchaseBody(p), 'deniedClinical'), 403, 'clinical denial still protects Ledger');
  status(await request(base + '/purchases', 'POST', purchaseBody(p), 'deniedView'), 403, 'catalogue selection respects explicit catalogue denial');
  status(await request(base + '/purchases', 'POST', purchaseBody(p, 'A', { orNumber: '000001' }), 'staffA'), 403, 'Staff cannot set OR');
  status(await request(base + '/purchases', 'POST', purchaseBody(p, 'A', { packageName: 'Override' })), 400, 'catalogue name cannot be overridden');
  status(await request(base + '/purchases', 'POST', purchaseBody(p, 'A', { lines: manualInput.lines })), 400, 'catalogue sessions cannot be overridden');
  status(await request(base + '/purchases', 'POST', { ...purchaseBody(p), catalogueSelection: { packageId: p.id, expectedVersion: p.version, serviceVersions: [] } }), 400, 'all Service versions required');
  const boughtInput = purchaseBody(p, 'A', { orNumber: '0000005' });
  const boughtResult = status(await request(base + '/purchases', 'POST', boughtInput), 201, 'record catalogue purchase');
  const bought = boughtResult.purchases.find((item: any) => item.catalogue?.packageId === p.id);
  check(bought.packageName === p.name && bought.catalogue.version === 1 && bought.purchaseDate === '2037-01-02' && bought.orNumber === '0000005', 'purchase freezes package version/date and leading-zero OR');
  check(bought.lines.every((l: any) => l.remainingSessions === p.lines.find((r: any) => r.serviceId === l.serviceId).sessions), 'allowances come from immutable server terms');
  const oldPurchase = JSON.stringify(bought);
  const changed = edit(p, { name: 'Synthetic revised package', lines: p.lines.map((l: any) => ({ serviceId: l.serviceId, expectedServiceVersion: l.currentServiceVersion, sessions: 9 })) });
  p = status(await request('/api/packages/' + p.id, 'PATCH', changed), 200, 'create next package version');
  check(p.version === 2, 'edit advances one version');
  status(await request('/api/packages/' + p.id, 'PATCH', changed), 200, 'same edit retries once');
  status(await request('/api/packages/' + p.id, 'PATCH', { ...changed, commandId: randomUUID() }), 409, 'concurrent old-version edit denied');
  check(JSON.stringify(savedPurchase(await ledger(), bought.id)) === oldPurchase, 'catalogue edits preserve historical purchase and balances');
  check(JSON.stringify(savedPurchase(await ledger(), manual.id)) === originalManual, 'catalogue edits preserve existing manual purchase');
  const countBefore = (await pool.query('SELECT count(*) FROM treatment_ledger_purchases')).rows[0].count;
  status(await request(base + '/purchases', 'POST', boughtInput), 200, 'lost response retry succeeds after catalogue changed');
  check((await pool.query('SELECT count(*) FROM treatment_ledger_purchases')).rows[0].count === countBefore, 'purchase replay creates no duplicate purchase');
  status(await request(base + '/purchases', 'POST', { ...boughtInput, commandId: randomUUID() }), 409, 'new stale selection must review current version');
  p = await current(p.id);
  const newBuy = status(await request(base + '/purchases', 'POST', purchaseBody(p)), 201, 'new purchase uses reviewed terms');
  check(newBuy.purchases.some((r: any) => r.catalogue?.version === 2 && r.lines.every((l: any) => l.purchasedSessions === 9)), 'new terms apply to new purchases only');
  p = status(await request('/api/packages/' + p.id, 'PATCH', edit(p, { active: false })), 200, 'deactivate by new version');
  check(p.version === 3 && !p.active, 'deactivation retains version history');
  check(status(await request('/api/packages?branchId=A&selectableOnly=true'), 200, 'inactive selection filter').total === 0, 'inactive package not selectable');
  status(await request(base + '/purchases', 'POST', purchaseBody(await current(p.id))), 409, 'direct inactive purchase denied');
  status(await request(base + '/purchases', 'POST', boughtInput), 200, 'successful purchase replay retained after deactivation');
  const history = status(await request('/api/packages/' + p.id + '/versions'), 200, 'read immutable history');
  check(history.total === 3 && history.versions[2].name === 'Synthetic starter package' && history.versions[2].lines.some((l: any) => l.sessions === 3), 'prior terms remain readable');
  const redeemService = history.versions[2].lines.find((l: any) => l.sessions === 3);
  let owned = savedPurchase(await ledger('staffB'), bought.id);
  check(owned.metadataRedacted && owned.notes === '' && owned.orNumber === null, 'foreign origin notes/OR remain redacted');
  let ownedLine = owned.lines.find((l: any) => l.serviceId === redeemService.serviceId);
  const v = visit(redeemService, ownedLine);
  status(await request('/api/records/visits', 'POST', v, 'staffB'), 201, 'redeem purchased sessions in another authorized branch after catalogue deactivation');
  status(await request('/api/records/visits', 'POST', v, 'staffB'), 200, 'Visit retry remains idempotent');
  owned = savedPurchase(await ledger(), bought.id); ownedLine = owned.lines.find((l: any) => l.id === ownedLine.id);
  check(ownedLine.remainingSessions === 2 && ownedLine.usedSessions === 1, 'one Visit retry deducts once');
  const results = await Promise.all([request('/api/records/visits', 'POST', visit(redeemService, ownedLine, 2), 'staffB'), request('/api/records/visits', 'POST', visit(redeemService, ownedLine, 2), 'staffB')]);
  check(results.filter(r => r.status === 201).length === 1 && results.filter(r => r.status === 409).length === 1, 'concurrent redemptions cannot overspend catalogue purchase');
  ownedLine = savedPurchase(await ledger(), bought.id).lines.find((l: any) => l.id === ownedLine.id);
  check(ownedLine.remainingSessions === 0 && ownedLine.usedSessions === 3, 'catalogue purchase uses existing balance invariants');
  status(await request(base + '/purchases/' + bought.id, 'PATCH', { commandId: randomUUID(), expectedVersion: bought.version, notes: 'Forbidden cross-branch edit' }, 'staffB'), 403, 'origin branch metadata restriction retained');
  const latestBought = savedPurchase(await ledger(), bought.id);
  status(await request(base + '/purchases/' + bought.id, 'PATCH', { commandId: randomUUID(), expectedVersion: latestBought.version, notes: 'Revised synthetic purchase note', orNumber: '0000006' }), 200, 'existing revisioned notes/OR update supports catalogue purchase');
  const rejectSql = async (sql: string, args: any[]) => { await assert.rejects(pool.query(sql, args), (e: any) => ['23514', '23503'].includes(e.code)); checks++; };
  await rejectSql('UPDATE package_catalogue_versions SET name=$2 WHERE package_id=$1', [p.id, 'Rewrite history']);
  await rejectSql('DELETE FROM package_catalogue_versions WHERE package_id=$1', [p.id]);
  await rejectSql('UPDATE package_catalogue_lines SET sessions=99 WHERE package_id=$1', [p.id]);
  await rejectSql('DELETE FROM package_catalogue_lines WHERE package_id=$1', [p.id]);
  await rejectSql('INSERT INTO package_catalogue_lines(package_id,version,service_id,service_name_snapshot,service_catalogue_version,sessions) VALUES($1,1,$2,\'Extra\',1,2)', [p.id, services[0].id]);
  await rejectSql('UPDATE package_catalogue SET version=version+2 WHERE id=$1', [p.id]);
  await rejectSql('UPDATE treatment_ledger_purchases SET catalogue_package_version=2,version=version+1 WHERE id=$1', [bought.id]);
  const beforeGeneric = (await pool.query('SELECT count(*) FROM package_catalogue')).rows[0].count;
  status(await request('/api/data/write', 'POST', { operations: [{ mode: 'set', path: 'package_catalogue/' + p.id, data: { active: true } }] }), 403, 'generic writes cannot bypass catalogue API');
  check((await pool.query('SELECT count(*) FROM package_catalogue')).rows[0].count === beforeGeneric, 'generic denial preserves catalogue');
  p = await current(p.id); p = status(await request('/api/packages/' + p.id, 'PATCH', edit(p, { active: true })), 200, 'reactivate through next version');
  const staleServiceInput = purchaseBody(p);
  await pool.query('UPDATE services SET version=version+1 WHERE id=$1', [p.lines[0].serviceId]);
  status(await request(base + '/purchases', 'POST', staleServiceInput), 409, 'new catalogue purchase validates current Service versions');
  p = await current(p.id);
  status(await request(base + '/purchases', 'POST', purchaseBody(p)), 201, 'reviewed current Service versions accepted');
  await pool.query('UPDATE service_branch_settings SET available=false WHERE service_id=$1 AND branch_id=\'A\'', [p.lines[0].serviceId]);
  check(status(await request('/api/packages?branchId=A&selectableOnly=true'), 200, 'availability filter').total === 0, 'unavailable included Service blocks entire new package');
  status(await request(base + '/purchases', 'POST', purchaseBody(p)), 409, 'direct purchase rechecks branch availability');
  await pool.query('UPDATE service_branch_settings SET available=true WHERE service_id=$1 AND branch_id=\'A\'', [p.lines[0].serviceId]);
  await pool.query('UPDATE services SET standard_price=NULL WHERE id=$1', [p.lines[0].serviceId]);
  status(await request(base + '/purchases', 'POST', purchaseBody(p)), 409, 'unpriced Service cannot be newly purchased through catalogue');
  await pool.query('UPDATE services SET standard_price=0 WHERE id=$1', [p.lines[0].serviceId]);
  const grantedBody = { ...payload, id: randomUUID(), commandId: randomUUID(), name: 'Explicitly delegated package', lines: [{ serviceId: services[1].id, expectedServiceVersion: p.lines.find((l: any) => l.serviceId === services[1].id).currentServiceVersion, sessions: 1 }] };
  status(await request('/api/packages', 'POST', grantedBody, 'granted'), 201, 'explicit catalogue management grant uses existing hybrid policy');
  const lock = await pool.connect();
  try {
    await lock.query('BEGIN; SELECT pg_advisory_xact_lock(78194602)');
    const pending = request('/api/packages', 'POST', { ...grantedBody, id: randomUUID(), commandId: randomUUID(), name: 'Queued denied package' }, 'granted');
    for (let i = 0; i < 100; i++) {
      const waiting = (await pool.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count;
      if (Number(waiting) > 0) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await pool.query("UPDATE app_records SET data=data||'{\"permissionOverrides\":{\"packages.manage\":\"deny\"},\"accessRevision\":2}'::jsonb WHERE collection_path='users' AND id='granted'");
    await lock.query('COMMIT'); status(await pending, 403, 'queued write rechecks current permission after lock');
  } finally { await lock.query('ROLLBACK'); lock.release(); }
  check(!(await pool.query("SELECT 1 FROM package_catalogue WHERE name='Queued denied package'")).rowCount, 'revoked queued command creates no package');
  console.log(`Package catalogue API: ${checks} checks passed (synthetic disposable PostgreSQL; no production access).`);
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await pool.end(); }
