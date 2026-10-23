export type VisitPosLaunch = { patientId: string; branchId: string; visitId: string; invoiceId?: string };
export type VisitBillingInvoice = {
  id: string; number: number | string; state: 'draft' | 'posted' | 'void';
  paymentStatus: 'unpaid' | 'partial' | 'paid' | null;
  totalCents: number; paidCents: number; outstandingCents: number; visitLineCents: number;
  // Missing provenance from an older server is not an authoritative zero amount.
  visitAmountSource?: 'visit' | 'linked_booking' | 'mixed' | 'unavailable';
  visitQuoteComparable?: boolean;
};
export type VisitBillingSummary = {
  visitId: string; packageSessionUsed: boolean; invoices: VisitBillingInvoice[];
  hasMoreInvoices: boolean; billingUnavailable: boolean; canCreateInvoice: boolean;
};
