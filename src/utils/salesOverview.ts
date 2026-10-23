export type SalesPeriodMetrics = {
  sales: number; received: number; reversed: number; collected: number;
  invoiceCount: number; averageInvoiceCents: number;
};
export type SalesMetrics = SalesPeriodMetrics & { outstanding: number };
export const salesSourceKinds = ['visit', 'appointment', 'service', 'package', 'unclassified'] as const;
export type SalesSourceKind = typeof salesSourceKinds[number];
export type SalesSourceTotal = { kind: SalesSourceKind; sales: number; lineCount: number };
export const salesSourceName = (kind: SalesSourceKind) => ({ visit: 'Visit billing', appointment: 'Appointment billing', service: 'Catalogue Services', package: 'Package purchases', unclassified: 'Unclassified historical items' }[kind]);
export type SalesBranch = SalesMetrics & { id: string; name: string; sources: SalesSourceTotal[] };
export type SalesOverviewData = {
  from: string; to: string; timezone: string; generatedAt: string;
  previousFrom: string; previousTo: string;
  branches: SalesBranch[]; totals: SalesMetrics; previous: SalesPeriodMetrics; salesSources: SalesSourceTotal[];
  trend: { date: string; sales: number; received: number; reversed: number; collected: number; invoiceCount: number }[];
  paymentMethods: { method: string; received: number; reversed: number; collected: number }[];
};
export type SalesRecordKind = 'sales' | 'payments' | 'corrections' | 'outstanding';
export type SalesRecordSource = {
  kind: SalesSourceKind; name: string; amountCents: number;
  // Clinical references are supplied only after the server checks their own
  // capability and current patient/clinic context. Aggregate exports omit them.
  sourceId?: string; linkedVisitIds?: string[]; hasMoreLinkedVisits?: boolean;
};
export type SalesRecordsData = {
  records: { id: string; invoiceId: string; invoiceNumber: number | string; branchId: string; branchName: string; patientName: string; at: string; kind: SalesRecordKind; method: string | null; amountCents: number; invoiceTotalCents: number; sources: SalesRecordSource[] }[];
  total: number; page: number; pageSize: number;
};
export const salesCurrency = (cents: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
export const salesMethodName = (method: string) => ({ cash: 'Cash', card: 'Card', gcash: 'GCash', bank: 'Bank transfer' }[method] || method);
export const salesDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function salesRange(preset: string): { from: string; to: string } {
  const to = salesDay();
  const date = new Date(`${to}T12:00:00Z`);
  if (preset === 'yesterday') date.setUTCDate(date.getUTCDate() - 1);
  if (preset === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (preset === 'month') date.setUTCDate(1);
  const from = date.toISOString().slice(0, 10);
  return { from, to: preset === 'yesterday' ? from : to };
}
export function salesRangeError(from: string, to: string): string {
  const realDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!realDate(from) || !realDate(to) || from < '1900-01-01' || to > '9999-12-31' || from > to) return 'Choose a valid start and end date.';
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= 366) return 'Choose a range of up to 366 days.';
  return '';
}
