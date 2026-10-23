// A booking quote only. This does not alter catalogue prices or record a charge.
export function parseAppointmentSpecialPrice(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Enter a valid Special Price with up to two decimal places.');
  const amount = value.trim();
  if (!amount) return null;
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error('Enter a Special Price from ₱0 to ₱9,999,999,999.99 with up to two decimal places.');
  }
  const [whole, fraction = ''] = amount.split('.');
  return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
}

// Missing metadata belongs to the historical revision zero. Do not turn
// malformed metadata into zero, which could allow a stale form to match again.
export function appointmentPricingRevision(record: Record<string, any> | null | undefined): number {
  if (!record || !Object.hasOwn(record, 'bookingPricingRevision')) return 0;
  const revision = record.bookingPricingRevision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid booking pricing revision.');
  return revision;
}
