import { uiRecordPermission } from '../permissionState';
import { useMemo } from 'react';
import { Calendar, CheckCircle, Clock, MapPin, UserPlus, Users } from 'lucide-react';
import { formatDateTime } from '../utils';
import type { OverviewState } from '../utils/workspaceOverview';
import { hasPermission, Role } from '../rbac';
import { getActiveDatePrefix } from '../utils/timezone';

type BranchDashboardProps = {
  activeBranchId: string;
  userProfile: any;
  branches: any[];
  onNavigate: (view: string) => void;
  overview: OverviewState;
};

export default function BranchDashboard({ activeBranchId, branches, onNavigate, userProfile, overview }: BranchDashboardProps) {
  const { patients, appointments, visits } = overview.data;
  const refreshErrors = Object.values(overview.errors);

  const activeBranch = branches.find(branch => branch.id === activeBranchId);
  const isAllBranches = activeBranchId === 'All';
  const workspaceName = isAllBranches ? 'All Branches' : activeBranch?.branchName || 'Branch not assigned';
  const today = getActiveDatePrefix();

  const branchAppointments = useMemo(
    () => isAllBranches ? appointments : appointments.filter(item => item.branchId === activeBranchId),
    [activeBranchId, appointments, isAllBranches],
  );
  const branchVisits = useMemo(
    () => isAllBranches ? visits : visits.filter(item => item.branchId === activeBranchId),
    [activeBranchId, isAllBranches, visits],
  );
  const registeredPatients = useMemo(
    () => isAllBranches ? patients : patients.filter(patient => patient.homeBranchId === activeBranchId),
    [activeBranchId, isAllBranches, patients],
  );

  const todayAppointments = branchAppointments.filter(item => item.appointmentDate?.startsWith(today));
  const arrivedToday = todayAppointments.filter(item => item.status === 'Arrived').length;
  const completedVisitsToday = branchVisits.filter(item => item.visitDate?.startsWith(today) && item.status === 'Completed').length;
  const nextAppointments = branchAppointments
    .filter(item => item.appointmentDate >= `${today}T00:00` && !['Cancelled', 'Completed', 'No Show'].includes(item.status))
    .sort((left, right) => String(left.appointmentDate).localeCompare(String(right.appointmentDate)))
    .slice(0, 6);
  const recentVisits = [...branchVisits]
    .sort((left, right) => String(right.visitDate || '').localeCompare(String(left.visitDate || '')))
    .slice(0, 6);

  if (!activeBranchId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
        <MapPin className="w-10 h-10 text-amber-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">No clinic branch assigned</h2>
        <p className="text-sm text-slate-600 mt-1">Ask an administrator to assign a default clinic branch to this account.</p>
      </div>
    );
  }

  if (!overview.ready && refreshErrors.length) {
    return <div role="alert" className="text-sm text-red-700">Could not load the workspace overview. Retrying automatically.</div>;
  }
  if (!overview.ready) {
    return <div className="text-sm text-slate-500">Loading {workspaceName} workspace...</div>;
  }

  const kpis = [
    { label: 'Shared patients', value: patients.length, icon: Users, iconClass: 'text-teal-700', iconBg: 'bg-teal-50' },
    { label: isAllBranches ? 'Registered patients' : 'Registered here', value: registeredPatients.length, icon: UserPlus, iconClass: 'text-blue-700', iconBg: 'bg-blue-50' },
    { label: "Today's appointments", value: todayAppointments.length, icon: Calendar, iconClass: 'text-violet-700', iconBg: 'bg-violet-50' },
    { label: 'Visits completed today', value: completedVisitsToday, icon: CheckCircle, iconClass: 'text-emerald-700', iconBg: 'bg-emerald-50' },
  ].filter(kpi => kpi.label !== 'Visits completed today' || uiRecordPermission(userProfile?.role as Role, 'visitHistory', 'read'));

  return (
    <div className="space-y-5">
      {refreshErrors.length > 0 && <div role="status" className="text-sm text-amber-700">The workspace overview could not refresh. Showing the last available data while retrying.</div>}
      <section className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm shadow-slate-200/40">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <MapPin className="w-3.5 h-3.5" />
              </span>
              Active clinic
            </div>
            <h2 className="mt-3 truncate text-xl font-semibold tracking-[-0.02em] text-slate-950">{workspaceName}</h2>
            <p className="text-slate-500 text-sm mt-1">Shared patient records, organized by clinic location.</p>
          </div>
          <div className="min-w-[170px] rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <span className="text-xs font-medium text-slate-500">Waiting or arrived today</span>
            <div className="text-2xl font-semibold tracking-tight text-slate-950 mt-1">{arrivedToday}</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(kpi => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm shadow-slate-200/30">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs sm:text-sm font-medium leading-snug text-slate-500">{kpi.label}</div>
              <span className={`hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${kpi.iconBg}`}>
                <kpi.icon className={`w-4.5 h-4.5 ${kpi.iconClass}`} />
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-slate-950 mt-3">{kpi.value}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm shadow-slate-200/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold tracking-[-0.01em] text-slate-950">Upcoming appointments</h3>
              <p className="text-xs text-slate-500 mt-0.5">Scoped to {workspaceName}</p>
            </div>
            <button onClick={() => onNavigate('Appointments')} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 hover:text-teal-900">View all</button>
          </div>
          <div className="divide-y divide-slate-100">
            {nextAppointments.length > 0 ? nextAppointments.map(appointment => (
              <div key={appointment.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-slate-900 truncate">{appointment.patientName || 'Patient'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{formatDateTime(appointment.appointmentDate)}</div>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase bg-teal-50 text-teal-700 px-2 py-1 rounded-full">{appointment.status}</span>
              </div>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-slate-500">No upcoming appointments.</div>
            )}
          </div>
        </div>

        {uiRecordPermission(userProfile?.role as Role, 'visitHistory', 'read') && <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm shadow-slate-200/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold tracking-[-0.01em] text-slate-950">Recent visits</h3>
              <p className="text-xs text-slate-500 mt-0.5">Latest completed patient activity</p>
            </div>
            <button onClick={() => onNavigate('VisitHistory')} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 hover:text-teal-900">View all</button>
          </div>
          <div className="divide-y divide-slate-100">
            {recentVisits.length > 0 ? recentVisits.map(visit => (
              <div key={visit.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-slate-900 truncate">{visit.patientName || 'Patient'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{formatDateTime(visit.visitDate)}</div>
                </div>
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-slate-500">No clinic visits recorded yet.</div>
            )}
          </div>
        </div>}
      </section>
    </div>
  );
}
