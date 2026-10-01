import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from '../dataClient';
import { formatDateTime } from '../utils';
import VisitForm from './VisitForm';
import { hasPermission, Role } from '../rbac';
import { Activity, Archive, Calendar, CalendarCheck2, ChevronLeft, ChevronRight, CircleAlert, Eye, Inbox, MapPin, Pencil, Plus, RotateCcw, Search, Stethoscope, UserRound, X } from 'lucide-react';
import { getAccessibleBranches, subscribeToBranchScopedCollection, subscribeToSharedCollection } from '../utils/branchAccess';
import { archiveRecord, restoreRecord } from '../utils/recordApi';
import { auth } from '../platform';
import { getActiveDatePrefix } from '../utils/timezone';

function visitInitials(name?: string) {
  return String(name || 'Patient')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'P';
}

function visitStatusClass(status?: string) {
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/10';
  if (status === 'For Follow-up') return 'bg-amber-50 text-amber-700 ring-amber-600/10';
  if (status === 'Cancelled' || status === 'No Show') return 'bg-rose-50 text-rose-700 ring-rose-600/10';
  return 'bg-blue-50 text-blue-700 ring-blue-600/10';
}

export default function VisitHistoryDashboard({ db, role, userProfile, activeBranchId }: { db: any, role: string | null, userProfile: any, activeBranchId?: string }) {
  const [visits, setVisits] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<any>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVisitType, setFilterVisitType] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterOutcome, setFilterOutcome] = useState('All');
  const [filterBranch, setFilterBranch] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showArchived, setShowArchived] = useState(false);

  const canCreate = role ? hasPermission(role as Role, 'visitHistory', 'create') : false;
  const canUpdate = role ? hasPermission(role as Role, 'visitHistory', 'update') : false;
  const canArchive = role ? hasPermission(role as Role, 'visitHistory', 'delete') : false;

  useEffect(() => {
    const unsubVisits = subscribeToBranchScopedCollection(db, 'visits', 'branchId', userProfile, setVisits, undefined, [], true);
    const unsubAppointments = subscribeToBranchScopedCollection(db, 'appointments', 'branchId', userProfile, setAppointments);
    const unsubPatients = subscribeToSharedCollection(db, 'patients', setPatients);
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => setUsers(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snap) => setBranches(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    Promise.all([unsubVisits, unsubAppointments, unsubPatients, unsubUsers, unsubBranches]).then(() => setLoading(false));
    return () => { unsubVisits(); unsubAppointments(); unsubPatients(); unsubUsers(); unsubBranches(); };
  }, [db, userProfile]);

  useEffect(() => {
    setFilterBranch(activeBranchId || 'All');
    setCurrentPage(1);
  }, [activeBranchId]);

  const accessibleBranches = getAccessibleBranches(branches, userProfile);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };
  const handleBranchChange = (value: string) => {
    setFilterBranch(value);
    setCurrentPage(1);
  };
  const handleVisitTypeChange = (value: string) => {
    setFilterVisitType(value);
    setCurrentPage(1);
  };
  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
    setCurrentPage(1);
  };
  const handleOutcomeChange = (value: string) => {
    setFilterOutcome(value);
    setCurrentPage(1);
  };

  const doctorName = (visit: any) => {
    const doctor = users.find(user => user.id === visit.doctorId);
    return doctor ? (doctor.fullName || doctor.name) : 'Not assigned';
  };

  const branchName = (visit: any) => branches.find(branch => branch.id === visit.branchId)?.branchName || visit.branchName || 'Not assigned';

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredVisits = visits.filter(v =>
    (showArchived ? v.isArchived === true : v.isArchived !== true) &&
    ([v.patientName, doctorName(v), v.treatmentService, v.diagnosis, v.visitSource, v.id].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch)) &&
    (filterVisitType === 'All' || v.visitType === filterVisitType) &&
    (filterStatus === 'All' || v.status === filterStatus) &&
    (filterOutcome === 'All' || v.visitOutcome === filterOutcome) &&
    (filterBranch === 'All' || v.branchId === filterBranch)
  ).sort((a, b) => {
    const dateA = a.visitDate || '';
    const dateB = b.visitDate || '';
    return dateB.localeCompare(dateA);
  });

  const today = getActiveDatePrefix();
  const monthPrefix = today.slice(0, 7);
  const activeScopedVisits = visits.filter(visit => visit.isArchived !== true && (filterBranch === 'All' || visit.branchId === filterBranch));
  const todaysVisits = activeScopedVisits.filter(visit => visit.visitDate?.startsWith(today));
  const completedToday = todaysVisits.filter(visit => visit.status === 'Completed').length;
  const followUpsRequired = activeScopedVisits.filter(visit => visit.followUpRequired === true || visit.status === 'For Follow-up' || visit.visitOutcome === 'Follow-up Required').length;
  const visitsThisMonth = activeScopedVisits.filter(visit => visit.visitDate?.startsWith(monthPrefix)).length;

  const totalItems = filteredVisits.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedVisits = filteredVisits.slice(startIndex, startIndex + itemsPerPage);
  const defaultBranchFilter = activeBranchId || 'All';
  const hasActiveFilters = Boolean(searchTerm || filterBranch !== defaultBranchFilter || filterVisitType !== 'All' || filterStatus !== 'All' || filterOutcome !== 'All');

  const clearFilters = () => {
    setSearchTerm('');
    setFilterBranch(defaultBranchFilter);
    setFilterVisitType('All');
    setFilterStatus('All');
    setFilterOutcome('All');
    setCurrentPage(1);
  };

  const handleArchive = async (visit: any) => {
    const reason = window.prompt('Why are you archiving this visit? This reason will be recorded in the audit trail.');
    if (!reason) return;
    try {
      await archiveRecord('visits', visit.id, reason);
      setSelectedVisit(null);
    } catch (error: any) {
      window.alert(error.message || 'Visit could not be archived.');
    }
  };

  const handleRestore = async (visit: any) => {
    if (!window.confirm('Restore this visit?')) return;
    try {
      await restoreRecord('visits', visit.id);
      setSelectedVisit(null);
    } catch (error: any) {
      window.alert(error.message || 'Visit could not be restored.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading visit records">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
        <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section aria-label="Visit summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Today's visits", value: todaysVisits.length, detail: 'Recorded today', icon: Calendar, tone: 'bg-teal-50 text-teal-700' },
          { label: 'Completed today', value: completedToday, detail: 'Care completed', icon: CalendarCheck2, tone: 'bg-emerald-50 text-emerald-700' },
          { label: 'Follow-ups needed', value: followUpsRequired, detail: 'Require next action', icon: CircleAlert, tone: 'bg-amber-50 text-amber-700' },
          { label: 'Visits this month', value: visitsThisMonth, detail: 'Current month total', icon: Activity, tone: 'bg-blue-50 text-blue-700' },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 sm:text-sm">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">{stat.value}</p>
              </div>
              <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex ${stat.tone}`}><stat.icon className="h-4.5 w-4.5" /></span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400 sm:text-xs">{stat.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950">{showArchived ? 'Archived visits' : 'Visit records'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{totalItems} {totalItems === 1 ? 'visit' : 'visits'} shown · Clinical history for authorized teams</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canArchive && (
              <button onClick={() => { setShowArchived(value => !value); setCurrentPage(1); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                {showArchived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {showArchived ? 'Active visits' : `Archived (${visits.filter(item => item.isArchived === true).length})`}
              </button>
            )}
            {canCreate && !showArchived && (
              <button onClick={() => { setSelectedVisit(null); setShowAddForm(true); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"><Plus className="h-4 w-4" /> Add visit</button>
            )}
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="relative block sm:col-span-2">
            <span className="sr-only">Search visits</span><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input placeholder="Search patient, provider, service, diagnosis, or ID" value={searchTerm} className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" onChange={event => handleSearchChange(event.target.value)} />
          </label>
          <label><span className="sr-only">Filter by clinic</span><select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" value={filterBranch} onChange={event => handleBranchChange(event.target.value)}><option value="All">All clinic branches</option>{accessibleBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}</select></label>
          <label><span className="sr-only">Filter by visit type</span><select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" value={filterVisitType} onChange={event => handleVisitTypeChange(event.target.value)}><option value="All">All visit types</option><option value="Initial Consultation">Initial consultation</option><option value="Follow-up">Follow-up</option><option value="Treatment Session">Treatment session</option><option value="Assessment">Assessment</option></select></label>
          <label><span className="sr-only">Filter by status</span><select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" value={filterStatus} onChange={event => handleStatusChange(event.target.value)}><option value="All">All statuses</option><option value="Completed">Completed</option><option value="For Follow-up">For follow-up</option><option value="No Show">No show</option><option value="Cancelled">Cancelled</option></select></label>
          <label><span className="sr-only">Filter by outcome</span><select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" value={filterOutcome} onChange={event => handleOutcomeChange(event.target.value)}><option value="All">All outcomes</option><option value="Consultation Only">Consultation only</option><option value="Treatment Done">Treatment done</option><option value="Follow-up Required">Follow-up required</option><option value="Referred to Doctor">Referred to doctor</option><option value="No Treatment Availed">No treatment availed</option><option value="Package Session Used">Package session used</option></select></label>
          <div className="flex items-center justify-end">
            {hasActiveFilters && <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"><X className="h-3.5 w-3.5" /> Clear filters</button>}
          </div>
        </div>

      <div className="space-y-4 p-3 sm:p-4">
        {/* Compact clinical cards for laptops and tablets. */}
        <div className="space-y-3 xl:hidden">
          {paginatedVisits.length > 0 ? (
            paginatedVisits.map(v => (
                <article key={v.id} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{visitInitials(v.patientName)}</div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-950 sm:text-base">{v.patientName || 'Unnamed patient'}</h3>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{v.visitType || 'Clinic visit'}</p>
                      </div>
                    </div>
                    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${visitStatusClass(v.status)}`}>{v.status || 'Unknown'}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                    <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Date and time</p><p className="mt-1 font-medium text-slate-700">{formatDateTime(v.visitDate)}</p></div>
                    <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Clinic</p><p className="mt-1 truncate font-medium text-slate-700">{branchName(v)}</p></div>
                  </div>

                  <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <div className="flex min-w-0 items-center gap-2"><Stethoscope className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{doctorName(v)}</span></div>
                    <div className="flex min-w-0 items-center gap-2"><Activity className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{v.treatmentService || v.diagnosis || 'Service not recorded'}</span></div>
                  </div>

                  {(v.visitOutcome || v.followUpRequired) && (
                    <div className="rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-400">Outcome: </span>{v.visitOutcome || 'Follow-up required'}
                    </div>
                  )}

                  <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => setSelectedVisit(v)} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"><Eye className="h-4 w-4" /> View details</button>
                    {canUpdate && !v.isArchived && (role !== 'doctor' || v.doctorId === auth.currentUser?.uid) && (
                      <button onClick={() => { setSelectedVisit(v); setShowAddForm(true); }} aria-label={`Edit visit for ${v.patientName}`} title="Edit visit" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"><Pencil className="h-4 w-4" /></button>
                    )}
                    {canArchive && (v.isArchived ? (
                      <button onClick={() => handleRestore(v)} aria-label={`Restore visit for ${v.patientName}`} title="Restore visit" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50"><RotateCcw className="h-4 w-4" /></button>
                    ) : (
                      <button onClick={() => handleArchive(v)} aria-label={`Archive visit for ${v.patientName}`} title="Archive visit" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"><Archive className="h-4 w-4" /></button>
                    ))}
                  </div>
                </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-5 py-14 text-center"><Inbox className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 text-sm font-semibold text-slate-800">No visit records found</h3><p className="mt-1 text-xs text-slate-500">Try changing the search or clinical filters.</p></div>
          )}
        </div>

        {/* Wide desktop clinical history table */}
        <div className="hidden overflow-hidden rounded-xl border border-slate-200 xl:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-5 py-3.5">Date and time</th>
                <th className="px-5 py-3.5">Patient and service</th>
                <th className="px-5 py-3.5">Provider and source</th>
                <th className="px-5 py-3.5">Outcome</th>
                <th className="px-5 py-3.5">Clinic and status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedVisits.length > 0 ? (
                paginatedVisits.map(v => (
                  <tr key={v.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4"><p className="font-medium text-slate-800">{formatDateTime(v.visitDate)}</p><p className="mt-0.5 text-xs text-slate-400">Newest visits first</p></td>
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{visitInitials(v.patientName)}</div><div className="min-w-0"><p className="max-w-48 truncate font-semibold text-slate-950">{v.patientName || 'Unnamed patient'}</p><p className="mt-0.5 max-w-48 truncate text-xs text-slate-400">{v.treatmentService || v.visitType || 'Clinic visit'}</p></div></div></td>
                    <td className="px-5 py-4"><p className="max-w-40 truncate font-medium text-slate-700">{doctorName(v)}</p><p className="mt-0.5 max-w-40 truncate text-xs text-slate-400">{v.visitSource || 'Source not recorded'}</p></td>
                    <td className="px-5 py-4"><p className="max-w-40 truncate font-medium text-slate-700">{v.visitOutcome || 'Not recorded'}</p><p className="mt-0.5 max-w-40 truncate text-xs text-slate-400">{v.diagnosis || 'No diagnosis recorded'}</p></td>
                    <td className="px-5 py-4">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><MapPin className="h-3 w-3 text-slate-400" />{branchName(v)}</p>
                      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${visitStatusClass(v.status)}`}>{v.status || 'Unknown'}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button onClick={() => setSelectedVisit(v)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"><Eye className="h-3.5 w-3.5" /> View</button>
                        {canUpdate && !v.isArchived && (role !== 'doctor' || v.doctorId === auth.currentUser?.uid) && <button onClick={() => { setSelectedVisit(v); setShowAddForm(true); }} aria-label={`Edit visit for ${v.patientName}`} title="Edit visit" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"><Pencil className="h-3.5 w-3.5" /></button>}
                        {canArchive && (v.isArchived ? <button onClick={() => handleRestore(v)} aria-label={`Restore visit for ${v.patientName}`} title="Restore visit" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50"><RotateCcw className="h-3.5 w-3.5" /></button> : <button onClick={() => handleArchive(v)} aria-label={`Archive visit for ${v.patientName}`} title="Archive visit" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"><Archive className="h-3.5 w-3.5" /></button>)}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-14 text-center"><Inbox className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No visit records found</p><p className="mt-1 text-xs text-slate-400">Try changing the search or clinical filters.</p></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalItems > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-1 pt-4 text-xs text-slate-500 sm:flex-row">
            <div className="flex items-center gap-3">
              <span>Showing <strong className="font-semibold text-slate-800">{startIndex + 1}–{Math.min(startIndex + itemsPerPage, totalItems)}</strong> of <strong className="font-semibold text-slate-800">{totalItems}</strong></span>
              <label className="flex items-center"><span className="sr-only">Visits per page</span><select value={itemsPerPage} onChange={event => { setItemsPerPage(Number(event.target.value)); setCurrentPage(1); }} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-teal-500">{[5, 10, 25, 50].map(size => <option key={size} value={size}>{size} per page</option>)}</select></label>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1">Page {safeCurrentPage} of {totalPages}</span>
              <button aria-label="Previous page" onClick={() => setCurrentPage(previous => Math.max(previous - 1, 1))} disabled={safeCurrentPage === 1} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <button aria-label="Next page" onClick={() => setCurrentPage(previous => Math.min(previous + 1, totalPages))} disabled={safeCurrentPage === totalPages} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>
      </section>
      {showAddForm && <VisitForm patients={patients} branches={accessibleBranches} users={users} defaultBranchId={activeBranchId !== 'All' ? activeBranchId : undefined} onClose={() => { setShowAddForm(false); setSelectedVisit(null); }} onSave={() => { setShowAddForm(false); setSelectedVisit(null); }} visit={selectedVisit} userRole={role} visits={visits} appointments={appointments} />}
      {selectedVisit && !showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-labelledby="visit-details-title">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{visitInitials(selectedVisit.patientName)}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="visit-details-title" className="truncate text-lg font-semibold tracking-[-0.02em] text-slate-950">{selectedVisit.patientName || 'Visit details'}</h2>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${visitStatusClass(selectedVisit.status)}`}>{selectedVisit.status || 'Unknown'}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{selectedVisit.visitType || 'Clinic visit'} · {formatDateTime(selectedVisit.visitDate)}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedVisit(null)} aria-label="Close visit details" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Visit overview</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ['Provider', doctorName(selectedVisit)],
                    ['Clinic', branchName(selectedVisit)],
                    ['Source', selectedVisit.visitSource || 'Not recorded'],
                    ['Service', selectedVisit.treatmentService || 'Not recorded'],
                    ['Outcome', selectedVisit.visitOutcome || 'Not recorded'],
                    ['Visit ID', String(selectedVisit.id || '').slice(0, 12).toUpperCase() || 'Not available'],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-xl bg-slate-50 px-3.5 py-3"><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-medium text-slate-700">{value}</p></div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Clinical record</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Main concern', selectedVisit.mainConcern || 'Not recorded'],
                    ['Diagnosis', selectedVisit.diagnosis || 'Not recorded'],
                    ['Treatment plan', selectedVisit.treatmentPlan || 'Not recorded'],
                    ['Notes', selectedVisit.notes || 'Not recorded'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-100 px-3.5 py-3"><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{value}</p></div>
                  ))}
                </div>
              </section>

              {(selectedVisit.status === 'For Follow-up' || selectedVisit.followUpRequired) && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><CircleAlert className="h-4 w-4" /> Follow-up required</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-amber-600">Next visit</p><p className="mt-1 text-sm text-amber-900">{selectedVisit.nextVisitDate || 'Not scheduled'}</p></div><div><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-amber-600">Instructions</p><p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{selectedVisit.followUpInstructions || 'No instructions recorded'}</p></div></div>
                </section>
              )}

              {selectedVisit.documents && selectedVisit.documents.length > 0 && (
                <section><h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Documents</h3><div className="mt-3 flex flex-wrap gap-2">{selectedVisit.documents.map((url: string, index: number) => <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-100">Document {index + 1}</a>)}</div></section>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
              {canArchive && (selectedVisit.isArchived ? (
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-xs font-semibold text-emerald-700 hover:bg-emerald-50" onClick={() => handleRestore(selectedVisit)}><RotateCcw className="h-4 w-4" /> Restore</button>
              ) : (
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700" onClick={() => handleArchive(selectedVisit)}><Archive className="h-4 w-4" /> Archive</button>
              ))}
              {canUpdate && !selectedVisit.isArchived && (role !== 'doctor' || selectedVisit.doctorId === auth.currentUser?.uid) && (
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100" onClick={() => setShowAddForm(true)}><Pencil className="h-4 w-4" /> Edit visit</button>
              )}
              <button className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setSelectedVisit(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
