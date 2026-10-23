import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, ArrowDown, ArrowUp } from 'lucide-react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { hasBranchScope, hasCapability, permissionScopeKey } from '../permissions';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { subscribeBillingRefresh } from '../utils/billingRefresh';
import { packagesRequest } from '../utils/packageCatalogueApi';
import { salesCurrency as money, salesMethodName, salesRange, salesRangeError, salesSourceName, salesSourceKinds, type SalesRecordSource, type SalesOverviewData, type SalesRecordsData, type SalesRecordKind } from '../utils/salesOverview';

const field = 'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600';
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50';
const link = 'min-h-11 text-left font-medium text-teal-800 underline decoration-teal-300 underline-offset-4 hover:decoration-teal-800 focus-visible:outline-2 focus-visible:outline-teal-600';
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const timestamp = (value: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value));
const recordLabels: Record<SalesRecordKind, string> = { sales: 'Posted invoices', payments: 'Received payments', corrections: 'Reversed entries', outstanding: 'Outstanding balances' };

type Props = { userProfile: any; branchId: string; refresh: number; active: boolean; period: { range: { from: string; to: string }; preset: string }; onPeriodChange: (period: Props['period']) => void; onOpenInvoice: (invoice: any) => void };
export default function SalesOverview({ userProfile, branchId, refresh, active, period, onPeriodChange, onOpenInvoice }: Props) {
  const { range, preset } = period;
  const [retry, setRetry] = useState(0);
  const [automaticRefresh, setAutomaticRefresh] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sort, setSort] = useState('sales');
  const [recordKind, setRecordKind] = useState<SalesRecordKind>('sales');
  const [recordBranch, setRecordBranch] = useState('');
  const [recordMethod, setRecordMethod] = useState('');
  const [recordSource, setRecordSource] = useState('');
  const [page, setPage] = useState(1);
  const [showRecords, setShowRecords] = useState(false);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const [opening, setOpening] = useState(''), [openError, setOpenError] = useState('');
  const live = useRef(''), controllerRef = useRef<AbortController | null>(null);
  const exportFlight = useRef(false), openFlight = useRef(false);
  // Keep report filters while viewing an invoice, but retire pending actions as
  // soon as navigation hides the report (including a transition into a new draft).
  const interaction = useRef({ active, generation: 0 });
  if (interaction.current.active !== active) interaction.current = { active, generation: interaction.current.generation + 1 };
  const currentProfile = currentPermissionProfile();
  const capturedUid = auth.currentUser?.uid, capturedPermission = uiPermissionScope(userProfile);
  const authorized = () => Boolean(auth.currentUser?.uid && ['pos.view', 'pos.sales', 'patients.view'].every(cap => hasCapability(userProfile, cap as any) && uiCan(userProfile, cap as any))
    && (branchId === 'All' || hasBranchScope(userProfile, branchId) && (!currentPermissionProfile() || hasBranchScope(currentPermissionProfile(), branchId))));
  const allowed = authorized();
  const filterScope = JSON.stringify([capturedUid, permissionScopeKey(userProfile), capturedPermission, currentProfile, branchId, range.from, range.to]);
  const scope = JSON.stringify([filterScope, refresh, retry, automaticRefresh]);
  live.current = allowed && !paused && active ? scope : '';
  const [report, setReport] = useState<{ scope: string; data?: SalesOverviewData; error?: string }>({ scope: '' });
  const [records, setRecords] = useState<{ scope: string; data?: SalesRecordsData; error?: string }>({ scope: '' });
  const rangeError = salesRangeError(range.from, range.to);
  const query = new URLSearchParams(range);
  if (branchId !== 'All') query.set('branchId', branchId);
  const reportUrl = '/api/pos/sales-overview?' + query;
  const current = (captured: string, controller: AbortController) => live.current === captured && !controller.signal.aborted && auth.currentUser?.uid === capturedUid && uiPermissionScope(userProfile) === capturedPermission && authorized();
  useEffect(() => subscribeProtectedDataInvalidation(() => {
    live.current = ''; controllerRef.current?.abort(); setPaused(true); setReport({ scope: '' }); setRecords({ scope: '' });
  }), []);
  useEffect(() => {
    if (!active || !allowed || paused) return;
    return subscribeBillingRefresh(() => setAutomaticRefresh(value => value + 1));
  }, [active, allowed, paused]);
  useLayoutEffect(() => {
    setRecordBranch(''); setRecordMethod(''); setRecordSource(''); setPage(1); setShowRecords(false);
  }, [filterScope]);
  useLayoutEffect(() => {
    setExportError(''); setOpenError(''); setOpening(''); setExporting(false);
    exportFlight.current = false; openFlight.current = false;
    if (!active || !allowed || paused || rangeError || !branchId) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setReport({ scope });
    packagesRequest(reportUrl, 'GET', undefined, controller.signal, () => current(scope, controller)).then(data => {
      if (current(scope, controller)) setReport({ scope, data });
    }).catch(error => { if (current(scope, controller) && error.name !== 'AbortError') setReport({ scope, error: error.message }); });
    return () => controller.abort();
  }, [scope, active, allowed, paused, rangeError]);
  const data = allowed && !paused && !rangeError && report.scope === scope ? report.data : undefined;
  const recordScope = JSON.stringify([scope, recordBranch, recordKind, recordMethod, recordSource, page, showRecords]);
  const liveRecords = useRef(recordScope); liveRecords.current = recordScope;
  useLayoutEffect(() => {
    if (!active || !data || !showRecords || !allowed || paused) return;
    const controller = new AbortController();
    const fresh = () => current(scope, controller) && liveRecords.current === recordScope;
    const params = new URLSearchParams(range);
    if (recordBranch || branchId !== 'All') params.set('branchId', recordBranch || branchId);
    params.set('kind', recordKind); params.set('page', String(page));
    if (recordMethod && ['payments', 'corrections'].includes(recordKind)) params.set('method', recordMethod);
    if (recordKind === 'sales' && recordSource) params.set('source', recordSource);
    setRecords({ scope: recordScope });
    packagesRequest('/api/pos/sales-records?' + params, 'GET', undefined, controller.signal, fresh).then(result => {
      if (fresh()) setRecords({ scope: recordScope, data: result });
    }).catch(error => { if (fresh() && error.name !== 'AbortError') setRecords({ scope: recordScope, error: error.message }); });
    return () => controller.abort();
  }, [recordScope, active, data, allowed, paused]);
  const retryRead = () => { setPaused(false); setRetry(value => value + 1); };
  const show = (kind: SalesRecordKind, clinic = '', method = '', source = '') => {
    setRecordKind(kind); setRecordBranch(clinic); setRecordMethod(method); setRecordSource(source); setPage(1); setShowRecords(true);
    requestAnimationFrame(() => document.getElementById('sales-records')?.scrollIntoView({ behavior: 'auto', block: 'nearest' }));
  };
  const exportExcel = async () => {
    const controller = controllerRef.current;
    if (!data || !controller || !active || !current(scope, controller) || exportFlight.current) return;
    const generation = interaction.current.generation;
    const fresh = () => current(scope, controller) && interaction.current.active && interaction.current.generation === generation;
    exportFlight.current = true; setExporting(true); setExportError('');
    try {
      // Reauthorize and obtain one complete report; never export a paginated invoice list.
      const freshData: SalesOverviewData = await packagesRequest(reportUrl, 'GET', undefined, controller.signal, fresh);
      if (!fresh()) return;
      const { salesOverviewExcelFile, downloadSalesOverviewExcel } = await import('../utils/salesOverviewExcel');
      const scopeName = branchId === 'All' ? 'All authorized clinics' : freshData.branches.find(row => row.id === branchId)?.name || 'Selected clinic';
      const file = await salesOverviewExcelFile(freshData, scopeName);
      if (!fresh()) return;
      setReport({ scope, data: freshData });
      downloadSalesOverviewExcel(file, range.from, range.to);
    } catch (error: any) { if (fresh() && error.name !== 'AbortError') setExportError(error.message || 'Export failed. Try again.'); }
    finally { if (current(scope, controller)) { exportFlight.current = false; setExporting(false); } }
  };
  const openInvoice = async (id: string) => {
    const controller = controllerRef.current;
    if (!controller || !active || !current(scope, controller) || openFlight.current) return;
    const generation = interaction.current.generation;
    openFlight.current = true; setOpening(id); setOpenError('');
    const fresh = () => current(scope, controller) && liveRecords.current === recordScope && interaction.current.active && interaction.current.generation === generation;
    try {
      const invoice = await packagesRequest('/api/pos/invoices/' + encodeURIComponent(id), 'GET', undefined, controller.signal, fresh);
      if (fresh() && invoice.id === id && data?.branches.some(row => row.id === invoice.branch_id)) onOpenInvoice(invoice);
    } catch (error: any) { if (fresh() && error.name !== 'AbortError') setOpenError(error.message); }
    finally { if (current(scope, controller)) { openFlight.current = false; setOpening(''); } }
  };
  if (!allowed) return <p className="text-sm text-slate-600">Sales access is unavailable.</p>;
  const rows = [...(data?.branches || [])].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b[sort as 'sales' | 'collected' | 'outstanding'] - a[sort as 'sales' | 'collected' | 'outstanding'] || a.name.localeCompare(b.name));
  const recordData = data && records.scope === recordScope ? records.data : undefined;
  return <section className="min-w-0 space-y-6" aria-label="Sales overview">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-slate-950">Sales overview</h2><p className="mt-1 text-sm text-slate-600">{branchId === 'All' ? 'Compare all clinics you can access.' : 'Sales and collections for the selected clinic.'}</p></div>
      <button type="button" className={button} onClick={exportExcel} disabled={!data || exporting}><Download size={16} aria-hidden="true"/>{exporting ? 'Preparing Excel…' : 'Export Excel'}</button>
    </div>
    <div className="grid items-end gap-3 sm:grid-cols-3">
      <label className="min-w-0 space-y-1 text-sm font-medium">Period<select className={field} value={preset} onChange={event => { onPeriodChange({ preset: event.target.value, range: event.target.value === 'custom' ? range : salesRange(event.target.value) }); }}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom dates</option></select></label>
      <label className="min-w-0 space-y-1 text-sm font-medium">From<input type="date" min="1900-01-01" max="9999-12-31" className={field} value={range.from} onChange={event => { onPeriodChange({ preset: 'custom', range: { ...range, from: event.target.value } }); }}/></label>
      <label className="min-w-0 space-y-1 text-sm font-medium">To<input type="date" min="1900-01-01" max="9999-12-31" className={field} value={range.to} onChange={event => { onPeriodChange({ preset: 'custom', range: { ...range, to: event.target.value } }); }}/></label>
    </div>
    <p className="text-xs text-slate-600">Dates are inclusive in Asia/Manila. This week starts Monday. Custom ranges support up to 366 days.</p>
    {rangeError ? <p role="alert" className="text-sm text-rose-800">{rangeError}</p> : paused || report.scope === scope && report.error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-800"><p>{paused ? 'Sales access changed. Refresh to load your current access.' : report.error}</p><button type="button" className={button} onClick={retryRead}>Retry sales</button></div> : !data ? <p role="status" className="text-sm text-slate-600">Loading sales overview…</p> : <>
      <p className="text-xs text-slate-600">{dateLabel(data.from)} – {dateLabel(data.to)} · Updated {timestamp(data.generatedAt)}</p>
      <dl className="grid divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Invoiced sales" value={money(data.totals.sales)} current={data.totals.sales} previous={data.previous.sales} onClick={() => show('sales')}/>
        <Metric label="Net collections" value={money(data.totals.collected)} current={data.totals.collected} previous={data.previous.collected}/>
        <Metric label="Outstanding now" value={money(data.totals.outstanding)} note="Current balance · all dates" onClick={() => show('outstanding')}/>
        <Metric label="Posted invoices" value={data.totals.invoiceCount.toLocaleString()} current={data.totals.invoiceCount} previous={data.previous.invoiceCount} onClick={() => show('sales')}/>
        <Metric label="Average invoice" value={money(data.totals.averageInvoiceCents)} current={data.totals.averageInvoiceCents} previous={data.previous.averageInvoiceCents}/>
      </dl>
      <p className="text-xs text-slate-600">Changes compare with {dateLabel(data.previousFrom)} – {dateLabel(data.previousTo)}. Outstanding is a current balance, not a past-period total.</p>
      <section className="min-w-0 space-y-3" aria-label="Sales by clinic">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-950">Sales by clinic</h3><label className="flex items-center gap-2 text-sm">Sort by<select className={field} value={sort} onChange={event => setSort(event.target.value)}><option value="sales">Invoiced sales</option><option value="collected">Net collections</option><option value="outstanding">Outstanding</option><option value="name">Clinic name</option></select></label></div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} aria-label="Clinic sales comparison"><table className="w-full min-w-[780px] text-right text-sm tabular-nums"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-3 text-left" scope="col">Clinic</th>{['Invoiced sales', 'Net collections', 'Outstanding now', 'Invoices', 'Average invoice'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>
          {rows.map(row => <tr key={row.id} className="border-t border-slate-200"><th scope="row" className="max-w-64 break-words px-3 py-1 text-left"><button type="button" className={link} onClick={() => show('sales', row.id)}>{row.name}</button></th><td className="p-3">{money(row.sales)}</td><td className="p-3">{money(row.collected)}</td><td className="p-3">{money(row.outstanding)}</td><td className="p-3">{row.invoiceCount}</td><td className="p-3">{money(row.averageInvoiceCents)}</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-slate-600">No authorized clinics to report.</td></tr>}
        </tbody><tfoot className="border-t border-slate-300 bg-slate-50 font-semibold"><tr><th className="p-3 text-left" scope="row">{branchId === 'All' ? 'All authorized clinics' : 'Total'}</th><td className="p-3">{money(data.totals.sales)}</td><td className="p-3">{money(data.totals.collected)}</td><td className="p-3">{money(data.totals.outstanding)}</td><td className="p-3">{data.totals.invoiceCount}</td><td className="p-3">{money(data.totals.averageInvoiceCents)}</td></tr></tfoot></table></div>
        <p className="text-xs text-slate-600">Select a clinic to see its source records. Clinics with no activity remain visible.</p>
      </section>
      <section className="space-y-3" aria-label="Sales by invoice source">
        <h3 className="font-semibold text-slate-950">Sales by source</h3>
        <p className="max-w-prose text-sm text-slate-600">Each posted invoice item is counted once. Open a source to trace its billed items.</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} aria-label="Sales source comparison">
          <table className="w-full min-w-[440px] text-right text-sm tabular-nums"><thead className="bg-slate-50 text-slate-600"><tr><th scope="col" className="p-3 text-left">Source</th><th scope="col" className="p-3">Invoice items</th><th scope="col" className="p-3">Invoiced sales</th></tr></thead><tbody>
            {data.salesSources.filter(row => row.kind !== 'unclassified' || row.lineCount > 0).map(row => <tr key={row.kind} className="border-t border-slate-200"><th scope="row" className="px-3 py-1 text-left"><button type="button" className={link} onClick={() => show('sales', '', '', row.kind)}>{salesSourceName(row.kind)}</button></th><td className="p-3">{row.lineCount.toLocaleString()}</td><td className="p-3">{money(row.sales)}</td></tr>)}
          </tbody><tfoot className="border-t border-slate-300 bg-slate-50 font-semibold"><tr><th scope="row" className="p-3 text-left">Total</th><td className="p-3">{data.salesSources.reduce((sum, row) => sum + BigInt(row.lineCount), 0n).toLocaleString()}</td><td className="p-3">{money(data.totals.sales)}</td></tr></tfoot></table>
        </div>
        <p className="max-w-prose text-xs text-slate-600">Catalogue Services have no Visit link. Appointment quotes retain their source when a Visit is recorded later. Package session usage does not add a sale.</p>
      </section>
      <SalesTrend data={data}/>
      <section className="space-y-3" aria-label="Payment breakdown"><h3 className="font-semibold text-slate-950">Collections by payment method</h3><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} aria-label="Collections table"><table className="w-full min-w-[520px] text-right text-sm tabular-nums"><thead className="bg-slate-50 text-slate-600"><tr><th scope="col" className="p-3 text-left">Method</th><th scope="col" className="p-3">Received</th><th scope="col" className="p-3">Reversed entries</th><th scope="col" className="p-3">Net collections</th></tr></thead><tbody>{data.paymentMethods.map(row => <tr key={row.method} className="border-t border-slate-200"><th scope="row" className="px-3 py-1 text-left"><button type="button" className={link} onClick={() => show('payments', '', row.method)}>{salesMethodName(row.method)}</button></th><td className="p-3">{money(row.received)}</td><td className="p-3"><button type="button" className="text-teal-800 underline underline-offset-4" onClick={() => show('corrections', '', row.method)}>{money(row.reversed)}</button></td><td className="p-3">{money(row.collected)}</td></tr>)}</tbody><tfoot className="border-t border-slate-300 bg-slate-50 font-semibold"><tr><th scope="row" className="p-3 text-left">Total</th><td className="p-3">{money(data.totals.received)}</td><td className="p-3">{money(data.totals.reversed)}</td><td className="p-3">{money(data.totals.collected)}</td></tr></tfoot></table></div></section>
      <section id="sales-records" className="space-y-3 scroll-mt-4" aria-label="Sales source records">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-950">Source records</h3><button type="button" className={button} onClick={() => setShowRecords(value => !value)}>{showRecords ? 'Hide records' : 'View records'}</button></div>
        {showRecords && <><div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1 text-sm">Records<select className={field} value={recordKind} onChange={event => { setRecordKind(event.target.value as SalesRecordKind); setRecordMethod(''); setRecordSource(''); setPage(1); }}>{Object.entries(recordLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="space-y-1 text-sm">Clinic<select className={field} value={recordBranch} onChange={event => { setRecordBranch(event.target.value); setPage(1); }}><option value="">{branchId === 'All' ? 'All authorized clinics' : 'Selected clinic'}</option>{data.branches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{recordKind === 'sales' && <label className="space-y-1 text-sm">Invoice source<select className={field} value={recordSource} onChange={event => { setRecordSource(event.target.value); setPage(1); }}><option value="">All sources</option>{salesSourceKinds.map(kind => <option key={kind} value={kind}>{salesSourceName(kind)}</option>)}</select></label>}{['payments', 'corrections'].includes(recordKind) && <label className="space-y-1 text-sm">Payment method<select className={field} value={recordMethod} onChange={event => { setRecordMethod(event.target.value); setPage(1); }}><option value="">All methods</option>{data.paymentMethods.map(row => <option key={row.method} value={row.method}>{salesMethodName(row.method)}</option>)}</select></label>}</div>
          <p className="text-xs text-slate-600">{recordKind === 'outstanding' ? 'Current unpaid amounts across all dates. Date shown is the invoice posting date.' : recordKind === 'sales' ? recordSource ? 'Matching source item amounts by invoice posting date. The whole-invoice total is shown separately.' : 'Invoice amounts by posting date. Expand invoice sources to see each billed item.' : recordKind === 'corrections' ? 'Original payment amounts reversed, by correction date. These are entry corrections, not refunds.' : 'Payments by recorded date. Reversed entries are listed separately above.'}</p>
          {records.scope === recordScope && records.error ? <p role="alert" className="text-sm text-rose-800">{records.error} <button type="button" className={link} onClick={retryRead}>Retry sales</button></p> : !recordData ? <p role="status" className="text-sm text-slate-600">Loading source records…</p> : <><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} aria-label="Source records table"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['Date and time', 'Invoice / patient', 'Clinic', 'Amount', ''].map((label, index) => <th scope="col" key={index} className="p-3">{label || <span className="sr-only">Open invoice</span>}</th>)}</tr></thead><tbody>{recordData.records.map(row => <tr key={row.id} className="border-t border-slate-200"><td className="p-3">{timestamp(row.at)}</td><td className="p-3"><p className="font-medium">#{row.invoiceNumber} · {row.patientName}</p>{row.method && <p className="text-xs text-slate-600">{salesMethodName(row.method)}</p>}<InvoiceSources sources={row.sources} branchId={row.branchId} userProfile={userProfile}/></td><td className="p-3">{row.branchName}</td><td className="p-3 tabular-nums"><p>{money(row.amountCents)}</p>{recordKind === 'sales' && recordSource && <p className="mt-1 text-xs text-slate-600">Whole invoice: {money(row.invoiceTotalCents)}</p>}</td><td className="p-3"><button type="button" className={button} disabled={Boolean(opening)} onClick={() => openInvoice(row.invoiceId)} aria-label={`Open invoice ${row.invoiceNumber}`}>{opening === row.invoiceId ? 'Opening…' : 'Open'}</button></td></tr>)}{!recordData.records.length && <tr><td colSpan={5} className="p-6 text-center text-slate-600">No matching records.</td></tr>}</tbody></table></div><div className="flex flex-wrap items-center justify-end gap-3 text-sm"><span>{recordData.total.toLocaleString()} records · Page {page} of {Math.max(1, Math.ceil(recordData.total / recordData.pageSize))}</span><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" className={button} disabled={page * recordData.pageSize >= recordData.total} onClick={() => setPage(value => value + 1)}>Next</button></div></>}
          {openError && <p role="alert" className="text-sm text-rose-800">{openError}</p>}
        </>}
      </section>
      <details className="border-t border-slate-200 pt-4 text-sm text-slate-600"><summary className="min-h-11 cursor-pointer font-medium text-slate-800">How these figures are calculated</summary><ul className="list-disc space-y-2 pl-5"><li>Invoiced sales use posted invoice amounts and the posting date. Quotes, drafts and voided invoices do not count.</li><li>Net collections equal received payments minus reversed payment entries. Each uses its own recorded date, so a period can have negative collections.</li><li>Outstanding now is the current unpaid balance on posted invoices across all dates.</li><li>Sales belong to the invoice clinic. A package purchase counts once; using its sessions does not add another sale.</li><li>Saved invoice prices, including Special Price, remain unchanged. Average invoice is total invoiced sales divided by posted invoice count, rounded to the nearest cent.</li><li>Sales sources count each frozen invoice item once. Payments and remaining balances belong to the invoice and are not allocated to individual Visits.</li><li>Excel includes the complete selected clinic scope, daily trend, payment methods and sales sources, without patient details or Visit IDs. Source-record filters do not change the export.</li></ul></details>
    </>}
    {exportError && <p role="alert" className="text-sm text-rose-800">{exportError}</p>}
  </section>;
}

function InvoiceSources({ sources, branchId, userProfile }: { sources: SalesRecordSource[]; branchId: string; userProfile: any }) {
  const profile = currentPermissionProfile();
  const can = (permission: 'visits.view' | 'appointments.view') => hasCapability(userProfile, permission, { branchId }) && uiCan(userProfile, permission)
    && (!profile || hasBranchScope(profile, branchId));
  return <details className="mt-2 max-w-md text-xs text-slate-600"><summary className="min-h-11 cursor-pointer text-teal-800 underline underline-offset-4">Invoice sources · {sources.length}</summary>
    <ul className="space-y-3 pt-2">{sources.map((source, index) => <li key={index} className="break-words"><p className="font-medium text-slate-800">{source.name} · {money(source.amountCents)}</p><p>{salesSourceName(source.kind)}{source.kind === 'service' ? ' · no Visit link' : ''}</p>
      {source.sourceId && (source.kind === 'visit' ? can('visits.view') : source.kind === 'appointment' && can('appointments.view')) && <p>{source.kind === 'visit' ? 'Visit' : 'Appointment'} ID: {source.sourceId}</p>}
      {can('visits.view') && source.linkedVisitIds?.length ? <p>Linked Visit ID{source.linkedVisitIds.length > 1 ? 's' : ''}: {source.linkedVisitIds.join(', ')}{source.hasMoreLinkedVisits ? ' · additional links available in Visit history' : ''}</p> : null}
    </li>)}</ul><p className="mt-2">Item amounts explain the invoice. Payments are recorded against the whole invoice.</p>
  </details>;
}

function Metric({ label, value, current, previous, note, onClick }: { label: string; value: string; current?: number; previous?: number; note?: string; onClick?: () => void }) {
  const delta = current !== undefined && previous !== undefined ? current - previous : undefined;
  const change = delta === undefined ? note : delta === 0 ? 'No change' : previous === 0 ? 'No prior-period baseline' : `${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(Math.abs(delta / Math.abs(previous!)) * 100)}% ${delta > 0 ? 'higher' : 'lower'}`;
  return <div className="min-w-0 border-b border-slate-200 p-4 last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums text-slate-950">{onClick ? <button type="button" className="min-h-11 text-left underline decoration-slate-300 underline-offset-4 hover:decoration-teal-700 focus-visible:outline-2 focus-visible:outline-teal-600" onClick={onClick} aria-label={`${label}: ${value}. View source records.`}>{value}</button> : <span className="inline-flex min-h-11 items-center">{value}</span>}</dd><dd className="mt-1 flex items-start gap-1 text-xs text-slate-600">{delta !== undefined && delta !== 0 && (delta > 0 ? <ArrowUp size={14} className="shrink-0" aria-hidden="true"/> : <ArrowDown size={14} className="shrink-0" aria-hidden="true"/>)}{change}</dd></div>;
}
function SalesTrend({ data }: { data: SalesOverviewData }) {
  const [metric, setMetric] = useState<'sales' | 'collected'>('sales');
  const values = data.trend.map(row => row[metric]);
  const low = Math.min(0, ...values), high = Math.max(1, ...values);
  const y = (value: number) => 30 + (high - value) / (high - low) * 150;
  const x = (index: number) => values.length === 1 ? 420 : 100 + index / (values.length - 1) * 640;
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const activity = values.some(value => value !== 0);
  return <section className="space-y-3" aria-label="Daily sales trend"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-950">Daily trend</h3><label className="flex items-center gap-2 text-sm">Show<select className={field} value={metric} onChange={event => setMetric(event.target.value as 'sales' | 'collected')}><option value="sales">Invoiced sales</option><option value="collected">Net collections</option></select></label></div><div className="rounded-xl border border-slate-200 bg-white p-4">
    {activity ? <div className="overflow-x-auto" tabIndex={0} aria-label="Daily trend chart"><svg viewBox="0 0 780 220" className="w-full min-w-[640px]" role="img" aria-label={`Daily ${metric === 'sales' ? 'invoiced sales' : 'net collections'} in Philippine pesos. Exact values are available in Daily figures below.`}>
      <line x1="100" x2="740" y1={y(0)} y2={y(0)} stroke="#94a3b8"/>
      <line x1="100" x2="740" y1="30" y2="30" stroke="#e2e8f0"/>
      <text x="88" y="35" textAnchor="end" fill="#475569" fontSize="15">{new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 1 }).format(high / 100)}</text><text x="88" y="185" textAnchor="end" fill="#475569" fontSize="15">{new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 1 }).format(low / 100)}</text>
      <polyline points={points} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinejoin="round"/>
      {values.length === 1 && <circle cx={x(0)} cy={y(values[0])} r="4" fill="#0f766e"/>}
      <text x="100" y="210" fill="#475569" fontSize="15">{data.from}</text><text x="740" y="210" textAnchor="end" fill="#475569" fontSize="15">{data.to}</text>
    </svg></div> : <p className="py-8 text-center text-sm text-slate-600">No {metric === 'sales' ? 'invoiced sales' : 'net collections'} in this period.</p>}
    <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer font-medium text-teal-800">Daily figures</summary><div className="max-h-80 overflow-auto" tabIndex={0} aria-label="Daily figures table"><table className="w-full min-w-[440px] text-right tabular-nums"><thead className="sticky top-0 bg-white"><tr><th scope="col" className="p-2 text-left">Date</th><th scope="col" className="p-2">Invoiced sales</th><th scope="col" className="p-2">Net collections</th><th scope="col" className="p-2">Invoices</th></tr></thead><tbody>{data.trend.map(row => <tr key={row.date} className="border-t border-slate-200"><th scope="row" className="p-2 text-left font-normal">{dateLabel(row.date)}</th><td className="p-2">{money(row.sales)}</td><td className="p-2">{money(row.collected)}</td><td className="p-2">{row.invoiceCount}</td></tr>)}</tbody></table></div></details>
  </div></section>;
}
