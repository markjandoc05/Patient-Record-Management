import type { RecordTransaction } from './database';
import { AppointmentServiceError, type AppointmentServiceSelection } from './appointmentServices';
import { appointmentPricingRevision, parseAppointmentSpecialPrice } from '../src/utils/appointmentSpecialPrice';
import { readAppointmentBookingQuote } from '../src/utils/appointmentBookingQuote';

export class VisitPricingError extends Error {
  constructor(public status: number, message: string, public code = 'VISIT_PRICE_INVALID') { super(message); }
}

// Only a command and a freshness precondition cross the write boundary. Saved
// amounts, attribution and booking provenance are calculated inside the lock.
export function assertVisitQuoteServerOwned(payload: Record<string, unknown>) {
  const forbidden = ['bookingQuote', 'bookingPricingRevision', 'quotedAt', 'quotedByUid', 'quotedByName',
    'servicePrice', 'visitTotal', 'bookingTotal', 'quoteTotal', 'quoteSource', 'quoteCurrency',
    'specialPriceUpdatedAt', 'specialPriceUpdatedByUid', 'specialPriceUpdatedByName',
    'bookingAppointmentId'];
  if (Object.keys(payload).some(field => field.startsWith('visitQuote') || field.startsWith('bookingQuote')
    || forbidden.includes(field))) {
    throw new VisitPricingError(400, 'Visit Price Summary and quote attribution are calculated by the server.');
  }
}

export function parseVisitSpecialPriceCommand(payload: Record<string, unknown>): string | null | undefined {
  assertVisitQuoteServerOwned(payload);
  if (!Object.hasOwn(payload, 'specialPrice')) return undefined;
  try { return parseAppointmentSpecialPrice(payload.specialPrice); }
  catch (error) { throw new VisitPricingError(400, error instanceof Error ? error.message : 'Invalid Special Price.'); }
}

export function assertExpectedBookingContext(payload: Record<string, unknown>, appointment: Record<string, any>) {
  const value = payload.expectedBookingContext;
  if (value === undefined) throw new VisitPricingError(409,
    'Reload the linked appointment and review its Service and quote before creating this Visit. Your draft has not been saved.',
    'APPOINTMENT_BOOKING_REVIEW_REQUIRED');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VisitPricingError(400, 'Invalid expected booking context.');
  }
  const expected = value as Record<string, unknown>;
  if (Object.keys(expected).length !== 3
    || Object.keys(expected).some(key => !['pricingRevision', 'serviceId', 'serviceCatalogueVersion'].includes(key))
    || !Number.isSafeInteger(expected.pricingRevision) || Number(expected.pricingRevision) < 0
    || !(expected.serviceId === null || typeof expected.serviceId === 'string')
    || !(expected.serviceCatalogueVersion === null || Number.isSafeInteger(expected.serviceCatalogueVersion)
      && Number(expected.serviceCatalogueVersion) > 0)) {
    throw new VisitPricingError(400, 'Invalid expected booking context.');
  }
  let revision: number;
  try { revision = appointmentPricingRevision(appointment); }
  catch { throw new VisitPricingError(409, 'Booking pricing metadata needs review before creating this Visit.', 'APPOINTMENT_BOOKING_CHANGED'); }
  if (expected.pricingRevision !== revision || expected.serviceId !== (appointment.serviceId ?? null)
    || expected.serviceCatalogueVersion !== (appointment.serviceCatalogueVersion ?? null)) {
    throw new VisitPricingError(409,
      'The appointment Service or quote changed. Review the latest booking before saving. Your draft has not been saved.',
      'APPOINTMENT_BOOKING_CHANGED');
  }
}

const sameContext = (left: Record<string, any>, right: Record<string, any>) =>
  ['branchId', 'serviceId', 'serviceCatalogueVersion'].every(field => (left[field] ?? null) === (right[field] ?? null));

function amount(value: unknown): string | null {
  try { return value === undefined ? null : parseAppointmentSpecialPrice(value); }
  catch { return null; }
}

