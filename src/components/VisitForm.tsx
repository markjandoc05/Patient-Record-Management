import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { CheckCircle2, Clock3, Search } from 'lucide-react';
import { db, auth } from '../firebase';
import { hasPermission, Role } from '../rbac';
import { CustomDatePicker } from './CustomDatePicker';
import { createAppointmentRecord, createVisitRecord, updateVisitRecord } from '../utils/recordApi';
import FileAttachmentSection from './FileAttachmentSection';
import { formatDateTime } from '../utils';
import { getActiveDatePrefix } from '../utils/timezone';

const timeSlots = Array.from({ length: 19 }, (_, index) => {
  const totalMinutes = 10 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
});

const formatSlot = (time: string) => {
  const [hourValue, minute] = time.split(':').map(Number);
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${hourValue >= 12 ? 'PM' : 'AM'}`;
};

type VisitFormProps = {
  patients: any[];
  branches: any[];
  users: any[];
  defaultBranchId?: string;
  onClose: () => void;
  onSave: () => void;
  appointment?: any;
  visit?: any;
  userRole: string | null;
  visits?: any[];
  appointments?: any[];
};

export default function VisitForm({
  patients, branches, users, defaultBranchId, onClose, onSave, appointment, visit, userRole, visits = [], appointments = [],
}: VisitFormProps) {
  const initialDateTime = visit?.visitDate || appointment?.appointmentDate || '';
  const [isSaving, setIsSaving] = useState(false);
  const [patientId, setPatientId] = useState(visit?.patientId || appointment?.patientId || '');
  const [patientSearch, setPatientSearch] = useState('');
  const [isPatientMenuOpen, setIsPatientMenuOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(visit?.doctorId || appointment?.doctorId || '');
  const [branchId, setBranchId] = useState(visit?.branchId || appointment?.branchId || defaultBranchId || '');
  const [selectedDate, setSelectedDate] = useState(initialDateTime.slice(0, 10) || getActiveDatePrefix());
  const [selectedTime, setSelectedTime] = useState(initialDateTime.slice(11, 16) || '');
  const [visitType, setVisitType] = useState(visit?.visitType || appointment?.visitType || 'Initial Consultation');
  const [treatmentService, setTreatmentService] = useState(visit?.treatmentService || '');
  const [mainConcern, setMainConcern] = useState(visit?.mainConcern || appointment?.mainConcern || '');
  const [notes, setNotes] = useState(visit?.notes || appointment?.notes || '');
  const [diagnosis, setDiagnosis] = useState(visit?.diagnosis || '');
  const [treatmentPlan, setTreatmentPlan] = useState(visit?.treatmentPlan || '');
  const [outcome, setOutcome] = useState(visit?.visitOutcome || '');
  const [followUpRequired, setFollowUpRequired] = useState(Boolean(visit?.followUpRequired));
  const [nextVisitDate, setNextVisitDate] = useState(visit?.nextVisitDate || '');
  const [followUpInstructions, setFollowUpInstructions] = useState(visit?.followUpInstructions || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');
  const [logs, setLogs] = useState<any[]>([]);

  const isAppointment = Boolean(appointment);
  const canViewHistory = ['admin', 'support_developer'].includes(userRole || '');
  const selectedPatient = patients.find(patient => patient.id === patientId);
  const doctors = useMemo(() => users.filter(user => user.role?.toLowerCase() === 'doctor' && user.active !== false
    && (userRole !== 'doctor' || user.id === auth.currentUser?.uid)), [userRole, users]);
  const availableDoctors = useMemo(() => branchId
    ? doctors.filter(doctor => doctor.assignedBranches?.includes(branchId) || doctor.id === (visit?.doctorId || appointment?.doctorId || ''))
    : [], [appointment?.doctorId, branchId, doctors, visit?.doctorId]);
  const visiblePatients = useMemo(() => {
    const needle = patientSearch.trim().toLowerCase();
    if (!needle || patientId) return [];
    return patients.filter(patient => patient.isArchived !== true)
      .filter(patient => [patient.name, patient.patientID, patient.contactNumber].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .slice(0, 8);
  }, [patientId, patientSearch, patients]);

  const clearError = (field: string) => setErrors(current => {
    if (!current[field]) return current;
    const next = { ...current };
    delete next[field];
    return next;
  });
  const fieldClass = (field: string, extra = '') => `w-full rounded-xl border bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 ${errors[field] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-300'} ${extra}`;
  const closeForm = () => { if (!isSaving) onClose(); };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isSaving) closeForm(); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isSaving]);

  useEffect(() => {
    if (!visit?.id || !canViewHistory || activeTab !== 'history') return;
    const auditQuery = query(collection(db, 'audit_logs'), where('resourceId', '==', visit.id), where('resource', '==', 'Visit'), orderBy('timestamp', 'desc'), limit(50));
    void getDocs(auditQuery).then(snapshot => setLogs(snapshot.docs.map(document => ({ id: document.id, ...document.data() } as any)).filter(log => log.userRole !== 'support_developer')))
      .catch(error => console.error('Failed to load visit audit logs:', error));
  }, [activeTab, canViewHistory, visit?.id]);

  const isSlotAvailable = (time: string) => {
    if (!branchId || !doctorId || !selectedDate) return false;
    const dateTime = `${selectedDate}T${time}`;
    const visitConflict = visits.some(item => item.id !== visit?.id && item.isArchived !== true && item.doctorId === doctorId && item.visitDate?.slice(0, 16) === dateTime && item.status !== 'Cancelled');
    const appointmentConflict = appointments.some(item => item.id !== appointment?.id && item.id !== visit?.appointmentId && item.isArchived !== true && item.doctorId === doctorId && item.appointmentDate?.slice(0, 16) === dateTime && !['Cancelled', 'No Show'].includes(item.status));
    return !visitConflict && !appointmentConflict;
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
    if (!doctors.some(doctor => doctor.id === doctorId && doctor.assignedBranches?.includes(nextBranchId))) setDoctorId('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (userRole && !hasPermission(userRole as Role, 'visitHistory', visit ? 'update' : 'create')) {
      setSaveError('You are not authorized to save this visit.');
      return;
    }
    const visitDate = selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : '';
    const validationErrors: Record<string, string> = {};
    if (!patientId || !selectedPatient) validationErrors.patientId = 'Select a patient from the results.';
    if (!branchId) validationErrors.branchId = 'Select the clinic for this visit.';
    if (!doctorId) validationErrors.doctorId = 'Select an available doctor.';
    if (!selectedDate) validationErrors.visitDate = 'Select the visit date.';
    if (!selectedTime) validationErrors.visitDate = 'Select an available time slot.';
    if (!visitType) validationErrors.visitType = 'Select the visit type.';
    if (doctorId && selectedTime && !isSlotAvailable(selectedTime)) validationErrors.visitDate = 'This time slot is no longer available. Choose another slot.';
    if (appointment?.visitHistoryCreated && !visit) validationErrors.visitDate = 'A visit record has already been created for this appointment.';
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      setSaveError('Review the highlighted fields before saving.');
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-visit-field="${Object.keys(validationErrors)[0]}"]`)?.focus());
      return;
    }

    setErrors({});
    setSaveError('');
    setIsSaving(true);
    const visitData = { patientId, visitDate, branchId, doctorId, visitType, treatmentService, mainConcern, notes, diagnosis, treatmentPlan, visitOutcome: outcome, followUpRequired, nextVisitDate, followUpInstructions, appointmentId: visit?.appointmentId || appointment?.id || null };
    try {
      const saved = visit ? await updateVisitRecord(visit.id, visitData) : await createVisitRecord(visitData);
      if (!saved.id) throw new Error('The server did not confirm the visit record. Please try again.');
      if (followUpRequired && confirm('The visit has been saved. Would you like to create the recommended follow-up appointment now?')) {
        try {
          const defaultDate = getActiveDatePrefix(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await createAppointmentRecord({ patientId, branchId, doctorId, appointmentDate: `${nextVisitDate || defaultDate}T10:00`, status: 'Scheduled', visitType: 'Follow-up', mainConcern: '', notes: followUpInstructions });
          alert('Follow-up appointment created.');
        } catch (followUpError: any) {
          console.error('Visit saved, but follow-up creation failed:', followUpError);
          alert(`The visit was saved, but the follow-up appointment was not created: ${followUpError?.message || 'Please try again from Appointments.'}`);
        }
      }
      onSave();
      onClose();
    } catch (error: any) {
      console.error('Error saving visit:', error);
      setSaveError(error?.message || 'The visit could not be saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4 animate-fade-in">
      <form noValidate onSubmit={handleSubmit} aria-labelledby="visit-form-title" className="relative z-[101] max-h-[92vh] w-full max-w-5xl space-y-6 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl sm:p-7">
        <header className="-mx-5 -mt-5 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:-mx-7 sm:-mt-7 sm:px-7">
          <div><h2 id="visit-form-title" className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{visit ? 'Edit visit' : 'Add visit'}</h2><p className="mt-1 text-sm text-slate-500">{appointment ? 'Complete the linked appointment and record the clinical visit.' : visit ? 'Update the visit record and save verified changes.' : 'Record a completed walk-in visit in the shared patient record.'}</p></div>
          <button type="button" aria-label="Close visit form" onClick={closeForm} disabled={isSaving} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </header>

        {saveError && <div role="alert" aria-live="polite" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{saveError}</div>}
        {visit && canViewHistory && <div className="inline-flex rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setActiveTab('form')} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === 'form' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Details</button><button type="button" onClick={() => setActiveTab('history')} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>History</button></div>}

        {activeTab === 'history' ? <section className="space-y-3"><h3 className="text-base font-bold text-slate-900">Visit history</h3>{logs.length ? logs.map(log => <article key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><div className="flex justify-between gap-3 text-xs text-slate-500"><span>{formatDateTime(log.timestamp)}</span><span className="font-bold text-teal-700">{log.action}</span></div><p className="mt-2 text-slate-700">{log.details}</p><p className="mt-2 text-xs text-slate-500">Updated by {log.userName || log.userEmail || 'Unknown user'}</p></article>) : <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No recorded visit changes.</p>}</section> : (
          <div className="grid gap-8 md:grid-cols-2">
            <section className="space-y-4"><div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Visit information</h3><p className="mt-0.5 text-xs text-slate-500">Patient, clinic, provider, and completed visit time.</p></div>
              {appointment && <p className="rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-2.5 text-xs font-medium text-teal-800">This visit is linked to its appointment. The patient, clinic, provider, and schedule are kept in sync.</p>}
              <div className="relative space-y-1.5"><label htmlFor="visit-patient" className="text-xs font-semibold text-slate-600">Patient <span className="text-rose-500">*</span></label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id="visit-patient" data-visit-field="patientId" aria-invalid={Boolean(errors.patientId)} disabled={isAppointment || Boolean(visit)} value={patientId ? (selectedPatient?.name || '') : patientSearch} onChange={event => { setPatientSearch(event.target.value); setPatientId(''); setIsPatientMenuOpen(true); clearError('patientId'); }} onFocus={() => setIsPatientMenuOpen(true)} placeholder="Search name, ID or mobile number" autoComplete="off" className={fieldClass('patientId', `h-[42px] pl-9 ${(isAppointment || visit) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)} /></div>{selectedPatient && <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{selectedPatient.name}</p><p className="mt-0.5 text-xs text-slate-500">{selectedPatient.patientID || 'Patient record'}{selectedPatient.contactNumber ? ` · ${selectedPatient.contactNumber}` : ''}</p></div>{!isAppointment && !visit && <button type="button" onClick={() => { setPatientId(''); setPatientSearch(''); setIsPatientMenuOpen(false); }} className="shrink-0 text-xs font-bold text-teal-700 transition hover:text-teal-900">Change</button>}</div>}{errors.patientId && <p className="text-xs font-medium text-rose-600">{errors.patientId}</p>}{isPatientMenuOpen && !patientId && patientSearch.trim() && <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">{visiblePatients.length ? visiblePatients.map(patient => <button key={patient.id} type="button" onMouseDown={event => event.preventDefault()} onClick={() => selectPatient(patient)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 text-left text-sm last:border-0 hover:bg-slate-50"><span className="font-semibold text-slate-800">{patient.name}</span><span className="shrink-0 text-xs text-slate-500">{patient.patientID || 'No ID'}</span></button>) : <p className="px-3 py-3 text-sm text-slate-500">No active patients match this search.</p>}</div>}</div>
              <div className="space-y-1.5"><label htmlFor="visit-branch" className="text-xs font-semibold text-slate-600">Clinic <span className="text-rose-500">*</span></label><select id="visit-branch" data-visit-field="branchId" value={branchId} onChange={event => handleBranchChange(event.target.value)} disabled={isAppointment} className={fieldClass('branchId', `h-[42px] ${isAppointment ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">Select clinic</option>{branches.filter(branch => branch.status === 'Active' || branch.id === (visit?.branchId || appointment?.branchId || '')).map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}</select>{errors.branchId && <p className="text-xs font-medium text-rose-600">{errors.branchId}</p>}</div>
              <div className="space-y-1.5"><label htmlFor="visit-doctor" className="text-xs font-semibold text-slate-600">Doctor <span className="text-rose-500">*</span></label><select id="visit-doctor" data-visit-field="doctorId" value={doctorId} onChange={event => { setDoctorId(event.target.value); clearError('doctorId'); }} disabled={isAppointment || !branchId} className={fieldClass('doctorId', `h-[42px] ${(isAppointment || !branchId) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">{branchId ? 'Select doctor' : 'Select a clinic first'}</option>{availableDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.fullName || doctor.name}</option>)}</select>{errors.doctorId && <p className="text-xs font-medium text-rose-600">{errors.doctorId}</p>}</div>
              <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-600">Visit date <span className="text-rose-500">*</span></label><div data-visit-field="visitDate" tabIndex={-1}><CustomDatePicker value={selectedDate} onChange={date => { setSelectedDate(date); clearError('visitDate'); }} disabled={isAppointment || !doctorId} className={errors.visitDate ? 'border-rose-300 bg-rose-50/30' : ''} /></div>{errors.visitDate && <p className="text-xs font-medium text-rose-600">{errors.visitDate}</p>}</div>
              <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-semibold text-slate-600">Time slot <span className="text-rose-500">*</span></label>{doctorId && selectedDate && <span className="text-[11px] text-slate-400">Times shown in clinic time</span>}</div>{!doctorId ? <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-medium text-amber-700">Select a clinic and doctor to view available times.</p> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-2"><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{timeSlots.map(time => { const available = isSlotAvailable(time); const selected = selectedTime === time; return <button key={time} type="button" disabled={isAppointment || !available} onClick={() => { setSelectedTime(time); clearError('visitDate'); }} className={`rounded-lg border px-1 py-2 text-[11px] font-bold transition ${selected ? 'border-teal-600 bg-teal-600 text-white' : available ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-500 hover:bg-teal-50' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'}`}>{formatSlot(time)}</button>; })}</div></div>}</div>
            </section>
            <section className="space-y-6"><section className="space-y-4"><div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Clinical intake</h3><p className="mt-0.5 text-xs text-slate-500">Visit type, clinical findings, and treatment notes.</p></div><div className="space-y-1.5"><label htmlFor="visit-type" className="text-xs font-semibold text-slate-600">Visit type <span className="text-rose-500">*</span></label><select id="visit-type" data-visit-field="visitType" value={visitType} onChange={event => { setVisitType(event.target.value); clearError('visitType'); }} className={fieldClass('visitType', 'h-[42px]')}>{['Initial Consultation', 'Follow-up', 'Treatment Session', 'Assessment'].map(type => <option key={type} value={type}>{type}</option>)}</select>{errors.visitType && <p className="text-xs font-medium text-rose-600">{errors.visitType}</p>}</div><div className="space-y-1.5"><label htmlFor="visit-service" className="text-xs font-semibold text-slate-600">Treatment / service</label><select id="visit-service" value={treatmentService} onChange={event => setTreatmentService(event.target.value)} className={fieldClass('treatmentService', 'h-[42px]')}><option value="">Select service</option>{['Cleaning', 'Check-up', 'Treatment'].map(service => <option key={service} value={service}>{service}</option>)}</select></div><div className="space-y-1.5"><label htmlFor="visit-concern" className="text-xs font-semibold text-slate-600">Main concern</label><textarea id="visit-concern" value={mainConcern} onChange={event => setMainConcern(event.target.value)} maxLength={2000} rows={3} placeholder="Describe the reason for this visit" className={fieldClass('mainConcern', 'p-3')} /></div><div className="space-y-1.5"><label htmlFor="visit-diagnosis" className="text-xs font-semibold text-slate-600">Diagnosis</label><textarea id="visit-diagnosis" value={diagnosis} onChange={event => setDiagnosis(event.target.value)} maxLength={3000} rows={3} placeholder="Record the diagnosis or assessment" className={fieldClass('diagnosis', 'p-3')} /></div><div className="space-y-1.5"><label htmlFor="visit-plan" className="text-xs font-semibold text-slate-600">Treatment plan</label><textarea id="visit-plan" value={treatmentPlan} onChange={event => setTreatmentPlan(event.target.value)} maxLength={5000} rows={3} placeholder="Record the agreed treatment plan" className={fieldClass('treatmentPlan', 'p-3')} /></div><div className="space-y-1.5"><label htmlFor="visit-notes" className="text-xs font-semibold text-slate-600">Clinical notes</label><textarea id="visit-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={5000} rows={4} placeholder="Add relevant clinical or aftercare notes" className={fieldClass('notes', 'p-3')} /></div>{visit && <FileAttachmentSection patientId={patientId} appointmentId={visit.appointmentId || null} visitId={visit.id} />}</section>
              <section className="space-y-4"><div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Outcome & follow-up</h3><p className="mt-0.5 text-xs text-slate-500">Close the visit and optionally plan the next appointment.</p></div><div className="space-y-1.5"><label htmlFor="visit-outcome" className="text-xs font-semibold text-slate-600">Outcome</label><select id="visit-outcome" value={outcome} onChange={event => setOutcome(event.target.value)} className={fieldClass('visitOutcome', 'h-[42px]')}><option value="">Select outcome</option><option value="Completed">Completed</option></select></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={followUpRequired} onChange={event => setFollowUpRequired(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />Follow-up required</label>{followUpRequired && <div className="space-y-4 rounded-xl border border-teal-100 bg-teal-50/40 p-3"><div className="space-y-1.5"><label className="text-xs font-semibold text-slate-600">Recommended follow-up date</label><CustomDatePicker value={nextVisitDate} onChange={setNextVisitDate} min={getActiveDatePrefix()} /></div><div className="space-y-1.5"><label htmlFor="visit-follow-up-instructions" className="text-xs font-semibold text-slate-600">Follow-up instructions</label><textarea id="visit-follow-up-instructions" value={followUpInstructions} onChange={event => setFollowUpInstructions(event.target.value)} maxLength={2000} rows={3} placeholder="Add instructions for the next visit" className={fieldClass('followUpInstructions', 'p-3')} /></div></div>}</section>
            </section>
          </div>
        )}
        <footer className="-mx-5 -mb-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:-mx-7 sm:-mb-7 sm:flex-row sm:justify-end sm:px-7"><button type="button" onClick={closeForm} disabled={isSaving} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">Cancel</button>{activeTab === 'form' && <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">{isSaving ? <><Clock3 className="h-4 w-4 animate-spin" />Saving…</> : <><CheckCircle2 className="h-4 w-4" />{visit ? 'Save changes' : 'Save visit'}</>}</button>}</footer>
      </form>
    </div>
  );
}
