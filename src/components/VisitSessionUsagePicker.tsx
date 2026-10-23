import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { uiCan, uiPermissionScope } from '../permissionState';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { auth } from '../platform';
import { getTreatmentLedger } from '../utils/treatmentLedgerApi';
import type { TreatmentLedgerResponse } from '../treatmentLedgerPolicy';

export type SessionUsageChoice = { commandId: string; lineId: string; sessions: number; expectedLineVersion: number; expectedUsageVersion: 0; valid: boolean };
type Props = {
  patientId: string; branchId: string; serviceId: string; visitId?: string; visitDate: string;
  disabled: boolean; serviceUnresolved: boolean; userRole?: string | null;
  readOnly?: boolean;
  value: SessionUsageChoice | null; onChange: (value: SessionUsageChoice | null) => void;
  onBinding: (active: boolean, loading: boolean) => void;
};

export default function VisitSessionUsagePicker(props: Props) {
  const { patientId, branchId, serviceId, visitId, value, onChange, onBinding } = props;
  const scope = JSON.stringify([uiPermissionScope(), auth.currentUser?.uid, patientId, branchId, serviceId, visitId]);
  const [snapshot, setSnapshot] = useState<{ scope: string; data: TreatmentLedgerResponse | null; error: string }>({ scope: '', data: null, error: '' });
  const [reload, setReload] = useState(0);
  const lifetime = useRef({ active: false, generation: 0 });
  const canView = uiCan(props.userRole, 'treatment_ledger.view') && uiCan(props.userRole, 'patients.view') && uiCan(props.userRole, 'visits.view') && uiCan(props.userRole, 'clinical.view');
  useLayoutEffect(() => {
    lifetime.current.active = true; lifetime.current.generation++;
    if (visitId && canView && !props.readOnly) onBinding(false, true);
    return () => { lifetime.current.active = false; lifetime.current.generation++; };
  }, [scope]);
  useEffect(() => {
    onChange(null);
    if (!patientId || !canView || props.readOnly) { onBinding(false, false); return; }
    const controller = new AbortController(), generation = lifetime.current.generation;
    const current = () => lifetime.current.active && lifetime.current.generation === generation && !controller.signal.aborted;
    onBinding(false, Boolean(visitId));
    setSnapshot({ scope, data: null, error: '' });
    const stop = subscribeProtectedDataInvalidation(() => { if (current()) { controller.abort(); setSnapshot({ scope, data: null, error: 'Session access changed. Close and reopen this Visit.' }); onBinding(false, Boolean(visitId)); onChange(null); } });
    void getTreatmentLedger(patientId, { signal: controller.signal, isCurrent: current }).then(data => {
      if (!current()) return;
      setSnapshot({ scope, data, error: '' });
      onBinding(data.activeVisitUsages.some(usage => usage.visitId === visitId), false);
    }).catch(error => {
      if (!current() || error.name === 'AbortError') return;
      setSnapshot({ scope, data: null, error: error.message }); onBinding(false, Boolean(visitId));
    });
    return () => { stop(); controller.abort(); };
  }, [scope, reload, canView, props.readOnly]);
  const visible = snapshot.scope === scope ? snapshot : { data: null, error: '' };
  const active = visible.data?.activeVisitUsages.find(usage => usage.visitId === visitId);
  const allLines = visible.data?.purchases.flatMap(purchase => purchase.lines.map(line => ({ purchase, line }))) || [];
  const available = allLines.filter(({ line, purchase }) => purchase.usable !== false && line.serviceId === serviceId && line.remainingSessions > 0);
  const selected = available.find(({ line }) => line.id === value?.lineId);
  const field = 'w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-4 focus:ring-teal-500/10 disabled:opacity-50';
  const select = (lineId: string, sessions = value?.sessions || 1) => {
    const line = available.find(item => item.line.id === lineId)?.line;
    onChange({ commandId: crypto.randomUUID(), lineId, sessions, expectedLineVersion: line?.version || 0, expectedUsageVersion: 0,
      valid: Boolean(line) && Number.isInteger(sessions) && sessions > 0 && sessions <= (line?.remainingSessions || 0) });
  };
  if (!canView) return null;
  if (props.readOnly) return <p className="text-xs text-slate-600">View this Visit’s saved session transactions in the patient’s Treatment Ledger.</p>;
  if (active) {
    const recorded = allLines.find(item => item.line.id === active.lineId);
    return <section aria-label="Recorded session usage" className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-sm font-semibold text-slate-900">Recorded session usage</h4>
      <p className="text-sm text-slate-700">{active.sessions} {active.sessions === 1 ? 'session' : 'sessions'} · {recorded?.purchase.packageName || 'Recorded package'} · {recorded?.line.serviceNameSnapshot || 'Recorded Service'}</p>
      <p className="text-xs leading-5 text-slate-600">Patient, clinic, performed Service, Visit time and performer details are fixed while this usage is active. An authorized Administrator can reverse the usage with a reason in the Treatment Ledger before changing these fields.</p>
    </section>;
  }
  return <section aria-label="Package sessions" className="space-y-3 rounded-xl border border-slate-200 p-3">
    <h4 className="text-sm font-semibold text-slate-900">Package sessions</h4>
    {!patientId ? <p className="text-xs text-slate-600">Select a patient to view their available sessions.</p> : visible.error ? <div role="alert" className="space-y-2 text-xs text-rose-700"><p>{visible.error}</p><button type="button" disabled={props.disabled} onClick={() => setReload(number => number + 1)} className="min-h-9 rounded-lg border border-slate-300 px-3 text-slate-700">Retry session balances</button></div> : !visible.data ? <div role="status" aria-label="Loading session balances" className="h-10 animate-pulse rounded-lg bg-slate-100" /> : !serviceId || props.serviceUnresolved ? <p className="text-xs text-slate-600">Confirm a performed Service to use matching package sessions.</p> : !available.length ? <p className="text-xs text-slate-600">No remaining sessions match this performed Service at your authorized clinics. Save a purchase in the patient’s Treatment Ledger to add sessions.</p> : <>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(value)} disabled={props.disabled} onChange={event => event.target.checked ? select('') : onChange(null)} className="h-4 w-4 accent-teal-700" />Use package sessions for this Visit</label>
      {value && <><div className="space-y-1"><label htmlFor="visit-session-line" className="text-xs font-semibold text-slate-600">Package / Service balance</label><select id="visit-session-line" disabled={props.disabled} value={selected?.line.id || ''} onChange={event => select(event.target.value)} className={field}><option value="">Choose a package balance</option>{available.map(({ purchase, line }) => <option key={line.id} value={line.id}>{purchase.packageName} · {line.serviceNameSnapshot} · {line.remainingSessions} remaining · purchased {purchase.purchaseDate} at {purchase.branchNameSnapshot}</option>)}</select></div>
        <div className="space-y-1"><label htmlFor="visit-session-count" className="text-xs font-semibold text-slate-600">Sessions used</label><input id="visit-session-count" type="number" min={1} max={selected?.line.remainingSessions || 1} step={1} value={value.sessions || ''} disabled={props.disabled || !selected} onChange={event => select(value.lineId, Number(event.target.value))} className={field} />{!value.valid && <p className="text-xs text-rose-700">Choose a package and a whole number within its remaining balance.</p>}</div>
        <p className="text-xs leading-5 text-slate-600">Usage uses this Visit’s saved date and time: {props.visitDate || 'select the Visit date and time'} (clinic time). Sessions can be used at your authorized branches; Service availability still applies.</p>
      </>}
    </>}
  </section>;
}