// A malformed historical quote is never interpreted as a newly computed amount.
function previousQuote(record?: Record<string, any>) {
  const quote = record?.visitQuote;
  if (!quote || !readAppointmentBookingQuote({ ...record, bookingQuote: quote })) return null;
  if (!(quote.bookingAppointmentId === null || typeof quote.bookingAppointmentId === 'string')
    || !(quote.bookingPricingRevision === null || Number.isSafeInteger(quote.bookingPricingRevision)
      && quote.bookingPricingRevision >= 0)) return null;
  return quote;
}

export async function visitPriceQuoteUpdates(
  transaction: RecordTransaction,
  selection: AppointmentServiceSelection,
  specialPriceCommand: string | null | undefined,
  context: Record<string, any>,
  actor: { uid: string; name: string; now: string },
  previous?: Record<string, any>,
  appointment?: Record<string, any>
): Promise<Record<string, any>> {
  const prior = previousQuote(previous);
  const changed = !!previous && !sameContext(previous, context);
  if (previous && selection === undefined && !changed && specialPriceCommand === undefined) return {};
  if (changed && prior?.specialPrice !== null && prior?.specialPrice !== undefined && specialPriceCommand === undefined) {
    throw new VisitPricingError(409, 'Review Special Price for the changed performed Service or clinic before saving.', 'VISIT_PRICE_REVIEW_REQUIRED');
  }

  const bookedQuote = appointment && sameContext(appointment, context) ? readAppointmentBookingQuote(appointment) : null;
  const matchesBooking = !previous && !!appointment && sameContext(appointment, context);
  let servicePrice: string | null = null;
  let inheritedSpecial: string | null = null;
  let bookingAppointmentId: string | null = null;
  let bookingPricingRevision: number | null = null;
  if (prior && !changed) {
    servicePrice = prior.servicePrice;
    inheritedSpecial = prior.specialPrice;
    bookingAppointmentId = prior.bookingAppointmentId;
    bookingPricingRevision = prior.bookingPricingRevision;
  } else if (matchesBooking && bookedQuote) {
    servicePrice = bookedQuote.servicePrice;
    inheritedSpecial = bookedQuote.specialPrice;
    bookingAppointmentId = context.appointmentId;
    bookingPricingRevision = appointmentPricingRevision(appointment);
  } else {
    if (selection) {
      // Service eligibility/version was checked in this same authorized lock.
      const row = (await transaction.sql(`SELECT COALESCE(bs.price_override, s.standard_price)::text AS price
        FROM services s JOIN service_branch_settings bs ON bs.service_id=s.id AND bs.branch_id=$2
        WHERE s.id=$1 AND s.version=$3 AND s.active=true AND bs.available=true`,
      [selection.serviceId, context.branchId, selection.expectedVersion])).rows[0];
      servicePrice = amount(row?.price);
      if (servicePrice === null) throw new AppointmentServiceError(409,
        'This Service changed. Reload Services and choose it again.', 'SERVICE_VERSION_CHANGED');
    }
    if (matchesBooking) {
      inheritedSpecial = amount(appointment.specialPrice);
      bookingAppointmentId = context.appointmentId;
      bookingPricingRevision = appointmentPricingRevision(appointment);
    }
  }
  const specialPrice = specialPriceCommand === undefined ? inheritedSpecial : specialPriceCommand;
  return { visitQuote: {
    version: 1, currency: 'PHP', branchId: context.branchId,
    serviceId: context.serviceId ?? null, serviceCatalogueVersion: context.serviceCatalogueVersion ?? null,
    servicePrice, specialPrice, total: specialPrice ?? servicePrice,
    source: specialPrice !== null ? 'special' : servicePrice !== null ? 'service' : 'unset',
    quotedAt: actor.now, quotedByUid: actor.uid, quotedByName: actor.name,
    bookingAppointmentId, bookingPricingRevision,
  } };
}
