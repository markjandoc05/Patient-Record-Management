import assert from 'node:assert/strict';
import { appointmentBookingPricePreview, readAppointmentBookingQuote } from '../src/utils/appointmentBookingQuote';

let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
for (const [base, special, total] of [
  ['7000.00', '', '7000.00'], ['7000.00', '5500', '5500.00'],
  ['7000.00', '0', '0.00'], ['0.00', '', '0.00'],
  [null, '100.5', '100.50'], [null, '', null],
  ['9999999999.99', '', '9999999999.99'], ['0.10', '0.29', '0.29'],
] as const) {
  const result = appointmentBookingPricePreview(base, special);
  check(result.total === total && !result.invalid, `Exact booking quote: ${base}/${special}`);
}
for (const value of ['-1', '1.001', '1e3', '₱500', '10000000000']) {
  const result = appointmentBookingPricePreview('7000.00', value);
  check(result.invalid && result.total === null, 'Invalid Special Price cannot become Free or fall back to a misleading total');
}
const record = { branchId: 'A', serviceId: 'service', serviceCatalogueVersion: 1, bookingQuote: {
  version: 1, currency: 'PHP', branchId: 'A', serviceId: 'service', serviceCatalogueVersion: 1,
  servicePrice: '7000.00', specialPrice: '5500.00', total: '5500.00', source: 'special',
  quotedAt: '2026-10-23T00:00:00.000Z', quotedByUid: 'synthetic', quotedByName: 'Synthetic staff',
} };
const original = JSON.stringify(record);
check(readAppointmentBookingQuote(record)?.total === '5500.00', 'Saved quote loads independently of a live catalogue or POS');
check(JSON.stringify(record) === original, 'Reading a quote does not mutate historical data');
for (const change of [{ branchId: 'B' }, { serviceId: 'other' }, { serviceCatalogueVersion: 2 }]) {
  check(readAppointmentBookingQuote({ ...record, ...change }) === null, 'Saved amounts cannot cross booking contexts');
}
for (const change of [{ total: '12500.00' }, { source: 'service' }, { servicePrice: '7e3' }, { currency: 'USD' }, { version: 2 }]) {
  check(readAppointmentBookingQuote({ ...record, bookingQuote: { ...record.bookingQuote, ...change } }) === null, 'Malformed or unsupported saved quote is not displayed as authoritative');
}
check(readAppointmentBookingQuote({ branchId: 'A', serviceId: 'legacy' }) === null, 'Historical bookings without a quote remain unknown');
const unset = { branchId: 'A', bookingQuote: { ...record.bookingQuote, serviceId: null, serviceCatalogueVersion: null,
  servicePrice: null, specialPrice: null, total: null, source: 'unset' } };
check(readAppointmentBookingQuote(unset)?.total === null, 'Explicit Price not set is retained, rather than Free');
console.log(`Appointment Booking Quote: ${checks} checks passed`);
