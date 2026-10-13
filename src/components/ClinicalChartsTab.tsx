import React, { useEffect, useState } from 'react';
import { MapPinned } from 'lucide-react';
import { formatDateTime } from '../utils';
import { uiCan } from '../permissionState';
import { performedServiceLabel } from '../utils/visitServicePolicy';
import ClinicalChartModal from './ClinicalChartModal';

export default function ClinicalChartsTab({ patientId, visits, users, userRole }: { patientId: string; visits: any[]; users: any[]; userRole?: string }) {
  const [chartVisitId, setChartVisitId] = useState<string | null>(null);
  const canView = uiCan(userRole, 'clinical.view') && uiCan(userRole, 'visits.view');
  const records = visits.filter(visit => visit.patientId === patientId && !visit.isArchived)
    .sort((left, right) => String(right.visitDate || '').localeCompare(String(left.visitDate || '')));
  const chartVisit = records.find(visit => visit.id === chartVisitId);
  useEffect(() => {
    if (chartVisitId && (!chartVisit || !canView)) setChartVisitId(null);
  }, [chartVisitId, chartVisit, canView]);
  if (!canView) return <p className="text-sm text-slate-500">Clinical charts are unavailable with your current access.</p>;
  return <section className="space-y-4">
    <div><h3 className="text-base font-bold text-slate-900">Clinical charts</h3><p className="mt-1 text-xs leading-5 text-slate-500">Face and front/back body charts belong to a saved Visit. Nurse-led Visits can use charts without an assigned doctor. Editing requires clinical permissions; signing requires separate authorization.</p></div>
    {!records.length ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">Save a Visit first to open its clinical chart.</p> : <div className="space-y-3">{records.map(visit => <div key={visit.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
      <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{formatDateTime(visit.visitDate)}</p><p className="mt-1 break-words text-xs text-slate-500">{performedServiceLabel(visit)} · {visit.branchName || 'Recorded clinic'}</p><p className="mt-1 text-xs text-slate-500">Performed by: {visit.performedByUserId ? visit.performedByNameSnapshot || 'Recorded performer' : users.find(user => user.id === visit.doctorId)?.fullName || users.find(user => user.id === visit.doctorId)?.name || visit.doctorName || 'Not recorded'}{visit.performedByDesignationSnapshot ? ` · ${visit.performedByDesignationSnapshot}` : ''}</p>{visit.doctorId && <p className="mt-1 text-xs text-slate-500">Assigned doctor: {users.find(user => user.id === visit.doctorId)?.fullName || users.find(user => user.id === visit.doctorId)?.name || visit.doctorName || 'Recorded doctor'}</p>}</div>
      <button type="button" onClick={() => setChartVisitId(visit.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800"><MapPinned size={16} aria-hidden="true" />Open chart</button>
    </div>)}</div>}
    {chartVisit && <ClinicalChartModal visit={chartVisit} users={users} userRole={userRole} onClose={() => setChartVisitId(null)} />}
  </section>;
}
