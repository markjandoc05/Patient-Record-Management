import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { CheckCircle2, Clock3, Search } from 'lucide-react';
import { db, auth } from '../firebase';
import { CustomDatePicker } from './CustomDatePicker';
import { createAppointmentRecord, updateAppointmentRecord } from '../utils/recordApi';
import { formatDateTime } from '../utils';
import { getActiveDatePrefix, getActiveDateTimeInput } from '../utils/timezone';

const timeSlots = Array.from({ length: 19 }, (_, index) => {
  const totalMinutes = 10 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
});

const formatSlot = (time: string) => {
  const [hourValue, minute] = time.split(':').map(Number);
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${hourValue >= 12 ? 'PM' : 'AM'}`;
};

type AppointmentFormProps = {
  patients: any[];
  branches: any[];
  users: any[];
  defaultBranchId?: string;
  onClose: () => void;
  onSave: () => void;
  appointment?: any;
  mode?: 'edit' | 'view';
  appointments?: any[];
};

export default function AppointmentForm({
  patients,
  branches,
  users,
  defaultBranchId,
  onClose,
  onSave,
  appointment,
  mode = 'edit',
  appointments = [],
}: AppointmentFormProps) {
  const initialDateTime = appointment?.appointmentDate || getActiveDateTimeInput();
  const [currentMode, setCurrentMode] = useState(mode);
  const [isSaving, setIsSaving] = useState(false);
  const [patientId, setPatientId] = useState(appointment?.patientId || '');
  const [patientSearch, setPatientSearch] = useState('');
  const [isPatientMenuOpen, setIsPatientMenuOpen] = useState(false);
  const [branchId, setBranchId] = useState(appointment?.branchId || defaultBranchId || '');
  const [doctorId, setDoctorId] = useState(appointment?.doctorId || '');
  const [selectedDate, setSelectedDate] = useState(initialDateTime.split('T')[0] || getActiveDatePrefix());
  const [selectedTime, setSelectedTime] = useState(appointment ? initialDateTime.slice(11, 16) : '');
  const [visitType, setVisitType] = useState(appointment?.visitType || 'Initial Consultation');
  const [status, setStatus] = useState(appointment?.status || 'Scheduled');
  const [mainConcern, setMainConcern] = useState(appointment?.mainConcern || '');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [logs, setLogs] = useState<any[]>([]);

  const currentUser = auth.currentUser;
  const currentUserRole = users.find(user => user.email === currentUser?.email)?.role?.toLowerCase();
  const isVisitCreated = Boolean(appointment?.visitHistoryCreated);
  const isCompleted = appointment?.status === 'Completed';
  const canModifySealed = ['admin', 'manager', 'doctor', 'support_developer'].includes(currentUserRole || '');
  const canViewHistory = ['admin', 'support_developer'].includes(currentUserRole || '');
  const isLocked = Boolean(appointment?.isArchived) || isVisitCreated || (isCompleted && !canModifySealed);
  const isView = currentMode === 'view';
  const isReadOnly = isView || isLocked;
  const clinicalFieldsReadOnly = isReadOnly || (Boolean(appointment) && currentUserRole === 'staff');
  const today = getActiveDatePrefix();
  const nowTime = getActiveDateTimeInput().slice(11, 16);

  const doctors = useMemo(() => users.filter(user => user.role?.toLowerCase() === 'doctor' && user.active !== false), [users]);
  const availableDoctors = useMemo(() => branchId
    ? doctors.filter(doctor => doctor.assignedBranches?.includes(branchId) || doctor.id === appointment?.doctorId)
    : [], [appointment?.doctorId, branchId, doctors]);
  const selectedPatient = patients.find(patient => patient.id === patientId);
  const visiblePatients = useMemo(() => {
    const needle = patientSearch.trim().toLowerCase();
    if (!needle || patientId) return [];
    return patients
      .filter(patient => patient.isArchived !== true)
      .filter(patient => [patient.name, patient.patientID, patient.contactNumber].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .slice(0, 8);
  }, [patientId, patientSearch, patients]);

  const clearError = (field: string) => setErrors(current => {
    if (!current[field]) return current;
    const next = { ...current };
    delete next[field];
    return next;
  });

  const fieldClass = (field: string, extra = '') => `w-full rounded-xl border bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 ${
    errors[field] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-300'
  } ${extra}`;

  const closeForm = () => {
    if (!isSaving) onClose();
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) closeForm();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isSaving]);

  useEffect(() => {
    if (!appointment?.id || !canViewHistory || activeTab !== 'history') return;
    const auditQuery = query(
      collection(db, 'audit_logs'),
      where('resourceId', '==', appointment.id),
      where('resource', '==', 'Appointment'),
      orderBy('timestamp', 'desc'),
      limit(50),
    );
    void getDocs(auditQuery).then(snapshot => setLogs(snapshot.docs
      .map(document => ({ id: document.id, ...document.data() } as any))))
      .catch(error => console.error('Failed to load appointment audit logs:', error));
  }, [activeTab, appointment?.id, canViewHistory]);

  const isSlotAvailable = (time: string) => {
    if (!doctorId || !selectedDate) return false;
    if (!appointment && selectedDate === today && time <= nowTime) return false;
    const appointmentDate = `${selectedDate}T${time}`;
    return !appointments.some(item =>
      item.id !== appointment?.id
      && item.isArchived !== true
      && item.doctorId === doctorId
      && item.appointmentDate === appointmentDate
      && !['Cancelled', 'No Show'].includes(item.status),
    );
  };

  const selectPatient = (patient: any) => {
    setPatientId(patient.id);
    setPatientSearch('');
    setIsPatientMenuOpen(false);
    clearError('patientId');
  };

  const handleBranchChange = (nextBranchId: string) => {
    setBranchId(nextBranchId);
    clearError('branchId');
    const doctorStillAvailable = doctors.some(doctor => doctor.id === doctorId && doctor.assignedBranches?.includes(nextBranchId));
    if (!doctorStillAvailable) setDoctorId('');
  };

  const selectDate = (date: string) => {
    setSelectedDate(date);
    clearError('appointmentDate');
    if (!appointment && date === today && selectedTime && selectedTime <= nowTime) setSelectedTime('');
  };

  const saveAppointment = async () => {
    if (isSaving || isReadOnly) return;
    const finalStatus = status;
    const appointmentDate = selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : '';
    const validationErrors: Record<string, string> = {};
    if (!patientId || !selectedPatient) validationErrors.patientId = 'Select a patient from the results.';
    if (!branchId) validationErrors.branchId = 'Select the clinic for this appointment.';
    if (!doctorId) validationErrors.doctorId = 'Select an available doctor.';
    if (!selectedDate) validationErrors.appointmentDate = 'Select an appointment date.';
    if (!selectedTime) validationErrors.appointmentDate = 'Select an available time slot.';
    if (!visitType) validationErrors.visitType = 'Select the visit type.';
    if (!finalStatus) validationErrors.status = 'Select an appointment status.';
    if (finalStatus === 'Completed' && !mainConcern.trim()) validationErrors.mainConcern = 'A main concern is required before completion.';
    if (finalStatus === 'Completed' && !notes.trim()) validationErrors.notes = 'Clinical notes are required before completion.';
    if (doctorId && selectedTime && !isSlotAvailable(selectedTime)) validationErrors.appointmentDate = 'This time slot is no longer available. Choose another slot.';

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setSaveError('Review the highlighted fields before saving.');
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-appointment-field="${Object.keys(validationErrors)[0]}"]`)?.focus());
      return;
    }

    setSaveError('');
    setErrors({});
    setIsSaving(true);
    const payload = {
      patientId,
      appointmentDate,
      branchId,
      doctorId,
      visitType,
      mainConcern: mainConcern.trim(),
      notes: notes.trim(),
      status: finalStatus,
    };

    try {
      const saved = appointment
        ? await updateAppointmentRecord(appointment.id, payload)
        : await createAppointmentRecord(payload);
      if (!saved.id) throw new Error('The server did not confirm the appointment record. Please try again.');
      onSave();
      onClose();
    } catch (error: any) {
      console.error('Error saving appointment:', error);
      setSaveError(error?.message || 'The appointment could not be saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div role="presentation" className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4 animate-fade-in">
      <form noValidate onSubmit={event => { event.preventDefault(); void saveAppointment(); }} aria-labelledby="appointment-form-title" className="relative z-[10000] max-h-[92vh] w-full max-w-5xl space-y-6 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl sm:p-7">
        <header className="-mx-5 -mt-5 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:-mx-7 sm:-mt-7 sm:px-7">
          <div>
            <h2 id="appointment-form-title" className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
              {isView ? 'Appointment details' : appointment ? 'Edit appointment' : 'Schedule appointment'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isView ? 'Review the scheduled appointment and its saved activity.' : appointment ? 'Update the appointment and save verified changes.' : 'Schedule a patient visit across your shared clinic record.'}
            </p>
          </div>
          <button type="button" aria-label="Close appointment form" onClick={closeForm} disabled={isSaving} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {saveError && <div role="alert" aria-live="polite" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{saveError}</div>}

        {appointment && canViewHistory && (
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setActiveTab('details')} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === 'details' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Details</button>
            <button type="button" onClick={() => setActiveTab('history')} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>History</button>
          </div>
        )}

        {activeTab === 'history' ? (
          <section className="space-y-3"><h3 className="text-base font-bold text-slate-900">Appointment history</h3>{logs.length ? logs.map(log => <article key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><div className="flex justify-between gap-3 text-xs text-slate-500"><span>{formatDateTime(log.timestamp)}</span><span className="font-bold text-teal-700">{log.action}</span></div><p className="mt-2 text-slate-700">{log.details}</p><p className="mt-2 text-xs text-slate-500">Updated by {log.userName || log.userEmail || 'Unknown user'}</p></article>) : <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No recorded appointment changes.</p>}</section>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            <section className="space-y-4">
              <div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Appointment information</h3><p className="mt-0.5 text-xs text-slate-500">Patient, clinic, doctor, and appointment time.</p></div>
              <div className="relative space-y-1.5">
                <label htmlFor="appointment-patient" className="text-xs font-semibold text-slate-600">Patient <span className="text-rose-500">*</span></label>
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id="appointment-patient" data-appointment-field="patientId" aria-invalid={Boolean(errors.patientId)} disabled={isReadOnly} value={patientId ? (selectedPatient?.name || '') : patientSearch} onChange={event => { setPatientSearch(event.target.value); setPatientId(''); setIsPatientMenuOpen(true); clearError('patientId'); }} onFocus={() => setIsPatientMenuOpen(true)} placeholder="Search name, ID or mobile number" autoComplete="off" className={fieldClass('patientId', `h-[42px] pl-9 ${isReadOnly ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)} /></div>
                {selectedPatient && <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{selectedPatient.name}</p><p className="mt-0.5 text-xs text-slate-500">{selectedPatient.patientID || 'Patient record'}{selectedPatient.contactNumber ? ` · ${selectedPatient.contactNumber}` : ''}</p></div>{!isReadOnly && <button type="button" onClick={() => { setPatientId(''); setPatientSearch(''); setIsPatientMenuOpen(false); }} className="shrink-0 text-xs font-bold text-teal-700 transition hover:text-teal-900">Change</button>}</div>}
                {errors.patientId && <p className="text-xs font-medium text-rose-600">{errors.patientId}</p>}
                {isPatientMenuOpen && !patientId && patientSearch.trim() && <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">{visiblePatients.length ? visiblePatients.map(patient => <button key={patient.id} type="button" onMouseDown={event => event.preventDefault()} onClick={() => selectPatient(patient)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 text-left text-sm last:border-0 hover:bg-slate-50"><span className="font-semibold text-slate-800">{patient.name}</span><span className="shrink-0 text-xs text-slate-500">{patient.patientID || 'No ID'}</span></button>) : <p className="px-3 py-3 text-sm text-slate-500">No active patients match this search.</p>}</div>}
              </div>

              <div className="space-y-1.5"><label htmlFor="appointment-branch" className="text-xs font-semibold text-slate-600">Clinic <span className="text-rose-500">*</span></label><select id="appointment-branch" data-appointment-field="branchId" value={branchId} onChange={event => handleBranchChange(event.target.value)} disabled={isReadOnly} className={fieldClass('branchId', `h-[42px] ${isReadOnly ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">Select clinic</option>{branches.filter(branch => branch.status === 'Active' || branch.id === appointment?.branchId).map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}</select>{errors.branchId && <p className="text-xs font-medium text-rose-600">{errors.branchId}</p>}</div>

              <div className="space-y-1.5"><label htmlFor="appointment-doctor" className="text-xs font-semibold text-slate-600">Doctor <span className="text-rose-500">*</span></label><select id="appointment-doctor" data-appointment-field="doctorId" value={doctorId} onChange={event => { setDoctorId(event.target.value); clearError('doctorId'); }} disabled={isReadOnly || !branchId} className={fieldClass('doctorId', `h-[42px] ${(isReadOnly || !branchId) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">{branchId ? 'Select doctor' : 'Select a clinic first'}</option>{availableDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.fullName || doctor.name}</option>)}</select>{errors.doctorId && <p className="text-xs font-medium text-rose-600">{errors.doctorId}</p>}</div>

              <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-600">Appointment date <span className="text-rose-500">*</span></label><div data-appointment-field="appointmentDate" tabIndex={-1}><CustomDatePicker min={appointment ? '' : today} value={selectedDate} onChange={selectDate} disabled={isReadOnly || !doctorId} className={errors.appointmentDate ? 'border-rose-300 bg-rose-50/30' : ''} /></div>{errors.appointmentDate && <p className="text-xs font-medium text-rose-600">{errors.appointmentDate}</p>}</div>

              <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-semibold text-slate-600">Time slot <span className="text-rose-500">*</span></label>{doctorId && selectedDate && <span className="text-[11px] text-slate-400">Times shown in clinic time</span>}</div>{!doctorId ? <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-medium text-amber-700">Select a clinic and doctor to view available times.</p> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-2"><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{timeSlots.map(time => { const available = isSlotAvailable(time); const selected = selectedTime === time; return <button key={time} type="button" disabled={isReadOnly || !available} onClick={() => { setSelectedTime(time); clearError('appointmentDate'); }} className={`rounded-lg border px-1 py-2 text-[11px] font-bold transition ${selected ? 'border-teal-600 bg-teal-600 text-white' : available ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-500 hover:bg-teal-50' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'}`}>{formatSlot(time)}</button>; })}</div></div>}</div>
            </section>

            <section className="space-y-4">
              <div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Clinical intake</h3><p className="mt-0.5 text-xs text-slate-500">Visit purpose, status, and supporting notes.</p></div>
              <div className="space-y-1.5"><label htmlFor="appointment-visit-type" className="text-xs font-semibold text-slate-600">Visit type <span className="text-rose-500">*</span></label><select id="appointment-visit-type" data-appointment-field="visitType" value={visitType} onChange={event => { setVisitType(event.target.value); clearError('visitType'); }} disabled={isReadOnly} className={fieldClass('visitType', `h-[42px] ${isReadOnly ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}>{['Initial Consultation', 'Follow-up', 'Treatment Session', 'Assessment'].map(type => <option key={type} value={type}>{type}</option>)}</select>{errors.visitType && <p className="text-xs font-medium text-rose-600">{errors.visitType}</p>}</div>
              <div className="space-y-1.5"><label htmlFor="appointment-status" className="text-xs font-semibold text-slate-600">Status <span className="text-rose-500">*</span></label><select id="appointment-status" data-appointment-field="status" value={status} onChange={event => { setStatus(event.target.value); clearError('status'); }} disabled={isReadOnly} className={fieldClass('status', `h-[42px] ${isReadOnly ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}>{['Scheduled', 'Confirmed', 'Arrived', 'Completed', 'Cancelled', 'No Show'].map(item => <option key={item} value={item} disabled={item === 'Completed' && currentUserRole === 'staff'}>{item}</option>)}</select>{errors.status && <p className="text-xs font-medium text-rose-600">{errors.status}</p>}</div>
              <div className="space-y-1.5"><label htmlFor="appointment-concern" className="text-xs font-semibold text-slate-600">Main concern {status === 'Completed' && <span className="text-rose-500">*</span>}</label><textarea id="appointment-concern" data-appointment-field="mainConcern" value={mainConcern} onChange={event => { setMainConcern(event.target.value); clearError('mainConcern'); }} disabled={clinicalFieldsReadOnly} maxLength={2000} rows={4} placeholder="Describe the reason for this appointment or treatment." className={fieldClass('mainConcern', `p-3 ${clinicalFieldsReadOnly ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)} />{errors.mainConcern && <p className="text-xs font-medium text-rose-600">{errors.mainConcern}</p>}</div>
              <div className="space-y-1.5"><label htmlFor="appointment-notes" className="text-xs font-semibold text-slate-600">Notes {status === 'Completed' && <span className="text-rose-500">*</span>}</label><textarea id="appointment-notes" data-appointment-field="notes" value={notes} onChange={event => { setNotes(event.target.value); clearError('notes'); }} disabled={clinicalFieldsReadOnly} maxLength={3000} rows={5} placeholder="Add relevant scheduling or clinical notes" className={fieldClass('notes', `p-3 ${clinicalFieldsReadOnly ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)} />{errors.notes && <p className="text-xs font-medium text-rose-600">{errors.notes}</p>}</div>
              {isVisitCreated && <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs font-medium text-teal-800">This appointment is linked to a visit record and can no longer be changed.</p>}
            </section>
          </div>
        )}

        <footer className="-mx-5 -mb-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:-mx-7 sm:-mb-7 sm:flex-row sm:justify-end sm:px-7">
          {isView && !isLocked && <button type="button" onClick={() => setCurrentMode('edit')} className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700">Edit appointment</button>}
          <button type="button" onClick={closeForm} disabled={isSaving} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">{isView ? 'Close' : 'Cancel'}</button>
          {!isReadOnly && activeTab === 'details' && <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">{isSaving ? <><Clock3 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-4 w-4" /> {appointment ? 'Save changes' : 'Save appointment'}</>}</button>}
        </footer>
      </form>
    </div>
  );
}
