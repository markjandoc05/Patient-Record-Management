import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, MapPinned, Plus, Printer, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { auth } from '../platform';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { CHART_MAPS, MAX_CHART_MARKERS, validateChartContent, type ChartDraft, type ChartMap, type ChartMarker, type ChartResponse, type ChartRevision } from '../clinicalChartPolicy';
import { getClinicalChart, saveClinicalChartDraft, signClinicalChart, startClinicalChartAmendment } from '../utils/clinicalChartsApi';
import { formatDateTime } from '../utils';
import ClinicalChartMap, { chartMapLabels } from './ClinicalChartMap';

type Props = { visit: any; users?: any[]; userProfile?: any; userRole?: string | null; onClose: () => void };
type Content = { markers: ChartMarker[]; notes: string };
const copyContent = (content: Content): Content => ({ markers: content.markers.map(marker => ({ ...marker })), notes: content.notes });
const isRevision = (value: ChartDraft): value is ChartRevision => 'signedAt' in value;
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50';

function ChartWorkspace({ visit, userRole, userProfile, onClose }: Props) {
  const [response, setResponse] = useState<ChartResponse | null>(null);
  const [content, setContent] = useState<Content>({ markers: [], notes: '' });
  const [undo, setUndo] = useState<Content[]>([]);
  const [map, setMap] = useState<ChartMap>('face');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [view, setView] = useState<'draft' | number>('draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requiresReload, setRequiresReload] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');
  const lifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  const dialog = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    lifetime.current.active = true;
    return () => { lifetime.current.active = false; lifetime.current.generation++; lifetime.current.request?.abort(); };
  }, []);
  const beginRequest = () => {
    lifetime.current.request?.abort();
    const controller = new AbortController(), generation = ++lifetime.current.generation;
    lifetime.current.request = controller;
    return { signal: controller.signal, isCurrent: () => lifetime.current.active && lifetime.current.generation === generation && lifetime.current.request === controller && !controller.signal.aborted };
  };
  const accept = (value: ChartResponse) => {
    setResponse(value);
    setContent(copyContent(value.chart?.draft || { markers: [], notes: '' }));
    setUndo([]); setSelectedMarkerId(null); setAmendmentReason('');
    setView(value.chart?.draft || !value.chart?.revisions.length ? 'draft' : value.chart.revisions[value.chart.revisions.length - 1].revision);
    setRequiresReload(false);
  };
  const load = async () => {
    const options = beginRequest(); setBusy(true); setError(''); setNotice('');
    try { const value = await getClinicalChart(visit.id, options); if (options.isCurrent()) accept(value); }
    catch (failure: any) { if (options.isCurrent() && failure.name !== 'AbortError') { setError(failure.message || 'The chart could not be loaded.'); setRequiresReload(true); } }
    finally { if (options.isCurrent()) setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const draft = response?.chart?.draft;
  const dirty = JSON.stringify(content) !== JSON.stringify(copyContent(draft || { markers: [], notes: '' }));
  const isDraft = view === 'draft';
  const revision = !isDraft ? response?.chart?.revisions.find(item => item.revision === view) : undefined;
  const saved: ChartDraft | ChartRevision | undefined = isDraft ? draft || undefined : revision;
  const shown = isDraft ? content : revision || { markers: [], notes: '' };
  const actor = userProfile || userRole;
  const canEdit = Boolean(isDraft && response?.permissions.canEdit && uiCan(actor, 'visits.edit') && uiCan(actor, 'clinical.edit_draft') && !busy && !requiresReload);
  const contextChanged = Boolean(draft && draft.contextKey !== response?.contextKey);
  const canSign = Boolean(isDraft && draft && !dirty && !contextChanged && response?.permissions.canSign && uiCan(actor, 'clinical.finalize') && !busy && !requiresReload);
  const canAmend = Boolean(response?.permissions.canAmend && uiCan(actor, 'visits.edit') && uiCan(actor, 'clinical.edit_draft') && !busy && !requiresReload && !draft);
  const canExport = Boolean(saved && !busy && !requiresReload && !(isDraft && dirty));
  const selectedMarker = shown.markers.find(marker => marker.id === selectedMarkerId);
  const mutate = (next: Content) => {
    if (!canEdit) return;
    setUndo(previous => [...previous.slice(-49), copyContent(content)]); setContent(next); setNotice(''); setError('');
  };
  const updateMarker = (values: Partial<ChartMarker>) => mutate({ ...content, markers: content.markers.map(marker => marker.id === selectedMarkerId ? { ...marker, ...values } : marker) });
  const addMarker = (x: number, y: number) => {
    if (!canEdit || content.markers.length >= MAX_CHART_MARKERS) return;
    const marker: ChartMarker = { id: crypto.randomUUID(), map, x, y, label: '', notes: '' };
    mutate({ ...content, markers: [...content.markers, marker] }); setSelectedMarkerId(marker.id);
  };
  const close = () => { if (!busy && (!dirty || window.confirm('Discard your unsaved chart changes?'))) onClose(); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [busy, dirty]);

  const write = async (action: 'save' | 'sign' | 'amend') => {
    if (!response || busy || requiresReload) return;
    if (action === 'save' && !canEdit || action === 'sign' && !canSign || action === 'amend' && !canAmend) return;
    if (action === 'sign' && !window.confirm('Sign this saved clinical chart? Its contents will be locked; later corrections require an amendment.')) return;
    if (action === 'amend' && !amendmentReason.trim()) { setError('Enter a reason for this amendment.'); return; }
    try { if (action === 'save') validateChartContent(content); }
    catch (failure: any) { setError(failure.message); return; }
    const options = beginRequest(); setBusy(true); setError(''); setNotice('');
    const version = { expectedVersion: response.chart?.version || 0, expectedContextKey: response.contextKey };
    try {
      const value = action === 'save' ? await saveClinicalChartDraft(visit.id, { ...version, ...copyContent(content) }, options)
        : action === 'sign' ? await signClinicalChart(visit.id, version, options)
          : await startClinicalChartAmendment(visit.id, { ...version, reason: amendmentReason.trim() }, options);
      if (!options.isCurrent()) return;
      accept(value); setNotice(action === 'save' ? 'Chart draft saved.' : action === 'sign' ? 'Chart signed. The signed revision is read-only.' : 'Amendment draft opened. The signed chart remains unchanged.');
    } catch (failure: any) {
      if (!options.isCurrent() || failure.name === 'AbortError') return;
      setError(`${failure.message || 'The chart action could not be confirmed.'} Reload the saved chart before trying again.`);
      setRequiresReload(true);
    } finally { if (options.isCurrent()) setBusy(false); }
  };
  const reload = () => { if (!busy && (!dirty || window.confirm('Reload the saved chart and discard your unsaved changes?'))) void load(); };
  const exportJson = () => {
    if (!canExport || !saved || !response) return;
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, visitId: response.visitId, chartVersion: response.chart?.version, state: isDraft ? 'draft' : 'signed', snapshot: saved }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `vine-clinical-chart-${response.visitId}-${isDraft ? 'draft' : `revision-${view}`}.json`;
    anchor.click(); URL.revokeObjectURL(url);
  };
  const context = saved?.context || response?.visitContext;
  const displayedContext = isDraft ? response?.visitContext : context;
  const performerName = (value: typeof context) => value?.performedByUserId
    ? value.performedByNameSnapshot || 'Recorded performer' : value?.doctorName || 'Not recorded';
  return <div ref={dialog} data-clinical-chart-dialog className="clinical-chart-dialog fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-labelledby="clinical-chart-title">
    <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="clinical-chart-no-print flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:px-7">
        <div><h2 id="clinical-chart-title" className="flex items-center gap-2 text-lg font-bold text-slate-950"><MapPinned size={20} className="text-teal-700" />Clinical chart</h2><p className="mt-1 text-xs text-slate-500">{response?.visitContext.patientName || visit.patientName || 'Patient'} · {formatDateTime(response?.visitContext.visitDate || visit.visitDate)} · linked to this Visit</p></div>
        <button type="button" autoFocus aria-label="Close clinical chart" onClick={close} disabled={busy} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
      </header>
      <div className="clinical-chart-no-print space-y-4 p-5 sm:p-7">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">{busy ? 'Loading or saving chart…' : dirty ? 'Unsaved draft changes' : response?.chart ? `Saved chart · version ${response.chart.version}` : 'No chart saved yet'}</p>
          <button type="button" onClick={reload} disabled={busy} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"><RotateCcw size={14} />Reload saved chart</button>
        </div>
        {response && <>
          {response.readOnlyReason && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{response.readOnlyReason}</p>}
          {contextChanged && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Visit details changed. Review the current Visit information and save the draft before signing.</p>}
          <div className="flex flex-wrap gap-2" aria-label="Chart history">
            {(draft || !response.chart?.revisions.length) && <button type="button" disabled={busy} onClick={() => { setView('draft'); setSelectedMarkerId(null); }} aria-pressed={isDraft} className={`rounded-xl px-3 py-2 text-xs font-semibold ${isDraft ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{draft?.kind === 'amendment' ? 'Amendment draft' : 'Chart draft'}</button>}
            {response.chart?.revisions.map(item => <button key={item.revision} type="button" disabled={busy} onClick={() => { setView(item.revision); setSelectedMarkerId(null); }} aria-pressed={view === item.revision} className={`rounded-xl px-3 py-2 text-xs font-semibold ${view === item.revision ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>Signed revision {item.revision}</button>)}
          </div>
          {saved && <p className="text-xs leading-5 text-slate-500">{isRevision(saved) ? `Signed by ${saved.signedBy.name} · ${formatDateTime(saved.signedAt)}` : `Draft updated by ${saved.updatedBy.name} · ${formatDateTime(saved.updatedAt)}`}{saved.kind === 'amendment' ? ` · Amendment: ${saved.reason}` : ''}</p>}
          <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="font-semibold text-slate-500">Clinic</dt><dd className="mt-1 text-slate-800">{isDraft ? response.visitContext.branchName : context?.branchName}</dd></div>
            <div><dt className="font-semibold text-slate-500">Assigned doctor</dt><dd className="mt-1 text-slate-800">{(isDraft ? response.visitContext.doctorName : context?.doctorName) || 'Unassigned'}</dd></div>
            <div><dt className="font-semibold text-slate-500">Performed by</dt><dd className="mt-1 text-slate-800">{performerName(displayedContext)}{displayedContext?.performedByDesignationSnapshot ? ` · ${displayedContext.performedByDesignationSnapshot}` : ''}</dd></div>
            <div><dt className="font-semibold text-slate-500">Visit Service</dt><dd className="mt-1 text-slate-800">{(isDraft ? response.visitContext.serviceNameSnapshot : context?.serviceNameSnapshot) || 'Not recorded'}</dd></div>
          </dl>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="space-y-3">
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Chart map">{CHART_MAPS.map(value => <button key={value} type="button" onClick={() => { setMap(value); setSelectedMarkerId(null); }} aria-pressed={map === value} className={`min-h-10 rounded-xl px-2 text-xs font-semibold ${map === value ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{chartMapLabels[value]}</button>)}</div>
              <ClinicalChartMap map={map} markers={shown.markers} selectedMarkerId={selectedMarkerId} editable={canEdit} onAdd={addMarker} onSelect={setSelectedMarkerId} />
              {canEdit && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => addMarker(0.5, 0.5)} disabled={content.markers.length >= MAX_CHART_MARKERS} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800 disabled:opacity-40"><Plus size={15} />Add marker at center</button><button type="button" disabled={!undo.length} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { setContent(copyContent(previous)); setUndo(undo.slice(0, -1)); setSelectedMarkerId(null); } }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"><RotateCcw size={15} />Undo</button></div>}
              <p className="text-xs leading-5 text-slate-500">{canEdit ? 'Click the schematic to add a point, or use Add marker and adjust its position below.' : 'Choose a numbered marker to read its details.'} These are reference points, not measured treatment doses or anatomy.</p>
            </section>
            <section className="min-w-0 space-y-4">
              <div><h3 className="text-sm font-bold text-slate-900">Markers · {shown.markers.length}</h3><div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{!shown.markers.length ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">No markers recorded.</p> : shown.markers.map((marker, index) => <button key={marker.id} type="button" onClick={() => { setSelectedMarkerId(marker.id); setMap(marker.map); }} aria-pressed={selectedMarkerId === marker.id} className={`block w-full rounded-xl border px-3 py-2 text-left text-xs ${selectedMarkerId === marker.id ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white'}`}><span className="font-semibold text-slate-800">{index + 1}. {marker.label || 'Untitled marker'}</span><span className="ml-2 text-slate-500">{chartMapLabels[marker.map]}</span></button>)}</div></div>
              {selectedMarker && <fieldset disabled={!canEdit} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <legend className="px-1 text-xs font-semibold text-slate-600">Marker {shown.markers.findIndex(marker => marker.id === selectedMarker.id) + 1}</legend>
                <label className="block text-xs font-semibold text-slate-600">Label<input aria-label="Marker label" maxLength={100} value={selectedMarker.label} onChange={event => updateMarker({ label: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
                <label className="block text-xs font-semibold text-slate-600">Notes<textarea aria-label="Marker notes" maxLength={1000} rows={3} value={selectedMarker.notes} onChange={event => updateMarker({ notes: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
                <div className="grid grid-cols-2 gap-3">{(['x', 'y'] as const).map(axis => <label key={axis} className="block text-xs font-semibold text-slate-600">{axis === 'x' ? 'Horizontal position (%)' : 'Vertical position (%)'}<input aria-label={`${axis === 'x' ? 'Horizontal' : 'Vertical'} marker position`} type="number" min={0} max={100} step={0.1} value={Math.round(selectedMarker[axis] * 1000) / 10} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) updateMarker({ [axis]: Math.max(0, Math.min(1, value / 100)) }); }} className={`mt-1 ${inputClass}`} /></label>)}</div>
                {canEdit && <button type="button" onClick={() => { mutate({ ...content, markers: content.markers.filter(marker => marker.id !== selectedMarkerId) }); setSelectedMarkerId(null); }} className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-rose-700"><Trash2 size={14} />Remove marker</button>}
              </fieldset>}
              <label className="block text-xs font-semibold text-slate-600">Chart notes<textarea aria-label="Chart notes" value={shown.notes} readOnly={!canEdit} maxLength={3000} rows={4} onChange={event => mutate({ ...content, notes: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
              {canAmend && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4"><label className="block text-xs font-semibold text-amber-800">Amendment reason<textarea aria-label="Amendment reason" value={amendmentReason} maxLength={500} rows={2} onChange={event => setAmendmentReason(event.target.value)} className={`mt-1 ${inputClass}`} /></label><button type="button" onClick={() => void write('amend')} className="min-h-10 rounded-xl bg-amber-800 px-4 text-xs font-semibold text-white">Amend latest signed chart</button></div>}
            </section>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap gap-2"><button type="button" disabled={!canExport} onClick={() => { if (canExport) window.print(); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40"><Printer size={15} />Print / Save PDF</button><button type="button" disabled={!canExport} onClick={exportJson} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40"><Download size={15} />Export saved chart</button></div>
            <div className="flex flex-wrap gap-2">{isDraft && response.permissions.canEdit && <button type="button" disabled={!canEdit} onClick={() => void write('save')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-xs font-semibold text-white disabled:opacity-40"><Save size={15} />Save draft</button>}{isDraft && response.permissions.canSign && uiCan(actor, 'clinical.finalize') && <button type="button" disabled={!canSign} onClick={() => void write('sign')} className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40">Sign saved chart</button>}</div>
          </footer>
          {isDraft && !uiCan(actor, 'clinical.finalize') && <p className="text-xs text-slate-500">Signing requires the existing clinical finalization permission.</p>}
        </>}
      </div>
      {canExport && saved && <section className="clinical-chart-print hidden" aria-label="Saved clinical chart print view">
        <h1 className="text-xl font-bold">Vine · Clinical chart</h1><p className="mt-2">{saved.context.patientName} · {formatDateTime(saved.context.visitDate)}</p><p>{saved.context.branchName} · Assigned doctor: {saved.context.doctorName || 'Unassigned'}</p><p>Service: {saved.context.serviceNameSnapshot || 'Not recorded'} · Visit: {saved.context.visitId}</p>
        <p>Performed by: {performerName(saved.context)}{saved.context.performedByDesignationSnapshot ? ` · ${saved.context.performedByDesignationSnapshot}` : ''}</p>
        <p className="mt-2 font-semibold">{isRevision(saved) ? `Signed revision ${saved.revision} · ${saved.signedBy.name} · ${formatDateTime(saved.signedAt)}` : `DRAFT · Updated by ${saved.updatedBy.name} · ${formatDateTime(saved.updatedAt)}`}</p>
        {saved.kind === 'amendment' && <p>Amendment reason: {saved.reason}</p>}
        <div className="mt-4 grid grid-cols-3 gap-3">{CHART_MAPS.map(value => <ClinicalChartMap key={value} map={value} markers={saved.markers} />)}</div>
        <ol className="mt-4 space-y-2">{saved.markers.map((marker, index) => <li key={marker.id}>{index + 1}. {chartMapLabels[marker.map]} · {marker.label || 'Untitled marker'} · {marker.notes || 'No marker notes'}</li>)}</ol><p className="mt-4">Chart notes: {saved.notes || 'None recorded'}</p><p className="mt-4 text-xs">Schematic reference points. Exported copy of saved version {response?.chart?.version}.</p>
      </section>}
    </div>
  </div>;
}

// Shared clinical history remains readable; the server supplies per-Visit write
// permissions. Access changes destroy the previous workspace and request scope.
export default function ClinicalChartModal(props: Props) {
  const user = auth.currentUser;
  const profile = currentPermissionProfile() || props.userProfile || props.users?.find(value => value.id === user?.uid || value.email === user?.email);
  const scope = JSON.stringify([uiPermissionScope(profile), user?.uid, profile?.role, profile?.active, profile?.assignedBranches, props.visit?.id, props.visit?.branchId, props.visit?.doctorId, props.visit?.performedByUserId, props.visit?.performedByNameSnapshot, props.visit?.performedByRoleSnapshot, props.visit?.performedByDesignationSnapshot, props.visit?.isArchived]);
  const [invalidated, setInvalidated] = useState<string | null>(null);
  useLayoutEffect(() => subscribeProtectedDataInvalidation(() => setInvalidated(scope)), [scope]);
  if (typeof props.visit?.id !== 'string' || !props.visit.id) return <div role="alert" className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/60 p-5"><div className="space-y-4 rounded-2xl bg-white p-6"><p>Save the Visit before opening its clinical chart.</p><button type="button" onClick={props.onClose}>Close</button></div></div>;
  if (!user || !profile?.active || invalidated === scope || !uiCan(profile, 'clinical.view') || !uiCan(profile, 'visits.view')) {
    return <div data-clinical-chart-dialog className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/60 p-5"><div role="alert" className="space-y-4 rounded-2xl bg-white p-6"><p>Clinical chart access changed. Close and reopen after access is refreshed.</p><button type="button" onClick={props.onClose} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">Close</button></div></div>;
  }
  return <ChartWorkspace key={scope} {...props} userRole={profile.role} userProfile={profile} />;
}
