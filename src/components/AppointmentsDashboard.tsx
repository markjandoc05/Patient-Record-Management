import { uiRecordPermission } from '../permissionState';
import { uiCan, uiPermissionScope } from '../permissionState';
import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot } from '../dataClient';
import { auth, db } from '../platform';
import AppointmentForm from './AppointmentForm';
import VisitForm from './VisitForm';
import CalendarView from './CalendarView';
import { hasPermission, Role } from '../rbac';
import { formatDateTime } from '../utils';
import { Archive, Calendar, CalendarCheck2, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Eye, Inbox, LayoutList, MapPin, Plus, RotateCcw, Search, Stethoscope, UserRound, X } from 'lucide-react';
import { getAccessibleBranches, subscribeToBranchScopedCollection, subscribeToSharedCollection } from '../utils/branchAccess';
import { archiveRecord, restoreRecord } from '../utils/recordApi';
import { emptyAppointmentState, subscribeAppointmentData } from '../utils/appointmentSubscriptions';
import { getActiveDatePrefix } from '../utils/timezone';

function appointmentInitials(name?: string) {
  return String(name || 'Patient')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'P';
}

function appointmentStatusClass(status?: string) {
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/10';
  if (status === 'Confirmed') return 'bg-blue-50 text-blue-700 ring-blue-600/10';
  if (status === 'Arrived') return 'bg-violet-50 text-violet-700 ring-violet-600/10';
  if (status === 'Cancelled' || status === 'No Show') return 'bg-rose-50 text-rose-700 ring-rose-600/10';
  return 'bg-amber-50 text-amber-700 ring-amber-600/10';
}

