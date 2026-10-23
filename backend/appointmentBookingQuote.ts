import type { RecordTransaction } from './database';
import { AppointmentServiceError, type AppointmentServiceSelection } from './appointmentServices';
import { parseAppointmentSpecialPrice } from '../src/utils/appointmentSpecialPrice';
import { nextBookingPricingRevision } from './appointmentSpecialPrice';

export class AppointmentBookingQuoteError extends Error {
  constructor(public status: number, message: string, public code = 'BOOKING_QUOTE_INVALID') { super(message); }
}

// The client submits only Service selection and optional Special Price commands.
// Neither a calculated amount nor quote attribution may cross this write boundary.
export function assertBookingQuoteServerOwned(payload: Record<string, unknown>) {
  if (Object.keys(payload).some(field => field === 'bookingQuote' || field.startsWith('bookingQuote')
    || ['quotedAt', 'quotedByUid', 'quotedByName', 'servicePrice', 'bookingTotal', 'quoteTotal', 'quoteSource', 'quoteCurrency'].includes(field))) {
    throw new AppointmentBookingQuoteError(400, 'Booking Price Summary is calculated by the server.');
  }
}

const quoteContextFields = ['branchId', 'serviceId', 'serviceCatalogueVersion'] as const;
const sameContext = (left: Record<string, any>, right: Record<string, any>) =>
  quoteContextFields.every(field => (left[field] ?? null) === (right[field] ?? null));

function knownAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try { return parseAppointmentSpecialPrice(value); }
  catch { return null; } // A historical malformed value cannot invent a quoted amount.
}

export async function appointmentBookingQuoteUpdates(
  transaction: RecordTransaction,
  selection: AppointmentServiceSelection,
  specialPriceCommand: string | null | undefined,
  context: Record<string, any>,
  actor: { uid: string; name: string; now: string },
  previous?: Record<string, any>
): Promise<Record<string, any>> {
  const contextChanged = !!previous && (!sameContext(previous, context) || previous.patientId !== context.patientId);
  const specialPriceChanged = specialPriceCommand !== undefined
    && specialPriceCommand !== (previous?.specialPrice ?? null);
  if (previous && selection === undefined && !contextChanged && !specialPriceChanged) return {};

  let servicePrice: string | null = null;
  if (selection) {
    // Selection eligibility/version was checked by appointmentServiceSnapshot in
    // this same advisory-locked transaction. Read only the authorized branch.
    const row = (await transaction.sql(`SELECT COALESCE(bs.price_override, s.standard_price)::text AS price
      FROM services s
      JOIN service_branch_settings bs ON bs.service_id=s.id AND bs.branch_id=$2
      WHERE s.id=$1 AND s.version=$3 AND s.active=true AND bs.available=true`,
    [selection.serviceId, context.branchId, selection.expectedVersion])).rows[0];
    servicePrice = knownAmount(row?.price);
    if (servicePrice === null) throw new AppointmentServiceError(409, 'This Service changed. Reload Services and choose it again.', 'SERVICE_VERSION_CHANGED');
  } else if (selection === undefined && previous?.bookingQuote?.version === 1
    && previous.bookingQuote.currency === 'PHP' && sameContext(previous.bookingQuote, context)) {
    // Editing only Special Price uses the original quote, even if the catalogue
    // was renamed, repriced or deactivated after booking.
    servicePrice = knownAmount(previous.bookingQuote.servicePrice);
  }
  const specialPrice = knownAmount(context.specialPrice);
  const total = specialPrice ?? servicePrice;
  return {
    bookingPricingRevision: nextBookingPricingRevision(previous),
    bookingQuote: {
      version: 1,
      currency: 'PHP',
      branchId: context.branchId,
      serviceId: context.serviceId ?? null,
      serviceCatalogueVersion: context.serviceCatalogueVersion ?? null,
      servicePrice,
      specialPrice,
      total,
      source: specialPrice !== null ? 'special' : servicePrice !== null ? 'service' : 'unset',
      quotedAt: actor.now,
      quotedByUid: actor.uid,
      quotedByName: actor.name,
    },
  };
}
