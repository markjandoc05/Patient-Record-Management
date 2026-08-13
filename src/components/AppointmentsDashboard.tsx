import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import AppointmentForm from './AppointmentForm';
import VisitForm from './VisitForm';
import CalendarView from './CalendarView';
import { hasPermission, Role } from '../rbac';
import { formatDateTime } from '../utils';
import { Calendar, CheckCircle, Clock, CheckSquare } from 'lucide-react';
import { getAccessibleBranches, subscribeToBranchScopedCollection } from '../utils/branchAccess';

export default function AppointmentsDashboard({ role, userProfile }: { role: string | null, userProfile: any }) {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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
  
  const canCreate = role ? hasPermission(role as Role, 'appointment', 'create') : false;
  const canCreateVisit = role ? hasPermission(role as Role, 'visitHistory', 'create') : false;

  useEffect(() => {
    const unsubAppointments = subscribeToBranchScopedCollection(db, 'appointments', 'branchId', userProfile, setAppointments);
    const unsubVisits = subscribeToBranchScopedCollection(db, 'visits', 'branchId', userProfile, setVisits);
    const unsubPatients = subscribeToBranchScopedCollection(db, 'patients', 'homeBranchId', userProfile, setPatients);
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => setUsers(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snap) => setBranches(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    Promise.all([unsubAppointments, unsubVisits, unsubPatients, unsubUsers, unsubBranches]).then(() => setLoading(false));
    return () => { unsubAppointments(); unsubVisits(); unsubPatients(); unsubUsers(); unsubBranches(); };
  }, [userProfile]);

  const accessibleBranches = getAccessibleBranches(branches, userProfile);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
    setCurrentPage(1);
  };

  const filteredAppointments = appointments.filter(a =>
    (a.patientName?.toLowerCase()?.includes(searchTerm.toLowerCase())) &&
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
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedAppointments = filteredAppointments.slice(startIndex, startIndex + itemsPerPage);

  const today = new Date().toISOString().split('T')[0];
  const kpiStats = useMemo(() => {
    const total = filteredAppointments.length;
    const confirmed = filteredAppointments.filter(a => a.status === 'Confirmed').length;
    const completed = filteredAppointments.filter(a => a.status === 'Completed').length;
    const upcoming = filteredAppointments.filter(a => a.appointmentDate > today && (a.status === 'Scheduled' || a.status === 'Confirmed')).length;
    
    return [
      { label: 'Total Appointments', value: total, icon: Calendar },
      { label: 'Confirmed', value: confirmed, icon: CheckCircle },
      { label: 'Upcoming', value: upcoming, icon: Clock },
      { label: 'Completed', value: completed, icon: CheckSquare },
    ];
  }, [filteredAppointments, today]);

  const handleCreateVisit = (appointment: any) => {
    setSelectedAppointment(appointment);
    setShowVisitForm(true);
  };

  return (
    <div className="space-y-6">
      {/* KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpiStats.map(kpi => (
          <div key={kpi.label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase">
                <kpi.icon size={16} />{kpi.label}
            </div>
            <div className="text-2xl font-bold mt-2">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex flex-col gap-2 w-full sm:w-auto">
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <input 
              placeholder="Search by patient..." 
              value={searchTerm}
              className="w-full sm:w-64 border border-slate-300 px-3.5 py-2 rounded-xl text-sm outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-800 placeholder:text-slate-400" 
              onChange={e => handleSearchChange(e.target.value)} 
            />
            <select 
              className="w-full sm:w-48 border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
              value={filterStatus}
              onChange={e => handleStatusChange(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Arrived">Arrived</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="No Show">No Show</option>
            </select>
            <select 
              className="w-full sm:w-48 border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
              value={filterBranch}
              onChange={e => setFilterBranch(e.target.value)}
            >
              <option value="All">All Branches</option>
              {accessibleBranches.map(b => (
                <option key={b.id} value={b.id}>{b.branchName}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            Total Results: <span className="font-bold text-slate-800">{totalItems} appointment{totalItems === 1 ? '' : 's'} found</span>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto px-5 py-2.5 bg-teal-600 hover:bg-teal-750 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow transition-all duration-150">New Appointment</button>
        )}
      </div>

      <div className="flex gap-2">
        <button 
          onClick={() => setView('list')} 
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${view === 'list' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          List View
        </button>
        <button 
          onClick={() => setView('calendar')} 
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${view === 'calendar' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          Calendar View
        </button>
      </div>

      {view === 'list' ? (
        <div className="space-y-4">
          {/* Mobile View: List of Cards */}
          <div className="block md:hidden space-y-3">
            {paginatedAppointments.length > 0 ? (
              paginatedAppointments.map(a => {
                const docName = users.find(u => u.id === a.doctorId)?.fullName || users.find(u => u.id === a.doctorId)?.name || 'N/A';
                return (
                  <div key={a.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold text-slate-900 text-base">{a.patientName}</div>
                        <div className="text-xs text-slate-500">{formatDateTime(a.appointmentDate)}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        a.status === 'Completed' 
                          ? 'bg-green-50 text-green-700 border border-green-100' 
                          : a.status === 'Cancelled' 
                            ? 'bg-red-50 text-red-700 border border-red-100'
                            : 'bg-teal-50 text-teal-700 border border-teal-100'
                      }`}>
                        {a.status}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                      <div>
                        <span className="text-slate-400 block font-medium uppercase tracking-wider text-[9px]">Provider / Doctor</span>
                        <span className="text-slate-700 font-medium">{docName}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium uppercase tracking-wider text-[9px]">Visit Type</span>
                        <span className="text-slate-700 font-medium">{a.visitType}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      <button 
                        onClick={() => { setSelectedAppointment(a); setFormMode('view'); setShowAddForm(true); }} 
                        className="flex-1 text-center py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg transition-all"
                      >
                        Details
                      </button>
                      {(a.status === 'Arrived' || a.status === 'Completed') && !a.visitHistoryCreated && canCreateVisit && (
                        <button 
                          onClick={() => handleCreateVisit(a)} 
                          className="flex-1 text-center py-2 bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold text-xs rounded-lg transition-all"
                        >
                          Create Visit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-500 text-sm">No appointments found matching filters.</div>
            )}
          </div>

          {/* Desktop View: Styled Table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5 flex items-center gap-1.5 font-bold">
                    <span>Date & Time</span>
                    <span className="text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded text-[9px] font-extrabold normal-case tracking-normal">Newest First ↓</span>
                  </th>
                  <th className="px-6 py-3.5">Patient</th>
                  <th className="px-6 py-3.5">Branch</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedAppointments.length > 0 ? (
                  paginatedAppointments.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-slate-600 font-medium">{formatDateTime(a.appointmentDate)}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">{a.patientName}</td>
                      <td className="px-6 py-4 text-slate-700">
                        {branches.find(b => b.id === a.branchId)?.branchName || 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                          a.status === 'Completed' 
                            ? 'bg-green-50 text-green-700 ring-1 ring-green-600/10' 
                            : a.status === 'Cancelled'
                              ? 'bg-red-50 text-red-700 ring-1 ring-red-600/10'
                              : 'bg-slate-100 text-slate-800'
                        }`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button 
                            onClick={() => { setSelectedAppointment(a); setFormMode('view'); setShowAddForm(true); }} 
                            className="text-teal-600 hover:text-teal-800 font-semibold text-xs transition-colors"
                          >
                            View
                          </button>
                          {(a.status === 'Arrived' || a.status === 'Completed') && !a.visitHistoryCreated && canCreateVisit && (
                            <button 
                              onClick={() => handleCreateVisit(a)} 
                              className="px-3 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg font-semibold text-xs transition-colors"
                            >
                              Create Visit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-slate-500 font-medium">No appointments found matching filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Gorgeous Pagination Footer */}
          {totalItems > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-sm">
              <div className="flex items-center gap-4 text-slate-500">
                <span>
                  Showing <strong className="font-semibold text-slate-800">{Math.min(startIndex + 1, totalItems)}</strong> to{' '}
                  <strong className="font-semibold text-slate-800">{Math.min(startIndex + itemsPerPage, totalItems)}</strong> of{' '}
                  <strong className="font-semibold text-slate-800">{totalItems}</strong> entries
                </span>
                
                <div className="hidden sm:flex items-center gap-1.5 border-l border-slate-200 pl-4 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  <span>Show:</span>
                  <select 
                    value={itemsPerPage} 
                    onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} 
                    className="border border-slate-200 rounded-lg bg-white px-2 py-1 text-slate-700 font-bold focus:border-teal-500 focus:outline-none transition-all"
                  >
                    {[5, 10, 25, 50].map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                  disabled={currentPage === 1}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 text-xs font-semibold transition-all"
                >
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button 
                    key={page} 
                    onClick={() => setCurrentPage(page)}
                    className={`h-8 w-8 rounded-xl text-xs font-semibold transition-all ${
                      currentPage === page 
                        ? 'bg-slate-800 text-white shadow' 
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                  disabled={currentPage === totalPages}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 text-xs font-semibold transition-all"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <CalendarView appointments={appointments} onSelectEvent={(event) => { setSelectedAppointment(event.resource); setFormMode('view'); setShowAddForm(true); }} />
      )}
      {showAddForm && <AppointmentForm patients={patients} branches={accessibleBranches} users={users} onClose={() => { setShowAddForm(false); setSelectedAppointment(null); }} onSave={() => { setShowAddForm(false); setSelectedAppointment(null); }} appointment={selectedAppointment} mode={formMode} appointments={appointments} />}
      {showVisitForm && <VisitForm patients={patients} branches={accessibleBranches} users={users} onClose={() => setShowVisitForm(false)} onSave={() => setShowVisitForm(false)} appointment={selectedAppointment} userRole={role} visits={visits} appointments={appointments} />}
    </div>
  );
}
