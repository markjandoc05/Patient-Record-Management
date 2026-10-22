import type express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { currentActor, assertCapability } from './permissions';
import { db, type RecordTransaction } from './database';
import { hasAdministrativeAccess } from '../src/rbac';
import { hasBranchScope } from '../src/permissions';
import { InventoryError, INVENTORY_MAX_QUANTITY, inventoryFail, inventoryRecordId, inventoryUuid,
  inventoryQuantity, inventoryText, inventoryOccurredAt, parseInventoryItem, parseInventorySupplier, parseInventoryCategory } from '../src/inventoryPolicy';
import { INVENTORY_IMPORT_MAX_ROWS, type InventoryImportRow, type InventoryImportPreview, type InventoryImportPreviewRow,
  type InventoryImportResult } from '../src/inventoryImportPolicy';

type Actor = Awaited<ReturnType<typeof currentActor>>;
type Account = { id: string; item_id: string; branch_id: string; stock_record_id: string; quantity: number; version: number };
type MovementDetails = { kind: string; occurredAt: string; notes: string; reference: string; supplierId?: string; supplierName?: string; transferId?: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actorSnapshot = (actor: Actor) => ({ uid: actor.identity.uid, name: String(actor.profile.fullName || actor.identity.email).slice(0, 200), role: actor.profile.role });
const stockQuery = (itemId: string, branchId: string) => db.collection('inventory_stocks').where('itemId', '==', itemId).where('branchId', '==', branchId);
const recordedName = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const branchRecordName = (data: any) => recordedName(data?.branchName) || recordedName(data?.name);
const categoryIdentity = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').toLowerCase() : '';
function transferBranchNames(transfer: any, directory: Map<string, string>) {
  const fromBranchName = recordedName(transfer?.fromBranchNameSnapshot) || directory.get(transfer?.fromBranchId);
  const toBranchName = recordedName(transfer?.toBranchNameSnapshot) || directory.get(transfer?.toBranchId);
  return { ...(fromBranchName ? { fromBranchName } : {}), ...(toBranchName ? { toBranchName } : {}) };
}
function audit(tx: RecordTransaction, actor: Actor, eventType: string, resourceId: string, branchId: string | null, changes?: any[]) {
  tx.create(db.collection('audit_logs').doc(), { timestamp: new Date().toISOString(), action: ['transfer_completed', 'category_updated'].includes(eventType) ? 'UPDATE' : 'CREATE', resource: 'Inventory', resourceId,
    branchId, userId: actor.identity.uid, userName: actorSnapshot(actor).name, userEmail: actor.identity.email,
    userRole: actor.profile.role, details: 'Inventory ' + eventType.replaceAll('_', ' '), eventType, source: 'trusted_server', ...(changes ? { changes } : {}) });
}
async function branch(tx: RecordTransaction, actor: Actor, value: unknown, permission: 'inventory.view' | 'inventory.manage' | 'inventory.transfer', active = false) {
  const id = inventoryRecordId(value);
  assertCapability(actor.profile, permission, { branchId: id });
  const data = (await tx.get(db.collection('branches').doc(id))).data();
  if (!data) inventoryFail(404, 'NOT_FOUND', 'Clinic not found.');
  if (active && data.status !== 'Active') inventoryFail(400, 'INACTIVE_BRANCH', 'Choose an active clinic.');
  return id;
}
async function item(tx: RecordTransaction, value: unknown) {
  const id = inventoryRecordId(value);
  const data = (await tx.get(db.collection('inventory_items').doc(id))).data();
  if (!data) inventoryFail(404, 'NOT_FOUND', 'Inventory item not found.');
  return { id, data };
}
function existingQuantity(value: unknown) {
  try { return inventoryQuantity(value, false, true); }
  catch { inventoryFail(409, 'STOCK_REVIEW_REQUIRED', 'This stock balance is invalid. An administrator must review the existing record before stock can change.'); }
}
async function stockState(tx: RecordTransaction, itemId: string, branchId: string) {
  const records = await tx.get(stockQuery(itemId, branchId));
  if (records.size > 1) inventoryFail(409, 'STOCK_REVIEW_REQUIRED', 'Duplicate stock records require administrator review before stock can change.');
  const record = records.docs[0];
  const quantity = record ? existingQuantity(record.data()?.quantity) : 0;
  const row = (await tx.sql('SELECT * FROM inventory_accounts WHERE item_id=$1 AND branch_id=$2 FOR UPDATE', [itemId, branchId])).rows[0];
  if (row && (!record || row.stock_record_id !== record.id || Number(row.quantity) !== quantity)) {
    inventoryFail(409, 'STOCK_REVIEW_REQUIRED', 'Stock and movement history do not match. An administrator must review them before stock can change.');
  }
  return { record, quantity, account: row ? { ...row, quantity: Number(row.quantity) } as Account : null };
}
async function account(tx: RecordTransaction, actor: Actor, itemId: string, branchId: string): Promise<Account> {
  const state = await stockState(tx, itemId, branchId);
  if (state.account) return state.account;
  const a: Account = { id: randomUUID(), item_id: itemId, branch_id: branchId,
    stock_record_id: state.record?.id || randomUUID(), quantity: state.quantity, version: 0 };
  const source = state.record ? { kind: 'legacy_stock', collection: 'inventory_stocks', recordId: state.record.id, quantity: state.quantity }
    : { kind: 'new_account', quantity: 0 };
  await tx.sql(`INSERT INTO inventory_accounts(id,item_id,branch_id,stock_record_id,quantity,version,opening_source)
    VALUES($1,$2,$3,$4,$5,0,$6::jsonb)`, [a.id, itemId, branchId, a.stock_record_id, a.quantity, JSON.stringify(source)]);
  await tx.sql(`INSERT INTO inventory_movements(id,account_id,kind,quantity,balance_after,version,occurred_at,actor,notes,reference)
    VALUES($1,$2,'opening',$3,$3,0,clock_timestamp(),$4::jsonb,$5,'')`, [randomUUID(), a.id, a.quantity, JSON.stringify(actorSnapshot(actor)),
    state.record ? 'Opening balance adopted from the existing stock record. This is not a stock receipt; the original receipt date is unknown.' : 'Opening balance for a new stock account.']);
  return a;
}
async function postMovement(tx: RecordTransaction, actor: Actor, a: Account, delta: number, details: MovementDetails) {
  const balance = (Math.round(a.quantity * 1000) + Math.round(delta * 1000)) / 1000;
  if (balance < 0) inventoryFail(400, 'INSUFFICIENT_STOCK', 'There is not enough stock for this movement. Reload the current balance.');
  if (balance > INVENTORY_MAX_QUANTITY) inventoryFail(400, 'STOCK_LIMIT', 'This movement exceeds the supported stock balance.');
  if (a.version >= 2_147_483_647) inventoryFail(409, 'STOCK_LIMIT', 'This stock account requires administrator review.');
  const id = randomUUID(), version = a.version + 1;
  await tx.sql(`INSERT INTO inventory_movements(id,account_id,kind,quantity,balance_after,version,occurred_at,actor,notes,reference,supplier_id,supplier_name,transfer_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`, [id, a.id, details.kind, delta, balance, version, details.occurredAt,
    JSON.stringify(actorSnapshot(actor)), details.notes, details.reference, details.supplierId || null, details.supplierName || null, details.transferId || null]);
  await tx.sql('UPDATE inventory_accounts SET quantity=$2,version=$3 WHERE id=$1', [a.id, balance, version]);
  // Queue only the final mirror. RecordTransaction flushes after SQL mutations;
  // its mirror guard therefore observes the final account balance atomically.
  tx.set(db.collection('inventory_stocks').doc(a.stock_record_id), { itemId: a.item_id, branchId: a.branch_id, quantity: balance }, { merge: true });
  return { id, quantity: balance, version };
}
async function replay(tx: RecordTransaction, actor: Actor, commandId: string, requestHash: string) {
  const old = (await tx.sql('SELECT * FROM inventory_commands WHERE command_id=$1', [commandId])).rows[0];
  if (!old) return null;
  if (old.request_hash !== requestHash || old.actor.uid !== actor.identity.uid) {
    inventoryFail(409, 'COMMAND_CONFLICT', 'This command identifier was already used with different details. Reload and review before saving.');
  }
  return { ...old.result, replayed: true };
}
async function saveCommand(tx: RecordTransaction, actor: Actor, commandId: string, action: string, requestHash: string, result: any) {
  await tx.sql('INSERT INTO inventory_commands(command_id,actor,request_hash,action,result) VALUES($1,$2::jsonb,$3,$4,$5::jsonb)',
    [commandId, JSON.stringify(actorSnapshot(actor)), requestHash, action, JSON.stringify(result)]);
}
function pageNumber(value: unknown) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value)) inventoryFail(400, 'INVALID_PAGE', 'Choose a valid movement history page.');
  return Number(value);
}
function importRows(value: unknown): InventoryImportRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > INVENTORY_IMPORT_MAX_ROWS) {
    inventoryFail(400, 'IMPORT_INVALID', `Choose a workbook with 1–${INVENTORY_IMPORT_MAX_ROWS} item rows.`);
  }
  const positions = new Set<number>();
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Number.isSafeInteger(row.rowNumber)
      || row.rowNumber < 2 || row.rowNumber > 1_048_576 || positions.has(row.rowNumber)) {
      inventoryFail(400, 'IMPORT_INVALID', 'Every item needs a unique valid Excel row number (starting at row 2).');
    }
    positions.add(row.rowNumber);
    // Copy only the workbook contract. Unknown client fields can never provide
    // IDs, category authority, actors, existing balances or movement metadata.
    return { rowNumber: row.rowNumber, name: row.name, sku: row.sku, category: row.category ?? '', unit: row.unit,
      lowStockThreshold: row.lowStockThreshold, openingQuantity: row.openingQuantity };
  });
}
type ImportPlan = { preview: InventoryImportPreview; ready: Array<{ data: ReturnType<typeof parseInventoryItem>; openingQuantity: number }> };
async function previewImport(tx: RecordTransaction, branchId: string, rows: InventoryImportRow[]): Promise<ImportPlan> {
  const existing = new Set((await tx.get(db.collection('inventory_items'))).docs.map(d => String(d.data()?.sku || '').trim().toLowerCase()));
  const categories = (await tx.get(db.collection('inventory_categories'))).docs.map(d => {
    const data = d.data()!;
    return { id: d.id, name: data.name, active: data.active, version: data.version };
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sku = typeof row.sku === 'string' ? row.sku.trim().toLowerCase() : '';
    if (sku) counts.set(sku, (counts.get(sku) || 0) + 1);
  }
  const ready: ImportPlan['ready'] = [], bindings: unknown[] = [];
  const previewRows: InventoryImportPreviewRow[] = rows.map(row => {
    try {
      const sku = inventoryText(row.sku, 80, 'SKU', true), key = sku.toLowerCase();
      if ((counts.get(key) || 0) > 1) inventoryFail(400, 'IMPORT_INVALID', 'This SKU appears more than once in the workbook.');
      if (existing.has(key)) {
        bindings.push(null);
        return { ...row, status: 'skip', message: 'SKU already exists. Its item details and stock will stay unchanged.' };
      }
      const categoryName = inventoryText(row.category, 80, 'category');
      let category: typeof categories[number] | undefined;
      if (categoryName) {
        const matches = categories.filter(c => categoryIdentity(c.name) === categoryIdentity(categoryName));
        if (matches.length !== 1) inventoryFail(400, 'IMPORT_INVALID', matches.length ? 'This category name is ambiguous. Review category management.' : 'Category not found. Create it in category management or leave this cell blank.');
        category = matches[0];
        if (category.active !== true) inventoryFail(400, 'IMPORT_INVALID', 'This category is inactive. Choose an active category or leave this cell blank.');
        if (!Number.isSafeInteger(category.version) || category.version < 1) inventoryFail(400, 'IMPORT_INVALID', 'This category requires review before importing items.');
        inventoryUuid(category.id);
      }
      const data = parseInventoryItem({ ...row, categoryId: category?.id ?? null });
      data.category = category ? inventoryText(category.name, 80, 'category name', true) : '';
      const openingQuantity = inventoryQuantity(row.openingQuantity, false, true);
      ready.push({ data, openingQuantity });
      bindings.push(category ? { id: category.id, name: category.name, version: category.version } : null);
      return { ...row, status: 'ready', message: openingQuantity > 0 ? 'Create item and receive opening stock at the selected clinic.' : 'Create item with no opening stock.' };
    } catch (error) {
      if (!(error instanceof InventoryError)) throw error;
      bindings.push(null);
      return { ...row, status: 'error', message: error.message };
    }
  });
  const preview = { rows: previewRows, readyCount: ready.length, skippedCount: previewRows.filter(r => r.status === 'skip').length,
    errorCount: previewRows.filter(r => r.status === 'error').length,
    previewHash: hash(['inventory_import_preview_v1', branchId, previewRows, bindings]) };
  return { preview, ready };
}
export function mountInventory(app: express.Express) {
  const route = (method: 'get' | 'post' | 'patch', path: string, handler: (req: express.Request, tx: RecordTransaction, actor: Actor) => Promise<any>) => {
    app[method](path, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (method !== 'get' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
          inventoryFail(400, 'INVALID_REQUEST', 'Enter valid inventory details.');
        }
        const result = await db.runTransaction(async tx => handler(req, tx, await currentActor(req, tx)));
        res.status(result.status ?? 200).json(result.body ?? result);
      } catch (error: any) {
        if (error instanceof InventoryError || typeof error.status === 'number') return res.status(error.status).json({ error: error.message, code: error.code || 'FORBIDDEN' });
        if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Please sign in again.', code: 'UNAUTHORIZED' });
        if (error.message === 'Invalid request origin or CSRF token') return res.status(403).json({ error: 'Invalid origin or CSRF token.', code: 'CSRF' });
        if (['23505', '23503', '23514'].includes(error.code)) return res.status(409).json({ error: 'The stock record changed or requires review. Reload the current balance before retrying.', code: 'STOCK_CONFLICT' });
        if (['ECONNREFUSED', 'ETIMEDOUT', '57P01', '53300', '08006', '42P01'].includes(error.code)) return res.status(503).json({ error: 'Inventory is temporarily unavailable. Retry loading.', code: 'UNAVAILABLE' });
        console.error('Inventory request failed', error.code || error.name);
        res.status(500).json({ error: 'Inventory could not be loaded or saved. Retry or reload to inspect the saved result.', code: 'SERVER_ERROR' });
      }
    });
  };
  route('post', '/api/inventory/import/preview', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.view'); assertCapability(actor.profile, 'inventory.manage');
    const branchId = await branch(tx, actor, req.body.branchId, 'inventory.manage', true);
    return (await previewImport(tx, branchId, importRows(req.body.rows))).preview;
  });
  route('post', '/api/inventory/import/commit', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.view'); assertCapability(actor.profile, 'inventory.manage');
    const branchId = await branch(tx, actor, req.body.branchId, 'inventory.manage'), rows = importRows(req.body.rows);
    const commandId = inventoryUuid(req.body.commandId), occurredAt = inventoryOccurredAt(req.body.occurredAt),
      notes = inventoryText(req.body.notes, 2000, 'notes');
    if (typeof req.body.previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.previewHash)) inventoryFail(400, 'IMPORT_INVALID', 'Preview this workbook before importing.');
    const requestHash = hash(['inventory_import_v1', branchId, rows, req.body.previewHash, occurredAt, notes]);
    // A successful lost-response retry resolves before category/branch activity
    // can change its outcome. Current account/capability/branch scope still apply.
    const previous = await replay(tx, actor, commandId, requestHash); if (previous) return previous;
    await branch(tx, actor, branchId, 'inventory.manage', true);
    const plan = await previewImport(tx, branchId, rows);
    if (plan.preview.previewHash !== req.body.previewHash) inventoryFail(409, 'IMPORT_PREVIEW_CHANGED', 'Inventory or categories changed. Preview this workbook again before importing.');
    if (plan.preview.errorCount || !plan.preview.readyCount) inventoryFail(400, 'IMPORT_INVALID', plan.preview.errorCount ? 'Fix every row error and preview again before importing.' : 'There are no new items to import.');
    const result: InventoryImportResult = { importedCount: plan.ready.length, skippedCount: plan.preview.skippedCount, itemIds: [] };
    for (const row of plan.ready) {
      const itemId = randomUUID();
      tx.create(db.collection('inventory_items').doc(itemId), row.data); result.itemIds.push(itemId);
      audit(tx, actor, 'item_created', itemId, branchId);
      if (row.openingQuantity > 0) {
        const movement = await postMovement(tx, actor, await account(tx, actor, itemId, branchId), row.openingQuantity,
          { kind: 'receive', occurredAt, notes, reference: 'Excel import' });
        audit(tx, actor, 'stock_receive', movement.id, branchId);
      }
    }
    await saveCommand(tx, actor, commandId, 'inventory_import', requestHash, result);
    audit(tx, actor, 'import_completed', commandId, branchId, [{ field: 'import', before: null,
      after: { importedCount: result.importedCount, skippedCount: result.skippedCount, occurredAt, notes } }]);
    return { status: 201, body: result };
  });
  route('get', '/api/inventory', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.view');
    const branches = (await tx.get(db.collection('branches'))).docs.filter(d => hasBranchScope(actor.profile, d.id))
      .map(d => ({ id: d.id, branchName: branchRecordName(d.data()) || '', status: d.data()?.status }));
    const directory = new Map(branches.filter(b => b.branchName).map(b => [b.id, b.branchName]));
    const categories = (await tx.get(db.collection('inventory_categories'))).docs.map(d => {
      const data = d.data()!;
      return { id: d.id, name: String(data.name || ''), active: data.active === true, version: data.version };
    });
    const categoryDirectory = new Map(categories.map(category => [category.id, category]));
    const items = (await tx.get(db.collection('inventory_items'))).docs.map(d => {
      const data = d.data()!;
      const recordedCategory = String(data.category || ''), categoryId = typeof data.categoryId === 'string' ? data.categoryId : null;
      return { id: d.id, name: String(data.name || ''), sku: String(data.sku || ''),
        category: categoryId ? categoryDirectory.get(categoryId)?.name || recordedCategory : recordedCategory,
        ...(Object.hasOwn(data, 'categoryId') ? { categoryId, recordedCategory } : {}),
        unit: String(data.unit || ''), lowStockThreshold: data.lowStockThreshold };
    });
    const suppliers = (await tx.get(db.collection('suppliers'))).docs.map(d => {
      const data = d.data()!;
      return { id: d.id, name: String(data.name || ''), contactPerson: String(data.contactPerson || ''), email: String(data.email || ''), phone: String(data.phone || '') };
    });
    if (req.query.branchId === undefined) return { items, suppliers, branches, categories, stocks: [], transfers: [] };
    const branchId = await branch(tx, actor, req.query.branchId, 'inventory.view');
    const stocks = [];
    for (const i of items) {
      try {
        const state = await stockState(tx, i.id, branchId);
        stocks.push({ itemId: i.id, branchId, quantity: state.quantity, version: state.account?.version ?? 0 });
      } catch (error) {
        if (!(error instanceof InventoryError) || error.code !== 'STOCK_REVIEW_REQUIRED') throw error;
        stocks.push({ itemId: i.id, branchId, quantity: null, version: 0, issue: error.message });
      }
    }
    const transfers = (await tx.get(db.collection('stock_transfers'))).docs.map(d => {
      const data = d.data()!;
      return { ...data, id: d.id, createdAt: data.createdAt?.__timestamp || data.createdAt } as Record<string, any>;
    })
      .filter(t => (t.fromBranchId === branchId || t.toBranchId === branchId) && hasBranchScope(actor.profile, t.fromBranchId) && hasBranchScope(actor.profile, t.toBranchId))
      .map(t => ({ ...t, ...transferBranchNames(t, directory) }));
    return { items, suppliers, branches, categories, stocks, transfers };
  });
  route('get', '/api/inventory/items/:id/history', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.view');
    const branchId = await branch(tx, actor, req.query.branchId, 'inventory.view');
    const selected = await item(tx, req.params.id), page = pageNumber(req.query.page);
    const state = await stockState(tx, selected.id, branchId);
    if (!state.account) return { movements: [], total: 0, page };
    const total = Number((await tx.sql('SELECT count(*) FROM inventory_movements WHERE account_id=$1', [state.account.id])).rows[0].count);
    const rows = (await tx.sql(`SELECT m.*,t.data AS transfer FROM inventory_movements m
      LEFT JOIN app_records t ON t.collection_path='stock_transfers' AND t.id=m.transfer_id
      WHERE m.account_id=$1 ORDER BY m.version DESC LIMIT 25 OFFSET $2`, [state.account.id, (page - 1) * 25])).rows;
    const directory = new Map<string, string>();
    if (rows.some(m => m.transfer_id)) {
      for (const b of (await tx.get(db.collection('branches'))).docs) {
        const name = branchRecordName(b.data());
        if (name && hasBranchScope(actor.profile, b.id)) directory.set(b.id, name);
      }
    }
    const movements = rows.map(m => {
      // A branch-scoped user can see their own quantity movement, without
      // learning a transfer counterpart or free text from another clinic.
      const restrictedTransfer = m.transfer_id && (!m.transfer || !hasBranchScope(actor.profile, m.transfer.fromBranchId) || !hasBranchScope(actor.profile, m.transfer.toBranchId));
      return { id: m.id, kind: m.kind, quantity: Number(m.quantity), balanceAfter: Number(m.balance_after),
        occurredAt: new Date(m.occurred_at).toISOString(), recordedAt: new Date(m.recorded_at).toISOString(), actor: { uid: m.actor.uid, name: m.actor.name },
        notes: restrictedTransfer ? '' : m.notes, reference: restrictedTransfer ? '' : m.reference,
        ...(m.supplier_name ? { supplierName: m.supplier_name } : {}),
        ...(!restrictedTransfer && m.transfer_id ? { transferId: m.transfer_id, ...transferBranchNames(m.transfer, directory) } : {}) };
    });
    return { movements, total, page };
  });
  for (const create of [true, false]) route(create ? 'post' : 'patch', create ? '/api/inventory/categories' : '/api/inventory/categories/:id', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.manage');
    const c = parseInventoryCategory(req.body, create);
    if (!create && inventoryUuid(req.params.id) !== c.id) inventoryFail(400, 'INVALID_ID', 'Category identifiers must match.');
    const requestHash = hash([create ? 'category_create' : 'category_edit', c.id, c.name, c.active, c.expectedVersion]);
    const prior = await replay(tx, actor, c.commandId, requestHash); if (prior) return prior;
    const ref = db.collection('inventory_categories').doc(c.id), previous = (await tx.get(ref)).data();
    if (create && previous) inventoryFail(409, 'CATEGORY_EXISTS', 'This category identifier already exists.');
    if (!create && !previous) inventoryFail(404, 'NOT_FOUND', 'Inventory category not found.');
    if (!create && (!Number.isSafeInteger(previous!.version) || previous!.version !== c.expectedVersion)) inventoryFail(409, 'CATEGORY_VERSION_CHANGED', 'This category changed. Reload it and review your changes before saving.');
    if ((await tx.get(db.collection('inventory_categories'))).docs.some(d => d.id !== c.id && categoryIdentity(d.data()?.name) === categoryIdentity(c.name))) {
      inventoryFail(409, 'CATEGORY_NAME_EXISTS', 'This category name is already in use, including inactive categories.');
    }
    const version = create ? 1 : previous!.version + 1;
    if (!Number.isSafeInteger(version)) inventoryFail(409, 'CATEGORY_VERSION_CHANGED', 'This category requires administrator review.');
    const result = { id: c.id, name: c.name, active: c.active, version }, now = new Date().toISOString();
    if (create) tx.create(ref, { name: c.name, active: c.active, version, createdAt: now, createdBy: actor.identity.uid, updatedAt: now, updatedBy: actor.identity.uid });
    else tx.update(ref, { name: c.name, active: c.active, version, updatedAt: now, updatedBy: actor.identity.uid });
    await saveCommand(tx, actor, c.commandId, create ? 'category_create' : 'category_edit', requestHash, result);
    audit(tx, actor, create ? 'category_created' : 'category_updated', c.id, null,
      ['name', 'active', 'version'].map(field => ({ field, before: previous?.[field] ?? null, after: result[field as keyof typeof result] })));
    return { status: create ? 201 : 200, body: result };
  });
  for (const collection of ['inventory_items', 'suppliers']) route('post', collection === 'inventory_items' ? '/api/inventory/items' : '/api/inventory/suppliers', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.manage');
    const id = inventoryUuid(req.body.id), data = collection === 'inventory_items' ? parseInventoryItem(req.body) : parseInventorySupplier(req.body);
    const requestHash = hash([collection, id, data]), old = await replay(tx, actor, id, requestHash);
    if (old) return old;
    if ((await tx.get(db.collection(collection).doc(id))).exists) inventoryFail(409, 'RECORD_EXISTS', 'This record identifier already exists.');
    if (collection === 'inventory_items') {
      if ('categoryId' in data && data.categoryId !== null) {
        const category = (await tx.get(db.collection('inventory_categories').doc(data.categoryId!))).data();
        if (!category) inventoryFail(404, 'NOT_FOUND', 'Inventory category not found.');
        if (category.active !== true) inventoryFail(409, 'CATEGORY_INACTIVE', 'This category is inactive. Choose an active category or leave the item uncategorized.');
        data.category = inventoryText(category.name, 80, 'category name', true);
      }
      const collision = (await tx.get(db.collection(collection))).docs.some(d => String(d.data()?.sku || '').trim().toLowerCase() === (data as ReturnType<typeof parseInventoryItem>).sku.toLowerCase());
      if (collision) inventoryFail(409, 'SKU_EXISTS', 'This SKU is already in use.');
    }
    tx.create(db.collection(collection).doc(id), data);
    const result = { id };
    await saveCommand(tx, actor, id, collection === 'inventory_items' ? 'item_create' : 'supplier_create', requestHash, result);
    audit(tx, actor, collection === 'inventory_items' ? 'item_created' : 'supplier_created', id, null);
    return { status: 201, body: result };
  });
  route('post', '/api/inventory/movements', async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.manage');
    const commandId = inventoryUuid(req.body.commandId), action = req.body.action;
    if (!['receive', 'use', 'adjust'].includes(action)) inventoryFail(400, 'INVALID_ACTION', 'Choose receive, use or correction.');
    const itemId = inventoryRecordId(req.body.itemId), branchId = await branch(tx, actor, req.body.branchId, 'inventory.manage');
    if (action === 'adjust' && !hasAdministrativeAccess(actor.profile.role)) inventoryFail(403, 'ADMIN_REQUIRED', 'Only an administrator can correct stock.');
    const quantity = inventoryQuantity(req.body.quantity, action === 'adjust'), occurredAt = inventoryOccurredAt(req.body.occurredAt),
      notes = inventoryText(req.body.notes, 2000, 'notes', action === 'adjust'), reference = inventoryText(req.body.reference, 160, 'reference');
    const expectedVersion = action === 'adjust' ? req.body.expectedVersion : undefined;
    if (action === 'adjust' && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) inventoryFail(400, 'INVALID_VERSION', 'Reload the stock balance before correcting it.');
    const supplierId = req.body.supplierId === undefined || req.body.supplierId === '' ? undefined : inventoryRecordId(req.body.supplierId);
    if (supplierId && action !== 'receive') inventoryFail(400, 'INVALID_SUPPLIER', 'A supplier can only be recorded for received stock.');
    const requestHash = hash(['movement', action, itemId, branchId, quantity, occurredAt, notes, reference, supplierId ?? null, expectedVersion ?? null]);
    const old = await replay(tx, actor, commandId, requestHash); if (old) return old;
    await branch(tx, actor, branchId, 'inventory.manage', true); await item(tx, itemId);
    let supplierName: string | undefined;
    if (supplierId) {
      const supplier = (await tx.get(db.collection('suppliers').doc(supplierId))).data();
      if (!supplier) inventoryFail(404, 'NOT_FOUND', 'Supplier not found.');
      supplierName = String(supplier.name || '');
    }
    const a = await account(tx, actor, itemId, branchId);
    if (action === 'adjust' && expectedVersion !== a.version) inventoryFail(409, 'STOCK_VERSION_CHANGED', 'The stock balance changed. Reload it and review your correction before saving.');
    const result = await postMovement(tx, actor, a, action === 'use' ? -quantity : quantity, { kind: action, occurredAt, notes, reference, supplierId, supplierName });
    await saveCommand(tx, actor, commandId, action, requestHash, result); audit(tx, actor, 'stock_' + action, result.id, branchId);
    return { status: 201, body: result };
  });
  for (const action of ['create', 'complete']) route('post', `/api/inventory/transfers/${action}`, async (req, tx, actor) => {
    assertCapability(actor.profile, 'inventory.transfer');
    const transferId = action === 'complete' ? inventoryRecordId(req.body.id) : randomUUID();
    const ref = db.collection('stock_transfers').doc(transferId), existing = action === 'complete' ? (await tx.get(ref)).data() : null;
    if (action === 'complete' && !existing) inventoryFail(404, 'NOT_FOUND', 'Transfer not found.');
    const t = existing || req.body;
    const itemId = inventoryRecordId(t.itemId), fromBranchId = await branch(tx, actor, t.fromBranchId, 'inventory.transfer'),
      toBranchId = await branch(tx, actor, t.toBranchId, 'inventory.transfer');
    if (existing?.status === 'completed') return { id: transferId, alreadyCompleted: true };
    if (existing && existing.status !== 'pending') inventoryFail(400, 'NOT_PENDING', 'Transfer is not pending.');
    if (fromBranchId === toBranchId) inventoryFail(400, 'INVALID_TRANSFER', 'Choose different source and destination clinics.');
    const quantity = inventoryQuantity(t.quantity), notes = inventoryText(t.notes, 2000, 'notes');
    // Legacy transfer requests remain accepted. New clients keep a command UUID
    // so a lost response/retry cannot create a second pending transfer.
    const commandId = action === 'create' ? req.body.commandId === undefined ? randomUUID() : inventoryUuid(req.body.commandId) : undefined;
    const requestedAt = action === 'create' && req.body.occurredAt !== undefined ? inventoryOccurredAt(req.body.occurredAt) : null;
    const requestHash = hash(['transfer_create', itemId, fromBranchId, toBranchId, quantity, notes, requestedAt]);
    if (commandId) { const old = await replay(tx, actor, commandId, requestHash); if (old) return old; }
    await item(tx, itemId);
    await branch(tx, actor, fromBranchId, 'inventory.transfer', true); await branch(tx, actor, toBranchId, 'inventory.transfer', true);
    const source = await stockState(tx, itemId, fromBranchId);
    if (source.quantity < quantity) inventoryFail(400, 'INSUFFICIENT_STOCK', 'There is not enough source stock for this transfer.');
    if (action === 'create') {
      const result = { id: transferId };
      // Snapshot only authoritative directory names. Older transfers fall back
      // to currently authorized branch records when read; reads never backfill.
      const fromBranchNameSnapshot = branchRecordName((await tx.get(db.collection('branches').doc(fromBranchId))).data());
      const toBranchNameSnapshot = branchRecordName((await tx.get(db.collection('branches').doc(toBranchId))).data());
      tx.create(ref, { itemId, fromBranchId, toBranchId, quantity, notes, status: 'pending', createdAt: { __operation: 'timestamp' },
        createdBy: actor.identity.uid, ...(requestedAt ? { occurredAt: requestedAt } : {}),
        ...(fromBranchNameSnapshot ? { fromBranchNameSnapshot } : {}), ...(toBranchNameSnapshot ? { toBranchNameSnapshot } : {}) });
      await saveCommand(tx, actor, commandId!, 'transfer_create', requestHash, result); audit(tx, actor, 'transfer_created', transferId, fromBranchId);
      return result;
    }
    const from = await account(tx, actor, itemId, fromBranchId), to = await account(tx, actor, itemId, toBranchId);
    const occurredAt = new Date().toISOString();
    await postMovement(tx, actor, from, -quantity, { kind: 'transfer_out', occurredAt, notes, reference: '', transferId });
    await postMovement(tx, actor, to, quantity, { kind: 'transfer_in', occurredAt, notes, reference: '', transferId });
    tx.update(ref, { status: 'completed', completedAt: occurredAt, completedBy: actor.identity.uid });
    audit(tx, actor, 'transfer_completed', transferId, fromBranchId);
    return { id: transferId };
  });
}
