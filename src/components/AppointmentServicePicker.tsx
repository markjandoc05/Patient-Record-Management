import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { servicesRequest } from '../utils/servicesApi';
import { priceLabel } from '../servicesPolicy';

export type SelectedAppointmentService = {
  kind: 'selected'; branchId: string; serviceId: string; expectedVersion: number;
  name: string; duration: number; referencePrice: string; reviewRequired: boolean;
};
export type AppointmentServiceChoice = { kind: 'unchanged' } | { kind: 'removed' } | SelectedAppointmentService;

function eligibleChoice(service: any, branchId: string): SelectedAppointmentService | null {
  const branch = service.branches?.find((value: any) => value.id === branchId);
  if (!service.active || !branch?.operationallyAvailable
    || !['priced', 'free'].includes(branch.effectivePrice?.mode) || branch.effectivePrice.amount == null) return null;
  return { kind: 'selected', branchId, serviceId: service.id, expectedVersion: service.version,
    name: service.name, duration: service.default_duration_minutes,
    referencePrice: branch.effectivePrice.amount, reviewRequired: false };
}
const choiceLabel = (choice: SelectedAppointmentService) => `${choice.name} · ${choice.duration} min · ${priceLabel(choice.referencePrice)} current catalogue price · v${choice.expectedVersion}`;

