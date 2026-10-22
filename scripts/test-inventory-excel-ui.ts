import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

const savedExcel = globals.inventoryTestExcel;
const harness = await buildControlledForms(['InventoryDashboard'], process.cwd(), { exposePermissionState: true, useProductionInvalidation: true, mockInventoryExcel: true });
const item = { id: 'cream', name: 'Synthetic cream', sku: 'SYN-CREAM', category: 'Consumables', unit: 'bottle', lowStockThreshold: 2 };
const importRows = [{ rowNumber: 2, name: 'New synthetic vial', sku: 'NEW-VIAL', category: 'Consumables', unit: 'vial', lowStockThreshold: 1, openingQuantity: 2.125 }];
const overview = (branch = 'A', extra: any = {}) => ({
  categories: [], items: [item], suppliers: [{ id: 'supplier', name: 'Synthetic supplier', contactPerson: 'Synthetic contact', email: 'supplier@example.invalid', phone: '123' }],
  branches: ['A', 'B'].map(id => ({ id, branchName: 'Synthetic branch ' + id, status: 'Active' })),
  stocks: [{ itemId: item.id, branchId: branch, quantity: 10, version: 4 }], transfers: [], ...extra,
});
const preview = (rows = importRows, statuses = rows.map(() => 'ready'), hash = 'preview-001') => ({
  previewHash: hash, rows: rows.map((row, index) => ({ ...row, status: statuses[index], message: 'Synthetic row result' })),
  readyCount: statuses.filter(status => status === 'ready').length,
  skippedCount: statuses.filter(status => status === 'skip').length,
  errorCount: statuses.filter(status => status === 'error').length,
});
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: any) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Fixture {
  renderer: Renderer; props: any; profile: any; requests: any[] = [];
  reads: any[] = []; templates: any[] = []; writes: any[] = []; downloads: any[] = [];
  constructor() {
    globals.servicesTestInvalidations = 0;
    globals.servicesTestAuth.currentUser = { uid: 'account', getRequestToken: async () => 'synthetic' };
    globals.window.confirm = () => false;
    this.profile = { id: 'account', role: 'admin', active: true, assignedBranches: ['A', 'B'], accessRevision: 1 };
    harness.modules.InventoryDashboard.publishPermissionProfile(this.profile);
    globals.fetch = (url: string, init: any) => new Promise((resolve, reject) => this.requests.push({ url, init,
      deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })),
      fail: () => reject(new TypeError('Synthetic lost response')),
    }));
    globals.inventoryTestExcel = {
      read: (file: any) => { const task = deferred<any>(); this.reads.push({ ...task, file }); return task.promise; },
      template: () => { const task = deferred<any>(); this.templates.push(task); return task.promise; },
      write: (...args: any[]) => { const task = deferred<any>(); this.writes.push({ ...task, args }); return task.promise; },
      download: (...args: any[]) => this.downloads.push(args),
    };
    this.renderer = new Renderer(harness.components.InventoryDashboard);
    this.props = { userProfile: this.profile, activeBranchId: 'A' };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let index = 0; index < 12; index++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); if (this.renderer.dirty) this.render(); } }
  async loaded(data = overview()) { this.render(); await this.settle(); this.requests[0].deliver(data); await this.settle(); }
  button(label: string) { const node = find(this.renderer.tree, node => node.type === 'button' && text(node).trim() === label); assert.ok(node, 'Missing button ' + label); return node; }
  has(label: string) { return !!find(this.renderer.tree, node => node.type === 'button' && text(node).trim() === label); }
  field(label: string) { const node = find(this.renderer.tree, node => node.type === 'label' && text(find(node.props.children, child => child.type === 'span')).startsWith(label)); assert.ok(node, 'Missing field ' + label); const field = find(node.props.children, child => ['input', 'select', 'textarea'].includes(child.type)); assert.ok(field); return field; }
  async click(label: string) { const node = this.button(label); if (!node.props.disabled) node.props.onClick(); await this.settle(); }
  async change(label: string, value: string) { this.field(label).props.onChange({ target: { value } }); await this.settle(); }
  async choose(name = 'synthetic.xlsx', size = 100) { this.field('Excel file').props.onChange({ target: { files: [{ name, size }], value: name } }); await this.settle(); }
  async openImport() { await this.loaded(); await this.click('Import Excel'); }
  async ready(rows = importRows, statuses = rows.map(() => 'ready')) { await this.openImport(); await this.choose(); this.reads.at(-1).resolve(rows); await this.settle(); this.requests.at(-1).deliver(preview(rows, statuses)); await this.settle(); }
  async submit() { const form = find(this.renderer.tree, node => node.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); await this.settle(); }
  async commit() { await this.ready(); await this.change('Import notes', ' KEEP IMPORT NOTES '); await this.change('Opening stock date', '2035-01-01T09:30'); await this.submit(); return this.requests.at(-1); }
  async exportReady(data = overview()) { await this.click('Export Excel'); this.requests.at(-1).deliver(data); await this.settle(); assert.equal(this.writes.length, 1); return this.writes[0]; }
  permission(extra: any, render = true) { this.profile = { ...this.profile, ...extra }; this.props.userProfile = this.profile; harness.modules.InventoryDashboard.publishPermissionProfile(this.profile); if (render) this.render(); }
  async branch() { this.props.activeBranchId = 'B'; this.render(); await this.settle(); }
  account(render = false) { globals.servicesTestAuth.currentUser = { uid: 'different-account', getRequestToken: async () => 'different' }; if (render) this.render(); }
  stop() { this.renderer.unmount(); }
}
const results: { name: string; passed: boolean; error?: string }[] = [];
async function check(name: string, run: (fixture: Fixture) => Promise<void>) {
  const f = new Fixture();
  try { await run(f); results.push({ name, passed: true }); }
  catch (error: any) { results.push({ name, passed: false, error: error.message }); }
  finally { f.stop(); }
}
try {
  await check('read-only inventory can export but cannot import', async f => {
    f.permission({ role: 'staff', permissionOverrides: { 'inventory.view': 'allow' } }); await f.loaded();
    assert.ok(f.has('Export Excel')); assert.ok(!f.has('Import Excel'));
  });
  await check('explicit inventory denial offers neither spreadsheet action', async f => {
    f.permission({ permissionOverrides: { 'inventory.view': 'deny' } }); f.render(); await f.settle();
    assert.ok(!f.has('Export Excel') && !f.has('Import Excel')); assert.equal(f.requests.length, 0);
  });
  await check('inactive branch import is disabled while reference export remains available', async f => {
    await f.loaded(overview('A', { branches: [{ id: 'A', branchName: 'Inactive clinic', status: 'Inactive' }] }));
    assert.ok(f.button('Import Excel').props.disabled); assert.ok(!f.button('Export Excel').props.disabled);
  });
  await check('template downloads through the guarded import workflow', async f => {
    await f.openImport(); await f.click('Download Excel template'); assert.equal(f.templates.length, 1);
    f.templates[0].resolve(new Uint8Array([1, 2])); await f.settle();
    assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0][1], 'vine-inventory-import-template.xlsx');
  });
  await check('template failure remains retryable without clearing import notes', async f => {
    await f.openImport(); await f.change('Import notes', 'KEEP'); await f.click('Download Excel template');
    f.templates[0].reject(new Error('Synthetic template failure')); await f.settle();
    assert.match(text(f.renderer.tree), /Synthetic template failure/); assert.equal(f.field('Import notes').props.value, 'KEEP'); assert.ok(!f.button('Download Excel template').props.disabled);
  });
  await check('unsupported file extension never reaches the workbook parser or API', async f => {
    await f.openImport(); await f.choose('synthetic.xls'); assert.equal(f.reads.length, 0); assert.equal(f.requests.length, 1); assert.match(text(f.renderer.tree), /Choose an .xlsx/);
  });
  await check('oversized workbook never reaches the parser', async f => {
    await f.openImport(); await f.choose('synthetic.xlsx', 2 * 1024 * 1024 + 1); assert.equal(f.reads.length, 0); assert.match(text(f.renderer.tree), /no larger than 2 MB/);
  });
  await check('file parse failure retains its name and notes without API mutation', async f => {
    await f.openImport(); await f.change('Import notes', 'KEEP'); await f.choose(); f.reads[0].reject(new Error('Invalid workbook contents')); await f.settle();
    assert.match(text(f.renderer.tree), /synthetic.xlsx|Invalid workbook contents/); assert.equal(f.field('Import notes').props.value, 'KEEP'); assert.equal(f.requests.length, 1);
  });
  await check('file preview sends parsed rows and selected branch to the server', async f => {
    await f.openImport(); await f.choose(); f.reads[0].resolve(importRows); await f.settle();
    const request = f.requests.at(-1); assert.equal(request.url, '/api/inventory/import/preview'); assert.equal(request.init.method, 'POST'); assert.deepEqual(JSON.parse(request.init.body), { branchId: 'A', rows: importRows });
  });
  await check('confirmed import sends reviewed hash date notes and a retry identity', async f => {
    const request = await f.commit(); const payload = JSON.parse(request.init.body);
    assert.equal(request.url, '/api/inventory/import/commit'); assert.equal(payload.branchId, 'A'); assert.deepEqual(payload.rows, importRows); assert.equal(payload.previewHash, 'preview-001');
    assert.equal(payload.occurredAt, '2035-01-01T01:30:00.000Z'); assert.equal(payload.notes, 'KEEP IMPORT NOTES'); assert.ok(payload.commandId);
    request.deliver({ importedCount: 1, skippedCount: 0, itemIds: ['new-item'] }); await f.settle();
    assert.match(text(f.renderer.tree), /Imported 1 new item/); assert.match(f.requests.at(-1).url, /branchId=A/);
  });
  await check('preview errors block all writes and keep row-level correction instructions', async f => {
    await f.ready(importRows, ['error']); assert.ok(f.button('Import 0 new items').props.disabled); const before = f.requests.length; await f.submit();
    assert.equal(f.requests.length, before); assert.match(text(f.renderer.tree), /Needs correction|Nothing has been imported/);
  });
  await check('existing SKUs-only preview does not offer a no-op import', async f => {
    await f.ready(importRows, ['skip']); assert.ok(f.button('Import 0 new items').props.disabled); const before = f.requests.length; await f.submit(); assert.equal(f.requests.length, before);
    assert.match(text(f.renderer.tree), /No new items to import/);
  });
  await check('mixed preview counts ready items and preserves skipped rows', async f => {
    const rows = [...importRows, { ...importRows[0], rowNumber: 3, sku: 'EXISTING' }]; await f.ready(rows, ['ready', 'skip']);
    assert.ok(!f.button('Import 1 new item').props.disabled); assert.match(text(f.renderer.tree), /1\s+ready.*1\s+skipped.*0\s+errors/); await f.submit(); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body).rows, rows);
  });
  await check('malformed preview is not accepted as reviewable data', async f => {
    await f.openImport(); await f.choose(); f.reads[0].resolve(importRows); await f.settle(); f.requests.at(-1).deliver({ ...preview(), readyCount: 2 }); await f.settle();
    assert.match(text(f.renderer.tree), /preview could not be loaded/); assert.ok(f.button('Import 0 new items').props.disabled);
  });
  await check('changed-preview conflict preserves file notes and permits an explicit new preview', async f => {
    const request = await f.commit(); const oldPayload = JSON.parse(request.init.body); request.deliver({ error: 'Preview changed', code: 'IMPORT_PREVIEW_CHANGED' }, 409); await f.settle();
    assert.match(text(f.renderer.tree), /Selected file:\s+synthetic.xlsx/); assert.equal(f.field('Import notes').props.value, ' KEEP IMPORT NOTES '); assert.ok(f.button('Import 0 new items').props.disabled);
    await f.click('Refresh preview'); assert.equal(f.requests.at(-1).url, '/api/inventory/import/preview'); f.requests.at(-1).deliver(preview(importRows, ['ready'], 'new-preview')); await f.settle(); await f.submit();
    const newPayload = JSON.parse(f.requests.at(-1).init.body); assert.equal(newPayload.previewHash, 'new-preview'); assert.notEqual(newPayload.commandId, oldPayload.commandId);
  });
  await check('uncertain server failure freezes editable fields and retries exactly the same command', async f => {
    const request = await f.commit(); request.deliver({ error: 'Synthetic uncertain failure' }, 500); await f.settle();
    assert.ok(find(f.renderer.tree, node => node.type === 'fieldset' && node.props.disabled)); assert.ok(f.has('Retry same import')); assert.ok(f.button('Refresh preview').props.disabled);
    await f.submit(); assert.equal(f.requests.at(-1).init.body, request.init.body);
  });
  await check('lost import response retains the exact command and confirmation guards closing', async f => {
    const request = await f.commit(); request.fail(); await f.settle(); await f.click('Cancel'); assert.ok(f.has('Retry same import'));
    await f.submit(); assert.equal(f.requests.at(-1).init.body, request.init.body);
  });
  await check('current preview denial invalidates protected data exactly once', async f => {
    await f.openImport(); await f.choose(); f.reads[0].resolve(importRows); await f.settle(); f.requests.at(-1).deliver({ error: 'Denied' }, 403); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.match(text(f.renderer.tree), /Inventory access changed/); assert.doesNotMatch(text(f.renderer.tree), /New synthetic vial/);
  });
  await check('current commit denial clears protected data exactly once', async f => {
    const request = await f.commit(); request.deliver({ error: 'Denied' }, 401); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.match(text(f.renderer.tree), /Inventory access changed/);
  });
  await check('old file parsing cannot replace a newer file selection', async f => {
    await f.openImport(); await f.choose('old.xlsx'); await f.choose('new.xlsx'); const newer = [{ ...importRows[0], name: 'NEW FILE', sku: 'NEW' }];
    f.reads[1].resolve(newer); await f.settle(); const request = f.requests.at(-1); f.reads[0].resolve([{ ...importRows[0], name: 'OLD FILE' }]); await f.settle();
    assert.equal(f.requests.at(-1), request); assert.deepEqual(JSON.parse(request.init.body).rows, newer); assert.doesNotMatch(text(f.renderer.tree), /OLD FILE/);
  });
  await check('old preview response cannot replace the newly selected file preview', async f => {
    await f.openImport(); await f.choose('old.xlsx'); f.reads[0].resolve(importRows); await f.settle(); const old = f.requests.at(-1);
    await f.choose('new.xlsx'); const newer = [{ ...importRows[0], name: 'NEW FILE', sku: 'NEW' }]; f.reads[1].resolve(newer); await f.settle(); f.requests.at(-1).deliver(preview(newer)); await f.settle(); old.deliver(preview()); await f.settle();
    assert.match(text(f.renderer.tree), /NEW FILE/); assert.doesNotMatch(text(f.renderer.tree), /New synthetic vial/); assert.equal(globals.servicesTestInvalidations, 0);
  });
  for (const mode of ['branch', 'permission', 'account', 'unmount'] as const) {
    await check(`${mode} change discards delayed workbook parsing`, async f => {
      await f.openImport(); await f.choose(); const before = f.requests.length;
      if (mode === 'branch') await f.branch(); else if (mode === 'permission') f.permission({ accessRevision: 2 }); else if (mode === 'account') f.account(); else f.stop();
      await f.settle(); const afterChange = f.requests.length; f.reads[0].resolve(importRows); await f.settle();
      assert.equal(f.requests.length, afterChange); assert.equal(f.requests.slice(before).filter(request => request.url.includes('/import/')).length, 0); assert.equal(f.renderer.lateSetters, 0);
    });
  }
  await check('branch change discards an old preview denial without invalidating current scope', async f => {
    await f.openImport(); await f.choose(); f.reads[0].resolve(importRows); await f.settle(); const old = f.requests.at(-1); await f.branch();
    old.deliver({ error: 'Old denied preview' }, 403); await f.settle(); assert.equal(globals.servicesTestInvalidations, 0); assert.doesNotMatch(text(f.renderer.tree), /Old denied preview/); assert.equal(f.renderer.lateSetters, 0);
  });
  for (const mode of ['branch', 'permission', 'account', 'unmount'] as const) {
    await check(`${mode} change discards delayed import completion or denial`, async f => {
      const request = await f.commit();
      if (mode === 'branch') await f.branch(); else if (mode === 'permission') f.permission({ accessRevision: 2 }); else if (mode === 'account') f.account(); else f.stop();
      await f.settle(); request.deliver(mode === 'permission' ? { error: 'Old commit denied' } : { importedCount: 1, skippedCount: 0, itemIds: ['stale'] }, mode === 'permission' ? 403 : 200); await f.settle();
      assert.equal(globals.servicesTestInvalidations, 0); assert.doesNotMatch(text(f.renderer.tree), /Imported 1 new item|Old commit denied/); assert.equal(f.renderer.lateSetters, 0);
    });
  }
  for (const mode of ['branch', 'account', 'unmount'] as const) {
    await check(`${mode} change discards a delayed template download`, async f => {
      await f.openImport(); await f.click('Download Excel template');
      if (mode === 'branch') await f.branch(); else if (mode === 'account') f.account(); else f.stop();
      f.templates[0].resolve(new Uint8Array([1])); await f.settle(); assert.equal(f.downloads.length, 0); assert.equal(f.renderer.lateSetters, 0);
    });
  }
  await check('export reauthorizes selected branch before constructing the workbook', async f => {
    await f.loaded(); const before = f.requests.length; await f.click('Export Excel');
    assert.equal(f.requests.length, before + 1); assert.equal(f.requests.at(-1).url, '/api/inventory?branchId=A'); assert.equal(f.writes.length, 0);
    f.requests.at(-1).deliver(overview()); await f.settle(); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].args[3].branchName, 'Synthetic branch A');
    f.writes[0].resolve(new Uint8Array([1])); await f.settle(); assert.equal(f.downloads.length, 1); assert.match(f.downloads[0][1], /^vine-inventory-stocks-A-/);
  });
  await check('stock export follows visible filters and sort but uses freshly authorized branch balances', async f => {
    const entries = [item, { ...item, id: 'zinc', name: 'Synthetic zinc', sku: 'ZINC' }, { ...item, id: 'other', name: 'Other item', category: 'Other' }];
    await f.loaded(overview('A', { items: entries, stocks: entries.map((entry, index) => ({ itemId: entry.id, branchId: 'A', quantity: index + 1, version: 1 })) }));
    await f.change('Search items', 'Synthetic'); await f.change('Filter by category', 'recorded:Consumables'); await f.change('Sort by', 'name-desc');
    const fresh = overview('A', { items: entries, stocks: [{ itemId: 'cream', branchId: 'A', quantity: 2.125 }, { itemId: 'zinc', branchId: 'A', quantity: 0 }, { itemId: 'zinc', branchId: 'B', quantity: 999 }] });
    const write = await f.exportReady(fresh); assert.deepEqual(write.args[2].map((row: any[]) => row[0]), ['Synthetic zinc', 'Synthetic cream']); assert.deepEqual(write.args[2].map((row: any[]) => row[4]), [0, 2.125]);
  });
  await check('malformed historical stock exports unavailable quantity without inventing zero', async f => {
    const data = overview('A', { stocks: [{ itemId: item.id, branchId: 'A', quantity: null, version: 0, issue: 'Needs manual review' }] });
    await f.loaded(data); const write = await f.exportReady(data); assert.equal(write.args[2][0][4], null); assert.equal(write.args[2][0][6], 'Needs review'); assert.equal(write.args[2][0][7], 'Needs manual review');
  });
  await check('transfer export includes branch-name snapshots and typed UTC dates', async f => {
    const data = overview('A', { transfers: [{ id: 'transfer', itemId: item.id, fromBranchId: 'A', toBranchId: 'B', fromBranchName: 'Original clinic A', toBranchName: 'Original clinic B', quantity: 2.125, status: 'completed', createdAt: '2035-01-01T01:00:00Z', completedAt: '2035-01-01T02:00:00Z', notes: 'Synthetic transfer note' }] });
    await f.loaded(data); await f.click('Stock Transfers'); const write = await f.exportReady(data); const values = write.args[2][0];
    assert.equal(write.args[0], 'Stock transfers'); assert.deepEqual(values.slice(2, 5), ['Original clinic A', 'Original clinic B', 2.125]); assert.equal(values[7].toISOString(), '2035-01-01T01:00:00.000Z'); assert.equal(values[8].toISOString(), '2035-01-01T02:00:00.000Z'); assert.equal(values[9], 'Synthetic transfer note');
  });
  await check('supplier reference export is available to a read-only inventory user', async f => {
    f.permission({ role: 'staff', permissionOverrides: { 'inventory.view': 'allow' } }); await f.loaded(); await f.click('Suppliers'); const write = await f.exportReady();
    assert.equal(write.args[0], 'Suppliers'); assert.deepEqual(write.args[2][0], ['Synthetic supplier', 'Synthetic contact', 'supplier@example.invalid', '123']);
  });
  await check('export stops if server reauthorization removes selected branch', async f => {
    await f.loaded(); await f.click('Export Excel'); f.requests.at(-1).deliver(overview('A', { branches: [{ id: 'B', branchName: 'B', status: 'Active' }] })); await f.settle();
    assert.equal(f.writes.length, 0); assert.match(text(f.renderer.tree), /branch is no longer available/);
  });
  await check('export network failure permits an explicit retry', async f => {
    await f.loaded(); await f.click('Export Excel'); f.requests.at(-1).deliver({ error: 'Synthetic export unavailable' }, 503); await f.settle();
    assert.match(text(f.renderer.tree), /Synthetic export unavailable/); assert.ok(!f.button('Export Excel').props.disabled); await f.click('Export Excel'); assert.equal(f.requests.length, 3);
  });
  await check('current export denial invalidates once and produces no workbook', async f => {
    await f.loaded(); await f.click('Export Excel'); f.requests.at(-1).deliver({ error: 'Current export denied' }, 403); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.equal(f.writes.length, 0); assert.equal(f.downloads.length, 0); assert.match(text(f.renderer.tree), /Inventory access changed/);
  });
  await check('old export fetch denial cannot invalidate a new branch', async f => {
    await f.loaded(); await f.click('Export Excel'); const request = f.requests.at(-1); await f.branch(); request.deliver({ error: 'Old export denied' }, 403); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.writes.length, 0); assert.doesNotMatch(text(f.renderer.tree), /Old export denied/);
  });
  for (const mode of ['account', 'permission', 'branch', 'unmount', 'filter', 'tab'] as const) {
    await check(`${mode} change discards a workbook generated for an old export lifetime`, async f => {
      await f.loaded(); const write = await f.exportReady();
      if (mode === 'account') f.account();
      else if (mode === 'permission') f.permission({ accessRevision: 2 }, false);
      else if (mode === 'branch') await f.branch();
      else if (mode === 'unmount') f.stop();
      else if (mode === 'filter') await f.change('Search items', 'changed');
      else await f.click('Suppliers');
      write.resolve(new Uint8Array([1])); await f.settle(); assert.equal(f.downloads.length, 0); assert.equal(f.renderer.lateSetters, 0);
    });
  }
} finally {
  await harness.cleanup(); globals.inventoryTestExcel = savedExcel;
}
console.log(JSON.stringify(results, null, 2));
const passed = results.filter(result => result.passed).length;
console.log(`${passed}/${results.length} inventory Excel component scenarios passed.`);
assert.equal(passed, results.length);
