import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import PatientForm from './PatientForm';
import PatientProfile from './PatientProfile';
import { hasPermission, Role } from '../rbac';
import { formatDateTime } from '../utils';

export default function PatientDashboard({ db, user, role }: { db: any, user: any, role: string|null }) {
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

  useEffect(() => {
    if (!user) return;
    setLoadingPatients(true);
    setLoadingUsers(true);
    setLoadingBranches(true);
    setLoadingAppointments(true);
    setLoadingVisits(true);
    
    const unsubPatients = onSnapshot(collection(db, 'patients'), 
      (snapshot) => {
        setPatients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoadingPatients(false);
      }, (error) => { console.error("Error fetching patients", error); setLoadingPatients(false); }
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
    const unsubAppointments = onSnapshot(collection(db, 'appointments'),
      (snapshot) => {
        setAppointments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoadingAppointments(false);
      }, (error) => { console.error("Error fetching appointments", error); setLoadingAppointments(false); }
    );
    const unsubVisits = onSnapshot(collection(db, 'visits'),
      (snapshot) => {
        setVisits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
  }, [db, user]);

  const canCreate = role ? hasPermission(role as Role, 'patientRecord', 'create') : false;
  const canUpdate = role ? hasPermission(role as Role, 'patientRecord', 'update') : false;
  
  const userProfile = users.find(u => u.email === user.email);
  
  const patientCountsByBranch = branches.map(branch => ({
    name: branch.branchName,
    count: patients.filter(p => p.homeBranchId === branch.id).length
  }));
  
  const totalPatients = patients.length;
  
  if (loadingPatients || loadingUsers || loadingBranches || loadingAppointments || loadingVisits) return <div>Loading records...</div>;

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
    const patientAppts = appointments.filter(a => a.patientId === patientId);
    if (patientAppts.length === 0) return null;
    return patientAppts.reduce((latest, current) => {
      const dateLatest = latest.appointmentDate || '';
      const dateCurrent = current.appointmentDate || '';
      return dateLatest > dateCurrent ? latest : current;
    });
  };

  const getPatientLastVisit = (patientId: string) => {
    const patientVisits = visits.filter(v => v.patientId === patientId);
    if (patientVisits.length === 0) return null;
    return patientVisits.reduce((latest, current) => {
      const dateLatest = latest.visitDate || '';
      const dateCurrent = current.visitDate || '';
      return dateLatest > dateCurrent ? latest : current;
    });
  };

  const enrichedPatients = patients.map(p => {
    const lastAppt = getPatientLastAppointment(p.id);
    const lastVst = getPatientLastVisit(p.id);
    
    const apptDate = lastAppt?.appointmentDate || '';
    const visitDate = lastVst?.visitDate || '';
    const mostRecentDate = apptDate > visitDate ? apptDate : visitDate;

    return {
      ...p,
      lastAppointment: lastAppt,
      lastVisit: lastVst,
      mostRecentDate
    };
  });

  const filteredPatients = enrichedPatients.filter(p => 
    (p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || p.contactNumber?.includes(searchTerm)) &&
    (filterStatus === 'All' || p.status === filterStatus) &&
    (filterBranch === 'All' || p.homeBranchId === filterBranch)
  ).sort((a, b) => {
    const dateA = a.mostRecentDate || a.createdAt || '';
    const dateB = b.mostRecentDate || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  const totalItems = filteredPatients.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedPatients = filteredPatients.slice(startIndex, startIndex + itemsPerPage);
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-teal-100 shadow-sm border-2">
            <div className="text-teal-600 text-xs font-semibold uppercase">Overall Total</div>
            <div className="text-3xl font-bold text-teal-900">{totalPatients}</div>
        </div>
        {patientCountsByBranch.map((branch, index) => (
          <div key={index} className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-slate-500 text-xs font-semibold uppercase">{branch.name} Patients</div>
              <div className="text-2xl font-bold">{branch.count}</div>
          </div>
        ))}
      </div>
  
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <input 
              placeholder="Search by name or contact..." 
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
                <option value="Active">Active</option>
                <option value="Ongoing Treatment">Ongoing Treatment</option>
                <option value="Completed">Completed</option>
                <option value="Inactive">Inactive</option>
            </select>
            <select 
              className="w-full sm:w-48 border border-slate-300 px-3.5 py-2 rounded-xl text-sm bg-white outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-slate-700" 
              value={filterBranch}
              onChange={e => handleBranchChange(e.target.value)}
            >
                <option value="All">All Branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
            </select>
        </div>
        {canCreate && (
          <button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto px-5 py-2.5 bg-teal-600 hover:bg-teal-750 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow transition-all duration-150">Add Patient</button>
        )}
      </div>

      <div className="space-y-4">
        {/* Mobile View: Cards */}
        <div className="block md:hidden space-y-3">
          {paginatedPatients.length > 0 ? (
            paginatedPatients.map(p => (
              <div key={p.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-slate-900 text-base">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.contactNumber || 'No contact'}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    p.status === 'Active' 
                      ? 'bg-green-50 text-green-700 border border-green-100' 
                      : p.status === 'Completed'
                        ? 'bg-blue-50 text-blue-700 border border-blue-100'
                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                  }`}>
                    {p.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs bg-slate-50/50 p-2.5 rounded-lg">
                  <div>
                    <span className="text-slate-400 block font-bold uppercase tracking-wider text-[9px] mb-0.5">Last Appointment</span>
                    {p.lastAppointment ? (
                      <div className="space-y-0.5">
                        <span className="text-slate-900 font-bold block leading-tight">
                          {formatDateTime(p.lastAppointment.appointmentDate)}
                        </span>
                        <span className="text-slate-500 font-medium text-[10px] block leading-normal">
                          {p.lastAppointment.visitType} ({p.lastAppointment.status})
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 font-medium block">No scheduled appointments</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium uppercase tracking-wider text-[9px]">Home Branch</span>
                    <span className="text-slate-700 font-medium">{p.homeBranchName || 'N/A'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 pt-2 border-t border-slate-100 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium uppercase tracking-wider text-[9px]">Main Concern</span>
                    <span className="text-slate-700 font-medium line-clamp-1">{p.mainConcern || 'None'}</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <button 
                    onClick={() => setSelectedPatient(p)} 
                    className="flex-1 text-center py-2 bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold text-xs rounded-lg transition-all"
                  >
                    View File
                  </button>
                  {canUpdate && (
                    <button 
                      onClick={() => setEditingPatient(p)} 
                      className="flex-1 text-center py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg transition-all"
                    >
                      Edit File
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-500 text-sm">No patient records found.</div>
          )}
        </div>

        {/* Desktop View: Styled Table */}
        <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider font-semibold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5 text-left">Patient Info</th>
                <th className="px-6 py-3.5 text-left">Contact</th>
                <th className="px-6 py-3.5 text-left">Last Appointment</th>
                <th className="px-6 py-3.5 text-left">Status</th>
                <th className="px-6 py-3.5 text-left">Home Branch</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {paginatedPatients.length > 0 ? (
                paginatedPatients.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-900 text-left">{p.name}</td>
                    <td className="px-6 py-4 text-slate-600 font-medium text-left">{p.contactNumber}</td>
                    <td className="px-6 py-4 text-left">
                      {p.lastAppointment ? (
                        <div className="text-xs font-bold text-slate-800">
                          {formatDateTime(p.lastAppointment.appointmentDate)}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">No appointments</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-left">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        p.status === 'Active' 
                          ? 'bg-green-50 text-green-700 ring-1 ring-green-600/10' 
                          : p.status === 'Completed'
                            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/10'
                            : 'bg-slate-100 text-slate-800'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-medium text-left">{p.homeBranchName}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button className="text-teal-600 hover:text-teal-800 font-semibold text-xs transition-colors" onClick={() => setSelectedPatient(p)}>View</button>
                        {canUpdate && (
                          <button className="text-blue-600 hover:text-blue-800 font-semibold text-xs transition-colors" onClick={() => setEditingPatient(p)}>Edit</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500 font-medium">No patient records found.</td>
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
  
      {showAddForm && <PatientForm db={db} user={user} users={users} patients={patients} branches={branches} userProfile={userProfile} onClose={() => setShowAddForm(false)} onSave={() => setShowAddForm(false)} />}
      {editingPatient && <PatientForm db={db} user={user} users={users} patients={patients} branches={branches} userProfile={userProfile} patient={editingPatient} onClose={() => setEditingPatient(null)} onSave={() => setEditingPatient(null)} />}
      {selectedPatient && <PatientProfile db={db} patient={selectedPatient} onClose={() => setSelectedPatient(null)} userRole={role ?? undefined} users={users} />}
    </div>
  );
}
