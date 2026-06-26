import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { formatDateTime } from '../utils';
import VisitForm from './VisitForm';
import { hasPermission, Role } from '../rbac';
import { Calendar, UserCheck, AlertCircle, Clock } from 'lucide-react';

export default function VisitHistoryDashboard({ db, role }: { db: any, role: string | null }) {
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

  const canCreate = role ? hasPermission(role as Role, 'visitHistory', 'create') : false;
  const canUpdate = role ? hasPermission(role as Role, 'visitHistory', 'update') : false;

  useEffect(() => {
    const qVisits = query(collection(db, 'visits'), orderBy('visitDate', 'desc'));
    const unsubVisits = onSnapshot(qVisits, (snap) => setVisits(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubAppointments = onSnapshot(collection(db, 'appointments'), (snap) => setAppointments(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubPatients = onSnapshot(collection(db, 'patients'), (snap) => setPatients(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => setUsers(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snap) => setBranches(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    Promise.all([unsubVisits, unsubAppointments, unsubPatients, unsubUsers, unsubBranches]).then(() => setLoading(false));
    return () => { unsubVisits(); unsubAppointments(); unsubPatients(); unsubUsers(); unsubBranches(); };
  }, [db]);

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

  const filteredVisits = visits.filter(v =>
    (v.patientName?.toLowerCase()?.includes(searchTerm.toLowerCase())) &&
    (filterVisitType === 'All' || v.visitType === filterVisitType) &&
    (filterStatus === 'All' || v.status === filterStatus) &&
    (filterOutcome === 'All' || v.visitOutcome === filterOutcome) &&
    (filterBranch === 'All' || v.branchId === filterBranch)
  ).sort((a, b) => {
    const dateA = a.visitDate || '';
    const dateB = b.visitDate || '';
    return dateB.localeCompare(dateA);
  });

  const kpiStats = useMemo(() => {
    const total = filteredVisits.length;
    const completed = filteredVisits.filter(v => v.status === 'Completed').length;
    const followUpRequired = filteredVisits.filter(v => v.followUpRequired === true).length;
    const today = new Date().toISOString().split('T')[0];
    const todaysVisits = filteredVisits.filter(v => v.visitDate?.startsWith(today)).length;
    
    return [
      { label: 'Total Visits', value: total, icon: Calendar },
      { label: 'Completed Visits', value: completed, icon: UserCheck },
      { label: 'Follow-up Required', value: followUpRequired, icon: AlertCircle },
      { label: 'Today\'s Visits', value: todaysVisits, icon: Calendar },
    ];
  }, [filteredVisits]);

  const totalItems = filteredVisits.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedVisits = filteredVisits.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="space-y-6">
      {/* KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpiStats.map(kpi => (
          <div key={kpi.label} className="bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase">
                <kpi.icon size={16} />{kpi.label}
            </div>
            <div className="text-2xl font-bold mt-2">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div className="flex flex-col gap-2 w-full xl:w-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 w-full xl:w-auto">
          <input 
            placeholder="Search by patient..." 
            value={searchTerm}
            className="w-full border border-slate-300 px-3.5 py-2 rounded-xl text-sm outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-800 placeholder:text-slate-400" 
            onChange={e => handleSearchChange(e.target.value)} 
          />
          <select 
            className="w-full border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
            value={filterBranch}
            onChange={e => handleBranchChange(e.target.value)}
          >
            <option value="All">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
          </select>
          <select 
            className="w-full border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
            value={filterVisitType}
            onChange={e => handleVisitTypeChange(e.target.value)}
          >
            <option value="All">All Types</option>
            <option value="Initial Consultation">Initial Consultation</option>
            <option value="Follow-up">Follow-up</option>
            <option value="Treatment Session">Treatment Session</option>
            <option value="Assessment">Assessment</option>
          </select>
          <select 
            className="w-full border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
            value={filterStatus}
            onChange={e => handleStatusChange(e.target.value)}
          >
            <option value="All">All Statuses</option>
            <option value="Completed">Completed</option>
            <option value="For Follow-up">For Follow-up</option>
            <option value="No Show">No Show</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <select 
            className="w-full border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
            value={filterOutcome}
            onChange={e => handleOutcomeChange(e.target.value)}
          >
            <option value="All">All Outcomes</option>
            <option value="Consultation Only">Consultation Only</option>
            <option value="Treatment Done">Treatment Done</option>
            <option value="Follow-up Required">Follow-up Required</option>
            <option value="Referred to Doctor">Referred to Doctor</option>
            <option value="No Treatment Availed">No Treatment Availed</option>
            <option value="Package Session Used">Package Session Used</option>
          </select>
        </div>
          <div className="flex flex-col gap-1 text-xs text-slate-500 font-medium">
            <div>
              Total Results: <span className="font-bold text-slate-800">{totalItems} visit{totalItems === 1 ? '' : 's'} found</span>
            </div>
            { (searchTerm || filterBranch !== 'All' || filterVisitType !== 'All' || filterStatus !== 'All' || filterOutcome !== 'All') && (
              <div>
                Showing {totalItems} visits for {' '}
                {[
                  searchTerm && `Search: "${searchTerm}"`,
                  filterBranch !== 'All' && `Branch: ${branches.find(b => b.id === filterBranch)?.branchName || filterBranch}`,
                  filterVisitType !== 'All' && `Type: ${filterVisitType}`,
                  filterStatus !== 'All' && `Status: ${filterStatus}`,
                  filterOutcome !== 'All' && `Outcome: ${filterOutcome}`
                ].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setShowAddForm(true)} className="w-full xl:w-auto px-5 py-2.5 bg-teal-600 hover:bg-teal-750 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow transition-all duration-150 shrink-0">Add Visit</button>
        )}
      </div>

      <div className="space-y-4">
        {/* Mobile Cards View */}
        <div className="block md:hidden space-y-3">
          {paginatedVisits.length > 0 ? (
            paginatedVisits.map(v => {
              const doc = users.find(u => u.id === v.doctorId);
              const docName = doc ? (doc.fullName || doc.name) : 'N/A';
              return (
                <div 
                  key={v.id} 
                  className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 cursor-pointer" 
                  onClick={() => setSelectedVisit(v)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-slate-900 text-base">{v.patientName}</div>
                      <div className="text-xs text-slate-500">{formatDateTime(v.visitDate)}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      v.status === 'Completed' 
                        ? 'bg-green-50 text-green-700 border border-green-100' 
                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}>
                      {v.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                    <div>
                      <span className="text-slate-400 block font-medium uppercase tracking-wider text-[9px]">Provider / Doctor</span>
                      <span className="text-slate-700 font-medium">{docName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium uppercase tracking-wider text-[9px]">Service / Diagnosis</span>
                      <span className="text-slate-700 font-medium line-clamp-1">{v.treatmentService || 'N/A'}</span>
                    </div>
                  </div>
                  
                  <div className="pt-2 text-xs text-teal-600 font-semibold flex items-center justify-end">
                    View Details &rarr;
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-500 text-sm">No visit histories found.</div>
          )}
        </div>

        {/* Desktop Styled Table */}
        <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider font-semibold border-b border-slate-200 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5 flex items-center gap-1.5 font-bold">
                  <span>Date & Time</span>
                  <span className="text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded text-[9px] font-extrabold normal-case tracking-normal">Newest First ↓</span>
                </th>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Doctor</th>
                <th className="px-6 py-3.5">Source</th>
                <th className="px-6 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedVisits.length > 0 ? (
                paginatedVisits.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => setSelectedVisit(v)}>
                    <td className="px-6 py-4 text-slate-600 font-medium">{formatDateTime(v.visitDate)}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">{v.patientName}</td>
                    <td className="px-6 py-4 text-slate-700 font-medium">{(() => {
                      const doctor = users.find(u => u.id === v.doctorId);
                      return doctor ? (doctor.fullName || doctor.name) : 'N/A';
                    })()}</td>
                    <td className="px-6 py-4 text-slate-500 font-medium">{v.visitSource}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        v.status === 'Completed' 
                          ? 'bg-green-50 text-green-700 ring-1 ring-green-600/10' 
                          : 'bg-slate-100 text-slate-800'
                      }`}>
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-500 font-medium">No visit histories found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Beautiful Pagination Footer */}
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
                      : 'bg-white border border-slate-100 text-slate-600 hover:bg-slate-50'
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
      {showAddForm && <VisitForm patients={patients} branches={branches} users={users} onClose={() => { setShowAddForm(false); setSelectedVisit(null); }} onSave={() => { setShowAddForm(false); setSelectedVisit(null); }} visit={selectedVisit} userRole={role} visits={visits} appointments={appointments} />}
      {selectedVisit && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl p-6 space-y-4">
                  <h2 className="text-xl font-bold">Visit Details</h2>
                  <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-sm text-slate-500">Patient</label><div className="font-medium">{selectedVisit.patientName}</div></div>
                      <div><label className="text-sm text-slate-500">Doctor</label><div className="font-medium">{(() => {
                        const doctor = users.find(u => u.id === selectedVisit.doctorId);
                        return doctor ? (doctor.fullName || doctor.name) : 'N/A';
                      })()}</div></div>
                      <div><label className="text-sm text-slate-500">Date</label><div className="font-medium">{formatDateTime(selectedVisit.visitDate)}</div></div>
                      <div><label className="text-sm text-slate-500">Source</label><div className="font-medium">{selectedVisit.visitSource || 'N/A'}</div></div>
                      <div><label className="text-sm text-slate-500">Type</label><div className="font-medium">{selectedVisit.visitType || 'N/A'}</div></div>
                      <div><label className="text-sm text-slate-500">Service</label><div className="font-medium">{selectedVisit.treatmentService || 'N/A'}</div></div>
                      <div className="col-span-2"><label className="text-sm text-slate-500">Status</label><div className="font-medium">{selectedVisit.status || 'N/A'}</div></div>
                      <div className="col-span-2"><label className="text-sm text-slate-500">Main Concern</label><div className="font-medium">{selectedVisit.mainConcern || 'N/A'}</div></div>
                      <div className="col-span-2"><label className="text-sm text-slate-500">Diagnosis</label><div className="font-medium">{selectedVisit.diagnosis || 'N/A'}</div></div>
                      <div className="col-span-2"><label className="text-sm text-slate-500">Treatment Plan</label><div className="font-medium">{selectedVisit.treatmentPlan || 'N/A'}</div></div>
                      <div className="col-span-2"><label className="text-sm text-slate-500">Notes</label><div className="font-medium">{selectedVisit.notes || 'N/A'}</div></div>
                      {selectedVisit.status === 'For Follow-up' && (
                          <>
                              <div className="col-span-2"><label className="text-sm text-slate-500">Next Visit Date</label><div className="font-medium">{selectedVisit.nextVisitDate || 'N/A'}</div></div>
                              <div className="col-span-2"><label className="text-sm text-slate-500">Follow-up Instructions</label><div className="font-medium">{selectedVisit.followUpInstructions || 'N/A'}</div></div>
                          </>
                      )}
                      {selectedVisit.documents && selectedVisit.documents.length > 0 && (
                          <div className="col-span-2 space-y-2">
                              <label className="text-sm text-slate-500">Documents</label>
                              <div className="flex flex-wrap gap-2">
                                  {selectedVisit.documents.map((url: string, index: number) => (
                                      <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="text-xs bg-teal-50 text-teal-700 px-2 py-1 rounded">Document {index + 1}</a>
                                  ))}
                              </div>
                          </div>
                      )}
                  </div>
                  <div className="flex gap-2">
                    {canUpdate && (
                      <button className="flex-1 bg-slate-200 text-slate-800 py-2 rounded-lg" onClick={() => { setShowAddForm(true); }}>Edit</button>
                    )}
                    <button className="flex-1 bg-slate-900 text-white py-2 rounded-lg" onClick={() => setSelectedVisit(null)}>Close</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
