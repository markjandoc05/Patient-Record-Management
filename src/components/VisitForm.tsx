import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, getDoc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { hasPermission, Role } from '../rbac';
import { CustomDatePicker } from './CustomDatePicker';
import { getChangedFields } from '../utils/diffUtils';
import { logActivity } from '../utils/auditLogger';
import FileAttachmentSection from './FileAttachmentSection';

// Enum for operation types

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function VisitForm({ patients, branches, users, onClose, onSave, appointment, visit, userRole, visits = [], appointments = [] }: { patients: any[], branches: any[], users: any[], onClose: () => void, onSave: () => void, appointment?: any, visit?: any, userRole: string | null, visits?: any[], appointments?: any[] }) {
  const [isSaving, setIsSaving] = useState(false);
  const [patientId, setPatientId] = useState(visit?.patientId || appointment?.patientId || '');
  const [patientSearch, setPatientSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(visit?.doctorId || appointment?.doctorId || '');
  const [visitDate, setVisitDate] = useState(visit?.visitDate || (appointment ? appointment.appointmentDate : ''));
  const [selectedDate, setSelectedDate] = useState(visitDate.split('T')[0] || '');
  const [selectedTime, setSelectedTime] = useState(visitDate.split('T')[1] || '');
  const [branchId, setBranchId] = useState(visit?.branchId || appointment?.branchId || '');
  const [visitSource, setVisitSource] = useState(visit?.visitSource || (appointment ? 'Appointment' : 'Walk-In'));
  const [visitType, setVisitType] = useState(visit?.visitType || appointment?.visitType || 'Initial Consultation');
  const [treatmentService, setTreatmentService] = useState(visit?.treatmentService || '');
  const [mainConcern, setMainConcern] = useState(visit?.mainConcern || appointment?.mainConcern || '');
  const [notes, setNotes] = useState(visit?.notes || appointment?.notes || '');
  const [diagnosis, setDiagnosis] = useState(visit?.diagnosis || '');
  const [treatmentPlan, setTreatmentPlan] = useState(visit?.treatmentPlan || '');
  const [outcome, setOutcome] = useState(visit?.visitOutcome || '');
  const [followUpRequired, setFollowUpRequired] = useState(visit?.followUpRequired || false);
  const [nextVisitDate, setNextVisitDate] = useState(visit?.nextVisitDate || '');
  const [followUpInstructions, setFollowUpInstructions] = useState(visit?.followUpInstructions || '');
  
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');
  const [logs, setLogs] = useState<any[]>([]);

  const isAppointment = visitSource === 'Appointment';

  useEffect(() => {
    if (visit?.id && (userRole === 'admin' || userRole === 'manager')) {
      const q = query(
        collection(db, 'audit_logs'),
        where('resourceId', '==', visit.id),
        where('resource', '==', 'Visit'),
        orderBy('timestamp', 'desc')
      );
      const unsub = onSnapshot(q, (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'audit_logs');
      });
      return () => unsub();
    }
  }, [visit?.id, userRole]);

  const timeSlots = [];
  for (let h = 10; h <= 19; h++) {
    for (let m = 0; m < 60; m += 30) {
        if (h === 19 && m > 0) break;
        timeSlots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }

  const handleDateChange = (date: string) => {
      setSelectedDate(date);
      setVisitDate(`${date}T${selectedTime}`);
  };

  const handleTimeChange = (time: string) => {
      setSelectedTime(time);
      setVisitDate(`${selectedDate}T${time}`);
  };

  const handleBranchChange = (newBranchId: string) => {
      setBranchId(newBranchId);
      if (newBranchId) {
          const selectedDocObj = doctors.find(u => u.id === doctorId);
          if (selectedDocObj && !selectedDocObj.assignedBranches?.includes(newBranchId)) {
              setDoctorId('');
          }
      } else {
          setDoctorId('');
      }
  };

  const checkIsAvailable = (time: string) => {
      if (!branchId || !doctorId || !selectedDate) {
          return false;
      }
      const dateTimeString = `${selectedDate}T${time}`;
      const conflictVisit = visits.find(v => 
          v.id !== visit?.id &&
          v.doctorId === doctorId &&
          v.visitDate && v.visitDate.slice(0, 16) === dateTimeString &&
          v.status !== 'Cancelled'
      );
      const conflictAppointment = appointments.find(a => 
          a.id !== appointment?.id && a.id !== visit?.appointmentId &&
          a.doctorId === doctorId &&
          a.appointmentDate && a.appointmentDate.slice(0, 16) === dateTimeString &&
          a.status !== 'Cancelled'
      );
      return !conflictVisit && !conflictAppointment;
  };

  const filteredPatients = patients.filter(p => 
    !patientId && 
    (p.name?.toLowerCase()?.includes(patientSearch.toLowerCase()) || 
     p.patientID?.toLowerCase()?.includes(patientSearch.toLowerCase()))
  );

  const doctors = users.filter(u => u.role?.toLowerCase() === 'doctor');
  const availableDoctors = branchId
    ? doctors.filter(doc => doc.assignedBranches?.includes(branchId) || doc.id === (visit?.doctorId || appointment?.doctorId || ''))
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    
    if (userRole && !hasPermission(userRole as Role, 'visitHistory', visit ? 'update' : 'create')) {
        alert("You are not authorized to perform this action.");
        return;
    }

    if (!patientId) return alert('Please select a patient.');
    if (appointment?.visitHistoryCreated && !visit) return alert('A visit record has already been created for this appointment.');
    
    if (!checkIsAvailable(selectedTime)) {
        alert("This doctor already has a booking scheduled at this time (either at this branch or another branch).");
        return;
    }
    
    setIsSaving(true);
    const currentUser = auth.currentUser;
    const currentUserRecord = users.find(u => u.email === currentUser?.email);
    const userDisplayName = currentUserRecord?.fullName || currentUser?.email || 'unknown';

    let derivedStatus = 'Completed';

    const visitData = {
      patientId,
      patientName: patients.find(p => p.id === patientId)?.name,
      visitDate,
      branchId,
      doctorId,
      visitType,
      treatmentService,
      mainConcern,
      notes,
      diagnosis,
      treatmentPlan,
      visitOutcome: outcome,
      followUpRequired: followUpRequired,
      status: derivedStatus,
      visitSource,
      nextVisitDate,
      followUpInstructions,
      appointmentId: visit?.appointmentId || appointment?.id || null,
      updatedAt: new Date().toISOString(),
      updatedBy: userDisplayName
    };
 
    if (visit) {
        try {
            const allChangedFields = getChangedFields(visit, visitData);
            const significantChanges = allChangedFields.filter(c => 
                !['updatedAt', 'updatedBy', 'createdAt', 'createdBy'].includes(c.field)
            );
            
            await updateDoc(doc(db, 'visits', visit.id), visitData);
            
            await logActivity({
              action: 'UPDATE',
              resource: 'Visit',
              resourceId: visit.id,
              resourceName: visitData.patientName || '',
              details: `Updated Patient Visit details. Status: ${derivedStatus}. Modified fields: ${significantChanges.map(c => c.field).join(', ')}`,
              changes: significantChanges,
              userProfile: currentUserRecord || null
            });
        } catch (error) {
            console.error('Error updating visit:', error);
            alert('Failed to update visit. Please check console for details.');
        }
    } else {
        const visitDocRef = await addDoc(collection(db, 'visits'), {
            ...visitData,
            createdAt: new Date().toISOString(),
            createdBy: userDisplayName
        });
        
        await logActivity({
          action: 'CREATE',
          resource: 'Visit',
          resourceId: visitDocRef.id,
          resourceName: visitData.patientName || '',
          details: `Logged new patient visit. Type: ${visitType}, Status: ${derivedStatus}`,
          userProfile: currentUserRecord || null
        });
        
        if (appointment?.id) {
            await updateDoc(doc(db, 'appointments', appointment.id), {
                visitHistoryId: visitDocRef.id,
                visitHistoryCreated: true,
                status: 'Completed'
            });
        }
 
        const patientDocRef = doc(db, 'patients', patientId);
        const patientSnapshot = await getDoc(patientDocRef);
        const patientData = patientSnapshot.data();
        
        const updates: any = {
          lastVisitDate: visitDate,
          lastVisitBranch: branches.find(b => b.id === branchId)?.branchName,
          totalVisits: (patientData?.totalVisits || 0) + 1,
          currentPatientStatus: derivedStatus
        };
        
        if (!(patientData?.totalVisits) || (patientData?.totalVisits === 0)) {
            updates.firstVisitDate = visitDate;
        }
        
        if (derivedStatus === 'Completed') {
            updates.totalCompletedVisits = (patientData?.totalCompletedVisits || 0) + 1;
        }
        if (derivedStatus === 'No Show') {
            updates.totalNoShowVisits = (patientData?.totalNoShowVisits || 0) + 1;
        }
 
        await updateDoc(patientDocRef, updates);
    }
    
    // Handle Follow-up prompt
    if (followUpRequired) {
        if (confirm(`This patient requires a follow-up visit. Would you like to create the follow-up appointment now?`)) {
            await addDoc(collection(db, 'appointments'), {
                patientId,
                branchId,
                doctorId,
                appointmentDate: nextVisitDate || new Date(new Date().setDate(new Date().getDate() + 7)).toISOString(), // Default to 7 days from now if nextVisitDate not provided
                status: 'Scheduled',
                visitType: 'Follow-up',
                notes: followUpInstructions,
                createdAt: new Date().toISOString(),
                createdBy: userDisplayName
            });
            alert("Follow-up appointment created.");
        }
    }
    
    onSave();
    onClose();
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center p-4 z-[100] backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-8 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-6 relative z-[101] shadow-2xl border border-slate-100">
        <div className="flex justify-between items-center border-b pb-4">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{visit ? 'Edit Visit' : 'New Visit'}</h2>
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
             <button type="button" onClick={() => setActiveTab('form')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'form' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500'}`}>Form</button>
             {visit && <button type="button" onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'history' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500'}`}>History</button>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        {activeTab === 'form' ? (
        <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Visit Information</h3>
                    
                    <div className="relative space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient <span className="text-red-500">*</span></label>
                        <input type="text" value={patientId ? patients.find(p => p.id === patientId)?.name : patientSearch}
                            onChange={e => {setPatientSearch(e.target.value); setPatientId(''); setIsDropdownOpen(true);}}
                            onFocus={() => setIsDropdownOpen(true)}
                            required disabled={isAppointment}
                            placeholder="Type to search patient..."
                            className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none ${isAppointment ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`} />
                        {isDropdownOpen && !patientId && patientSearch && filteredPatients.length > 0 && (
                            <div className="absolute z-10 w-full bg-white border border-slate-200 mt-1 max-h-40 overflow-y-auto rounded-xl shadow-xl divide-y divide-slate-100">
                                {filteredPatients.map(p => (
                                    <div key={p.id} className="p-3 hover:bg-slate-50 cursor-pointer text-sm font-medium text-slate-700 transition-colors" onClick={() => {setPatientId(p.id); setPatientSearch(''); setIsDropdownOpen(false);}}>
                                        {p.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Branch <span className="text-red-500">*</span></label>
                        <select value={branchId} onChange={e => handleBranchChange(e.target.value)} required disabled={isAppointment} className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none ${isAppointment ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`}>
                        <option value="">Select Branch</option>
                        {branches.filter(b => b.status === 'Active' || b.id === (visit?.branchId || appointment?.branchId || '')).map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Doctor / Provider <span className="text-red-500">*</span></label>
                        <select 
                          value={doctorId} 
                          onChange={e => setDoctorId(e.target.value)} 
                          required 
                          disabled={isAppointment || !branchId} 
                          className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none ${isAppointment || !branchId ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-800'}`}
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

                    <div className="space-y-1.5 w-full">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Visit Date <span className="text-red-500">*</span></label>
                        <CustomDatePicker 
                            value={selectedDate} 
                            onChange={val => handleDateChange(val)} 
                            disabled={isAppointment || !doctorId} 
                            placeholder="Select Date"
                        />
                    </div>

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
                                const isDisabled = !isAvailable || isAppointment;
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

                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Source</label>
                        <input type="text" value={visitSource} readOnly className="w-full h-[42px] border border-slate-200 px-3 rounded-xl text-sm bg-slate-50 text-slate-500 cursor-not-allowed" />
                    </div>
                </section>
            </div>

            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Visit Details</h3>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Visit Type <span className="text-red-500">*</span></label>
                        <select value={visitType} onChange={e => setVisitType(e.target.value)} className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800">
                          {["Initial Consultation", "Follow-up", "Treatment Session", "Assessment"].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Treatment / Service</label>
                        <select value={treatmentService} onChange={e => setTreatmentService(e.target.value)} className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800">
                          <option value="">Select Service</option>
                          {["Cleaning", "Check-up", "Treatment"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Main Concern</label>
                        <textarea value={mainConcern} onChange={e => setMainConcern(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-xl text-sm focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800" rows={2} />
                    </div>
                </section>

                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Clinical Notes</h3>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Diagnosis</label>
                        <textarea value={diagnosis} onChange={e => setDiagnosis(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-xl text-sm focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800" rows={2} />
                    </div>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Treatment Plan</label>
                        <textarea value={treatmentPlan} onChange={e => setTreatmentPlan(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-xl text-sm focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800" rows={2} />
                    </div>
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-xl text-sm focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800" rows={3} />
                    </div>
                    {visit && (
                        <FileAttachmentSection patientId={patientId} appointmentId={visit.appointmentId || null} visitId={visit.id} />
                    )}
                </section>
                
                    <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Outcome & Follow-up</h3>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Outcome</label>
                            <select value={outcome} onChange={e => setOutcome(e.target.value)} className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800">
                                <option value="">Select Outcome</option>
                                <option value="Completed">Completed</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                             <input type="checkbox" checked={followUpRequired} onChange={e => setFollowUpRequired(e.target.checked)} id="followUpRequired" className="w-5 h-5 text-teal-600 rounded focus:ring-teal-500" />
                             <label htmlFor="followUpRequired" className="text-sm font-medium text-slate-700">Follow-up Required</label>
                        </div>
                        {followUpRequired && (
                            <>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-teal-800 uppercase tracking-wider">Recommended Follow-up Date</label>
                                    <CustomDatePicker value={nextVisitDate} onChange={val => setNextVisitDate(val)} className="border-teal-300" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-teal-800 uppercase tracking-wider">Follow-up Instructions</label>
                                    <textarea value={followUpInstructions} onChange={e => setFollowUpInstructions(e.target.value)} className="w-full border border-teal-300 p-2.5 rounded-xl text-sm bg-white focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800" rows={2} />
                                </div>
                            </>
                        )}
                </section>

                
            </div>
        </div>
        ) : (
          <div className="space-y-4 max-h-[50vh] overflow-y-auto">
            {logs.length > 0 ? logs.map((log: any) => (
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
                                  if (field === 'visitDate') {
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
            )) : <p className="text-center text-slate-500 py-8">No history found.</p>}
          </div>
        )}
        
        <div className="flex justify-end gap-3 border-t pt-4 mt-6">
            <button type="button" onClick={onClose} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition-all">Cancel</button>
            <button type="submit" disabled={isSaving} className={`px-5 py-2.5 font-medium rounded-xl text-sm transition-all shadow-sm ${isSaving ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700 text-white hover:shadow'}`}>
                {isSaving ? 'Saving...' : (visit ? 'Save Edit' : 'Save Visit')}
            </button>
        </div>
      </form>
    </div>
  );
}