export default function AppointmentsDashboard({ role, userProfile, activeBranchId }: { role: string | null, userProfile: any, activeBranchId?: string }) {
  const scope = JSON.stringify([uiPermissionScope(userProfile), activeBranchId || 'All', userProfile?.uid || userProfile?.id, userProfile?.role, userProfile?.assignedBranches || []]);
  const [load, setLoad] = useState(() => ({ scope, ...emptyAppointmentState() }));
  const latestLoad = useRef(load);
  const [retry, setRetry] = useState(0);
  const currentLoad = load.scope === scope ? load : { scope, ...emptyAppointmentState() };
  const { appointments, visits, patients, users, branches } = currentLoad.data;
  const loadErrors = Object.values(currentLoad.errors);
  const loading = !currentLoad.ready && loadErrors.length === 0;
  const [showAddForm, setShowAddForm] = useState(false);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [formMode, setFormMode] = useState<'edit' | 'view'>('edit');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterBranch, setFilterBranch] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showArchived, setShowArchived] = useState(false);
  
  const canCreate = role ? uiRecordPermission(role as Role, 'appointment', 'create') : false;
  const canCreateVisit = role ? uiRecordPermission(role as Role, 'visitHistory', 'create') : false;
  const canArchive = role ? uiRecordPermission(role as Role, 'appointment', 'delete') : false;

  useEffect(() => {
    const previous = latestLoad.current.scope === scope ? latestLoad.current : emptyAppointmentState();
    return subscribeAppointmentData((source, success, failure) => {
      if (source === 'visits' && !uiRecordPermission(role as Role, 'visitHistory', 'read')) { success([]); return () => undefined; }
      if (source === 'appointments' || source === 'visits') {
        return subscribeToBranchScopedCollection(db, source, 'branchId', userProfile, success, failure, [], source === 'appointments', true);
      }
      if (source === 'patients') return subscribeToSharedCollection(db, source, success, failure);
      return onSnapshot(collection(db, source), snap => success(snap.docs.map(d => ({ id: d.id, ...d.data() }))), failure);
    }, state => {
      const next = { scope, ...state };
      latestLoad.current = next;
      setLoad(next);
      if (!state.ready && Object.keys(state.errors).length) { setShowAddForm(false); setShowVisitForm(false); setSelectedAppointment(null); }
    }, previous);
  }, [scope, retry]);

  useEffect(() => {
    setFilterBranch(activeBranchId || 'All');
    setCurrentPage(1);
  }, [activeBranchId]);

  const accessibleBranches = getAccessibleBranches(branches, userProfile);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
    setCurrentPage(1);
  };

  const doctorName = (appointment: any) => (
    users.find(user => user.id === appointment.doctorId)?.fullName
    || users.find(user => user.id === appointment.doctorId)?.name
    || 'Not assigned'
  );

  const branchName = (appointment: any) => branches.find(branch => branch.id === appointment.branchId)?.branchName || appointment.branchName || 'Not assigned';

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredAppointments = appointments.filter(a =>
    (showArchived ? a.isArchived === true : a.isArchived !== true) &&
    ([a.patientName, a.visitType, doctorName(a), branchName(a), a.id].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch)) &&
    (filterStatus === 'All' || a.status === filterStatus) &&
    (filterBranch === 'All' || a.branchId === filterBranch)
  ).sort((a, b) => {
    const dateA = a.appointmentDate || '';
    const dateB = b.appointmentDate || '';
    return dateB.localeCompare(dateA);
  });

  // Pagination calculations
  const totalItems = filteredAppointments.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedAppointments = filteredAppointments.slice(startIndex, startIndex + itemsPerPage);

  const today = getActiveDatePrefix();
  const activeScopedAppointments = appointments.filter(appointment =>
    appointment.isArchived !== true && (filterBranch === 'All' || appointment.branchId === filterBranch)
  );
  const todayAppointments = activeScopedAppointments.filter(appointment => appointment.appointmentDate?.startsWith(today));
  const arrivedToday = todayAppointments.filter(appointment => appointment.status === 'Arrived').length;
  const completedToday = todayAppointments.filter(appointment => appointment.status === 'Completed').length;
  const upcomingAppointments = activeScopedAppointments.filter(appointment =>
    appointment.appointmentDate >= `${today}T00:00`
    && ['Scheduled', 'Confirmed'].includes(appointment.status)
  ).length;
  const defaultBranchFilter = activeBranchId || 'All';
  const hasActiveFilters = Boolean(searchTerm || filterStatus !== 'All' || filterBranch !== defaultBranchFilter);

  const clearFilters = () => {
    setSearchTerm('');
    setFilterStatus('All');
    setFilterBranch(defaultBranchFilter);
    setCurrentPage(1);
  };

  const handleCreateVisit = (appointment: any) => {
    setSelectedAppointment(appointment);
    setShowVisitForm(true);
  };

  const handleArchive = async (appointment: any) => {
    const reason = window.prompt('Why are you archiving this appointment? This reason will be recorded in the audit trail.');
    if (!reason) return;
    try {
      await archiveRecord('appointments', appointment.id, reason);
    } catch (error: any) {
      window.alert(error.message || 'Appointment could not be archived.');
    }
  };

  const handleRestore = async (appointment: any) => {
    if (!window.confirm('Restore this appointment?')) return;
    try {
      await restoreRecord('appointments', appointment.id);
    } catch (error: any) {
      window.alert(error.message || 'Appointment could not be restored.');
    }
  };

  const errorNotice = loadErrors.length > 0 ? (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p>{currentLoad.ready ? 'Some appointment information could not be refreshed. Showing the last loaded data.' : 'Unable to load the appointment schedule.'}</p>
      <p className="mt-1">{loadErrors.join(' ')} Check your connection or sign in again if access has expired.</p>
      <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 font-semibold underline">Retry loading</button>
    </div>
  ) : null;

  if (!currentLoad.ready && errorNotice) return errorNotice;

  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading appointment schedule">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
        <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {errorNotice}
      <section aria-label="Appointment summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Today's appointments", value: todayAppointments.length, detail: 'Scheduled for today', icon: Calendar, tone: 'bg-teal-50 text-teal-700' },
          { label: 'Arrived today', value: arrivedToday, detail: 'Waiting for care', icon: UserRound, tone: 'bg-violet-50 text-violet-700' },
          { label: 'Upcoming care', value: upcomingAppointments, detail: 'Scheduled or confirmed', icon: CalendarClock, tone: 'bg-blue-50 text-blue-700' },
          { label: 'Completed today', value: completedToday, detail: 'Visits completed', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700' },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 sm:text-sm">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">{stat.value}</p>
              </div>
              <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex ${stat.tone}`}>
                <stat.icon className="h-4.5 w-4.5" />
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400 sm:text-xs">{stat.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950">{showArchived ? 'Archived appointments' : 'Appointment schedule'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{totalItems} {totalItems === 1 ? 'appointment' : 'appointments'} shown · Scoped to authorized clinic access</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canArchive && (
              <button onClick={() => { setShowArchived(value => !value); setCurrentPage(1); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                {showArchived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {showArchived ? 'Active appointments' : `Archived (${appointments.filter(item => item.isArchived === true).length})`}
              </button>
            )}
            {canCreate && !showArchived && (
              <button onClick={() => { setSelectedAppointment(null); setFormMode('edit'); setShowAddForm(true); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700">
                <Plus className="h-4 w-4" /> New appointment
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-2 xl:grid-cols-[auto_minmax(260px,1fr)_180px_210px_auto] xl:items-center">
          <div className="flex h-11 rounded-xl bg-slate-200/70 p-1 sm:col-span-2 xl:col-span-1" aria-label="Appointment view">
            <button type="button" onClick={() => setView('list')} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition ${view === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><LayoutList className="h-4 w-4" /> List</button>
            <button type="button" onClick={() => setView('calendar')} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition ${view === 'calendar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><Calendar className="h-4 w-4" /> Calendar</button>
          </div>
          <label className="relative block sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Search appointments</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search patient, provider, service, or ID"
              value={searchTerm}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              onChange={event => handleSearchChange(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filter by appointment status</span>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              value={filterStatus}
              onChange={event => handleStatusChange(event.target.value)}
            >
              <option value="All">All statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Arrived">Arrived</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="No Show">No Show</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by clinic branch</span>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              value={filterBranch}
              onChange={event => { setFilterBranch(event.target.value); setCurrentPage(1); }}
            >
              <option value="All">All clinic branches</option>
              {accessibleBranches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.branchName}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            {hasActiveFilters && <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"><X className="h-3.5 w-3.5" /> Clear</button>}
          </div>
        </div>

      {view === 'list' ? (
        <div className="space-y-4 p-3 sm:p-4">
          {/* Compact cards keep appointment details readable on laptops and tablets. */}
          <div className="space-y-3 xl:hidden">
            {paginatedAppointments.length > 0 ? (
              paginatedAppointments.map(a => (
                  <article key={a.id} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{appointmentInitials(a.patientName)}</div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-slate-950 sm:text-base">{a.patientName || 'Unnamed patient'}</h3>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{a.visitType || 'Clinic appointment'}</p>
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${appointmentStatusClass(a.status)}`}>{a.status || 'Unknown'}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Date and time</p>
                        <p className="mt-1 font-medium text-slate-700">{formatDateTime(a.appointmentDate)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Clinic</p>
                        <p className="mt-1 truncate font-medium text-slate-700">{branchName(a)}</p>
                      </div>
                    </div>

                    <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600"><Stethoscope className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{doctorName(a)}</span></div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button onClick={() => { setSelectedAppointment(a); setFormMode('view'); setShowAddForm(true); }} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800">
                        <Eye className="h-4 w-4" /> View details
                      </button>
                      {!a.isArchived && (a.status === 'Arrived' || a.status === 'Completed') && !a.visitHistoryCreated && canCreateVisit && (role !== 'doctor' || a.doctorId === auth.currentUser?.uid) && (
                        <button onClick={() => handleCreateVisit(a)} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-50 px-3 text-xs font-semibold text-teal-700 transition hover:bg-teal-100">
                          <CalendarCheck2 className="h-4 w-4" /> Create visit
                        </button>
                      )}
                      {canArchive && (a.isArchived ? (
                        <button onClick={() => handleRestore(a)} aria-label={`Restore appointment for ${a.patientName}`} title="Restore appointment" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50"><RotateCcw className="h-4 w-4" /></button>
                      ) : (
                        <button onClick={() => handleArchive(a)} aria-label={`Archive appointment for ${a.patientName}`} title="Archive appointment" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"><Archive className="h-4 w-4" /></button>
                      ))}
                    </div>
                  </article>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-5 py-14 text-center"><Inbox className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 text-sm font-semibold text-slate-800">No appointments found</h3><p className="mt-1 text-xs text-slate-500">Try changing the search, status, or clinic filter.</p></div>
            )}
          </div>

          {/* Wide desktop appointment table */}
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 xl:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="px-5 py-3.5">Date and time</th>
                  <th className="px-5 py-3.5">Patient and service</th>
                  <th className="px-5 py-3.5">Provider</th>
                  <th className="px-5 py-3.5">Clinic and status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedAppointments.length > 0 ? (
                  paginatedAppointments.map(a => (
                    <tr key={a.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-5 py-4"><p className="font-medium text-slate-800">{formatDateTime(a.appointmentDate)}</p><p className="mt-0.5 text-xs text-slate-400">Newest appointments first</p></td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{appointmentInitials(a.patientName)}</div><div className="min-w-0"><p className="max-w-52 truncate font-semibold text-slate-950">{a.patientName || 'Unnamed patient'}</p><p className="mt-0.5 max-w-52 truncate text-xs text-slate-400">{a.visitType || 'Clinic appointment'}</p></div></div>
                      </td>
                      <td className="px-5 py-4"><p className="max-w-44 truncate font-medium text-slate-700">{doctorName(a)}</p><p className="mt-0.5 text-xs text-slate-400">Assigned provider</p></td>
                      <td className="px-5 py-4">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><MapPin className="h-3 w-3 text-slate-400" />{branchName(a)}</p>
                        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${appointmentStatusClass(a.status)}`}>{a.status || 'Unknown'}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button onClick={() => { setSelectedAppointment(a); setFormMode('view'); setShowAddForm(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"><Eye className="h-3.5 w-3.5" /> View</button>
                          {!a.isArchived && (a.status === 'Arrived' || a.status === 'Completed') && !a.visitHistoryCreated && canCreateVisit && (role !== 'doctor' || a.doctorId === auth.currentUser?.uid) && (
                            <button onClick={() => handleCreateVisit(a)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"><CalendarCheck2 className="h-3.5 w-3.5" /> Create visit</button>
                          )}
                          {canArchive && (a.isArchived ? (
                            <button onClick={() => handleRestore(a)} aria-label={`Restore appointment for ${a.patientName}`} title="Restore appointment" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50"><RotateCcw className="h-3.5 w-3.5" /></button>
                          ) : (
                            <button onClick={() => handleArchive(a)} aria-label={`Archive appointment for ${a.patientName}`} title="Archive appointment" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"><Archive className="h-3.5 w-3.5" /></button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-14 text-center"><Inbox className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No appointments found</p><p className="mt-1 text-xs text-slate-400">Try changing the search, status, or clinic filter.</p></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalItems > 0 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-1 pt-4 text-xs text-slate-500 sm:flex-row">
              <div className="flex items-center gap-3">
                <span>Showing <strong className="font-semibold text-slate-800">{startIndex + 1}–{Math.min(startIndex + itemsPerPage, totalItems)}</strong> of <strong className="font-semibold text-slate-800">{totalItems}</strong></span>
                <label className="flex items-center"><span className="sr-only">Appointments per page</span><select value={itemsPerPage} onChange={event => { setItemsPerPage(Number(event.target.value)); setCurrentPage(1); }} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-teal-500">{[5, 10, 25, 50].map(size => <option key={size} value={size}>{size} per page</option>)}</select></label>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1">Page {safeCurrentPage} of {totalPages}</span>
                <button aria-label="Previous page" onClick={() => setCurrentPage(previous => Math.max(previous - 1, 1))} disabled={safeCurrentPage === 1} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button aria-label="Next page" onClick={() => setCurrentPage(previous => Math.min(previous + 1, totalPages))} disabled={safeCurrentPage === totalPages} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4"><CalendarView appointments={filteredAppointments} onSelectEvent={(event) => { setSelectedAppointment(event.resource); setFormMode('view'); setShowAddForm(true); }} /></div>
      )}
      </section>
      {showAddForm && <AppointmentForm patients={patients} branches={accessibleBranches} users={users} defaultBranchId={activeBranchId !== 'All' ? activeBranchId : undefined} onClose={() => { setShowAddForm(false); setSelectedAppointment(null); }} onSave={() => { setShowAddForm(false); setSelectedAppointment(null); }} appointment={selectedAppointment} mode={formMode} appointments={appointments} />}
      {showVisitForm && <VisitForm patients={patients} branches={accessibleBranches} users={users} defaultBranchId={activeBranchId !== 'All' ? activeBranchId : undefined} onClose={() => setShowVisitForm(false)} onSave={() => setShowVisitForm(false)} appointment={selectedAppointment} userRole={role} visits={visits} appointments={appointments} />}
    </div>
  );
}
