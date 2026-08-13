import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import PatientForm from './PatientForm';
import PatientProfile from './PatientProfile';
import { canEditPatient, hasPermission, Role } from '../rbac';
import { formatDateTime } from '../utils';
import { getAccessibleBranches, subscribeToSharedCollection } from '../utils/branchAccess';
import { archiveRecord, restoreRecord } from '../utils/recordApi';
import { Activity, Archive, CalendarClock, ChevronLeft, ChevronRight, Eye, Inbox, Mail, MapPin, Pencil, Phone, Plus, RotateCcw, Search, Users, X } from 'lucide-react';

function patientInitials(name?: string) {
  const initials = String(name || 'Patient')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
  return initials || 'P';
}

function patientStatusClass(status?: string) {
  if (status === 'Active') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/10';
  if (status === 'Ongoing Treatment') return 'bg-amber-50 text-amber-700 ring-amber-600/10';
  if (status === 'Completed') return 'bg-blue-50 text-blue-700 ring-blue-600/10';
  return 'bg-slate-100 text-slate-700 ring-slate-500/10';
}

export default function PatientDashboard({ db, user, role, userProfile, activeBranchId }: { db: any, user: any, role: string|null, userProfile: any, activeBranchId?: string }) {
  const [patients, setPatients] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterBranch, setFilterBranch] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<any>(null);
  const [saveNotice, setSaveNotice] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoadingPatients(true);
    setLoadingUsers(true);
    setLoadingBranches(true);
    setLoadingAppointments(true);
    setLoadingVisits(true);
    
    const unsubPatients = subscribeToSharedCollection(db, 'patients',
      (documents) => {
        setPatients(documents);
        setLoadingPatients(false);
      }, (error) => { console.error("Error fetching patients", error); setLoadingPatients(false); }, [], true
    );
    const unsubUsers = onSnapshot(collection(db, 'users'), 
      (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoadingUsers(false);
      }, (error) => { console.error("Error fetching users", error); setLoadingUsers(false); }
    );
    const unsubBranches = onSnapshot(collection(db, 'branches'), 
        (snapshot) => {
          setBranches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setLoadingBranches(false);
        }, (error) => { console.error("Error fetching branches", error); setLoadingBranches(false); }
    );
    const unsubAppointments = subscribeToSharedCollection(db, 'appointments',
      (documents) => {
        setAppointments(documents);
        setLoadingAppointments(false);
      }, (error) => { console.error("Error fetching appointments", error); setLoadingAppointments(false); }
    );
    const unsubVisits = subscribeToSharedCollection(db, 'visits',
      (documents) => {
        setVisits(documents);
        setLoadingVisits(false);
      }, (error) => { console.error("Error fetching visits", error); setLoadingVisits(false); }
    );

    return () => {
      unsubPatients();
      unsubUsers();
      unsubBranches();
      unsubAppointments();
      unsubVisits();
    };
  }, [db, user, userProfile]);

  useEffect(() => {
    if (!saveNotice) return;
    const timeout = window.setTimeout(() => setSaveNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [saveNotice]);

  const canCreate = role ? hasPermission(role as Role, 'patientRecord', 'create') : false;
  const canUpdate = role ? canEditPatient(role as Role) : false;
  const canArchive = role ? hasPermission(role as Role, 'patientRecord', 'delete') : false;
  
  const accessibleBranches = getAccessibleBranches(branches, userProfile);
  
  const activePatients = patients.filter(patient => patient.isArchived !== true);
  const archivedPatients = patients.filter(patient => patient.isArchived === true);
  const displayedPatients = showArchived ? archivedPatients : activePatients;
  const totalPatients = activePatients.length;
  const ongoingPatients = activePatients.filter(patient => patient.status === 'Ongoing Treatment').length;
  const upcomingPatientIds = new Set(
    appointments
      .filter(appointment => appointment.isArchived !== true && !['Cancelled', 'Completed', 'No Show'].includes(appointment.status) && new Date(appointment.appointmentDate).getTime() >= Date.now())
      .map(appointment => appointment.patientId)
      .filter(Boolean)
  );
  const recentVisitThreshold = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const recentlySeenPatientIds = new Set(
    visits
      .filter(visit => visit.isArchived !== true && new Date(visit.visitDate).getTime() >= recentVisitThreshold)
      .map(visit => visit.patientId)
      .filter(Boolean)
  );

  if (loadingPatients || loadingUsers || loadingBranches || loadingAppointments || loadingVisits) {
    return (
      <div className="space-y-5" aria-label="Loading patient directory">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
        <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      </div>
    );
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
    setCurrentPage(1);
  };

  const handleBranchChange = (value: string) => {
    setFilterBranch(value);
    setCurrentPage(1);
  };
  
  const getPatientLastAppointment = (patientId: string) => {
    const patientAppts = appointments.filter(a => a.patientId === patientId && a.isArchived !== true);
    if (patientAppts.length === 0) return null;
    return patientAppts.reduce((latest, current) => {
      const dateLatest = latest.appointmentDate || '';
      const dateCurrent = current.appointmentDate || '';
      return dateLatest > dateCurrent ? latest : current;
    });
  };

  const getPatientLastVisit = (patientId: string) => {
    const patientVisits = visits.filter(v => v.patientId === patientId && v.isArchived !== true);
    if (patientVisits.length === 0) return null;
    return patientVisits.reduce((latest, current) => {
      const dateLatest = latest.visitDate || '';
      const dateCurrent = current.visitDate || '';
      return dateLatest > dateCurrent ? latest : current;
    });
  };

  const enrichedPatients = displayedPatients.map(p => {
    const lastAppt = getPatientLastAppointment(p.id);
    const lastVst = getPatientLastVisit(p.id);
    
    const apptDate = lastAppt?.appointmentDate || '';
    const visitDate = lastVst?.visitDate || '';
    const mostRecentDate = apptDate > visitDate ? apptDate : visitDate;

    return {
      ...p,
      lastAppointment: lastAppt,
      lastVisit: lastVst,
      mostRecentDate,
      mostRecentType: mostRecentDate ? (apptDate > visitDate ? 'Appointment' : 'Visit') : ''
    };
  });

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredPatients = enrichedPatients.filter(p => 
    ([p.name, p.contactNumber, p.email, p.id].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch)) &&
    (filterStatus === 'All' || p.status === filterStatus) &&
    (filterBranch === 'All' || p.homeBranchId === filterBranch)
  ).sort((a, b) => {
    const dateA = a.mostRecentDate || a.createdAt || '';
    const dateB = b.mostRecentDate || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  const totalItems = filteredPatients.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedPatients = filteredPatients.slice(startIndex, startIndex + itemsPerPage);
  const hasActiveFilters = Boolean(searchTerm || filterStatus !== 'All' || filterBranch !== 'All');

  const clearFilters = () => {
    setSearchTerm('');
    setFilterStatus('All');
    setFilterBranch('All');
    setCurrentPage(1);
  };

  const handleArchive = async (patient: any) => {
    const reason = window.prompt('Why are you archiving this patient? This is required and will be recorded in the audit trail.');
    if (!reason) return;
    try {
      await archiveRecord('patients', patient.id, reason);
      setSaveNotice('Patient archived. The record can be restored from Archived Records.');
    } catch (error: any) {
      window.alert(error.message || 'Patient could not be archived.');
    }
  };

  const handleRestore = async (patient: any) => {
    if (!window.confirm(`Restore ${patient.name || 'this patient'}?`)) return;
    try {
      await restoreRecord('patients', patient.id);
      setSaveNotice('Patient restored successfully.');
    } catch (error: any) {
      window.alert(error.message || 'Patient could not be restored.');
    }
  };
  
  return (
    <div className="space-y-5">
      {saveNotice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <span>{saveNotice}</span>
          <button onClick={() => setSaveNotice('')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900" aria-label="Dismiss save confirmation"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section aria-label="Patient summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Shared patients', value: totalPatients, detail: 'Across all clinics', icon: Users, tone: 'bg-teal-50 text-teal-700' },
          { label: 'Ongoing treatment', value: ongoingPatients, detail: 'Active care plans', icon: Activity, tone: 'bg-amber-50 text-amber-700' },
          { label: 'Upcoming care', value: upcomingPatientIds.size, detail: 'Patients scheduled', icon: CalendarClock, tone: 'bg-violet-50 text-violet-700' },
          { label: 'Recently seen', value: recentlySeenPatientIds.size, detail: 'Within 30 days', icon: Eye, tone: 'bg-blue-50 text-blue-700' },
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
            <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950">{showArchived ? 'Archived records' : 'Patient directory'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{totalItems} {totalItems === 1 ? 'record' : 'records'} shown · Shared across authorized clinic teams</p>
          </div>
          <div className="flex gap-2">
            {canArchive && (
              <button onClick={() => { setShowArchived(value => !value); setCurrentPage(1); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                {showArchived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {showArchived ? 'Active records' : `Archived (${archivedPatients.length})`}
              </button>
            )}
            {canCreate && !showArchived && (
              <button onClick={() => setShowAddForm(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700">
                <Plus className="h-4 w-4" /> Add patient
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(280px,1fr)_190px_210px_auto] xl:items-center">
          <label className="relative block sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Search patients</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search name, contact, email, or ID"
              value={searchTerm}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              onChange={event => handleSearchChange(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filter by care status</span>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              value={filterStatus}
              onChange={event => handleStatusChange(event.target.value)}
            >
              <option value="All">All care statuses</option>
              <option value="Active">Active</option>
              <option value="Ongoing Treatment">Ongoing treatment</option>
              <option value="Completed">Completed</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by registration clinic</span>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              value={filterBranch}
              onChange={event => handleBranchChange(event.target.value)}
            >
              <option value="All">All registration clinics</option>
              {branches.filter(branch => branch.status === 'Active').map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}
            </select>
          </label>
          <div className="flex justify-end">
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4 p-3 sm:p-4">
        {/* Compact patient cards are safer until the directory has enough horizontal room. */}
        <div className="space-y-3 xl:hidden">
          {paginatedPatients.length > 0 ? (
            paginatedPatients.map(p => (
              <article key={p.id} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{patientInitials(p.name)}</div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-950 sm:text-base">{p.name || 'Unnamed patient'}</h3>
                      <p className="mt-0.5 truncate text-xs text-slate-400">ID {String(p.id || '').slice(0, 8).toUpperCase()}</p>
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${patientStatusClass(p.status)}`}>
                    {p.status || 'Unknown'}
                  </span>
                </div>

                <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <div className="flex min-w-0 items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{p.contactNumber || 'No contact number'}</span></div>
                  <div className="flex min-w-0 items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{p.email || 'No email address'}</span></div>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Last activity</p>
                    <p className="mt-1 truncate font-medium text-slate-700">{p.mostRecentDate ? formatDateTime(p.mostRecentDate) : 'No activity yet'}</p>
                    {p.mostRecentType && <p className="mt-0.5 text-[10px] text-slate-400">{p.mostRecentType}</p>}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Home clinic</p>
                    <p className="mt-1 truncate font-medium text-slate-700">{p.homeBranchName || 'Not assigned'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
                  <button onClick={() => setSelectedPatient(p)} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800">
                    <Eye className="h-4 w-4" /> View record
                  </button>
                  {canUpdate && !p.isArchived && (
                    <button onClick={() => setEditingPatient(p)} aria-label={`Edit ${p.name}`} title="Edit patient" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canArchive && (p.isArchived ? (
                    <button onClick={() => handleRestore(p)} aria-label={`Restore ${p.name}`} title="Restore patient" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50"><RotateCcw className="h-4 w-4" /></button>
                  ) : (
                    <button onClick={() => handleArchive(p)} aria-label={`Archive ${p.name}`} title="Archive patient" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"><Archive className="h-4 w-4" /></button>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-5 py-14 text-center">
              <Inbox className="mx-auto h-9 w-9 text-slate-300" />
              <h3 className="mt-3 text-sm font-semibold text-slate-800">No patient records found</h3>
              <p className="mt-1 text-xs text-slate-500">Try changing the search or filters.</p>
            </div>
          )}
        </div>

        {/* Wide desktop directory table */}
        <div className="hidden overflow-hidden rounded-xl border border-slate-200 xl:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-5 py-3.5">Patient</th>
                <th className="px-5 py-3.5">Contact</th>
                <th className="px-5 py-3.5">Last activity</th>
                <th className="px-5 py-3.5">Care and clinic</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedPatients.length > 0 ? (
                paginatedPatients.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{patientInitials(p.name)}</div>
                        <div className="min-w-0"><p className="max-w-52 truncate font-semibold text-slate-950">{p.name || 'Unnamed patient'}</p><p className="mt-0.5 max-w-52 truncate text-xs text-slate-400">{p.email || `ID ${String(p.id || '').slice(0, 8).toUpperCase()}`}</p></div>
                      </div>
                    </td>
                    <td className="px-5 py-4"><p className="font-medium text-slate-700">{p.contactNumber || 'Not provided'}</p><p className="mt-0.5 text-xs text-slate-400">{p.age ? `${p.age} years old` : 'Age not provided'}</p></td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-700">{p.mostRecentDate ? formatDateTime(p.mostRecentDate) : 'No activity yet'}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{p.mostRecentType || 'New patient record'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${patientStatusClass(p.status)}`}>{p.status || 'Unknown'}</span>
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="h-3 w-3" />{p.homeBranchName || 'Not assigned'}</p>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800" onClick={() => setSelectedPatient(p)}><Eye className="h-3.5 w-3.5" /> View</button>
                        {canUpdate && !p.isArchived && (
                          <button aria-label={`Edit ${p.name}`} title="Edit patient" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900" onClick={() => setEditingPatient(p)}><Pencil className="h-3.5 w-3.5" /></button>
                        )}
                        {canArchive && (p.isArchived ? (
                          <button aria-label={`Restore ${p.name}`} title="Restore patient" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50" onClick={() => handleRestore(p)}><RotateCcw className="h-3.5 w-3.5" /></button>
                        ) : (
                          <button aria-label={`Archive ${p.name}`} title="Archive patient" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700" onClick={() => handleArchive(p)}><Archive className="h-3.5 w-3.5" /></button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-14 text-center"><Inbox className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No patient records found</p><p className="mt-1 text-xs text-slate-400">Try changing the search or filters.</p></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalItems > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-1 pt-4 text-xs text-slate-500 sm:flex-row">
            <div className="flex items-center gap-3">
              <span>Showing <strong className="font-semibold text-slate-800">{startIndex + 1}–{Math.min(startIndex + itemsPerPage, totalItems)}</strong> of <strong className="font-semibold text-slate-800">{totalItems}</strong></span>
              <label className="flex items-center gap-1.5"><span className="sr-only">Records per page</span><select value={itemsPerPage} onChange={event => { setItemsPerPage(Number(event.target.value)); setCurrentPage(1); }} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-teal-500">{[5, 10, 25, 50].map(size => <option key={size} value={size}>{size} per page</option>)}</select></label>
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
  
      {showAddForm && <PatientForm db={db} user={user} users={users} patients={patients} branches={accessibleBranches} userProfile={userProfile} defaultBranchId={activeBranchId !== 'All' ? activeBranchId : undefined} onClose={() => setShowAddForm(false)} onSave={() => { setShowAddForm(false); setSaveNotice('Patient registered successfully. The shared record is available to both clinics.'); }} />}
      {editingPatient && <PatientForm db={db} user={user} users={users} patients={patients} branches={branches.filter(branch => branch.status === 'Active' || branch.id === editingPatient.homeBranchId)} userProfile={userProfile} patient={editingPatient} defaultBranchId={activeBranchId !== 'All' ? activeBranchId : undefined} onClose={() => setEditingPatient(null)} onSave={() => { setEditingPatient(null); setSaveNotice('Patient changes saved successfully.'); }} />}
      {selectedPatient && <PatientProfile patient={selectedPatient} onClose={() => setSelectedPatient(null)} userRole={role ?? undefined} users={users} branches={branches} visits={visits} appointments={appointments} />}
    </div>
  );
}
