import assert from 'node:assert/strict';
import { inventoryQuantity, inventoryOccurredAt, parseInventoryItem, parseInventorySupplier } from '../src/inventoryPolicy';

let checks = 0;
for (const quantity of [0.001, 0.125, 1, 999999999.999, 1000000000]) {
  assert.equal(inventoryQuantity(quantity), quantity); checks++;
}
for (const value of [0, -1, 0.0001, 1.2345, 1000000000.001, NaN, Infinity, '1', null, undefined]) {
  assert.throws(() => inventoryQuantity(value)); checks++;
}
assert.equal(inventoryQuantity(-0.125, true), -0.125); checks++;
assert.equal(inventoryQuantity(0, false, true), 0); checks++;
for (const value of ['2036-02-29T10:30:00Z', '2035-01-01T10:30:00+08:00']) {
  assert.equal(inventoryOccurredAt(value), new Date(value).toISOString()); checks++;
}
for (const value of ['2035-02-29T10:00:00Z', '2036-02-30T10:00:00Z', '2035-04-31T10:00:00Z',
  '2035-01-01T10:00', '2035-01-01', '2035-01-01T25:00:00Z', '2035-01-01T10:00:00+25:00', 'invalid', null]) {
  assert.throws(() => inventoryOccurredAt(value), 'invalid calendar/zone must not be normalized'); checks++;
}
const item = { name: ' Synthetic cream ', sku: ' CREAM-1 ', unit: ' bottle ', category: ' Consumables ', lowStockThreshold: 2.5 };
assert.deepEqual(parseInventoryItem(item), { name: 'Synthetic cream', sku: 'CREAM-1', unit: 'bottle', category: 'Consumables', lowStockThreshold: 2.5 }); checks++;
for (const extra of [{ name: '' }, { sku: ' ' }, { unit: '' }, { lowStockThreshold: -1 }, { lowStockThreshold: 0.0001 }, { category: 'x'.repeat(81) }]) {
  assert.throws(() => parseInventoryItem({ ...item, ...extra })); checks++;
}
assert.equal(parseInventorySupplier({ name: 'Synthetic supplier' }).name, 'Synthetic supplier'); checks++;
assert.throws(() => parseInventorySupplier({ name: 'Synthetic supplier', email: 'broken' })); checks++;
assert.throws(() => parseInventorySupplier({ name: ' ' })); checks++;
console.log(`${checks}/${checks} inventory policy checks passed.`);
