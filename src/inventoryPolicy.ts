// One base unit per item. Store/compare quantities in thousandths so stock
// arithmetic does not accumulate JavaScript floating point rounding errors.
export const INVENTORY_MAX_QUANTITY = 1_000_000_000;
export class InventoryError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function inventoryFail(status: number, code: string, message: string): never { throw new InventoryError(status, code, message); }
export function inventoryRecordId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) inventoryFail(400, 'INVALID_ID', 'Choose a valid inventory record.');
  return value;
}
export function inventoryUuid(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) inventoryFail(400, 'INVALID_COMMAND', 'A valid command identifier is required.');
  return value.toLowerCase();
}
export function inventoryQuantity(value: unknown, signed = false, allowZero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > INVENTORY_MAX_QUANTITY
    || (!signed && value < 0) || (!allowZero && value === 0) || Math.round(value * 1000) / 1000 !== value) {
    inventoryFail(400, 'INVALID_QUANTITY', 'Enter a valid quantity with at most three decimal places.');
  }
  return Object.is(value, -0) ? 0 : value;
}
export function inventoryText(value: unknown, maximum: number, label: string, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.includes('\u0000') || value.length > maximum || required && !value.trim()) {
    inventoryFail(400, 'INVALID_TEXT', `Enter a valid ${label} (maximum ${maximum} characters).`);
  }
  return value.trim();
}
export function inventoryOccurredAt(value: unknown) {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value) : null;
  const calendar = match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] || '').padEnd(3, '0')}Z` : '';
  const parsedCalendar = Date.parse(calendar);
  if (!match || !Number.isFinite(parsedCalendar) || new Date(parsedCalendar).toISOString() !== calendar
    || match[6] !== 'Z' && (Number(match[7]) > 23 || Number(match[8]) > 59) || !Number.isFinite(Date.parse(value as string))) {
    inventoryFail(400, 'INVALID_DATE', 'Enter a valid stock movement date and time.');
  }
  return new Date(value as string).toISOString();
}
export function parseInventoryItem(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inventoryFail(400, 'INVALID_ITEM', 'Enter item details.');
  const category = Object.hasOwn(value, 'categoryId')
    ? { categoryId: value.categoryId === null ? null : inventoryUuid(value.categoryId), category: '' }
    : { category: inventoryText(value.category, 80, 'category') };
  return { name: inventoryText(value.name, 200, 'item name', true), sku: inventoryText(value.sku, 80, 'SKU', true),
    ...category, unit: inventoryText(value.unit, 40, 'stock unit', true),
    lowStockThreshold: inventoryQuantity(value.lowStockThreshold, false, true) };
}
export function inventoryCategoryName(value: unknown) {
  return inventoryText(value, 80, 'category name', true).replace(/\s+/gu, ' ');
}
export function parseInventoryCategory(value: any, create: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inventoryFail(400, 'INVALID_CATEGORY', 'Enter category details.');
  const id = inventoryUuid(value.id), commandId = inventoryUuid(value.commandId), name = inventoryCategoryName(value.name);
  if (typeof value.active !== 'boolean' || create && value.active !== true) inventoryFail(400, 'INVALID_CATEGORY', 'Choose a valid category status. New categories start active.');
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < (create ? 0 : 1) || create && value.expectedVersion !== 0) {
    inventoryFail(400, 'INVALID_VERSION', 'Reload the category before saving.');
  }
  return { id, commandId, name, active: value.active, expectedVersion: value.expectedVersion as number };
}
export function parseInventorySupplier(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inventoryFail(400, 'INVALID_SUPPLIER', 'Enter supplier details.');
  const email = inventoryText(value.email, 200, 'supplier email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) inventoryFail(400, 'INVALID_EMAIL', 'Enter a valid supplier email.');
  return { name: inventoryText(value.name, 200, 'supplier name', true), contactPerson: inventoryText(value.contactPerson, 120, 'contact person'),
    email, phone: inventoryText(value.phone, 80, 'phone number') };
}
