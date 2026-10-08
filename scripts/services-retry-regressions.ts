import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Shared by the real HTTP suite and read-only negative-control reconstructions.
export async function servicesRetryRegressions(request: any, pool: any, db: any, check: (value: any, message: string) => void) {
  const categoryId = 'a0b1c2d3-e4f5-4678-9abc-def012345678';
  const otherCategoryId = randomUUID();
  for (const id of [categoryId, otherCategoryId]) check((await request('/api/service-categories', 'POST', { id: id.toUpperCase(), name: `Retry category ${id}` })).status === 201, 'uppercase category create');
  check((await request('/api/service-categories', 'POST', { id: categoryId, name: `Retry category ${categoryId}` })).status === 200, 'category ID canonical retry');
  for (const branchId of ['aa', 'ZZ', 'Aa']) await db.collection('branches').doc(branchId).set({ branchName: `Synthetic retry ${branchId}`, status: 'Active' });
  const payload = { id: 'f0e1d2c3-b4a5-4678-9abc-def012345678', name: 'Retry Identity', categoryId, description: ' Description ', defaultDurationMinutes: 30, standardPrice: { mode: 'priced', amount: '00100.0' }, active: true,
    branchSettings: [{ branchId: 'aa', available: true, price: { mode: 'inherit' } }, { branchId: 'ZZ', available: false, price: { mode: 'free' } }] };
  const first = await request('/api/services', 'POST', { ...payload, id: payload.id.toUpperCase() });
  check(first.status === 201, 'uppercase service/category UUID create');
  check(first.body.id === payload.id && first.body.category_id === categoryId, 'SQL returns canonical UUIDs');
  check(first.body.branchSettings.map((row: any) => row.branch_id).join() !== payload.branchSettings.map(row => row.branchId).join(), 'SQL ordering differs from submitted mixed-case ordering');
  const failures: string[] = [];
  const statusCheck = (name: string, actual: number, expected: number) => {
    console.log(`Retry regression: ${name}, expected=${expected}, actual=${actual}`);
    if (actual !== expected) failures.push(name); else check(true, name);
  };
  const uuidOnly = { ...payload, id: randomUUID(), name: 'UUID-only retry', categoryId: categoryId.toUpperCase(), branchSettings: [] };
  check((await request('/api/services', 'POST', uuidOnly)).status === 201, 'uppercase category-only create');
  statusCheck('category UUID lowercase retry without branches', (await request('/api/services', 'POST', { ...uuidOnly, categoryId })).status, 200);
  statusCheck('category UUID uppercase retry without branches', (await request('/api/services', 'POST', uuidOnly)).status, 200);
  statusCheck('materially different UUID without branches', (await request('/api/services', 'POST', { ...uuidOnly, categoryId: otherCategoryId })).status, 409);
  const auditBefore = (await pool.query("SELECT count(*)::int n FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [payload.id])).rows[0].n;
  const scenarios = [
    ['UUID casing', { ...payload, categoryId: categoryId.toUpperCase() } , 200],
    ['identical mixed-case branches', payload, 200],
    ['reversed branches', { ...payload, categoryId, branchSettings: [...payload.branchSettings].reverse() }, 200],
    ['normalized name/description/price', { ...payload, name: '\tRETRY   Identity\n', description: 'Description', standardPrice: { mode: 'priced', amount: '100.00' } }, 200],
    ['different category', { ...payload, categoryId: otherCategoryId }, 409],
    ['changed availability', { ...payload, branchSettings: [{ ...payload.branchSettings[0], available: false }, payload.branchSettings[1]] }, 409],
    ['changed price mode', { ...payload, branchSettings: [{ ...payload.branchSettings[0], price: { mode: 'free' } }, payload.branchSettings[1]] }, 409],
    ['changed price amount', { ...payload, branchSettings: [{ ...payload.branchSettings[0], price: { mode: 'priced', amount: '12.00' } }, payload.branchSettings[1]] }, 409],
    ['missing row', { ...payload, branchSettings: payload.branchSettings.slice(0, 1) }, 409],
    ['extra row', { ...payload, branchSettings: [...payload.branchSettings, { branchId: 'Aa', available: true, price: { mode: 'inherit' } }] }, 409],
    ['exact branch identity', { ...payload, branchSettings: [{ ...payload.branchSettings[0], branchId: 'Aa' }, payload.branchSettings[1]] }, 409],
    ['different duration', { ...payload, defaultDurationMinutes: 31 }, 409],
    ['different active status', { ...payload, active: false }, 409],
    ['different standard price mode', { ...payload, standardPrice: { mode: 'free' } }, 409],
    ['different standard price amount', { ...payload, standardPrice: { mode: 'priced', amount: '101' } }, 409],
    ['different description', { ...payload, description: 'Different' }, 409],
    ['different name', { ...payload, name: 'Different retry name' }, 409],
  ] as const;
  for (const [name, body, expected] of scenarios) {
    const result = await request('/api/services', 'POST', body);
    statusCheck(name, result.status, expected);
  }
  check((await pool.query('SELECT count(*)::int n FROM services WHERE id=$1', [payload.id])).rows[0].n === 1, 'no duplicate service');
  check((await pool.query('SELECT count(*)::int n FROM service_branch_settings WHERE service_id=$1', [payload.id])).rows[0].n === 2, 'no duplicate branch settings');
  check((await pool.query("SELECT count(*)::int n FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [payload.id])).rows[0].n === auditBefore, 'no duplicate retry/conflict audits');
  // Concurrent equivalent create attempts serialize to one create and one replay.
  const concurrent = { ...payload, id: randomUUID(), name: 'Concurrent equivalent retry' };
  const race = await Promise.all([request('/api/services', 'POST', concurrent), request('/api/services', 'POST', { ...concurrent, categoryId, branchSettings: [...concurrent.branchSettings].reverse() })]);
  const concurrentEquivalent = race.map((r: any) => r.status).sort().join() === '200,201';
  if (concurrentEquivalent) check(true, 'concurrent equivalent create'); else failures.push('concurrent equivalent create');
  check((await pool.query("SELECT count(*)::int n FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1 AND data->>'eventType'='service_created'", [concurrent.id])).rows[0].n === 1, 'concurrent create has one create audit');
  assert.deepEqual(failures, [], 'Services equivalent retry regressions');
}