// A historical snapshot is never resolved through the live catalogue. Editable
// selection and an explicitly requested review are separate transitions; only
// confirmation copies a reviewed version into the parent's submission state.
export default function AppointmentServicePicker({ branchId, readOnly, recorded, choice, onChange, onReviewRequired, unresolved, error }: {
  branchId: string; readOnly: boolean; recorded?: any; choice: AppointmentServiceChoice;
  onChange: (choice: AppointmentServiceChoice) => void; onReviewRequired: () => void;
  unresolved: boolean; error?: string;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState({ key: '', rows: [] as any[], total: 0, error: '', ready: false });
  const lifetime = useRef({ active: false, generation: 0 });
  useLayoutEffect(() => {
    lifetime.current.active = true; lifetime.current.generation++;
    return () => { lifetime.current.active = false; lifetime.current.generation++; };
  }, []);
  const key = JSON.stringify([branchId, search, page, retry]);
  const requestGeneration = useRef({ key, generation: 0 });
  useLayoutEffect(() => {
    requestGeneration.current = { key, generation: requestGeneration.current.generation + 1 };
    return () => { requestGeneration.current.generation++; };
  }, [key]);
  useEffect(() => {
    if (!branchId || readOnly) return;
    const controller = new AbortController(), generation = lifetime.current.generation, request = requestGeneration.current.generation;
    const current = () => lifetime.current.active && lifetime.current.generation === generation
      && requestGeneration.current.key === key && requestGeneration.current.generation === request && !controller.signal.aborted;
    const query = new URLSearchParams({ branchId, status: 'active', availableOnly: 'true', page: String(page), pageSize: '25', q: search });
    void servicesRequest(`/api/services?${query}`, 'GET', undefined, controller.signal, current).then(result => {
      if (!current()) return;
      setLoad({ key, rows: result.services.filter((service: any) => eligibleChoice(service, branchId)), total: result.total, ready: true, error: '' });
    }).catch(failure => {
      if (current() && failure.name !== 'AbortError') setLoad({ key, rows: [], total: 0, ready: true, error: failure.message });
    });
    return () => controller.abort();
  }, [key, readOnly]);
  const visible = load.key === key ? load : { rows: [], total: 0, ready: false, error: '' };
  const selected = choice.kind === 'selected' && choice.branchId === branchId ? choice : null;
  const selectionKey = selected ? JSON.stringify([selected.serviceId, selected.expectedVersion, branchId]) : '';
  const reviewLifetime = useRef({ key: selectionKey, generation: 0, request: null as AbortController | null });
  const [review, setReview] = useState({ key: '', request: null as AbortController | null,
    candidate: null as SelectedAppointmentService | null, name: '', duration: 0, version: 0, ready: false, error: '' });
  useLayoutEffect(() => {
    reviewLifetime.current.key = selectionKey; reviewLifetime.current.generation++;
    return () => { reviewLifetime.current.generation++; reviewLifetime.current.request?.abort(); };
  }, [selectionKey]);
  const reviewCurrent = review.key === selectionKey && review.request === reviewLifetime.current.request ? review : null;
  const reloadSelection = async () => {
    if (!selected || readOnly) return;
    onReviewRequired();
    reviewLifetime.current.request?.abort();
    const controller = new AbortController(), generation = reviewLifetime.current.generation, lifetimeGeneration = lifetime.current.generation;
    reviewLifetime.current.request = controller;
    setReview({ key: selectionKey, request: controller, candidate: null, name: '', duration: 0, version: 0, ready: false, error: '' });
    const current = () => lifetime.current.active && lifetime.current.generation === lifetimeGeneration
      && reviewLifetime.current.key === selectionKey && reviewLifetime.current.generation === generation
      && reviewLifetime.current.request === controller && !controller.signal.aborted;
    try {
      const service = await servicesRequest(`/api/services/${encodeURIComponent(selected.serviceId)}?branchId=${encodeURIComponent(branchId)}`, 'GET', undefined, controller.signal, current);
      if (current()) setReview({ key: selectionKey, request: controller, candidate: eligibleChoice(service, branchId),
        name: service.name, duration: service.default_duration_minutes, version: service.version, ready: true, error: '' });
    } catch (failure: any) {
      if (current() && failure.name !== 'AbortError') setReview({ key: selectionKey, request: controller, candidate: null, name: '', duration: 0, version: 0, ready: true, error: failure.message });
    }
  };
  const canKeepRecorded = Boolean(recorded?.serviceId) && recorded.branchId === branchId;
  const retained = choice.kind === 'unchanged' && canKeepRecorded;
  const value = retained ? '__recorded' : selected?.serviceId || (unresolved ? '__review' : '__none');
  return <div className="space-y-2 rounded-xl border border-slate-200 p-3">
    <label htmlFor="appointment-service" className="text-xs font-semibold text-slate-600">Service (optional)</label>
    {recorded?.serviceId && <p className="text-xs text-slate-600">Recorded: {recorded.serviceNameSnapshot || 'Historical Service'} · {recorded.serviceDurationMinutesSnapshot ?? 'Unknown'} min</p>}
    {readOnly ? <p className="text-sm text-slate-700">{recorded?.serviceId ? 'Saved Service snapshot retained.' : 'No canonical Service selected.'}</p> : <>
      {unresolved && <p role="alert" className="text-xs text-amber-700">{selected?.reviewRequired ? 'This selection needs review. Reload and confirm the current Service, choose another Service, or explicitly remove it before saving.' : 'Review the Service for the selected clinic. Choose an eligible Service or explicitly remove it before saving.'}</p>}
      {branchId && <input aria-label="Search appointment Services" type="search" maxLength={120} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search Services" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />}
      <select id="appointment-service" data-appointment-field="serviceSelection" aria-invalid={Boolean(error)} value={value} disabled={!branchId} onChange={event => {
        if (event.target.value === '__none') { onChange({ kind: 'removed' }); return; }
        if (event.target.value === '__recorded') { onChange({ kind: 'unchanged' }); return; }
        const row = visible.rows.find(service => service.id === event.target.value);
        const next = row && eligibleChoice(row, branchId);
        if (next) onChange(next);
      }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <option value="__none">{branchId ? 'No Service (explicit choice)' : 'Select a clinic first'}</option>
        {unresolved && !selected && <option value="__review" disabled>Service choice required for this clinic</option>}
        {canKeepRecorded && <option value="__recorded">Keep recorded Service: {recorded.serviceNameSnapshot || 'Historical Service'}</option>}
        {selected && <option value={selected.serviceId}>{selected.reviewRequired ? `${selected.name} · ${selected.duration} min · v${selected.expectedVersion} (needs review)` : choiceLabel(selected)}</option>}
        {visible.rows.filter(row => row.id !== selected?.serviceId).map(row => <option key={row.id} value={row.id}>{choiceLabel(eligibleChoice(row, branchId)!)}</option>)}
      </select>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {choice.kind === 'removed' && recorded?.serviceId && <p role="status" className="text-xs text-amber-700">The recorded Service will be removed when you save.</p>}
      {(recorded?.serviceId || choice.kind === 'selected') && choice.kind !== 'removed' && <button type="button" onClick={() => onChange({ kind: 'removed' })} className="text-xs font-semibold text-rose-700 underline">Remove Service</button>}
      {branchId && !visible.ready && <p role="status" className="text-xs text-slate-500">Loading Services…</p>}
      {visible.error && <div role="alert" className="text-xs text-rose-700">{visible.error} <button type="button" onClick={() => setRetry(value => value + 1)} className="font-semibold underline">Retry</button></div>}
      {branchId && visible.ready && !visible.error && !visible.rows.length && <p className="text-xs text-slate-500">No selectable Services on this page.</p>}
      {visible.total > 25 && <div className="flex items-center gap-3 text-xs"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={page * 25 >= visible.total} onClick={() => setPage(value => value + 1)}>Next</button></div>}
      {selected && <>
        <p className="text-xs text-slate-600">{selected.reviewRequired ? `Previous selection: ${selected.name} · ${selected.duration} min · v${selected.expectedVersion}` : `Selected: ${choiceLabel(selected)}`}</p>
        <button type="button" onClick={() => void reloadSelection()} className="text-xs font-semibold text-teal-700 underline">Reload Services to review changes</button>
        {reviewCurrent && !reviewCurrent.ready && <p role="status" className="text-xs text-slate-500">Loading current Service…</p>}
        {reviewCurrent?.error && <p role="alert" className="text-xs text-rose-700">{reviewCurrent.error} Reload to retry, choose another Service, or remove it.</p>}
        {selected.reviewRequired && reviewCurrent?.ready && !reviewCurrent.error && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
          <p>Latest catalogue: {reviewCurrent.name} · {reviewCurrent.duration} min · v{reviewCurrent.version}</p>
          {reviewCurrent.candidate ? <><p>{priceLabel(reviewCurrent.candidate.referencePrice)} current catalogue price</p><button type="button" onClick={() => onChange(reviewCurrent.candidate!)} className="font-semibold text-teal-700 underline">Use reviewed Service</button></> : <p role="alert" className="text-amber-700">This Service is no longer eligible at this clinic. Choose another Service or explicitly remove it before saving.</p>}
        </div>}
      </>}
      <p className="text-xs text-slate-500">Current catalogue price is for reference only. Default duration is an estimate; existing time slots are unchanged.</p>
    </>}
  </div>;
}
