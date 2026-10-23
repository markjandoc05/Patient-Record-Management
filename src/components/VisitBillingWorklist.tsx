import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { hasBranchScope, hasCapability, permissionScopeKey } from '../permissions';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { packagesRequest } from '../utils/packageCatalogueApi';
import { subscribeBillingRefresh } from '../utils/billingRefresh';
import type { VisitPosLaunch } from '../utils/visitBilling';
import type { VisitBillingWorklistFilter, VisitBillingWorklistResponse, VisitBillingWorklistRow } from '../utils/visitBillingWorklist';
import VisitBilling from './VisitBilling';

const field = 'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600';
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50';
const labels = { unbilled: 'Not invoiced', draft: 'Draft invoice', missing_price: 'Price not recorded', package: 'Package session used', billed: 'Invoiced', review: 'Needs review' };
type Props = {
  userProfile: any; branchId: string; refresh: number; active: boolean;
  onOpenInvoice: (invoice: any) => void;
  onCreateInvoice: (visit: VisitBillingWorklistRow, source: { id: string; version: number; name: string; price: string | null }) => void;
};

export default function VisitBillingWorklist({ userProfile, branchId, refresh, active, onOpenInvoice, onCreateInvoice }: Props) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<VisitBillingWorklistFilter>('attention'), [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0), [epoch, setEpoch] = useState(0), [paused, setPaused] = useState(false);
  const [read, setRead] = useState<{ scope: string; data?: VisitBillingWorklistResponse; error?: string }>({ scope: '' });
  const [opening, setOpening] = useState(''), [actionError, setActionError] = useState('');
  const live = useRef(''), controllerRef = useRef<AbortController | null>(null), flight = useRef(false);
  const interaction = useRef({ active, generation: 0 });
  if (interaction.current.active !== active) interaction.current = { active, generation: interaction.current.generation + 1 };
  const capturedUid = auth.currentUser?.uid, capturedPermissions = uiPermissionScope(userProfile);
  const authorized = () => Boolean(auth.currentUser?.uid && ['pos.view', 'patients.view', 'visits.view'].every(cap => hasCapability(userProfile, cap as any) && uiCan(userProfile, cap as any))
    && (branchId === 'All' || hasBranchScope(userProfile, branchId) && (!currentPermissionProfile() || hasBranchScope(currentPermissionProfile(), branchId))));
  const allowed = authorized();
  const scope = JSON.stringify([capturedUid, permissionScopeKey(userProfile), capturedPermissions, currentPermissionProfile(), branchId, search, filter, page, refresh, retry, epoch, active]);
  live.current = allowed && active && !paused ? scope : '';
  const current = (controller: AbortController) => live.current === scope && !controller.signal.aborted && auth.currentUser?.uid === capturedUid && uiPermissionScope(userProfile) === capturedPermissions && authorized();
  useEffect(() => subscribeProtectedDataInvalidation(() => {
    live.current = ''; controllerRef.current?.abort(); setPaused(true); setRead({ scope: '' });
  }), []);
  useEffect(() => subscribeBillingRefresh(() => { if (interaction.current.active) setEpoch(value => value + 1); }), []);
  useLayoutEffect(() => { setPage(1); }, [branchId]);
  useLayoutEffect(() => {
    setOpening(''); setActionError(''); flight.current = false;
    if (!allowed || !active || paused || !branchId) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setRead({ scope });
    const query = new URLSearchParams({ q: search, status: filter, page: String(page) });
    if (branchId !== 'All') query.set('branchId', branchId);
    const timer = setTimeout(() => {
      packagesRequest('/api/pos/visit-billing-worklist?' + query, 'GET', undefined, controller.signal, () => current(controller)).then(data => {
        if (current(controller)) setRead({ scope, data });
      }).catch(error => { if (current(controller) && error.name !== 'AbortError') setRead({ scope, error: error.message }); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scope, allowed, active, paused]);
  const data = allowed && active && !paused && read.scope === scope ? read.data : undefined;
  const retryRead = () => { setPaused(false); setRetry(value => value + 1); };
  const launch = async (row: VisitBillingWorklistRow, target: VisitPosLaunch) => {
    const controller = controllerRef.current;
    if (!controller || !data || !current(controller) || flight.current) return;
    const generation = interaction.current.generation;
    const fresh = () => current(controller) && interaction.current.active && interaction.current.generation === generation;
    flight.current = true; setOpening(row.id); setActionError('');
    try {
      if (target.invoiceId) {
        const query = new URLSearchParams({ patientId: row.patientId, visitId: row.id });
        const invoice = await packagesRequest('/api/pos/invoices/' + encodeURIComponent(target.invoiceId) + '?' + query, 'GET', undefined, controller.signal, fresh);
        if (!fresh()) return;
        if (invoice.id !== target.invoiceId || invoice.patient_id !== row.patientId || invoice.branch_id !== row.branchId) throw new Error('The linked invoice changed. Refresh billing before continuing.');
        onOpenInvoice(invoice);
      } else {
        if (!row.summary.canCreateInvoice || row.quoteTotal === null || !hasCapability(userProfile, 'pos.manage', { branchId: row.branchId }) || !uiCan(userProfile, 'pos.manage')) return;
        const query = new URLSearchParams({ patientId: row.patientId, branchId: row.branchId });
        const result = await packagesRequest('/api/pos/sources/visit/' + encodeURIComponent(row.id) + '?' + query, 'GET', undefined, controller.signal, fresh);
        if (!fresh()) return;
        if (result.source?.id !== row.id || result.source?.kind !== 'visit') throw new Error('The saved Visit quote is unavailable. Refresh billing before continuing.');
        onCreateInvoice(row, result.source);
      }
    } catch (error: any) { if (fresh() && error.name !== 'AbortError') setActionError(error.message); }
    finally { if (fresh()) { flight.current = false; setOpening(''); } }
  };
  if (!allowed) return <p className="text-sm text-slate-600">Visit billing access is unavailable.</p>;
  return <section className="min-w-0 space-y-4" aria-label="Visits needing billing">
    <div><h2 className="text-lg font-semibold text-slate-950">Visits needing billing</h2><p className="mt-1 text-sm text-slate-600">Completed Visits and their linked invoices. Creating an invoice starts a draft for review.</p></div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <label className="min-w-0 space-y-1 text-sm">Search Visits<input type="search" className={field} value={search} maxLength={100} placeholder="Patient, patient ID, Service or Visit ID" onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
      <label className="min-w-0 space-y-1 text-sm">Billing status<select className={field} value={filter} onChange={event => { setFilter(event.target.value as VisitBillingWorklistFilter); setPage(1); }}><option value="attention">Needs attention</option><option value="all">All completed Visits</option>{Object.entries(labels).filter(([key]) => key !== 'review').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <p className="text-xs text-slate-600">Only explicit Visit or linked booking references connect billing. A separate catalogue sale is not matched automatically. Package sessions do not create another sale here.</p>
    {actionError && <p role="alert" className="text-sm text-rose-800">{actionError}</p>}
    {paused || read.scope === scope && read.error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-800"><p>{paused ? 'Billing access changed. Retry to load your current access.' : read.error}</p><button type="button" className={button} onClick={retryRead}>Retry Visit billing</button></div>
      : !data ? <p role="status" className="text-sm text-slate-600">{branchId ? 'Loading completed Visits…' : 'Select a clinic to view Visits.'}</p> : <>
        <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {!data.visits.length && <p className="p-6 text-sm text-slate-600">No completed Visits match these filters.</p>}
          {data.visits.map(row => <article key={row.id} className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2"><h3 className="break-words font-semibold text-slate-950">{row.patientName}</h3><p className="break-words text-sm text-slate-600">{row.patientNumber} · {row.branchName}</p><p className="break-words text-sm">{row.serviceName}</p><p className="text-sm text-slate-600">{Number.isNaN(Date.parse(row.visitDate)) ? 'Visit date unavailable' : new Date(row.visitDate).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</p><p className="text-sm font-medium">Saved Visit quote: {row.quoteTotal === null ? 'Price not recorded' : Number(row.quoteTotal) === 0 ? 'Free' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(row.quoteTotal))}</p><p className="text-sm text-slate-700">{labels[row.status]}</p>
              {row.status === 'missing_price' && <p className="text-xs text-slate-600">Review the Visit price before billing. A missing amount is not Free.</p>}
              {row.status === 'review' && <p className="text-xs text-slate-600">Review the Visit and its existing billing records before creating another invoice.</p>}
              <details className="text-xs text-slate-600"><summary className="cursor-pointer">Visit reference</summary><p className="mt-2 break-all">{row.id}</p></details>
            </div>
            <fieldset className="min-w-0" disabled={Boolean(opening)}><VisitBilling visit={{ id: row.id, patientId: row.patientId, branchId: row.branchId }} userProfile={userProfile} read={{ status: 'ready', summaries: { [row.id]: row.summary }, retry: retryRead }} onOpenPos={target => { void launch(row, target); }}/>{opening === row.id && <p role="status" className="mt-2 text-sm text-slate-600">Opening billing…</p>}</fieldset>
          </article>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p>{data.total} matching Visits · Page {data.page}</p><div className="flex gap-2"><button type="button" className={button} disabled={page <= 1 || Boolean(opening)} onClick={() => setPage(value => value - 1)}>Previous Visits</button><button type="button" className={button} disabled={page * data.pageSize >= data.total || Boolean(opening)} onClick={() => setPage(value => value + 1)}>Next Visits</button></div></div>
      </>}
  </section>;
}
