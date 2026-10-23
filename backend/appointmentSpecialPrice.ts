import { appointmentPricingRevision, parseAppointmentSpecialPrice } from '../src/utils/appointmentSpecialPrice';

export class AppointmentSpecialPriceError extends Error {
  constructor(public status: number, message: string, public code = 'SPECIAL_PRICE_INVALID') { super(message); }
}

const attributionFields = ['specialPriceUpdatedAt', 'specialPriceUpdatedByUid', 'specialPriceUpdatedByName'] as const;

// The command is deliberately separate from the authoritative Service snapshot.
// An omitted field retains a booking quote; null explicitly removes it.
export function parseSpecialPriceCommand(payload: Record<string, unknown>): string | null | undefined {
  if (Object.hasOwn(payload, 'bookingPricingRevision')) {
    throw new AppointmentSpecialPriceError(400, 'Booking pricing revision is supplied by the server.');
  }
  if (attributionFields.some(field => Object.hasOwn(payload, field))) {
    throw new AppointmentSpecialPriceError(400, 'Special Price attribution is supplied by the server.');
  }
  if (!Object.hasOwn(payload, 'specialPrice')) return undefined;
  try { return parseAppointmentSpecialPrice(payload.specialPrice); }
  catch (error) { throw new AppointmentSpecialPriceError(400, error instanceof Error ? error.message : 'Invalid Special Price.'); }
}

// A precondition only: this client field must never enter the saved record.
export function parseExpectedPricingRevision(payload: Record<string, unknown>): number | undefined {
  if (!Object.hasOwn(payload, 'expectedPricingRevision')) return undefined;
  const revision = payload.expectedPricingRevision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
    throw new AppointmentSpecialPriceError(400, 'Expected booking pricing revision must be a nonnegative integer.');
  }
  return Number(revision);
}

function savedPricingRevision(previous?: Record<string, any>): number {
  try { return appointmentPricingRevision(previous); }
  catch { throw new AppointmentSpecialPriceError(409, 'Booking pricing metadata needs review before changing the quote.', 'SPECIAL_PRICE_CONTEXT_CHANGED'); }
}

export function assertSpecialPriceRevision(command: string | null | undefined, expected: number | undefined, previous: Record<string, any>) {
  if (command !== undefined && (expected === undefined || expected !== savedPricingRevision(previous))) {
    throw new AppointmentSpecialPriceError(409, 'Booking pricing changed. Reload the appointment and review Special Price before saving. Your draft has not been saved.', 'SPECIAL_PRICE_CONTEXT_CHANGED');
  }
}

export function nextBookingPricingRevision(previous?: Record<string, any>): number {
  const revision = savedPricingRevision(previous);
  if (revision === Number.MAX_SAFE_INTEGER) {
    throw new AppointmentSpecialPriceError(409, 'Booking pricing revision limit reached. The quote was not changed.', 'SPECIAL_PRICE_CONTEXT_CHANGED');
  }
  return revision + 1;
}

export function appointmentSpecialPriceUpdates(
  command: string | null | undefined,
  context: Record<string, any>,
  actor: { uid: string; name: string; now: string },
  previous?: Record<string, any>
): Record<string, any> {
  const previousPrice = previous?.specialPrice ?? null;
  const contextChanged = !!previous && ['branchId', 'serviceId', 'serviceCatalogueVersion']
    .some(field => (previous[field] ?? null) !== (context[field] ?? null));
  if (previousPrice !== null && contextChanged && command === undefined) {
    throw new AppointmentSpecialPriceError(409, 'Review Special Price for the changed Service or clinic before saving.', 'SPECIAL_PRICE_REVIEW_REQUIRED');
  }
  if (command === undefined || command === previousPrice && (!contextChanged || command === null)) return {};
  return {
    specialPrice: command,
    specialPriceUpdatedAt: actor.now,
    specialPriceUpdatedByUid: actor.uid,
    specialPriceUpdatedByName: actor.name,
  };
}
