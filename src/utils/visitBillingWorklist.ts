import type { VisitBillingSummary } from './visitBilling';

export type VisitBillingWorklistStatus = 'unbilled' | 'draft' | 'missing_price' | 'package' | 'billed' | 'review';
export type VisitBillingWorklistFilter = 'attention' | 'all' | Exclude<VisitBillingWorklistStatus, 'review'>;
export type VisitBillingWorklistRow = {
  id: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  branchId: string;
  branchName: string;
  visitDate: string;
  serviceName: string;
  quoteTotal: string | null;
  status: VisitBillingWorklistStatus;
  summary: VisitBillingSummary;
};
export type VisitBillingWorklistResponse = {
  visits: VisitBillingWorklistRow[];
  total: number;
  page: number;
  pageSize: 25;
};
