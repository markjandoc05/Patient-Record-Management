import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { hasCapability, hasBranchScope, permissionScopeKey } from '../permissions';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { packagesRequest } from '../utils/packageCatalogueApi';
import { readVisitPriceQuote } from '../utils/visitPricingPolicy';
import { subscribeBillingRefresh } from '../utils/billingRefresh';
import { moneyCents } from '../posPolicy';
import type { VisitBillingSummary, VisitPosLaunch } from '../utils/visitBilling';

const currency = (cents: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
const quoteAmount = (value: string) => value === '0.00' || Number(value) === 0 ? 'Free' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
const hasVisitAmount = (invoice: VisitBillingSummary['invoices'][number]) => ['visit', 'linked_booking', 'mixed'].includes(invoice.visitAmountSource ?? '')
  && Number.isSafeInteger(invoice.visitLineCents) && invoice.visitLineCents >= 0;
function visitAmountLabel(invoice: VisitBillingSummary['invoices'][number]) {
  const subject = invoice.visitAmountSource === 'visit' ? 'this Visit' : invoice.visitAmountSource === 'linked_booking' ? 'the linked booking' : 'this Visit / linked booking';
  return invoice.state === 'draft' ? `Draft amount for ${subject}` : invoice.state === 'void' ? `Voided amount for ${subject}` : `Billed for ${subject}`;
}

// Cached Visit records are not authority. Check the current permission mirror and
// the rendered profile before revealing a saved quote or requesting financial data.
export function canReadVisitPrice(profile: any, visit: any) {
  const current = currentPermissionProfile();
  return Boolean(auth.currentUser?.uid && profile && visit?.id && hasBranchScope(profile, visit.branchId)
    && (!current || hasBranchScope(current, visit.branchId))
    && hasCapability(profile, 'patients.view') && hasCapability(profile, 'visits.view')
    && uiCan(profile, 'patients.view') && uiCan(profile, 'visits.view'));
}
function canReadBilling(profile: any, visit: any) {
  return canReadVisitPrice(profile, visit) && hasCapability(profile, 'pos.view', { branchId: visit.branchId }) && uiCan(profile, 'pos.view');
}
export function VisitSavedPrice({ visit, userProfile, detailed = false }: { visit: any; userProfile: any; detailed?: boolean }) {
  if (!canReadVisitPrice(userProfile, visit)) return null;
  const quote = readVisitPriceQuote(visit);
  const amount = quote?.total == null ? 'Price not recorded' : quoteAmount(quote.total);
  if (!detailed) return <p className="mt-1 text-xs font-medium text-slate-700" aria-label="Saved Visit price">{amount}{quote?.total != null && <span className="font-normal text-slate-500"> · {quote.source === 'special' ? 'Special Price' : 'Service price'}</span>}</p>;
  return <section aria-label="Visit Price Summary" className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
    <h3 className="font-semibold text-slate-900">Visit Price Summary</h3>
    {quote?.servicePrice != null && <div className="flex justify-between gap-3"><span className="text-slate-500">Saved Service price</span><span>{quoteAmount(quote.servicePrice)}</span></div>}
    {quote?.specialPrice != null && <div className="flex justify-between gap-3"><span className="text-slate-500">Special Price</span><span>{quoteAmount(quote.specialPrice)}</span></div>}
    <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold"><span>Visit total (quote)</span><span>{amount}</span></div>
    <p className="text-xs text-slate-500">Saved quote; payments are recorded in POS. Catalogue changes do not change this amount.</p>
  </section>;
}

export type VisitBillingRead = { status: 'unavailable' | 'loading' | 'ready' | 'error'; summaries: Record<string, VisitBillingSummary>; retry: () => void };
export function useVisitBilling(visits: any[], userProfile: any, activeBranchId?: string): VisitBillingRead {
  const [epoch, setEpoch] = useState(0), [retryCount, setRetryCount] = useState(0);
  const [blockedScope, setBlockedScope] = useState<string | null>(null);
  const live = useRef(''), denialScopeRef = useRef('');
  useEffect(() => subscribeProtectedDataInvalidation(() => {
    live.current = '';
    setBlockedScope(denialScopeRef.current);
    setEpoch(value => value + 1);
  }), []);
  // Passive refresh changes request lifetime, not the authority/retry lifetime.
  // A denied scope stays paused until explicit retry or an actual scope change.
  useEffect(() => subscribeBillingRefresh(() => setEpoch(value => value + 1)), []);
  const allowed = visits.filter(visit => canReadBilling(userProfile, visit));
  const ids = [...new Set(allowed.map(visit => String(visit.id)))].slice(0, 50);
  const contexts = ids.map(id => { const visit = allowed.find(row => String(row.id) === id); return [id, visit.branchId, visit.patientId, visit.appointmentId, visit.isArchived, visit.updatedAt, visit.visitVersion, visit.version, visit.serviceId, visit.serviceCatalogueVersion, visit.visitQuote]; });
  const mirroredProfile = currentPermissionProfile();
  const denialScope = JSON.stringify([auth.currentUser?.uid,
    [userProfile?.role, userProfile?.active, userProfile?.isArchived, userProfile?.accountStatus, userProfile?.assignedBranches, permissionScopeKey(userProfile)],
    [mirroredProfile?.role, mirroredProfile?.active, mirroredProfile?.isArchived, mirroredProfile?.accountStatus, mirroredProfile?.assignedBranches, permissionScopeKey(mirroredProfile)],
    uiPermissionScope(userProfile), activeBranchId, retryCount]);
  denialScopeRef.current = denialScope;
  const paused = blockedScope === denialScope;
  const scope = JSON.stringify([denialScope, contexts, epoch]);
  live.current = paused ? '' : scope;
  const [read, setRead] = useState<{ scope: string; status: 'loading' | 'ready' | 'error'; summaries: Record<string, VisitBillingSummary> }>({ scope: '', status: 'loading', summaries: {} });
  useLayoutEffect(() => {
    if (!ids.length || paused) return;
    const controller = new AbortController();
    const current = () => live.current === scope && !controller.signal.aborted;
    setRead({ scope, status: 'loading', summaries: {} });
    packagesRequest('/api/pos/visit-billing?' + new URLSearchParams({ visitIds: ids.join(',') }), 'GET', undefined, controller.signal, current).then(data => {
      if (!current()) return;
      const summaries: Record<string, VisitBillingSummary> = {};
      for (const summary of data.visits || []) if (ids.includes(summary.visitId)) summaries[summary.visitId] = summary;
      // A missing summary is a failed read, never an implicit "Not invoiced".
      if (ids.some(id => !summaries[id])) { setRead({ scope, status: 'error', summaries: {} }); return; }
      setRead({ scope, status: 'ready', summaries });
    }).catch(error => { if (current() && error.name !== 'AbortError') setRead({ scope, status: 'error', summaries: {} }); });
    return () => controller.abort();
  }, [scope, paused]);
  return { status: !ids.length ? 'unavailable' : paused ? 'error' : read.scope === scope ? read.status : 'loading', summaries: ids.length && !paused && read.scope === scope ? read.summaries : {}, retry: () => setRetryCount(value => value + 1) };
}

export default function VisitBilling({ visit, userProfile, read, compact = false, onOpenPos }: { visit: any; userProfile: any; read: VisitBillingRead; compact?: boolean; onOpenPos?: (source: VisitPosLaunch) => void }) {
  if (!canReadBilling(userProfile, visit) || read.status === 'unavailable') return null;
  const summary = read.status === 'ready' ? read.summaries[visit.id] : null;
  const launch = (invoiceId?: string) => onOpenPos?.({ patientId: visit.patientId, branchId: visit.branchId, visitId: visit.id, ...(invoiceId ? { invoiceId } : {}) });
  const canManage = hasCapability(userProfile, 'pos.manage', { branchId: visit.branchId }) && uiCan(userProfile, 'pos.manage');
  const canCreate = Boolean(onOpenPos && !visit.isArchived && canManage && summary?.canCreateInvoice && !summary.packageSessionUsed && !summary.hasMoreInvoices && !summary.invoices.some(invoice => invoice.state !== 'void'));
  const unavailable = read.status === 'error' || read.status === 'ready' && (!summary || summary.billingUnavailable);
  if (read.status === 'loading') return <p className="mt-1 text-xs text-slate-400" role="status">Loading billing…</p>;
  if (unavailable) return <div className="mt-1 text-xs text-slate-500"><p>Billing unavailable</p>{!compact && <button type="button" className="mt-2 min-h-10 font-semibold text-teal-700 underline" onClick={read.retry}>Retry billing</button>}</div>;
  if (!summary) return null;
  const active = summary.invoices.filter(invoice => invoice.state !== 'void');
  const savedQuote = readVisitPriceQuote(visit);
  const savedQuoteCents = savedQuote?.total == null ? null : moneyCents(savedQuote.total);
  const invoiceLabel = (invoice: VisitBillingSummary['invoices'][number]) => invoice.state === 'draft' ? 'Draft invoice' : invoice.state === 'void' ? 'Voided invoice' : invoice.paymentStatus === 'paid' ? 'Invoice paid' : invoice.paymentStatus === 'partial' ? 'Invoice partially paid' : 'Invoice unpaid';
  const labels = [...new Set(active.map(invoiceLabel))];
  return <section aria-label={compact ? 'Visit billing status' : 'Visit billing'} className={compact ? 'mt-1 space-y-1 text-xs text-slate-500' : 'space-y-3 rounded-xl border border-slate-200 p-4 text-sm'}>
    {!compact && <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Billing</h3><button type="button" onClick={read.retry} className="min-h-10 text-xs font-semibold text-teal-700 underline">Refresh billing</button></div>}
    {summary.packageSessionUsed && <p className="font-medium text-teal-700">Package session used</p>}
    {labels.map(label => <p key={label}>{label}</p>)}
    {compact && active.length === 1 && hasVisitAmount(active[0]) && <p className="font-medium text-slate-700">{visitAmountLabel(active[0])}: {currency(active[0].visitLineCents)}</p>}
    {compact && active.length > 1 && <p>{active.length}{summary.hasMoreInvoices ? '+' : ''} linked invoices · See Visit details</p>}
    {!active.length && !summary.packageSessionUsed && <p>{summary.hasMoreInvoices ? 'Invoice history available in POS' : summary.invoices.length ? 'No active invoice' : 'Not invoiced'}</p>}
    {!compact && <>
      {summary.invoices.map(invoice => {
        const comparable = hasVisitAmount(invoice) && invoice.state !== 'void' && invoice.visitAmountSource === 'visit'
          && invoice.visitQuoteComparable === true && savedQuoteCents !== null;
        const difference = comparable ? invoice.visitLineCents - savedQuoteCents! : 0;
        return <div key={invoice.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">Invoice #{invoice.number} · {invoiceLabel(invoice)}</p>{onOpenPos && <button type="button" onClick={() => launch(invoice.id)} className="min-h-10 text-xs font-semibold text-teal-700 underline">{`${invoice.state === 'draft' ? canManage ? 'Continue draft' : 'View draft' : 'View invoice'} #${invoice.number}`}</button>}</div>
        {hasVisitAmount(invoice) ? <div className="flex flex-wrap justify-between gap-2 font-medium text-slate-800"><span>{visitAmountLabel(invoice)}</span><span className="tabular-nums">{currency(invoice.visitLineCents)}</span></div>
          : <p className="text-xs text-slate-500">Visit amount unavailable · Open the invoice to review its recorded items.</p>}
        {comparable && difference !== 0 && <p className="text-xs text-slate-600">{invoice.state === 'draft' ? 'Draft amount' : 'Billed amount'} is {currency(Math.abs(difference))} {difference > 0 ? 'higher' : 'lower'} than the saved Visit quote of {currency(savedQuoteCents!)}. See the invoice for its price adjustment.</p>}
        {invoice.visitAmountSource === 'linked_booking' && <p className="text-xs text-slate-500">Recorded against the linked booking. This amount does not change the Visit quote.</p>}
        {invoice.visitAmountSource === 'mixed' && <p className="text-xs text-slate-500">Includes this Visit and linked booking items. Open the invoice for the breakdown.</p>}
        <p className="text-xs text-slate-500">Whole invoice · Total {currency(invoice.totalCents)} · Collected {currency(invoice.paidCents)} · Remaining {currency(invoice.outstandingCents)}</p>
        <p className="text-xs text-slate-500">Payments and remaining balances belong to the whole invoice.</p>
      </div>;})}
      {summary.hasMoreInvoices && <p className="text-xs text-slate-500">More invoice history is available in POS &amp; Payments.</p>}
      {canCreate && <button type="button" onClick={() => launch()} className="min-h-11 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">Create invoice from Visit</button>}
    </>}
  </section>;
}
