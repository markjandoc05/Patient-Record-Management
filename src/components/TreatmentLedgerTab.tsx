import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Plus, X } from 'lucide-react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { getActiveDatePrefix } from '../utils/timezone';
import { formatDateTime } from '../utils';
import { formatLedgerTreatmentTime } from '../utils/treatmentLedgerPresentation';
import { servicesRequest } from '../utils/servicesApi';
import { adjustTreatmentSessions, createTreatmentPurchase, getTreatmentLedger, reverseTreatmentUsage, updateTreatmentPurchase } from '../utils/treatmentLedgerApi';
import type { TreatmentLedgerResponse } from '../treatmentLedgerPolicy';
import type { CataloguePackage } from '../packageCataloguePolicy';
import PackagePurchasePicker from './PackagePurchasePicker';

type Purchase = TreatmentLedgerResponse['purchases'][number];
type Line = Purchase['lines'][number];
type Event = TreatmentLedgerResponse['events'][number];
function activityLabel(event: Event) {
  if (event.type === 'metadata') {
    const changes = event.metadata?.changes as Record<string, unknown> | undefined;
    return changes ? Object.keys(changes).map(key => key === 'notes' ? 'Package notes updated' : key === 'orNumber' ? 'OR# updated' : 'Package details updated').join(' · ') : 'Package details updated';
  }
  if (event.type === 'purchase') return 'Package purchase recorded';
  return event.usedDelta ? `${event.usedDelta > 0 ? '+' : ''}${event.usedDelta} sessions used` : `${event.sessionsDelta > 0 ? '+' : ''}${event.sessionsDelta} sessions balance`;
}
const field = 'w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 disabled:bg-slate-100 disabled:opacity-60';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-teal-500/10 disabled:cursor-not-allowed disabled:opacity-40';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-500/15 disabled:cursor-not-allowed disabled:opacity-40';
function viewAllowed(role?: string) { return uiCan(role, 'treatment_ledger.view') && uiCan(role, 'patients.view') && uiCan(role, 'visits.view') && uiCan(role, 'clinical.view'); }

// Deliberately export only the saved ledger's session facts. Clinical Visit
// narratives and diagnoses never enter a patient session statement.
export function treatmentSessionStatement(data: TreatmentLedgerResponse, patient: any) {
  return { schemaVersion: 1, patient: { id: data.patientId, name: data.patientName || patient.name || '', patientID: patient.patientID || '' }, redemptionPolicy: data.redemptionPolicy,
    purchases: data.purchases.map(purchase => ({ id: purchase.id, packageName: purchase.packageName, purchaseDate: purchase.purchaseDate, usable: purchase.usable !== false, branchName: purchase.branchNameSnapshot, timezone: purchase.timezoneSnapshot,
      ...(purchase.catalogue ? { catalogue: purchase.catalogue } : {}),
      notes: purchase.notes, orNumber: purchase.orNumber, lines: purchase.lines.map(line => ({ id: line.id, serviceName: line.serviceNameSnapshot, purchasedSessions: line.purchasedSessions, adjustmentSessions: line.adjustmentSessions, usedSessions: line.usedSessions, remainingSessions: line.remainingSessions })) })),
    history: data.events.map(event => ({ id: event.id, type: event.type, purchaseId: event.purchaseId, lineId: event.lineId, visitId: event.visitId, sessionsDelta: event.sessionsDelta, usedDelta: event.usedDelta,
      recordedAt: event.recordedAt, treatmentDate: event.treatmentDate, actor: event.actor.name, reason: event.reason, reversesEventId: event.reversesEventId, balanceAfter: event.balanceAfter,
      visit: event.visitSnapshot ? { branchName: event.visitSnapshot.branchNameSnapshot, timezoneSnapshot: event.visitSnapshot.timezoneSnapshot,
        performedByName: event.visitSnapshot.performedByNameSnapshot, performedByDesignation: event.visitSnapshot.performedByDesignationSnapshot,
        assistingStaffText: event.visitSnapshot.assistingStaffText, serviceName: event.visitSnapshot.serviceNameSnapshot, visitDate: event.visitSnapshot.visitDate } : null })) };
}

