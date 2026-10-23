import assert from 'node:assert/strict';
import { appointmentPricingRevision, parseAppointmentSpecialPrice } from '../src/utils/appointmentSpecialPrice';
import { assertSpecialPriceRevision, nextBookingPricingRevision, parseExpectedPricingRevision, parseSpecialPriceCommand } from '../backend/appointmentSpecialPrice';

let checks = 0;
for (const [input, expected] of [
  [null, null], ['', null], ['  ', null], ['0', '0.00'], ['0.00', '0.00'],
  ['6000', '6000.00'], [' 6000.5 ', '6000.50'], ['00006000.50', '6000.50'],
  ['0.01', '0.01'], ['9999999999.99', '9999999999.99'],
] as const) {
  assert.equal(parseAppointmentSpecialPrice(input), expected); checks++;
}
for (const input of [undefined, 0, 6000, NaN, Infinity, {}, [], true, '-1', '-0', '+1', '1e3', '1,000', '₱6000', '.50', '1.', '0.001', '10000000000', '6000\u0000', 'x'.repeat(100)]) {
  assert.throws(() => parseAppointmentSpecialPrice(input), /Special Price/); checks++;
}
for (const record of [null, undefined, {}, { specialPrice: '12.00' }]) {
  assert.equal(appointmentPricingRevision(record), 0); checks++;
}
for (const bookingPricingRevision of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
  assert.equal(appointmentPricingRevision({ bookingPricingRevision }), bookingPricingRevision); checks++;
}
for (const bookingPricingRevision of [null, undefined, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => appointmentPricingRevision({ bookingPricingRevision }), /revision/); checks++;
}
assert.equal(nextBookingPricingRevision({}), 1); checks++;
assert.equal(nextBookingPricingRevision({ bookingPricingRevision: 41 }), 42); checks++;
assert.throws(() => nextBookingPricingRevision({ bookingPricingRevision: Number.MAX_SAFE_INTEGER }), /limit/); checks++;
assert.throws(() => parseSpecialPriceCommand({ bookingPricingRevision: 0 }), /server/); checks++;
assert.equal(parseExpectedPricingRevision({}), undefined); checks++;
assert.equal(parseExpectedPricingRevision({ expectedPricingRevision: 0 }), 0); checks++;
for (const expectedPricingRevision of [null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => parseExpectedPricingRevision({ expectedPricingRevision }), /nonnegative integer/); checks++;
}
for (const command of ['12.00', null]) {
  assert.throws(() => assertSpecialPriceRevision(command, undefined, {}), /pricing changed/); checks++;
  assert.throws(() => assertSpecialPriceRevision(command, 1, { bookingPricingRevision: 2 }), /pricing changed/); checks++;
  assert.doesNotThrow(() => assertSpecialPriceRevision(command, 2, { bookingPricingRevision: 2 })); checks++;
}
assert.doesNotThrow(() => assertSpecialPriceRevision(undefined, undefined, {})); checks++;
console.log(`${checks}/${checks} appointment Special Price parsing checks passed.`);
