import { appointmentPricingRevision, parseAppointmentSpecialPrice } from './appointmentSpecialPrice';
import { readAppointmentBookingQuote, type AppointmentBookingQuote } from './appointmentBookingQuote';

export type BookingContext = { pricingRevision: number; serviceId: string | null; serviceCatalogueVersion: number | null };
export function expectedBookingContext(record: any): BookingContext {
  return { pricingRevision: appointmentPricingRevision(record), serviceId: record?.serviceId ?? null,
    serviceCatalogueVersion: record?.serviceCatalogueVersion ?? null };
}
export type VisitPriceQuote = AppointmentBookingQuote & {
  bookingAppointmentId: string | null; bookingPricingRevision: number | null;
};
export function readVisitPriceQuote(visit: any): VisitPriceQuote | null {
  return readAppointmentBookingQuote({ ...visit, bookingQuote: visit?.visitQuote }) as VisitPriceQuote | null;
}
export function samePerformedService(record: any, branchId: string, serviceId: string | null, version: number | null) {
  return Boolean(record) && record.branchId === branchId && (record.serviceId ?? null) === serviceId
    && (record.serviceCatalogueVersion ?? null) === version;
}
export function bookedSpecialPrice(booking: any): string {
  const saved = readAppointmentBookingQuote(booking);
  try { return parseAppointmentSpecialPrice(saved ? saved.specialPrice : booking?.specialPrice ?? null) ?? ''; }
  catch { return ''; }
}