function PurchaseForm({ data, disabled, locked, onCancel, onSubmit, needsReview, onReviewed, userRole }: { data: TreatmentLedgerResponse; disabled: boolean; locked: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void; needsReview: boolean; onReviewed: () => void; userRole?: string }) {
  const [source, setSource] = useState('manual');
  const [selectedPackage, setSelectedPackage] = useState<CataloguePackage | null>(null);
  const [branchId, setBranchId] = useState(data.branches.length === 1 ? data.branches[0].id : '');
  const [name, setName] = useState(''), [date, setDate] = useState(getActiveDatePrefix()), [notes, setNotes] = useState(''), [orNumber, setOrNumber] = useState('');
  const [rows, setRows] = useState<{ serviceId: string; expectedServiceVersion: number; serviceName: string; purchasedSessions: number }[]>([{ serviceId: '', expectedServiceVersion: 0, serviceName: '', purchasedSessions: 1 }]);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [catalogue, setCatalogue] = useState({ key: '', rows: [] as any[], total: 0, error: '', ready: false });
  const [validation, setValidation] = useState('');
  const [selecting, setSelecting] = useState(false);
  const lifetime = useRef({ active: false, generation: 0, selection: null as AbortController | null });
  const command = useRef({ key: '', id: crypto.randomUUID() });
  const key = JSON.stringify([branchId, search, page, retry]);
  useLayoutEffect(() => { lifetime.current.active = true; lifetime.current.generation++; return () => { lifetime.current.active = false; lifetime.current.generation++; lifetime.current.selection?.abort(); }; }, [branchId]);
  useEffect(() => {
    if (!branchId || source !== 'manual') return;
    const controller = new AbortController(), generation = lifetime.current.generation;
    let active = true;
    const current = () => active && lifetime.current.active && lifetime.current.generation === generation && !controller.signal.aborted;
    const query = new URLSearchParams({ branchId, status: 'active', availableOnly: 'true', page: String(page), pageSize: '25', q: search });
    void servicesRequest(`/api/services?${query}`, 'GET', undefined, controller.signal, current).then(result => {
      if (current()) setCatalogue({ key, rows: result.services.filter((service: any) => {
        const branch = service.branches?.find((item: any) => item.id === branchId);
        return service.active && branch?.operationallyAvailable && ['priced', 'free'].includes(branch.effectivePrice?.mode) && branch.effectivePrice.amount != null;
      }), total: result.total, ready: true, error: '' });
    }).catch(error => { if (current() && error.name !== 'AbortError') setCatalogue({ key, rows: [], total: 0, ready: true, error: error.message }); });
    return () => { active = false; controller.abort(); };
  }, [key, source]);
  const visible = catalogue.key === key ? catalogue : { rows: [], total: 0, ready: false, error: '' };
  const chooseService = async (index: number, serviceId: string) => {
    if (disabled) return;
    setRows(current => current.map((row, position) => position === index ? { ...row, serviceId: '', expectedServiceVersion: 0, serviceName: '' } : row));
    if (!serviceId) return;
    lifetime.current.selection?.abort(); const controller = new AbortController(), generation = lifetime.current.generation;
    lifetime.current.selection = controller;
    setSelecting(true);
    const current = () => lifetime.current.active && lifetime.current.generation === generation && lifetime.current.selection === controller && !controller.signal.aborted;
    try {
      const result = await servicesRequest(`/api/services/${encodeURIComponent(serviceId)}?branchId=${encodeURIComponent(branchId)}`, 'GET', undefined, controller.signal, current);
      if (!current()) return; const service = result, branch = service?.branches?.find((item: any) => item.id === branchId);
      if (!service?.active || !branch?.operationallyAvailable || !['priced', 'free'].includes(branch.effectivePrice?.mode) || branch.effectivePrice.amount == null) throw new Error('This Service is unavailable at the purchase clinic. Choose another.');
      setRows(previous => previous.map((row, position) => position === index ? { ...row, serviceId: service.id, expectedServiceVersion: service.version, serviceName: service.name } : row)); setValidation('');
    } catch (error: any) { if (current() && error.name !== 'AbortError') setValidation(error.message); }
    finally { if (current()) setSelecting(false); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (!date || !branchId || (source === 'catalogue' ? !selectedPackage || needsReview || !uiCan(userRole, 'packages.view') || !uiCan(userRole, 'services.view') : !name.trim() || rows.some(row => !row.serviceId || !row.expectedServiceVersion || !Number.isInteger(row.purchasedSessions) || row.purchasedSessions < 1 || row.purchasedSessions > 10000) || new Set(rows.map(row => row.serviceId)).size !== rows.length)) {
      setValidation('Enter a package name, purchase date and clinic. Choose distinct Services with whole session counts from 1 to 10,000.'); return;
    }
    const body = { expectedVersion: 0, purchaseDate: date, branchId, notes, ...(data.capabilities.canEditOrNumber ? { orNumber } : {}),
      ...(source === 'catalogue' && selectedPackage ? { catalogueSelection: { packageId: selectedPackage.id, expectedVersion: selectedPackage.version,
        serviceVersions: selectedPackage.lines.map(line => ({ serviceId: line.serviceId, expectedServiceVersion: line.currentServiceVersion })) } }
        : { packageName: name.trim(), lines: rows.map(({ serviceId, expectedServiceVersion, purchasedSessions }) => ({ serviceId, expectedServiceVersion, purchasedSessions })) }) };
    const intent = JSON.stringify(body); if (command.current.key !== intent) command.current = { key: intent, id: crypto.randomUUID() };
    onSubmit({ ...body, commandId: command.current.id });
  };
  return <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-slate-900">Record package purchase</h4><button type="button" disabled={disabled} onClick={onCancel} aria-label="Cancel package purchase" className={button}><X size={16} /></button></div>
    {validation && <p role="alert" className="text-sm text-rose-700">{validation}</p>}
    <fieldset disabled={disabled || locked || selecting} className="space-y-4">
      <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Purchase source</span><select className={field} value={source} onChange={e => { setSource(e.target.value); setSelectedPackage(null); setValidation(''); onReviewed(); }}><option value="manual">Manual package</option><option value="catalogue" disabled={!uiCan(userRole, 'packages.view') || !uiCan(userRole, 'services.view')}>Catalogue package</option></select></label>
      <div className="grid gap-3 sm:grid-cols-2">
        {source === 'manual' && <label className="space-y-1 text-xs font-semibold text-slate-600"><span>Package name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={160} required className={field} /></label>}
        <label className="space-y-1 text-xs font-semibold text-slate-600"><span>Purchase clinic</span><select value={branchId} onChange={e => { setBranchId(e.target.value); setSelectedPackage(null); setRows([{ serviceId: '', expectedServiceVersion: 0, serviceName: '', purchasedSessions: 1 }]); setSearch(''); setPage(1); setValidation(''); setSelecting(false); onReviewed(); }} className={field} required><option value="">Select clinic</option>{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="space-y-1 text-xs font-semibold text-slate-600"><span>Purchase date (clinic local date)</span><input type="date" value={date} onChange={e => setDate(e.target.value)} required className={field} /></label>
        {data.capabilities.canEditOrNumber && <label className="space-y-1 text-xs font-semibold text-slate-600"><span>OR# (optional)</span><input value={orNumber} onChange={e => setOrNumber(e.target.value)} maxLength={120} className={field} /></label>}
      </div>
      {source === 'catalogue' ? <PackagePurchasePicker key={branchId} branchId={branchId} value={selectedPackage} disabled={disabled || locked} needsReview={needsReview} onChange={value => { setSelectedPackage(value); if (value) { onReviewed(); setValidation(''); } }} /> : <div className="space-y-3">
        <h5 className="text-sm font-semibold text-slate-900">Included Services and sessions</h5>
        {branchId && <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Find a Service</span><input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search available Services" className={field} /></label>}
        {visible.error ? <p role="alert" className="text-xs text-rose-700">{visible.error} <button type="button" onClick={() => setRetry(n => n + 1)} className="underline">Retry Services</button></p> : branchId && !visible.ready ? <div role="status" aria-label="Loading Services" className="h-10 animate-pulse rounded-lg bg-slate-200" /> : null}
        {rows.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
          <label className="space-y-1 text-xs font-semibold text-slate-600"><span>Service {index + 1}</span><select value={row.serviceId} disabled={!branchId || !visible.ready} onChange={e => void chooseService(index, e.target.value)} className={field}><option value="">Choose an available Service</option>{row.serviceId && !visible.rows.some(service => service.id === row.serviceId) && <option value={row.serviceId}>{row.serviceName}</option>}{visible.rows.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600"><span>Sessions</span><input type="number" step={1} min={1} max={10000} value={row.purchasedSessions || ''} onChange={e => setRows(previous => previous.map((value, position) => position === index ? { ...value, purchasedSessions: Number(e.target.value) } : value))} className={field} /></label>
          <button type="button" disabled={rows.length === 1} onClick={() => setRows(previous => previous.filter((_, position) => position !== index))} className={`${button} self-end`} aria-label={`Remove Service ${index + 1}`}>Remove</button>
        </div>)}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={rows.length >= 20} onClick={() => setRows(previous => [...previous, { serviceId: '', expectedServiceVersion: 0, serviceName: '', purchasedSessions: 1 }])} className={button}><Plus size={15} />Add Service</button>{visible.total > 25 && <><button type="button" disabled={page === 1} onClick={() => setPage(n => n - 1)} className={button}>Previous Services</button><button type="button" disabled={page * 25 >= visible.total} onClick={() => setPage(n => n + 1)} className={button}>Next Services</button></>}</div>
      </div>}
      <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Package notes (optional)</span><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={3000} className={field} /></label>
    </fieldset>
    <button type="submit" disabled={disabled || selecting || source === 'catalogue' && (!selectedPackage || needsReview)} className={primary}>{disabled ? 'Saving purchase…' : locked ? 'Retry package purchase' : 'Save package purchase'}</button>
  </form>;
}

type Editor = { kind: 'metadata'; purchaseId: string; expectedVersion: number } | { kind: 'adjustment'; lineId: string } | { kind: 'reversal'; eventId: string };
function LedgerWorkspace({ patient, userRole, scope }: { patient: any; userRole?: string; scope: string }) {
  const [data, setData] = useState<TreatmentLedgerResponse | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [purchaseOpen, setPurchaseOpen] = useState(false), [editor, setEditor] = useState<Editor | null>(null);
  const [retryLocked, setRetryLocked] = useState(false);
  const [purchaseReviewRequired, setPurchaseReviewRequired] = useState(false);
  const [notes, setNotes] = useState(''), [orNumber, setOrNumber] = useState(''), [reason, setReason] = useState(''), [delta, setDelta] = useState(1);
  const lifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  const command = useRef({ key: '', id: crypto.randomUUID() });
  const currentEditor = editor?.kind === 'metadata' ? data?.purchases.find(purchase => purchase.id === editor.purchaseId) : undefined;
  const lineContext = data?.purchases.flatMap(purchase => purchase.lines.map(line => ({ purchase, line }))) || [];
  const editorLine = editor?.kind === 'adjustment' ? lineContext.find(({ line }) => line.id === editor.lineId) : undefined;
  const editorUsage = editor?.kind === 'reversal' ? data?.activeVisitUsages.find(usage => usage.eventId === editor.eventId) : undefined;
  const usageLine = editorUsage ? lineContext.find(({ line }) => line.id === editorUsage.lineId) : undefined;
  useLayoutEffect(() => { lifetime.current.active = true; lifetime.current.generation++; return () => { lifetime.current.active = false; lifetime.current.generation++; lifetime.current.request?.abort(); }; }, [scope]);
  useEffect(() => {
    const controller = new AbortController(), generation = lifetime.current.generation; lifetime.current.request = controller;
    const current = () => lifetime.current.active && lifetime.current.generation === generation && lifetime.current.request === controller && !controller.signal.aborted;
    setData(null); setError('');
    void getTreatmentLedger(patient.id, { signal: controller.signal, isCurrent: current }).then(value => { if (current()) setData(value); }).catch(failure => { if (current() && failure.name !== 'AbortError') setError(failure.message); });
    return () => controller.abort();
  }, [scope, retry]);
  useEffect(() => { if (editor && !(currentEditor || editorLine || editorUsage && usageLine)) setEditor(null); }, [data, editor]);
  const actorCurrent = () => viewAllowed(userRole) && uiPermissionScope(currentPermissionProfile()) === JSON.parse(scope)[0];
  const run = async (action: (options: { signal: AbortSignal; isCurrent: () => boolean }) => Promise<TreatmentLedgerResponse>, message: string, closeEditors = true) => {
    if (busy || !actorCurrent() || retryLocked && !closeEditors) return;
    lifetime.current.request?.abort(); const controller = new AbortController(), generation = lifetime.current.generation; lifetime.current.request = controller;
    const current = () => lifetime.current.active && lifetime.current.generation === generation && lifetime.current.request === controller && !controller.signal.aborted;
    setBusy(true); setError(''); setNotice('');
    try { const value = await action({ signal: controller.signal, isCurrent: current }); if (!current()) return; setData(value); if (closeEditors) { setEditor(null); setPurchaseOpen(false); } setNotice(message); setRetryLocked(false); return value; }
    catch (failure: any) { if (!current() || failure.name === 'AbortError') return; if (closeEditors && failure.status === 409) setPurchaseReviewRequired(true); if (closeEditors && (!failure.status || failure.status >= 500)) { setRetryLocked(true); setNotice('The save result is uncertain. Retry the submitted command, or reload balances to inspect the saved record before making changes.'); } setError(failure.message + (failure.status === 409 ? ' Reload balances and review the current record before retrying.' : '')); }
    finally { if (current()) setBusy(false); }
  };
  const identify = (body: Record<string, unknown>) => { const key = JSON.stringify([editor, body]); if (command.current.key !== key) command.current = { key, id: crypto.randomUUID() }; return { ...body, commandId: command.current.id }; };
  const saveEditor = (event: React.FormEvent) => {
    event.preventDefault(); if (!data || busy || !actorCurrent() || patient.isArchived) return;
    if (editor?.kind === 'metadata' && currentEditor && (currentEditor.capabilities.canEditNotes || currentEditor.capabilities.canEditOrNumber)) {
      // Statement refreshes update saved data, not the metadata draft's base version.
      const body = identify({ expectedVersion: editor.expectedVersion, ...(currentEditor.capabilities.canEditNotes ? { notes } : {}), ...(currentEditor.capabilities.canEditOrNumber ? { orNumber } : {}) });
      void run(options => updateTreatmentPurchase(patient.id, currentEditor.id, body, options), 'Package details saved.');
    } else if (editorLine && editorLine.purchase.capabilities.canAdjust) {
      if (!reason.trim() || !Number.isInteger(delta) || delta === 0 || editorLine.line.remainingSessions + delta < 0) { setError('Enter a reason and a nonzero whole session adjustment that leaves a nonnegative balance.'); return; }
      const body = identify({ expectedLineVersion: editorLine.line.version, delta, reason: reason.trim() });
      void run(options => adjustTreatmentSessions(patient.id, editorLine.line.id, body, options), 'Session adjustment recorded.');
    } else if (editorUsage && usageLine && usageLine.purchase.capabilities.canAdjust && data.branches.some(branch => branch.id === editorUsage.visitSnapshot.branchId)) {
      if (!reason.trim()) { setError('Enter a reason for reversing this usage.'); return; }
      const body = identify({ expectedLineVersion: usageLine.line.version, expectedUsageVersion: editorUsage.version, reason: reason.trim() });
      void run(options => reverseTreatmentUsage(patient.id, editorUsage.eventId, body, options), 'Session usage reversed.');
    }
  };
  const exportSaved = async () => {
    if (!data || busy || retryLocked || !actorCurrent()) return;
    await run(async options => {
      const saved = await getTreatmentLedger(patient.id, options);
      if (!options.isCurrent() || !actorCurrent()) throw new DOMException('Statement access changed.', 'AbortError');
      const url = URL.createObjectURL(new Blob([JSON.stringify(treatmentSessionStatement(saved, patient), null, 2)], { type: 'application/json' }));
      try { const link = document.createElement('a'); link.href = url; link.download = `treatment-sessions-${patient.patientID || patient.id}.json`; link.click(); } finally { URL.revokeObjectURL(url); }
      return saved;
    }, 'Saved session statement exported.', false);
  };
  return <section className="space-y-4" aria-labelledby="treatment-ledger-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="max-w-xl"><h3 id="treatment-ledger-heading" className="text-base font-bold text-slate-900">Treatment Ledger</h3><p className="mt-1 text-xs leading-5 text-slate-600">Remaining sessions by package and Service. Sessions can be used at your authorized branches; Service availability still applies.</p></div><div className="flex flex-wrap gap-2">{data?.capabilities.canPurchase && !patient.isArchived && <button type="button" disabled={busy || retryLocked} onClick={() => { setPurchaseOpen(true); setPurchaseReviewRequired(false); setEditor(null); setError(''); }} className={primary}><Plus size={16} />Record purchase</button>}<button type="button" disabled={!data || busy || retryLocked || !data.purchases.length} onClick={() => void exportSaved()} className={button}><Download size={15} />Export saved ledger</button></div></div>
    {error && <div role="alert" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setEditor(null); setPurchaseOpen(false); setRetryLocked(false); setNotice(''); setRetry(value => value + 1); }} className={button}>Reload balances</button></div>}{notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    {!data && !error && <div role="status" aria-label="Loading treatment ledger" className="space-y-3"><div className="h-20 animate-pulse rounded-xl bg-slate-100" /><div className="h-32 animate-pulse rounded-xl bg-slate-100" /></div>}
    {data && purchaseOpen && <PurchaseForm data={data} disabled={busy} locked={retryLocked} userRole={userRole} needsReview={purchaseReviewRequired} onReviewed={() => setPurchaseReviewRequired(false)} onCancel={() => setPurchaseOpen(false)} onSubmit={body => void run(options => createTreatmentPurchase(patient.id, body, options), 'Package purchase saved.')} />}
    {data && !data.purchases.length && <div className="rounded-xl border border-dashed border-slate-300 p-6"><h4 className="text-sm font-semibold text-slate-900">No package purchases recorded</h4><p className="mt-1 text-sm leading-6 text-slate-600">Record a package with its included Services and session counts. Use sessions while saving a Visit with a matching performed Service.</p></div>}
    {data?.purchases.map(purchase => <article key={purchase.id} className="overflow-hidden rounded-xl border border-slate-200"><div className="flex flex-wrap items-start justify-between gap-3 bg-slate-50 p-4"><div className="min-w-0"><h4 className="break-words text-sm font-bold text-slate-900">{purchase.packageName}</h4>{purchase.usable === false && <p className="mt-1 text-sm font-semibold text-amber-800">Sessions locked — invoice unpaid or void.</p>}{purchase.catalogue && <p className="mt-1 text-xs text-slate-600">Catalogue version {purchase.catalogue.version}</p>}<p className="mt-1 break-words text-xs text-slate-600">Purchased {purchase.purchaseDate} · {purchase.branchNameSnapshot}</p>{purchase.orNumber && <p className="mt-1 text-xs text-slate-600">OR#: {purchase.orNumber}</p>}{purchase.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{purchase.notes}</p>}{purchase.metadataRedacted && <p className="mt-2 text-xs text-slate-600">Package notes and OR# require access to the purchase clinic.</p>}</div>{(purchase.capabilities.canEditNotes || purchase.capabilities.canEditOrNumber) && <button type="button" disabled={busy || retryLocked || patient.isArchived} onClick={() => { setEditor({ kind: 'metadata', purchaseId: purchase.id, expectedVersion: purchase.version }); setNotes(purchase.notes); setOrNumber(purchase.orNumber || ''); setError(''); }} className={button}>Edit package details</button>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="border-y border-slate-200 bg-white text-xs text-slate-600"><tr><th className="px-4 py-3 font-semibold">Service</th><th className="px-3 py-3 text-right font-semibold">Remaining</th><th className="px-3 py-3 text-right font-semibold">Used</th><th className="px-3 py-3 text-right font-semibold">Purchased</th><th className="px-3 py-3 text-right font-semibold">Adjusted</th>{purchase.capabilities.canAdjust && <th className="px-3 py-3"><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{purchase.lines.map(line => <tr key={line.id} className="border-b border-slate-100 last:border-0"><th scope="row" className="max-w-64 break-words px-4 py-3 font-medium text-slate-800">{line.serviceNameSnapshot}</th><td className="px-3 py-3 text-right font-bold tabular-nums text-teal-800">{line.remainingSessions}</td><td className="px-3 py-3 text-right tabular-nums text-slate-700">{line.usedSessions}</td><td className="px-3 py-3 text-right tabular-nums text-slate-700">{line.purchasedSessions}</td><td className="px-3 py-3 text-right tabular-nums text-slate-700">{line.adjustmentSessions > 0 ? '+' : ''}{line.adjustmentSessions}</td>{purchase.capabilities.canAdjust && <td className="px-3 py-3"><button type="button" disabled={busy || retryLocked || patient.isArchived} onClick={() => { setEditor({ kind: 'adjustment', lineId: line.id }); setReason(''); setDelta(1); setError(''); }} className={button}>Adjust sessions</button></td>}</tr>)}</tbody></table></div>
    </article>)}
    {editor && (currentEditor || editorLine || editorUsage && usageLine) && <form onSubmit={saveEditor} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><h4 className="text-sm font-semibold text-slate-900">{currentEditor ? `Edit ${currentEditor.packageName}` : editorLine ? `Adjust ${editorLine.line.serviceNameSnapshot}` : 'Reverse recorded session usage'}</h4><fieldset disabled={busy || retryLocked} className="space-y-3">{currentEditor ? <>{currentEditor.capabilities.canEditNotes && <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Package notes</span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={3000} rows={3} className={field} /></label>}{currentEditor.capabilities.canEditOrNumber && <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>OR#</span><input value={orNumber} onChange={event => setOrNumber(event.target.value)} maxLength={120} className={field} /></label>}</> : <>{editorLine && <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Session adjustment (positive adds, negative removes)</span><input type="number" step={1} value={delta || ''} onChange={event => setDelta(Number(event.target.value))} className={field} /></label>}{editorUsage && <p className="text-sm text-slate-700">Reverse {editorUsage.sessions} used sessions for {usageLine?.line.serviceNameSnapshot}. The original transaction stays in history.</p>}<label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Reason (required)</span><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} required rows={2} className={field} /></label></>}</fieldset><div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={primary}>{busy ? 'Saving…' : currentEditor ? 'Save package details' : editorLine ? 'Record adjustment' : 'Reverse usage'}</button><button type="button" onClick={() => setEditor(null)} disabled={busy} className={button}>Cancel</button></div></form>}
    {data && <section className="space-y-3" aria-label="Session transaction history"><h4 className="text-sm font-bold text-slate-900">Session history</h4>{!data.events.length ? <p className="text-sm text-slate-600">No session transactions recorded.</p> : <ol className="divide-y divide-slate-200">{[...data.events].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(event => {
      const purchase = data.purchases.find(item => item.id === event.purchaseId), line = purchase?.lines.find(item => item.id === event.lineId), usage = data.activeVisitUsages.find(item => item.eventId === event.id);
      return <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-semibold capitalize text-slate-900">{event.type} · {purchase?.packageName || 'Recorded package'}{line ? ` · ${line.serviceNameSnapshot}` : ''}</p><p className="mt-1 text-xs text-slate-600">{activityLabel(event)}{event.balanceAfter ? ` · ${event.balanceAfter.remainingSessions} remaining after` : ''} · recorded {formatDateTime(event.recordedAt)} · {event.actor.name}</p>{event.treatmentDate && <p className="mt-1 text-xs text-slate-600">Visit: {formatLedgerTreatmentTime(event.treatmentDate, event.visitSnapshot?.timezoneSnapshot)}{event.visitSnapshot?.branchNameSnapshot ? ` · ${event.visitSnapshot.branchNameSnapshot}` : ''}{event.visitSnapshot?.performedByNameSnapshot ? ` · ${event.visitSnapshot.performedByNameSnapshot}` : ''}</p>}{event.reason && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">Reason: {event.reason}</p>}</div>{usage && purchase?.capabilities.canAdjust && data.branches.some(branch => branch.id === event.branchId) && <button type="button" disabled={busy || retryLocked || patient.isArchived} onClick={() => { setEditor({ kind: 'reversal', eventId: event.id }); setReason(''); setError(''); }} className={button}>Reverse usage</button>}</li>;
    })}</ol>}</section>}
  </section>;
}

export default function TreatmentLedgerTab({ patient, userRole }: { patient: any; userRole?: string }) {
  const scope = JSON.stringify([uiPermissionScope(currentPermissionProfile()), auth.currentUser?.uid, patient.id, Boolean(patient.isArchived)]);
  const [invalidated, setInvalidated] = useState<string | null>(null);
  useLayoutEffect(() => subscribeProtectedDataInvalidation(() => setInvalidated(scope)), [scope]);
  if (!viewAllowed(userRole) || invalidated === scope) return <p role="alert" className="text-sm text-slate-600">Treatment Ledger access changed. Close and reopen this patient after your access is refreshed.</p>;
  return <LedgerWorkspace key={scope} patient={patient} userRole={userRole} scope={scope} />;
}
