import { parseAppointmentSpecialPrice } from './appointmentSpecialPrice';

export type AppointmentBookingQuote = {
  version: 1; currency: 'PHP'; branchId: string;
  serviceId: string | null; serviceCatalogueVersion: number | null;
  servicePrice: string | null; specialPrice: string | null; total: string | null;
  source: 'service' | 'special' | 'unset';
  quotedAt: string; quotedByUid: string; quotedByName: string;
};

// Saved quotes are historical values, never resolved from today's catalogue.
export function readAppointmentBookingQuote(record: any): AppointmentBookingQuote | null {
  const quote = record?.bookingQuote;
  if (!quote || quote.version !== 1 || quote.currency !== 'PHP'
    || quote.branchId !== record.branchId
    || quote.serviceId !== (record.serviceId ?? null)
    || quote.serviceCatalogueVersion !== (record.serviceCatalogueVersion ?? null)) return null;
  try {
    for (const key of ['servicePrice', 'specialPrice', 'total'] as const) {
      if (quote[key] !== null && (typeof quote[key] !== 'string' || parseAppointmentSpecialPrice(quote[key]) !== quote[key])) return null;
    }
    const total = quote.specialPrice ?? quote.servicePrice;
    const source = quote.specialPrice !== null ? 'special' : quote.servicePrice !== null ? 'service' : 'unset';
    return quote.total === total && quote.source === source ? quote : null;
  } catch { return null; }
}

export function appointmentBookingPricePreview(servicePrice: string | null, specialPrice: string) {
  try {
    const special = parseAppointmentSpecialPrice(specialPrice);
    const base = parseAppointmentSpecialPrice(servicePrice);
    return { servicePrice: base, specialPrice: special, total: special ?? base, invalid: false };
  } catch { return { servicePrice, specialPrice: null, total: null, invalid: true }; }
}
