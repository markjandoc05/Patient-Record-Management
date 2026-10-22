import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

const harness = await buildControlledForms(['InventoryDashboard'], process.cwd(), { exposePermissionState: true, useProductionInvalidation: true });
const itemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const managedCategory = { id: categoryId, name: 'Consumables', active: true, version: 1 };
const item = { id: itemId, name: 'Synthetic cream', sku: 'SYN-CREAM', category: 'Consumables', unit: 'bottle', lowStockThreshold: 2 };
const overview = (branch = 'A', extra: any = {}) => ({
  items: [item], suppliers: [{ id: 'supplier', name: 'Synthetic supplier' }],
  branches: ['A', 'B'].map(id => ({ id, branchName: 'Synthetic branch ' + id, status: 'Active' })),
  stocks: [{ itemId, branchId: branch, quantity: branch === 'A' ? 10 : 7, version: 4 }], transfers: [], ...extra,
});
class Fixture {
  renderer: Renderer; props: any; requests: any[] = []; profile: any;
  constructor() {
    globals.servicesTestInvalidations = 0;
    globals.servicesTestAuth.currentUser = { uid: 'account', getRequestToken: async () => 'synthetic' };
    globals.window.confirm = () => false;
    this.profile = { id: 'account', fullName: 'Synthetic Admin', role: 'admin', active: true, assignedBranches: ['A', 'B'], accessRevision: 1 };
    harness.modules.InventoryDashboard.publishPermissionProfile(this.profile);
    globals.fetch = (url: string, init: any) => new Promise((resolve, reject) => this.requests.push({ url, init,
      deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })),
      fail: () => reject(new TypeError('Synthetic lost response')),
    }));
    this.renderer = new Renderer(harness.components.InventoryDashboard);
    this.props = { userProfile: this.profile, activeBranchId: 'A' };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let i = 0; i < 12; i++) { this.renderer.passives.splice(0).forEach(f => f()); await flush(); if (this.renderer.dirty) this.render(); } }
  async start() { this.render(); await this.settle(); }
  async loaded(data = overview()) { await this.start(); this.requests[0].deliver(data); await this.settle(); }
  button(label: string) { const n = find(this.renderer.tree, n => n.type === 'button' && text(n).trim() === label); assert.ok(n, 'Missing button ' + label); return n; }
  has(label: string) { return !!find(this.renderer.tree, n => n.type === 'button' && text(n).trim() === label); }
  field(label: string) {
    const n = find(this.renderer.tree, n => n.type === 'label' && text(find(n.props.children, c => c.type === 'span')).startsWith(label));
    assert.ok(n, 'Missing field ' + label);
    const input = find(n.props.children, n => ['input', 'select', 'textarea'].includes(n.type)); assert.ok(input); return input;
  }
  async click(label: string) { const n = this.button(label); if (!n.props.disabled) n.props.onClick(); await this.settle(); }
  async change(label: string, value: any) { this.field(label).props.onChange({ target: { value } }); await this.settle(); }
  stockRows() {
    const body = find(this.renderer.tree, n => n.type === 'tbody'); assert.ok(body, 'Missing stock table');
    return [body.props.children].flat(Infinity).filter((n: any) => n?.type === 'tr');
  }
  stockNames() { return this.stockRows().map((row: any) => text(find(find(row, n => n.type === 'td'), n => n.type === 'p')).trim()); }
  async submit() { const n = find(this.renderer.tree, n => n.type === 'form'); assert.ok(n); n.props.onSubmit({ preventDefault() {} }); await this.settle(); }
  async receive() { await this.loaded(); await this.click('Receive'); await this.change('Quantity', '2.125'); await this.change('Date and time', '2035-01-01T09:30'); await this.change('Notes', 'KEEP UNSAVED NOTE'); }
  permission(extra: any) { this.profile = { ...this.profile, ...extra }; this.props.userProfile = this.profile; harness.modules.InventoryDashboard.publishPermissionProfile(this.profile); this.render(); }
  stop() { this.renderer.unmount(); }
}
const results: { name: string; passed: boolean; error?: string }[] = [];
async function check(name: string, run: (f: Fixture) => Promise<void>) {
  const f = new Fixture(); try { await run(f); results.push({ name, passed: true }); }
  catch (error: any) { results.push({ name, passed: false, error: error.message }); } finally { f.stop(); }
}
try {
  await check('empty stock offers item creation without invented stock', async f => {
    await f.loaded(overview('A', { items: [], stocks: [] }));
    assert.match(text(f.renderer.tree), /No inventory items yet/); assert.ok(f.has('Add Item'));
  });
  await check('receiving submits actual local clinic time, quantity, supplier and notes', async f => {
    await f.receive(); await f.change('Supplier', 'supplier'); await f.change('Reference', 'DELIVERY-001'); await f.submit();
    const r = f.requests.at(-1), p = JSON.parse(r.init.body);
    assert.equal(r.url, '/api/inventory/movements'); assert.equal(p.action, 'receive'); assert.equal(p.branchId, 'A');
    assert.equal(p.quantity, 2.125); assert.equal(p.occurredAt, '2035-01-01T01:30:00.000Z');
    assert.equal(p.notes, 'KEEP UNSAVED NOTE'); assert.equal(p.reference, 'DELIVERY-001'); assert.equal(p.supplierId, 'supplier');
    assert.ok(p.commandId); assert.equal(f.field('Notes').props.value, 'KEEP UNSAVED NOTE');
    assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled));
  });
  await check('lost response retains draft and retries exact command', async f => {
    await f.receive(); await f.submit(); const first = f.requests.at(-1); first.fail(); await f.settle();
    assert.equal(f.field('Notes').props.value, 'KEEP UNSAVED NOTE'); assert.ok(f.has('Retry same action'));
    assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled));
    await f.submit(); assert.equal(f.requests.at(-1).init.body, first.init.body);
  });
  await check('validation failure preserves notes and allows corrected command', async f => {
    await f.receive(); await f.submit(); const first = f.requests.at(-1); first.deliver({ error: 'Synthetic validation' }, 400); await f.settle();
    assert.equal(f.field('Notes').props.value, 'KEEP UNSAVED NOTE'); await f.change('Quantity', '3'); await f.submit();
    assert.notEqual(JSON.parse(f.requests.at(-1).init.body).commandId, JSON.parse(first.init.body).commandId);
  });
  await check('correction conflict preserves draft until explicit discard', async f => {
    await f.loaded(); await f.click('Adjust'); await f.change('Quantity change', '-1'); await f.change('Correction reason', 'KEEP CORRECTION REASON'); await f.submit();
    const r = f.requests.at(-1), p = JSON.parse(r.init.body); assert.equal(p.expectedVersion, 4); assert.equal(p.quantity, -1);
    r.deliver({ error: 'Balance changed' }, 409); await f.settle();
    assert.equal(f.field('Correction reason').props.value, 'KEEP CORRECTION REASON');
    await f.click('Close and reload inventory'); assert.equal(f.field('Correction reason').props.value, 'KEEP CORRECTION REASON');
    globals.window.confirm = () => true; await f.click('Close and reload inventory'); assert.match(text(f.renderer.tree), /Loading inventory/);
  });
  await check('cancel retains dirty draft when confirmation declined', async f => {
    await f.receive(); await f.click('Cancel'); assert.equal(f.field('Notes').props.value, 'KEEP UNSAVED NOTE');
  });
  await check('usage sends positive quantity and server determines subtraction', async f => {
    await f.loaded(); await f.click('Use'); await f.change('Quantity', '2'); await f.submit();
    const p = JSON.parse(f.requests.at(-1).init.body); assert.equal(p.action, 'use'); assert.equal(p.quantity, 2);
  });
  await check('valid large three-decimal quantities match server validation', async f => {
    await f.receive(); await f.change('Quantity', '135993393.55'); await f.submit();
    const p = JSON.parse(f.requests.at(-1).init.body); assert.equal(p.quantity, 135993393.55);
  });
  await check('transfer has no misleading pre-completion stock date', async f => {
    await f.loaded(); await f.click('Stock Transfers'); await f.click('New Transfer');
    await f.change('Item', itemId); await f.change('To branch', 'B'); await f.change('Quantity', '2'); await f.submit();
    const p = JSON.parse(f.requests.at(-1).init.body); assert.equal(p.fromBranchId, 'A'); assert.equal(p.toBranchId, 'B');
    assert.ok(p.commandId); assert.ok(!Object.hasOwn(p, 'occurredAt')); assert.doesNotMatch(text(f.renderer.tree), /Date and time/);
  });
  await check('read-only inventory cannot offer mutations', async f => {
    f.permission({ role: 'staff', permissionOverrides: { 'inventory.view': 'allow' } }); await f.loaded();
    assert.ok(f.has('History')); for (const label of ['Receive', 'Use', 'Adjust', 'Add Item']) assert.ok(!f.has(label));
    await f.click('Stock Transfers'); assert.ok(!f.has('New Transfer'));
  });
  await check('explicitly authorized staff manage stock but cannot correct', async f => {
    f.permission({ role: 'staff', permissionOverrides: { 'inventory.view': 'allow', 'inventory.manage': 'allow' } }); await f.loaded();
    assert.ok(f.has('Receive') && f.has('Use')); assert.ok(!f.has('Adjust'));
  });
  await check('malformed legacy stock refuses buttons and shows review state', async f => {
    await f.loaded(overview('A', { stocks: [{ itemId, branchId: 'A', quantity: null, version: 0, issue: 'Duplicate stock requires review' }] }));
    assert.match(text(f.renderer.tree), /Needs review/); assert.ok(f.button('Receive').props.disabled && f.button('Use').props.disabled && f.button('Adjust').props.disabled);
  });
  await check('legacy missing unit/threshold does not crash or infer values', async f => {
    await f.loaded(overview('A', { items: [{ ...item, unit: '', lowStockThreshold: undefined }] }));
    assert.match(text(f.renderer.tree), /not recorded|Not set|Threshold not set/);
  });
  await check('no authorized branch does not render false stock quantities', async f => {
    f.props.activeBranchId = ''; await f.loaded(overview('A', { branches: [], stocks: [] }));
    assert.match(text(f.renderer.tree), /No .*branches/); assert.ok(!f.has('Receive') && !f.has('Use'));
  });
  await check('discovery chooses an active authorized branch', async f => {
    f.props.activeBranchId = 'All'; await f.start(); assert.equal(f.requests[0].url, '/api/inventory');
    f.requests[0].deliver(overview('A', { branches: [{ id: 'I', branchName: 'Inactive', status: 'Inactive' }, { id: 'B', branchName: 'Active', status: 'Active' }] })); await f.settle();
    assert.match(f.requests.at(-1).url, /branchId=B/);
  });
  await check('history dates actors references and balances are visible', async f => {
    await f.loaded(); await f.click('History'); f.requests.at(-1).deliver({ movements: [{ id: 'event', kind: 'receive', quantity: 2, balanceAfter: 12, occurredAt: '2035-01-01T01:00Z', recordedAt: '2035-01-01T02:00Z', actor: { uid: 'admin', name: 'Synthetic recorder' }, reference: 'SYN-REF', notes: 'Synthetic note' }], total: 1, page: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /Synthetic recorder/); assert.match(text(f.renderer.tree), /SYN-REF/); assert.match(text(f.renderer.tree), /Balance:.*12/);
  });
  await check('transfer history displays the named source and destination', async f => {
    await f.loaded(); await f.click('History');
    f.requests.at(-1).deliver({ movements: [{ id: 'transfer-event', kind: 'transfer_out', quantity: -2, balanceAfter: 8, occurredAt: '2035-01-01T01:00Z', recordedAt: '2035-01-01T01:00Z', actor: { uid: 'admin', name: 'Synthetic recorder' }, fromBranchName: 'Original sending clinic', toBranchName: 'Original receiving clinic' }], total: 1, page: 1 });
    await f.settle(); assert.match(text(f.renderer.tree), /Original sending clinic.*→.*Original receiving clinic/);
  });
  await check('current denial clears protected content and requires explicit retry', async f => {
    await f.receive(); await f.submit(); f.requests.at(-1).deliver({ error: 'Denied' }, 403); await f.settle();
    assert.match(text(f.renderer.tree), /Inventory access changed/); assert.doesNotMatch(text(f.renderer.tree), /KEEP UNSAVED NOTE|Synthetic cream/);
    const before = f.requests.length; f.render(); await f.settle(); assert.equal(f.requests.length, before);
    await f.click('Retry inventory'); assert.equal(f.requests.length, before + 1);
  });
  await check('item creation lost response retries the same item identity', async f => {
    await f.loaded(); await f.click('Add Item'); await f.change('Item name', 'Synthetic new item');
    await f.change('SKU', 'SYN-NEW'); await f.change('Stock unit', 'vial'); await f.change('Low-stock threshold', '2'); await f.submit();
    const first = f.requests.at(-1); first.fail(); await f.settle(); await f.submit();
    assert.equal(f.requests.at(-1).init.body, first.init.body); assert.ok(JSON.parse(first.init.body).id);
  });
  await check('supplier creation retains entered details after server validation', async f => {
    await f.loaded(); await f.click('Suppliers'); await f.click('Add Supplier');
    await f.change('Supplier name', 'Synthetic supply company'); await f.change('Contact person', 'Synthetic contact'); await f.submit();
    const request = f.requests.at(-1); assert.equal(request.url, '/api/inventory/suppliers');
    request.deliver({ error: 'Synthetic supplier validation' }, 400); await f.settle();
    assert.equal(f.field('Contact person').props.value, 'Synthetic contact');
  });
  await check('history failure supports explicit retry without displaying old rows', async f => {
    await f.loaded(); await f.click('History'); f.requests.at(-1).deliver({ error: 'Synthetic history failure' }, 503); await f.settle();
    assert.ok(f.has('Retry history')); await f.click('Retry history');
    f.requests.at(-1).deliver({ movements: [], total: 0, page: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /No stock movements recorded/);
  });
  await check('pending transfer completion cannot unmount a newly opened stock draft', async f => {
    await f.loaded(overview('A', { transfers: [{ id: 'pending', itemId, fromBranchId: 'A', toBranchId: 'B', quantity: 1, status: 'pending', createdAt: '2035-01-01' }] }));
    globals.window.confirm = () => true; await f.click('Stock Transfers'); await f.click('Complete transfer');
    const request = f.requests.at(-1); await f.click('Stocks & Levels'); await f.click('Receive');
    assert.ok(!find(f.renderer.tree, n => n.type === 'form'));
    request.deliver({ id: 'pending' }); await f.settle(); assert.match(text(f.renderer.tree), /Loading inventory/);
  });
  await check('inactive clinic history stays readable and stock actions are disabled', async f => {
    await f.loaded(overview('A', { branches: [{ id: 'A', branchName: 'Inactive A', status: 'Inactive' }, { id: 'B', branchName: 'Active B', status: 'Active' }] }));
    assert.ok(f.has('History')); for (const action of ['Receive', 'Use', 'Adjust']) assert.ok(f.button(action).props.disabled);
  });
  await check('explicit view denial makes no inventory request', async f => {
    f.permission({ permissionOverrides: { 'inventory.view': 'deny' } }); await f.start();
    assert.equal(f.requests.length, 0); assert.match(text(f.renderer.tree), /Inventory access is unavailable/);
  });
  await check('new item category dropdown contains active managed categories only', async f => {
    await f.loaded(overview('A', { categories: [managedCategory, { id: 'inactive', name: 'Inactive category', active: false, version: 2 }] }));
    await f.click('Add Item'); const select = f.field('Category (optional)');
    assert.equal(select.type, 'select'); assert.match(text(select), /Consumables/); assert.doesNotMatch(text(select), /Inactive category/);
    assert.equal(select.props.value, '');
  });
  await check('new item submits canonical category ID without a client-authored category name', async f => {
    await f.loaded(overview('A', { categories: [managedCategory] })); await f.click('Add Item');
    await f.change('Item name', 'Synthetic managed item'); await f.change('SKU', 'SYN-MANAGED'); await f.change('Stock unit', 'vial'); await f.change('Category (optional)', categoryId); await f.submit();
    const p = JSON.parse(f.requests.at(-1).init.body); assert.equal(p.categoryId, categoryId); assert.ok(!Object.hasOwn(p, 'category'));
  });
  await check('uncategorized selection is explicit and does not invent a category', async f => {
    await f.loaded(); await f.click('Add Item'); await f.change('Item name', 'Synthetic uncategorized'); await f.change('SKU', 'SYN-NONE'); await f.change('Stock unit', 'piece'); await f.submit();
    const p = JSON.parse(f.requests.at(-1).init.body); assert.equal(p.categoryId, null); assert.ok(!Object.hasOwn(p, 'category'));
  });
  await check('category filtering separates linked IDs from identical historical text', async f => {
    await f.loaded(overview('A', { categories: [managedCategory], items: [item, { ...item, id: 'managed', name: 'Synthetic managed vial', categoryId }, { ...item, id: 'none', name: 'Synthetic uncategorized piece', category: '' }] }));
    await f.change('Filter by category', `category:${categoryId}`); assert.match(text(f.renderer.tree), /Synthetic managed vial/); assert.doesNotMatch(text(f.renderer.tree), /Synthetic cream|Synthetic uncategorized piece/);
    await f.change('Filter by category', 'recorded:Consumables'); assert.match(text(f.renderer.tree), /Synthetic cream/); assert.doesNotMatch(text(f.renderer.tree), /Synthetic managed vial/);
    await f.change('Filter by category', 'uncategorized'); assert.match(text(f.renderer.tree), /Synthetic uncategorized piece/); assert.doesNotMatch(text(f.renderer.tree), /Synthetic cream|Synthetic managed vial/);
  });
  await check('inactive category can filter historical linked items', async f => {
    await f.loaded(overview('A', { categories: [{ ...managedCategory, active: false }], items: [{ ...item, categoryId }] }));
    assert.match(text(f.field('Filter by category')), /Consumables.*inactive/); await f.change('Filter by category', `category:${categoryId}`); assert.match(text(f.renderer.tree), /Synthetic cream/);
  });
  await check('deactivating a selected unused category preserves a visible matching filter option', async f => {
    await f.loaded(overview('A', { categories: [managedCategory] })); await f.change('Filter by category', `category:${categoryId}`);
    await f.click('Manage categories'); await f.click('Deactivate'); await f.submit(); f.requests.at(-1).deliver({ ...managedCategory, active: false, version: 2 }); await f.settle();
    const inactive = overview('A', { categories: [{ ...managedCategory, active: false, version: 2 }] }); f.requests.at(-1).deliver(inactive); await f.settle();
    await f.click('Back to inventory'); f.requests.at(-1).deliver(inactive); await f.settle();
    const filter = f.field('Filter by category'); assert.equal(filter.props.value, `category:${categoryId}`);
    assert.ok(find(filter.props.children, n => n.type === 'option' && n.props.value === filter.props.value), 'selected filter must have a real option');
    assert.match(text(filter), /Consumables.*inactive/);
  });
  await check('category creation saves an active versioned definition', async f => {
    await f.loaded(); await f.click('Manage categories'); assert.match(text(f.renderer.tree), /No categories yet/); await f.click('Add category');
    await f.change('Category name', 'Synthetic new category'); await f.submit();
    const r = f.requests.at(-1), p = JSON.parse(r.init.body); assert.equal(r.url, '/api/inventory/categories'); assert.equal(r.init.method, 'POST');
    assert.equal(p.active, true); assert.equal(p.expectedVersion, 0); assert.ok(p.id && p.commandId);
    r.deliver({ ...p, version: 1 }, 201); await f.settle(); f.requests.at(-1).deliver(overview('A', { categories: [{ ...managedCategory, name: p.name }] })); await f.settle();
    assert.match(text(f.renderer.tree), /Category saved/); assert.match(text(f.renderer.tree), /Synthetic new category/);
  });
  await check('category creation retries the exact uncertain command and retains its draft', async f => {
    await f.loaded(); await f.click('Manage categories'); await f.click('Add category'); await f.change('Category name', 'KEEP CATEGORY DRAFT'); await f.submit();
    const original = f.requests.at(-1); original.fail(); await f.settle(); assert.equal(f.field('Category name').props.value, 'KEEP CATEGORY DRAFT');
    assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled)); await f.submit(); assert.equal(f.requests.at(-1).init.body, original.init.body);
  });
  await check('duplicate category name remains editable without discarding the draft', async f => {
    await f.loaded(); await f.click('Manage categories'); await f.click('Add category'); await f.change('Category name', 'Duplicate'); await f.submit();
    const first = f.requests.at(-1); first.deliver({ error: 'Duplicate category', code: 'CATEGORY_NAME_EXISTS' }, 409); await f.settle();
    assert.equal(f.field('Category name').props.value, 'Duplicate'); assert.ok(!find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled));
    await f.change('Category name', 'Unique category'); await f.submit(); assert.notEqual(JSON.parse(f.requests.at(-1).init.body).commandId, JSON.parse(first.init.body).commandId);
  });
  await check('category deactivation and reactivation retain the saved version', async f => {
    await f.loaded(overview('A', { categories: [managedCategory] })); await f.click('Manage categories'); await f.click('Deactivate'); await f.submit();
    let request = f.requests.at(-1), p = JSON.parse(request.init.body); assert.equal(request.init.method, 'PATCH'); assert.equal(p.active, false); assert.equal(p.expectedVersion, 1);
    request.deliver({ ...p, version: 2 }); await f.settle(); f.requests.at(-1).deliver(overview('A', { categories: [{ ...managedCategory, active: false, version: 2 }] })); await f.settle();
    await f.click('Reactivate'); await f.submit(); p = JSON.parse(f.requests.at(-1).init.body); assert.equal(p.active, true); assert.equal(p.expectedVersion, 2);
  });
  await check('stale category save preserves draft until explicitly accepted reload', async f => {
    await f.loaded(overview('A', { categories: [managedCategory] })); await f.click('Manage categories'); await f.click('Rename'); await f.change('Category name', 'KEEP STALE CATEGORY DRAFT'); await f.submit();
    f.requests.at(-1).deliver({ error: 'Changed', code: 'CATEGORY_VERSION_CHANGED' }, 409); await f.settle();
    const before = f.requests.length; await f.click('Reload saved category'); assert.equal(f.requests.length, before); assert.equal(f.field('Category name').props.value, 'KEEP STALE CATEGORY DRAFT');
    globals.window.confirm = () => true; await f.click('Reload saved category'); assert.equal(f.field('Category name').props.value, 'KEEP STALE CATEGORY DRAFT');
    f.requests.at(-1).deliver(overview('A', { categories: [{ ...managedCategory, name: 'Current saved category', version: 2 }] })); await f.settle();
    assert.equal(f.field('Category name').props.value, 'Current saved category'); await f.submit(); assert.equal(JSON.parse(f.requests.at(-1).init.body).expectedVersion, 2);
  });
  await check('failed category reload leaves the unsaved name intact', async f => {
    await f.loaded(overview('A', { categories: [managedCategory] })); await f.click('Manage categories'); await f.click('Rename'); await f.change('Category name', 'KEEP DURING RELOAD'); await f.submit();
    f.requests.at(-1).deliver({ error: 'Changed', code: 'CATEGORY_VERSION_CHANGED' }, 409); await f.settle(); globals.window.confirm = () => true; await f.click('Reload saved category');
    f.requests.at(-1).deliver({ error: 'Temporary reload failure' }, 503); await f.settle(); assert.equal(f.field('Category name').props.value, 'KEEP DURING RELOAD');
    assert.match(text(f.renderer.tree), /Temporary reload failure/);
  });
  await check('deactivated item category denial preserves all other new-item fields', async f => {
    await f.loaded(overview('A', { categories: [managedCategory] })); await f.click('Add Item'); await f.change('Item name', 'KEEP ITEM NAME'); await f.change('SKU', 'KEEP-SKU'); await f.change('Stock unit', 'bottle'); await f.change('Category (optional)', categoryId); await f.submit();
    f.requests.at(-1).deliver({ error: 'Category inactive', code: 'CATEGORY_INACTIVE' }, 409); await f.settle();
    assert.equal(f.field('Item name').props.value, 'KEEP ITEM NAME'); assert.equal(f.field('SKU').props.value, 'KEEP-SKU'); assert.equal(f.field('Stock unit').props.value, 'bottle');
    assert.ok(!find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled)); await f.change('Category (optional)', ''); await f.submit(); assert.equal(JSON.parse(f.requests.at(-1).init.body).categoryId, null);
  });
  await check('read-only users can filter categories but cannot manage them', async f => {
    f.permission({ role: 'staff', permissionOverrides: { 'inventory.view': 'allow' } }); await f.loaded(overview('A', { categories: [managedCategory] }));
    assert.ok(f.field('Filter by category')); assert.ok(!f.has('Manage categories'));
  });
  await check('stock names default to case-insensitive natural alphabetic order and can reverse', async f => {
    await f.loaded(overview('A', { items: ['zinc', 'Cream 10', 'balm', 'cream 2'].map((name, index) => ({ ...item, id: `name-${index}`, name })), stocks: [] }));
    assert.equal(f.field('Sort by').props.value, 'name-asc'); assert.deepEqual(f.stockNames(), ['balm', 'cream 2', 'Cream 10', 'zinc']);
    await f.change('Sort by', 'name-desc'); assert.deepEqual(f.stockNames(), ['zinc', 'Cream 10', 'cream 2', 'balm']);
  });
  for (const direction of ['asc', 'desc']) await check(`remaining ${direction} sorts numeric balances in the selected branch with unavailable rows last`, async f => {
    const entries = [
      { id: 'hundred', name: 'B hundred', quantity: 100 }, { id: 'ten', name: 'C ten', quantity: 10 },
      { id: 'two', name: 'A two', quantity: 2 }, { id: 'fraction', name: 'Z fraction', quantity: 0.125 },
      { id: 'missing', name: 'M no local stock' }, { id: 'review', name: 'Review stock', quantity: 1, issue: 'Historical stock needs review' },
      { id: 'null', name: 'Unknown quantity', quantity: null }, { id: 'undefined', name: 'Undefined quantity', quantity: undefined },
    ];
    await f.loaded(overview('A', {
      items: entries.map(({ id, name }) => ({ ...item, id, name })),
      stocks: [...entries.filter(entry => entry.id !== 'missing').map(entry => ({ itemId: entry.id, branchId: 'A', quantity: entry.quantity, issue: entry.issue, version: 1 })),
        { itemId: 'missing', branchId: 'B', quantity: 999, version: 1 }, { itemId: 'fraction', branchId: 'B', quantity: 500, version: 1 }],
    }));
    await f.change('Sort by', `remaining-${direction}`);
    const valid = ['M no local stock', 'Z fraction', 'A two', 'C ten', 'B hundred'];
    assert.deepEqual(f.stockNames(), [...(direction === 'asc' ? valid : valid.reverse()), 'Review stock', 'Undefined quantity', 'Unknown quantity']);
  });
  await check('status priority agrees with rendered review, low-stock, in-stock and unset-threshold states', async f => {
    const entries = [
      { id: 'unset', name: 'A unset threshold', lowStockThreshold: undefined, quantity: 0 },
      { id: 'good', name: 'B in stock', lowStockThreshold: 2, quantity: 3 },
      { id: 'low', name: 'C low stock', lowStockThreshold: 2, quantity: 2 },
      { id: 'review', name: 'D needs review', lowStockThreshold: 2, quantity: null, issue: 'Historical issue' },
    ];
    await f.loaded(overview('A', { items: entries.map(entry => ({ ...item, ...entry })), stocks: entries.map(entry => ({ itemId: entry.id, branchId: 'A', quantity: entry.quantity, issue: entry.issue, version: 1 })) }));
    await f.change('Sort by', 'status'); assert.deepEqual(f.stockNames(), ['D needs review', 'C low stock', 'B in stock', 'A unset threshold']);
    const states = f.stockRows().map((row: any) => {
      const cells = [row.props.children].flat(Infinity).filter((node: any) => node?.type === 'td'); return text(cells[2]).trim();
    });
    assert.deepEqual(states, ['Needs review', 'Low stock', 'In stock', 'Threshold not set']);
  });
  await check('equal balances and statuses use deterministic name, SKU and ID tie breakers', async f => {
    const items = [
      { ...item, id: 'tie-z', name: 'Cream', sku: 'SKU-2' }, { ...item, id: 'tie-b', name: 'cream', sku: 'SKU-10' },
      { ...item, id: 'tie-a', name: 'CREAM', sku: 'sku-2' }, { ...item, id: 'balm', name: 'Balm', sku: 'SKU-99' },
    ];
    await f.loaded(overview('A', { items, stocks: items.map(entry => ({ itemId: entry.id, branchId: 'A', quantity: 5, version: 1 })) }));
    for (const mode of ['remaining-asc', 'remaining-desc', 'status', 'name-asc']) {
      await f.change('Sort by', mode); assert.deepEqual(f.stockRows().map((row: any) => row.key), ['balm', 'tie-a', 'tie-z', 'tie-b']);
    }
    await f.change('Sort by', 'name-desc'); assert.deepEqual(f.stockRows().map((row: any) => row.key), ['tie-b', 'tie-z', 'tie-a', 'balm']);
  });
  await check('sorting composes with search and category filtering and survives a stock refresh', async f => {
    const entries = [
      { ...item, id: 'large', name: 'Synthetic cream large', categoryId },
      { ...item, id: 'small', name: 'Synthetic cream small', categoryId },
      { ...item, id: 'other', name: 'Synthetic cream other', category: 'Other category' },
      { ...item, id: 'vial', name: 'Synthetic vial', sku: 'SYN-VIAL', categoryId },
    ];
    const response = overview('A', { categories: [managedCategory], items: entries, stocks: entries.map((entry, index) => ({ itemId: entry.id, branchId: 'A', quantity: index + 1, version: 1 })) });
    await f.loaded(response); await f.change('Search items', 'cream'); await f.change('Filter by category', `category:${categoryId}`); await f.change('Sort by', 'remaining-desc');
    assert.deepEqual(f.stockNames(), ['Synthetic cream small', 'Synthetic cream large']);
    await f.click('Refresh inventory'); f.requests.at(-1).deliver({ ...response, stocks: response.stocks.map(stock => ({ ...stock, quantity: stock.itemId === 'large' ? 20 : stock.quantity })) }); await f.settle();
    assert.equal(f.field('Sort by').props.value, 'remaining-desc'); assert.equal(f.field('Search items').props.value, 'cream'); assert.equal(f.field('Filter by category').props.value, `category:${categoryId}`);
    assert.deepEqual(f.stockNames(), ['Synthetic cream large', 'Synthetic cream small']);
  });
  await check('stock sorting leaves the source catalogue order unchanged for transfer selection', async f => {
    const items = [{ ...item, id: 'zinc', name: 'Zinc' }, { ...item, id: 'balm', name: 'Balm' }, { ...item, id: 'cream', name: 'Cream' }];
    await f.loaded(overview('A', { items, stocks: [] })); assert.deepEqual(f.stockNames(), ['Balm', 'Cream', 'Zinc']);
    await f.change('Sort by', 'name-desc'); await f.change('Sort by', 'remaining-asc'); await f.click('Stock Transfers'); await f.click('New Transfer');
    const options = [f.field('Item').props.children].flat(Infinity).filter((node: any) => node?.type === 'option');
    assert.deepEqual(options.map((option: any) => option.props.value), ['', 'zinc', 'balm', 'cream']);
  });
  await check('read-only users can sort locally without gaining stock mutation actions', async f => {
    f.permission({ role: 'staff', permissionOverrides: { 'inventory.view': 'allow' } });
    await f.loaded(overview('A', { items: [{ ...item, id: 'two', name: 'Two' }, { ...item, id: 'ten', name: 'Ten' }], stocks: [{ itemId: 'two', branchId: 'A', quantity: 2, version: 1 }, { itemId: 'ten', branchId: 'A', quantity: 10, version: 1 }] }));
    const before = f.requests.length; await f.change('Sort by', 'remaining-desc'); assert.deepEqual(f.stockNames(), ['Ten', 'Two']); assert.equal(f.requests.length, before);
    for (const action of ['Receive', 'Use', 'Adjust', 'Add Item', 'Manage categories']) assert.ok(!f.has(action)); assert.ok(f.has('History'));
  });
  await check('current category save denial clears protected draft and requires retry', async f => {
    await f.loaded(); await f.click('Manage categories'); await f.click('Add category'); await f.change('Category name', 'PROTECTED CATEGORY NAME'); await f.submit();
    f.requests.at(-1).deliver({ error: 'Denied' }, 403); await f.settle(); assert.match(text(f.renderer.tree), /Inventory access changed/); assert.doesNotMatch(text(f.renderer.tree), /PROTECTED CATEGORY NAME/);
  });
  for (const operation of ['overview', 'history', 'save', 'categorySave', 'categoryReload']) for (const scope of ['branch', 'permission', 'account']) for (const status of [200, 403, 409]) {
    await check(`${operation} old ${scope} response ${status} cannot replace current scope`, async f => {
      if (operation === 'overview') await f.start();
      else if (operation === 'history') { await f.loaded(); await f.click('History'); }
      else if (operation === 'save') { await f.receive(); await f.submit(); }
      else {
        await f.loaded(overview('A', { categories: [managedCategory] })); await f.click('Manage categories'); await f.click('Rename'); await f.change('Category name', 'OLD PROTECTED CATEGORY DRAFT'); await f.submit();
        if (operation === 'categoryReload') { f.requests.at(-1).deliver({ error: 'Changed', code: 'CATEGORY_VERSION_CHANGED' }, 409); await f.settle(); globals.window.confirm = () => true; await f.click('Reload saved category'); }
      }
      const old = f.requests.at(-1);
      if (scope === 'branch') { f.props.activeBranchId = 'B'; f.render(); }
      else if (scope === 'account') { globals.servicesTestAuth.currentUser = { ...globals.servicesTestAuth.currentUser, uid: 'replacement' }; f.permission({ id: 'replacement' }); }
      else f.permission({ accessRevision: 2 });
      await f.settle();
      const current = f.requests.at(-1); assert.notEqual(current, old);
      current.deliver(overview(scope === 'branch' ? 'B' : 'A', { items: [{ ...item, name: 'CURRENT SCOPE ITEM' }] })); await f.settle();
      const before = globals.servicesTestInvalidations;
      old.deliver(status === 200 ? operation === 'history' ? { movements: [{ notes: 'OLD PROTECTED HISTORY' }], total: 1 } : overview('A', { items: [{ ...item, name: 'OLD PROTECTED ITEM' }] }) : { error: 'OLD PROTECTED ERROR' }, status); await f.settle();
      assert.match(text(f.renderer.tree), /CURRENT SCOPE ITEM/); assert.doesNotMatch(text(f.renderer.tree), /OLD PROTECTED|KEEP UNSAVED NOTE/);
      assert.equal(globals.servicesTestInvalidations, before);
    });
  }
  console.log(JSON.stringify(results, null, 2));
  console.log(`${results.filter(r => r.passed).length}/${results.length} inventory component scenarios passed (controlled responses, not browser acceptance).`);
  assert.ok(results.every(r => r.passed), 'Inventory component scenarios failed');
} finally { await harness.cleanup(); }
