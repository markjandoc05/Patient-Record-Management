import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { CustomDatePicker } from './CustomDatePicker';
import { getChangedFields } from '../utils/diffUtils';
import { logActivity } from '../utils/auditLogger';
import FileAttachmentSection from './FileAttachmentSection';

export default function AppointmentForm({ 
    patients, 
    branches, 
    users, 
    onClose, 
    onSave, 
    appointment,
    mode = 'edit',
    appointments = []
}: { 
    patients: any[], 
    branches: any[], 
    users: any[], 
    onClose: () => void, 
    onSave: () => void,
    appointment?: any,
    mode?: 'edit' | 'view',
    appointments?: any[]
}) {
  const [currentMode, setCurrentMode] = useState(mode);
  const [isSaving, setIsSaving] = useState(false);
  const [patientId, setPatientId] = useState(appointment?.patientId || '');
  const [patientSearch, setPatientSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [branchId, setBranchId] = useState(appointment?.branchId || '');
  const [doctorId, setDoctorId] = useState(appointment?.doctorId || '');
  const [appointmentDate, setAppointmentDate] = useState(appointment?.appointmentDate || new Date().toISOString().slice(0, 16));
  const [selectedDate, setSelectedDate] = useState(appointmentDate.split('T')[0]);
  const [selectedTime, setSelectedTime] = useState(appointmentDate.split('T')[1]);
  const [visitType, setVisitType] = useState(appointment?.visitType || 'Initial Consultation');
  const [status, setStatus] = useState(appointment?.status || 'Scheduled');
  const [mainConcern, setMainConcern] = useState(appointment?.mainConcern || '');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [logs, setLogs] = useState<any[]>([]);
  
  const isVisitCreated = !!appointment?.visitHistoryCreated;
  const isCompleted = appointment?.status === 'Completed';
  const currentUser = auth.currentUser;
  const currentUserRecord = users.find(u => u.email === currentUser?.email);
  const currentUserRole = currentUserRecord?.role?.toLowerCase();
  
  const canModifySealed = ['admin', 'manager', 'doctor', 'support_developer'].includes(currentUserRole || '');
  const canViewHistory = ['admin', 'support_developer'].includes(currentUserRole || '');
  const isLocked = isVisitCreated || (isCompleted && !canModifySealed);
  const isView = currentMode === 'view';
  const isReadOnly = isView || isLocked;

  const [localAppointments, setLocalAppointments] = useState<any[]>(appointments);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setLocalAppointments(appointments);
  }, [appointments]);

  useEffect(() => {
    if (appointment?.id && canViewHistory) {
      const q = query(
        collection(db, 'audit_logs'),
        where('resourceId', '==', appointment.id),
        where('resource', '==', 'Appointment'),
        orderBy('timestamp', 'desc')
      );
      const unsub = onSnapshot(q, (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => {
        console.error("Failed to listen to appointment audit logs:", error);
      });
      return () => unsub();
    }
  }, [appointment?.id, canViewHistory]);

  const timeSlots = [];
  for (let h = 10; h <= 19; h++) {
    for (let m = 0; m < 60; m += 30) {
        if (h === 19 && m > 0) break;
        timeSlots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }

  const checkIsAvailable = (time: string) => {
      if (!branchId || !doctorId || !selectedDate) return false;
      const dateTimeString = `${selectedDate}T${time}`;
      // Check for doctor conflicts globally (across all branches)
      const conflict = localAppointments.find(a => 
          a.id !== appointment?.id &&
          a.doctorId === doctorId &&
          a.appointmentDate === dateTimeString &&
          a.status !== 'Cancelled'
      );
      return !conflict;
  };

  const handleDateChange = (date: string) => {
      setSelectedDate(date);
      setAppointmentDate(`${date}T${selectedTime}`);
  };

  const handleTimeChange = (time: string) => {
      setSelectedTime(time);
      setAppointmentDate(`${selectedDate}T${time}`);
  };

  const handleBranchChange = (newBranchId: string) => {
      setBranchId(newBranchId);
      // Reset doctor if they are not assigned to the selected branch
      if (newBranchId) {
          const selectedDocObj = doctors.find(u => u.id === doctorId);
          if (selectedDocObj && !selectedDocObj.assignedBranches?.includes(newBranchId)) {
              setDoctorId('');
          }
      } else {
          setDoctorId('');
      }
  };

  const filteredPatients = patients.filter(p => 
    !patientId && 
    (p.name?.toLowerCase()?.includes(patientSearch.toLowerCase()) || 
     p.patientID?.toLowerCase()?.includes(patientSearch.toLowerCase()))
  );

  const doctors = users.filter(u => u.role?.toLowerCase() === 'doctor');
  const availableDoctors = branchId
    ? doctors.filter(doc => doc.assignedBranches?.includes(branchId) || doc.id === (appointment?.doctorId || ''))
    : [];

  const saveAppointment = async (targetStatus?: string) => {
    if (isSaving) return;
    if (!patientId) return alert('Please select a patient.');
    if (!branchId) return alert('Please select a branch.');
    if (!doctorId) return alert('Please select a doctor.');
    if (!selectedDate) return alert('Please select an appointment date.');
    if (!selectedTime) return alert('Please select a time slot.');
    if (!visitType) return alert('Please select a visit type.');
    if (!status) return alert('Please select a status.');
    
    // Check for double booking
    const conflict = localAppointments.find(a => 
      a.id !== appointment?.id &&
      a.doctorId === doctorId &&
      a.appointmentDate === appointmentDate &&
      a.status !== 'Cancelled'
    );
    
    if (conflict) {
        alert("This doctor already has an appointment scheduled at this time (either at this branch or another branch).");
        return;
    }
    
    setIsSaving(true);
    const now = new Date().toISOString();
    const finalStatus = targetStatus || status;

    if (finalStatus === 'Completed') {
        if (!mainConcern) return alert('Please provide a main concern summary before completing.');
        if (!notes) return alert('Please provide clinical notes before completing.');
    }
    
    const userData = {
        uid: currentUser?.uid || 'unknown',
        name: currentUserRecord?.fullName || currentUser?.email || 'Unknown'
    };

    try {
        if (appointment) {
            const updateData: any = {
                appointmentDate,
                branchId,
                doctorId,
                visitType,
                mainConcern,
                notes,
                status: finalStatus,
                updatedAt: now,
                updatedByUid: userData.uid,
                updatedByName: userData.name
            };
            
            if (finalStatus !== appointment.status) {
                updateData.lastStatusChangedAt = now;
                updateData.lastStatusChangedByUid = userData.uid;
                updateData.lastStatusChangedByName = userData.name;
            }

            await updateDoc(doc(db, 'appointments', appointment.id), updateData);
            const allChangedFields = getChangedFields(appointment, updateData);
            const significantChanges = allChangedFields.filter(c => 
                !['updatedAt', 'updatedByUid', 'updatedByName', 'lastStatusChangedAt', 'lastStatusChangedByUid', 'lastStatusChangedByName'].includes(c.field)
            );
            
            await logActivity({
              action: 'UPDATE',
              resource: 'Appointment',
              resourceId: appointment.id,
              resourceName: appointment.patientName || '',
              details: `Updated appointment. Status: ${finalStatus}. Modified: ${significantChanges.map(c => c.field).join(', ')}`,
              changes: significantChanges,
              userProfile: currentUserRecord
            });
        } else {
            const patientName = patients.find(p => p.id === patientId)?.name || '';
            const docRef = await addDoc(collection(db, 'appointments'), {
                patientId,
                patientName,
                appointmentDate,
                branchId,
                doctorId,
                visitType,
                mainConcern,
                notes,
                status: finalStatus,
                createdAt: now,
                createdByUid: userData.uid,
                createdByName: userData.name
            });
            await logActivity({
              action: 'CREATE',
              resource: 'Appointment',
              resourceId: docRef.id,
              resourceName: patientName,
              details: `Created new appointment scheduled on ${appointmentDate}`,
              userProfile: currentUserRecord
            });
        }
        
        onSave();
        onClose();
    } catch (err: any) {
        console.error("Error saving appointment:", err);
        alert("Failed to save appointment: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveAppointment();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center p-4 z-[9999] backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-8 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-6 relative z-[10000] shadow-2xl border border-slate-100">
        <div className="flex justify-between items-center border-b pb-4">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
            {isView ? 'Appointment Details' : (appointment ? 'Edit Appointment' : 'New Appointment')}
          </h2>
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
             <button type="button" onClick={() => setActiveTab('details')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'details' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500'}`}>Details</button>
             {appointment && canViewHistory && <button type="button" onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'history' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500'}`}>History</button>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {activeTab === 'details' ? (
        <div className="space-y-8">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Appointment Information</h3>
                    
                    {/* Patient Section */}
                    <div className="relative space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="Type to search patient..." 
                        value={patientId ? (patients.find(p => p.id === patientId)?.name || '') : patientSearch}
                        onChange={e => {
                            setPatientSearch(e.target.value);
                            setPatientId('');
                            setIsDropdownOpen(true);
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                        onBlur={() => {
                           setTimeout(() => {
                             setIsDropdownOpen(false);
                             if (patientSearch.trim().length > 0 && !patientId) {
                               alert('Please select a valid patient from the list.');
                               setPatientSearch('');
                             }
                           }, 200);
                        }}
                        required={!patientId}
                        disabled={isReadOnly}
                        className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none ${isReadOnly ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`} 
                      />
                      {isDropdownOpen && !patientId && patientSearch && filteredPatients.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-slate-200 mt-1 max-h-40 overflow-y-auto rounded-xl shadow-xl divide-y divide-slate-100">
                            {filteredPatients.map(p => (
                                <div key={p.id} className="p-3 hover:bg-slate-50 cursor-pointer text-sm font-medium text-slate-700 transition-colors" onClick={() => {
                                    setPatientId(p.id);
                                    setPatientSearch('');
                                    setIsDropdownOpen(false);
                                }}>
                                    {p.name} <span className="text-xs text-slate-400 font-normal">({p.patientID})</span>
                                </div>
                            ))}
                        </div>
                      )}
                      {appointment?.visitHistoryCreated && (
                          <div className="text-xs font-medium text-teal-600 mt-1 bg-teal-50/50 p-2 rounded-lg border border-teal-100 inline-block">Visit Record Linked: {appointment.visitHistoryId}</div>
                      )}
                    </div>

                    {/* Branch Selection */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Branch <span className="text-red-500">*</span></label>
                        <select value={branchId} onChange={e => handleBranchChange(e.target.value)} required disabled={isReadOnly} className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all ${isReadOnly ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`}>
                          <option value="">Select Branch</option>
                          {branches.filter(b => b.status === 'Active' || b.id === (appointment?.branchId || '')).map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
                        </select>
                    </div>

                    {/* Doctor Section */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Doctor <span className="text-red-500">*</span></label>
                      <select 
                        value={doctorId} 
                        onChange={e => setDoctorId(e.target.value)} 
                        required 
                        disabled={isReadOnly || !branchId}
                        className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all ${(isReadOnly || !branchId) ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`}
                      >
                        {branchId ? (
                            <>
                                <option value="">Select Doctor</option>
                                {availableDoctors.map(u => (
                                    <option key={u.id} value={u.id}>{u.fullName || u.name}</option>
                                ))}
                            </>
                        ) : (
                            <option value="">Please select a branch first</option>
                        )}
                      </select>
                    </div>

                    {/* Visit Date Selection */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Appointment Date <span className="text-red-500">*</span></label>
                        <CustomDatePicker 
                            min={new Date().toISOString().split('T')[0]} 
                            value={selectedDate} 
                            onChange={val => handleDateChange(val)} 
                            disabled={isReadOnly || !doctorId} 
                        />
                    </div>

                    {/* Time Slot Selection Grid */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Slot <span className="text-red-500">*</span></label>
                        {!branchId ? (
                            <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-xl border border-amber-100 italic font-medium">Please select a branch first</p>
                        ) : !doctorId ? (
                            <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-xl border border-amber-100 italic font-medium">Please select a doctor first</p>
                        ) : !selectedDate ? (
                            <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-xl border border-amber-100 italic font-medium">Please select a date first</p>
                        ) : (
                            <div className="grid grid-cols-4 gap-2">
                                {timeSlots.map(time => {
                                    const isAvailable = checkIsAvailable(time);
                                    const isDisabled = isReadOnly || !isAvailable;
                                    return (
                                        <button 
                                            key={time} 
                                            type="button"
                                            onClick={() => handleTimeChange(time)}
                                            disabled={isDisabled}
                                            className={`py-2 px-1 text-[11px] font-medium rounded-lg border transition-all duration-200 text-center ${
                                                selectedTime === time 
                                                    ? 'bg-teal-600 border-teal-600 text-white shadow-sm ring-2 ring-teal-500/10' 
                                                    : isAvailable 
                                                        ? 'bg-white border-slate-200 hover:border-teal-500 hover:bg-teal-50/30 text-slate-700' 
                                                        : 'bg-slate-100 border-slate-200 text-slate-400 line-through'
                                            } ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-[1.02]'}`}
                                        >
                                            {parseInt(time.split(':')[0]) > 12 ? `${parseInt(time.split(':')[0]) - 12}:${time.split(':')[1]} PM` : `${parseInt(time.split(':')[0])}:${time.split(':')[1]} AM`}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </section>
            </div>

            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Appointment Details</h3>
                    
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Visit Type <span className="text-red-500">*</span></label>
                        <select value={visitType} onChange={e => setVisitType(e.target.value)} disabled={isReadOnly} className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all ${isReadOnly ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`}>
                          <option value="Initial Consultation">Initial Consultation</option>
                          <option value="Follow-up">Follow-up</option>
                          <option value="Treatment Session">Treatment Session</option>
                          <option value="Assessment">Assessment</option>
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Status <span className="text-red-500">*</span></label>
                        <select value={status} onChange={e => setStatus(e.target.value)} disabled={isReadOnly} className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all ${isReadOnly ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`}>
                          <option value="Scheduled">Scheduled</option>
                          <option value="Confirmed">Confirmed</option>
                          <option value="Arrived">Arrived</option>
                          <option value="Completed">Completed</option>
                          <option value="Cancelled">Cancelled</option>
                          <option value="No Show">No Show</option>
                        </select>
                    </div>
                    
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                        <textarea placeholder="Write any relevant notes..." value={notes} onChange={e => setNotes(e.target.value)} disabled={isReadOnly} className={`w-full border border-slate-300 p-2.5 rounded-xl text-sm text-slate-800 bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all ${isReadOnly ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`} rows={3} />
                    </div>
                </section>
            </div>
          </div>
        </div>
        ) : activeTab === 'history' ? (
            <section className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800">Appointment History</h3>
              <div className="space-y-4 max-h-[40vh] overflow-y-auto">
                {logs.length > 0 ? logs.map(log => (
                    <div key={log.id} className="p-4 border rounded-xl bg-slate-50 text-sm">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>{new Date(log.timestamp).toLocaleString()}</span>
                            <span className="font-semibold text-teal-700">{log.action}</span>
                        </div>
                        <p className="text-slate-700">{log.details}</p>
                        {log.changes && log.changes.length > 0 && (
                            <div className="mt-2 text-xs bg-white p-2 rounded-lg border border-slate-100">
                                {log.changes.map((c: any, idx: number) => {
                                    const getDisplayValue = (field: string, value: any) => {
                                      if (value === null || value === undefined || value === '') return 'None';
                                      if (field === 'doctorId') {
                                        const user = users.find(u => u.id === value);
                                        return user ? user.fullName || user.name : value;
                                      }
                                      if (field === 'branchId') {
                                        const branch = branches.find(b => b.id === value);
                                        return branch ? branch.branchName : value;
                                      }
                                      if (field === 'appointmentDate') {
                                        return new Date(value).toLocaleString();
                                      }
                                      return String(value);
                                    };

                                    return (
                                      <div key={idx} className="flex justify-between py-0.5">
                                        <span className="font-semibold text-slate-700 capitalize">{c.field.replace(/([A-Z])/g, ' $1')}:</span>
                                        <span className="text-slate-500 truncate max-w-[150px] text-right" title={`${getDisplayValue(c.field, c.oldValue)} → ${getDisplayValue(c.field, c.newValue)}`}>
                                          {getDisplayValue(c.field, c.oldValue)} <span className="text-teal-600">→</span> {getDisplayValue(c.field, c.newValue)}
                                        </span>
                                      </div>
                                    );
                                })}
                            </div>
                        )}
                        <p className="text-slate-500 text-xs mt-1">Updated by: {log.userName || log.userEmail}</p>
                    </div>
                )) : <p className="text-center text-slate-500 py-4">No history found.</p>}
              </div>
            </section>
        ) : null}

        <div className="space-y-1.5 pt-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Main Concern</label>
            <textarea placeholder="Describe the main clinical or diagnostic concern..." value={mainConcern} onChange={e => setMainConcern(e.target.value)} disabled={isReadOnly} className={`w-full border border-slate-300 p-2.5 rounded-xl text-sm focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all ${isReadOnly ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`} rows={3} />
        </div>

        <div className="flex justify-end gap-3 border-t pt-4 mt-6">
            {isView && !isLocked && (
                <button type="button" onClick={() => setCurrentMode('edit')} className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl text-sm transition-all shadow-sm">Edit</button>
            )}
            <button type="button" onClick={onClose} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition-all">
                {isView ? 'Close' : 'Cancel'}
            </button>
            {!isReadOnly && (
                <div className="flex gap-3">
                    <button type="submit" disabled={isSaving} className={`px-5 py-2.5 font-medium rounded-xl text-sm transition-all shadow-sm ${isSaving ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700 text-white hover:shadow'}`}>
                        {isSaving ? 'Saving...' : (appointment ? 'Save Edit' : 'Save Appointment')}
                    </button>
                </div>
            )}
        </div>
      </form>
    </div>
  );
}
