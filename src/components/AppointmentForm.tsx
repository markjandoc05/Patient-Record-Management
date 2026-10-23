import { uiCan, uiPermissionScope } from '../permissionState';
import AppointmentServicePicker, { type AppointmentServiceChoice } from './AppointmentServicePicker';
import { matchesPatientLookup } from '../utils/patientLookup';
import { isEligibleVisitPerformer } from '../utils/visitPerformerPolicy';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, subscribeProtectedDataInvalidation, where } from '../dataClient';
import { CheckCircle2, Clock3, Search } from 'lucide-react';
import { developerRoles, hasAdministrativeAccess } from '../rbac';
import { db, auth } from '../platform';
import { CustomDatePicker } from './CustomDatePicker';
import { createAppointmentRecord, getAppointmentRecord, updateAppointmentRecord } from '../utils/recordApi';
import { formatDateTime } from '../utils';
import { getActiveDatePrefix, getActiveDateTimeInput } from '../utils/timezone';
import { appointmentPricingRevision, parseAppointmentSpecialPrice } from '../utils/appointmentSpecialPrice';
import { appointmentBookingPricePreview, readAppointmentBookingQuote } from '../utils/appointmentBookingQuote';
import { priceLabel } from '../servicesPolicy';

const timeSlots = Array.from({ length: 19 }, (_, index) => {
  const totalMinutes = 10 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
});

const formatSlot = (time: string) => {
  const [hourValue, minute] = time.split(':').map(Number);
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${hourValue >= 12 ? 'PM' : 'AM'}`;
};

const specialPriceFormatter = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function specialPriceDisplay(value: string, editing: boolean) {
  if (editing) return value;
  try {
    const amount = parseAppointmentSpecialPrice(value);
    return amount === null ? value : specialPriceFormatter.format(Number(amount));
  } catch { return value; }
}

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

function AppointmentFormWorkspace({
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
  const [serviceChoice, setServiceChoice] = useState<AppointmentServiceChoice>({ kind: 'unchanged' });
  const [serviceBranchNotice, setServiceBranchNotice] = useState(false);
  const [specialPrice, setSpecialPrice] = useState(() => appointment?.specialPrice == null ? '' : String(appointment.specialPrice));
  const [specialPriceEditing, setSpecialPriceEditing] = useState(false);
  const [specialPriceChanged, setSpecialPriceChanged] = useState(false);
  const [specialPriceNotice, setSpecialPriceNotice] = useState(false);
  // A prop refresh cannot silently acknowledge pricing that this draft never reviewed.
  const [pricingRecord, setPricingRecord] = useState<any>(() => appointment
    ? { ...appointment, bookingQuote: appointment.bookingQuote && { ...appointment.bookingQuote } } : undefined);
  const [pricingReview, setPricingReview] = useState({ conflict: false, loading: false, candidate: null as any, error: '' });
  const pricingReviewLifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  useLayoutEffect(() => {
    pricingReviewLifetime.current.active = true; pricingReviewLifetime.current.generation++;
    setPricingReview(current => current.loading || current.candidate || current.error
      ? { ...current, loading: false, candidate: null, error: '' } : current);
    return () => { pricingReviewLifetime.current.active = false; pricingReviewLifetime.current.generation++; pricingReviewLifetime.current.request?.abort(); };
  }, [branchId, patientId]);
  const saveLifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  useLayoutEffect(() => {
    saveLifetime.current.active = true; saveLifetime.current.generation++;
    setIsSaving(false);
    return () => { saveLifetime.current.active = false; saveLifetime.current.generation++; saveLifetime.current.request?.abort(); };
  }, [branchId]);

  const currentUser = auth.currentUser;
  const currentUserRole = users.find(user => user.email === currentUser?.email)?.role;
  const isVisitCreated = Boolean(appointment?.visitHistoryCreated);
  const isCompleted = appointment?.status === 'Completed';
  const canModifySealed = ['admin', 'manager', 'doctor', ...developerRoles].includes(currentUserRole || '');
  const canViewHistory = hasAdministrativeAccess(currentUserRole);
  const isLocked = Boolean(appointment?.isArchived) || isVisitCreated || (isCompleted && !canModifySealed);
  const isView = currentMode === 'view';
  const isReadOnly = isView || isLocked || !uiCan(currentUserRole, appointment ? 'appointments.edit' : 'appointments.create');
  const clinicalFieldsReadOnly = !uiCan(currentUserRole, 'clinical.view') || isReadOnly || (Boolean(appointment) && currentUserRole === 'staff');
  const today = getActiveDatePrefix();
  const nowTime = getActiveDateTimeInput().slice(11, 16);

  const doctors = useMemo(() => users.filter(user => user.role === 'doctor'), [users]);
  const availableDoctors = useMemo(() => branchId
    ? doctors.filter(doctor => isEligibleVisitPerformer(doctor, branchId))
    : [], [branchId, doctors]);
  const historicalDoctor = doctorId && doctorId === appointment?.doctorId
    && !availableDoctors.some(doctor => doctor.id === doctorId);
  const historicalDoctorName = appointment?.doctorName || users.find(user => user.id === appointment?.doctorId)?.fullName
    || users.find(user => user.id === appointment?.doctorId)?.name || 'Recorded doctor';
  const selectedPatient = patients.find(patient => patient.id === patientId);
  const visiblePatients = useMemo(() => {
    const needle = patientSearch.trim().toLowerCase();
    if (!needle || patientId) return [];
    return patients
      .filter(patient => patient.isArchived !== true)
      .filter(patient => matchesPatientLookup(patient, needle))
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
    if (!branchId || !selectedDate) return false;
    if (!appointment && selectedDate === today && time <= nowTime) return false;
    // An unassigned booking does not reserve an individual doctor's time.
    if (!doctorId) return true;
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
    if (nextBranchId !== branchId) {
      clearSpecialPriceForContext();
      if (!pricingRecord?.serviceId && serviceChoice.kind === 'selected') {
        setServiceChoice({ kind: 'unchanged' });
        setServiceBranchNotice(true);
      }
    }
    setBranchId(nextBranchId);
    clearError('branchId');
    const doctorStillAvailable = doctors.some(doctor => doctor.id === doctorId && isEligibleVisitPerformer(doctor, nextBranchId));
    if (!doctorStillAvailable) setDoctorId('');
  };

  const selectDate = (date: string) => {
    setSelectedDate(date);
    clearError('appointmentDate');
    if (!appointment && date === today && selectedTime && selectedTime <= nowTime) setSelectedTime('');
  };

  const serviceUnresolved = (serviceChoice.kind === 'unchanged' && Boolean(pricingRecord?.serviceId) && branchId !== pricingRecord.branchId)
    || (serviceChoice.kind === 'selected' && (serviceChoice.branchId !== branchId || serviceChoice.reviewRequired));
  const savedBookingQuote = readAppointmentBookingQuote(pricingRecord);
  const keepingRecordedService = serviceChoice.kind === 'unchanged' && branchId === pricingRecord?.branchId;
  const serviceQuotePrice = serviceChoice.kind === 'selected' && serviceChoice.branchId === branchId
    && !serviceChoice.reviewRequired && !serviceChoice.verificationPending
    ? serviceChoice.referencePrice : keepingRecordedService ? savedBookingQuote?.servicePrice ?? null : null;
  const bookingPrice = appointmentBookingPricePreview(serviceQuotePrice, specialPrice);
  const showingSavedQuote = keepingRecordedService && !specialPriceChanged && Boolean(savedBookingQuote);
  const hasSummaryService = serviceChoice.kind === 'selected' && serviceChoice.branchId === branchId
    || keepingRecordedService && Boolean(pricingRecord?.serviceId);
  const clearSpecialPriceForContext = () => {
    if (!specialPrice.trim()) return;
    setSpecialPrice('');
    setSpecialPriceChanged(true);
    setSpecialPriceNotice(true);
    clearError('specialPrice');
  };
  const serviceContext = (choice: AppointmentServiceChoice) => JSON.stringify(choice.kind === 'selected'
    ? [choice.serviceId, choice.expectedVersion]
    : choice.kind === 'unchanged' ? [pricingRecord?.serviceId ?? null, pricingRecord?.serviceCatalogueVersion ?? null] : [null, null]);
  const changeService = (next: AppointmentServiceChoice) => {
    if (isReadOnly || isSaving) return;
    if (serviceContext(next) !== serviceContext(serviceChoice)) clearSpecialPriceForContext();
    setServiceChoice(next);
    clearError('serviceSelection');
    setSaveError('');
  };
  const requireServiceReview = () => setServiceChoice(current => current.kind === 'selected' ? { ...current, reviewRequired: true } : current);

  const latestPricing = pricingReview.candidate;
  const latestQuote = readAppointmentBookingQuote(latestPricing);
  const reviewBase = serviceChoice.kind === 'selected' && serviceChoice.branchId === branchId
    && !serviceChoice.reviewRequired && !serviceChoice.verificationPending ? serviceChoice.referencePrice
    : serviceChoice.kind === 'unchanged' && latestPricing?.branchId === branchId ? latestQuote?.servicePrice ?? null : null;
  const reviewedDraftPrice = appointmentBookingPricePreview(reviewBase, specialPrice);
  const canUseReviewedPricing = Boolean(latestPricing) && latestPricing.branchId === pricingRecord?.branchId
    && latestPricing.patientId === pricingRecord?.patientId && !latestPricing.isArchived && !latestPricing.visitHistoryCreated
    && (latestPricing.status !== 'Completed' || canModifySealed);
  const reviewLatestPricing = async () => {
    if (!appointment?.id || isReadOnly || isSaving || !pricingReview.conflict) return;
    pricingReviewLifetime.current.request?.abort();
    const controller = new AbortController(), generation = pricingReviewLifetime.current.generation;
    pricingReviewLifetime.current.request = controller;
    const current = () => pricingReviewLifetime.current.active && pricingReviewLifetime.current.generation === generation
      && pricingReviewLifetime.current.request === controller && !controller.signal.aborted;
    setPricingReview(value => ({ ...value, loading: true, candidate: null, error: '' }));
    try {
      const latest = await getAppointmentRecord(appointment.id, { signal: controller.signal, current });
      if (!current()) return;
      appointmentPricingRevision(latest);
      setPricingReview({ conflict: true, loading: false, candidate: latest, error: '' });
    } catch (error: any) {
      if (current() && error.name !== 'AbortError') setPricingReview({ conflict: true, loading: false, candidate: null,
        error: error.message || 'Could not review the latest pricing. Your draft has been kept.' });
    }
  };
  const useReviewedPricing = () => {
    if (isReadOnly || isSaving || pricingReview.loading || !canUseReviewedPricing) return;
    setPricingRecord(latestPricing);
    setPricingReview({ conflict: false, loading: false, candidate: null, error: '' });
    clearError('specialPrice');
    setSaveError('');
  };

  const saveAppointment = async () => {
    if (isSaving || isReadOnly || pricingReview.conflict) return;
    const finalStatus = status;
    const appointmentDate = selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : '';
    const validationErrors: Record<string, string> = {};
    let quotedPrice: string | null = null;
    let expectedPricingRevision: number | undefined;
    if (specialPriceChanged) {
      try {
        quotedPrice = parseAppointmentSpecialPrice(specialPrice);
        if (appointment) expectedPricingRevision = appointmentPricingRevision(pricingRecord);
      }
      catch (error: any) { validationErrors.specialPrice = error.message; }
    }
    if (serviceUnresolved) validationErrors.serviceSelection = 'Choose an eligible Service, confirm the reviewed Service, or explicitly remove it before saving.';
    if (!patientId || !selectedPatient) validationErrors.patientId = 'Select a patient from the results.';
    if (!branchId) validationErrors.branchId = 'Select the clinic for this appointment.';
    if (!selectedDate) validationErrors.appointmentDate = 'Select an appointment date.';
    if (!selectedTime) validationErrors.appointmentDate = 'Select an available time slot.';
    if (!visitType) validationErrors.visitType = 'Select the visit type.';
    if (!finalStatus) validationErrors.status = 'Select an appointment status.';
    if (uiCan(currentUserRole, 'clinical.view') && finalStatus === 'Completed' && !mainConcern.trim()) validationErrors.mainConcern = 'A main concern is required before completion.';
    if (uiCan(currentUserRole, 'clinical.view') && finalStatus === 'Completed' && !notes.trim()) validationErrors.notes = 'Clinical notes are required before completion.';
    if (selectedTime && !isSlotAvailable(selectedTime)) validationErrors.appointmentDate = 'This time slot is no longer available. Choose another slot.';

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
      ...(expectedPricingRevision === undefined ? {} : { expectedPricingRevision }),
      ...(specialPriceChanged && (appointment || quotedPrice !== null) ? { specialPrice: quotedPrice } : {}),
      ...(serviceChoice.kind === 'unchanged' ? {} : { serviceSelection: serviceChoice.kind === 'removed' ? null : { serviceId: serviceChoice.serviceId, expectedVersion: serviceChoice.expectedVersion } }),
      patientId,
      appointmentDate,
      branchId,
      doctorId: doctorId || null,
      visitType,
      mainConcern: mainConcern.trim(),
      notes: notes.trim(),
      status: finalStatus,
    };

    const controller = new AbortController(), generation = saveLifetime.current.generation;
    saveLifetime.current.request = controller;
    const current = () => saveLifetime.current.active && saveLifetime.current.generation === generation
      && saveLifetime.current.request === controller && !controller.signal.aborted;
    const requestScope = { signal: controller.signal, current };
    try {
      const saved = appointment
        ? await updateAppointmentRecord(appointment.id, payload, requestScope)
        : await createAppointmentRecord(payload, requestScope);
      if (!current()) return;
      if (!saved.id) throw new Error('The server did not confirm the appointment record. Please try again.');
      onSave();
      onClose();
    } catch (error: any) {
      if (!current() || error.name === 'AbortError') return;
      if (error.code === 'SERVICE_VERSION_CHANGED') requireServiceReview();
      if (error.code === 'SPECIAL_PRICE_REVIEW_REQUIRED') setErrors(current => ({ ...current, specialPrice: error.message }));
      if (error.code === 'SPECIAL_PRICE_CONTEXT_CHANGED') {
        pricingReviewLifetime.current.request?.abort();
        setPricingReview({ conflict: true, loading: false, candidate: null, error: '' });
      }
      console.error('Error saving appointment:', error);
      setSaveError(error?.message || 'The appointment could not be saved. Please try again.');
    } finally {
      if (current()) setIsSaving(false);
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

              {serviceBranchNotice && <p role="status" className="text-xs text-amber-700">Clinic changed. Choose a Service for this clinic, or continue without a Service.</p>}
              <fieldset disabled={isSaving} className="min-w-0 space-y-4 border-0 p-0">
                <AppointmentServicePicker key={branchId} branchId={branchId} readOnly={isReadOnly} recorded={pricingRecord} choice={serviceChoice} onChange={changeService} onReviewRequired={requireServiceReview} unresolved={serviceUnresolved} error={errors.serviceSelection} />
                <div className="space-y-1.5">
                  <label htmlFor="appointment-special-price" className="text-xs font-semibold text-slate-600">Special Price:</label>
                  <div className="relative"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">₱</span><input id="appointment-special-price" data-appointment-field="specialPrice" type="text" inputMode="decimal" maxLength={32} value={specialPriceDisplay(specialPrice, specialPriceEditing)} disabled={isReadOnly || isSaving} aria-invalid={Boolean(errors.specialPrice)} aria-describedby={`appointment-special-price-hint${errors.specialPrice ? ' appointment-special-price-error' : ''}`} onFocus={() => { if (!isReadOnly && !isSaving) setSpecialPriceEditing(true); }} onBlur={() => setSpecialPriceEditing(false)} onChange={event => { if (isReadOnly || isSaving) return; setSpecialPriceEditing(true); setSpecialPrice(event.target.value); setSpecialPriceChanged(true); setSpecialPriceNotice(false); clearError('specialPrice'); setSaveError(''); }} placeholder="Optional amount" className={fieldClass('specialPrice', `h-[42px] pl-7 ${(isReadOnly || isSaving) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)} /></div>
                  <p id="appointment-special-price-hint" className="text-xs text-slate-600">Overrides the Service price for this booking quote. Leave blank to use the Service price. ₱0 means Free.</p>
                  {specialPriceNotice && <p role="status" className="text-xs text-amber-700">Special Price cleared because the Service or clinic changed. Enter it again if it applies.</p>}
                  {errors.specialPrice && <p id="appointment-special-price-error" className="text-xs font-medium text-rose-600">{errors.specialPrice}</p>}
                </div>
                <section aria-label="Booking Price Summary" data-booking-price-summary="true" className="space-y-3 border-t border-slate-200 pt-4">
                  <h4 className="text-sm font-semibold text-slate-800">Price summary</h4>
                  {hasSummaryService && <dl className="text-sm"><div data-booking-price-row="servicePrice" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-slate-600">Service price</dt><dd className="font-medium tabular-nums text-slate-800">{bookingPrice.servicePrice === null ? 'Price not set' : priceLabel(bookingPrice.servicePrice)}</dd></div></dl>}
                  {!bookingPrice.invalid && bookingPrice.specialPrice !== null && <p data-booking-price-row="specialPrice" className="text-xs font-medium text-teal-800">Special Price applied</p>}
                  <dl><div data-booking-price-row="total" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2"><dt className="text-sm font-semibold text-slate-800">Quoted total</dt><dd aria-live="polite" aria-atomic="true" className={`min-w-0 max-w-full break-words font-semibold leading-tight tabular-nums ${bookingPrice.invalid ? 'text-sm text-rose-700' : bookingPrice.total === null ? 'text-sm text-slate-600' : 'text-xl text-teal-800 sm:text-2xl'}`}>{bookingPrice.invalid ? 'Enter a valid Special Price' : bookingPrice.total === null ? 'Price not set' : priceLabel(bookingPrice.total)}</dd></div></dl>
                  <p className="text-xs text-slate-600">Quote only. Payment is recorded separately.</p>
                  {showingSavedQuote && <p className="text-xs text-slate-600">Saved booking quote. Catalogue changes do not change this amount.</p>}
                  {keepingRecordedService && pricingRecord?.serviceId && serviceQuotePrice === null && <p className="text-xs text-slate-600">To set a Service price for this booking, select and confirm the current Service.</p>}
                </section>
                {pricingReview.conflict && <section aria-label="Pricing conflict review" className="space-y-3 border-t border-slate-200 pt-4 text-sm text-slate-800">
                  <p role="alert">This booking’s pricing changed after you opened it. Your unsaved draft has been kept. Review the latest pricing before saving.</p>
                  <button type="button" disabled={isReadOnly || isSaving || pricingReview.loading} onClick={() => void reviewLatestPricing()} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">{pricingReview.loading ? 'Loading latest pricing…' : 'Review latest pricing'}</button>
                  {pricingReview.error && <p role="alert" className="text-rose-700">{pricingReview.error}</p>}
                  {latestPricing && <div className="space-y-2">
                    <p>Latest saved Service: {latestPricing.serviceNameSnapshot || 'No Service'}{latestPricing.serviceCatalogueVersion ? ` · v${latestPricing.serviceCatalogueVersion}` : ''}</p>
                    <p>Latest Service price: {latestQuote?.servicePrice != null ? priceLabel(latestQuote.servicePrice) : 'Price not set'}</p>
                    <p>Latest saved quote: {latestQuote?.total != null ? priceLabel(latestQuote.total) : latestPricing.specialPrice != null ? priceLabel(latestPricing.specialPrice) : 'Price not set'}</p>
                    {canUseReviewedPricing ? <>
                      <p>Your draft total after review: {reviewedDraftPrice.invalid ? 'Enter a valid Special Price' : reviewedDraftPrice.total === null ? 'Price not set' : priceLabel(reviewedDraftPrice.total)}</p>
                      <p className="text-xs text-slate-600">This keeps your draft Service choice, Special Price, notes and appointment details. Your changes are saved only when you save the appointment.</p>
                      <button type="button" disabled={isReadOnly || isSaving || pricingReview.loading} onClick={useReviewedPricing} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Use reviewed pricing and keep my draft</button>
                    </> : <p role="alert">The saved patient, clinic or appointment availability changed. Your draft is kept here; reopen the latest booking before making further changes.</p>}
                  </div>}
                </section>}
              </fieldset>

              <div className="space-y-1.5"><label htmlFor="appointment-doctor" className="text-xs font-semibold text-slate-600">Doctor (optional)</label><select id="appointment-doctor" data-appointment-field="doctorId" aria-describedby="appointment-doctor-hint" value={doctorId} onChange={event => { setDoctorId(event.target.value); clearError('doctorId'); clearError('appointmentDate'); }} disabled={isReadOnly || !branchId} className={fieldClass('doctorId', `h-[42px] ${(isReadOnly || !branchId) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">Unassigned — assign later</option>{historicalDoctor && <option value={doctorId}>{historicalDoctorName} (recorded)</option>}{availableDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.fullName || doctor.name}</option>)}</select><p id="appointment-doctor-hint" className="text-xs text-slate-600">You can assign a doctor later through Edit appointment. Unassigned bookings do not reserve a doctor's time.</p>{errors.doctorId && <p className="text-xs font-medium text-rose-600">{errors.doctorId}</p>}</div>

              <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-600">Appointment date <span className="text-rose-500">*</span></label><div data-appointment-field="appointmentDate" tabIndex={-1}><CustomDatePicker min={appointment ? '' : today} value={selectedDate} onChange={selectDate} disabled={isReadOnly || !branchId} className={errors.appointmentDate ? 'border-rose-300 bg-rose-50/30' : ''} /></div>{errors.appointmentDate && <p className="text-xs font-medium text-rose-600">{errors.appointmentDate}</p>}</div>

              <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-semibold text-slate-600">Time slot <span className="text-rose-500">*</span></label>{branchId && selectedDate && <span className="text-[11px] text-slate-400">Times shown in clinic time</span>}</div>{!branchId ? <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-medium text-amber-700">Select a clinic to view appointment times.</p> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-2"><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{timeSlots.map(time => { const available = isSlotAvailable(time); const selected = selectedTime === time; return <button key={time} type="button" disabled={isReadOnly || !available} onClick={() => { setSelectedTime(time); clearError('appointmentDate'); }} className={`rounded-lg border px-1 py-2 text-[11px] font-bold transition ${selected ? 'border-teal-600 bg-teal-600 text-white' : available ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-500 hover:bg-teal-50' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'}`}>{formatSlot(time)}</button>; })}</div></div>}</div>
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
          {!isReadOnly && activeTab === 'details' && <button type="submit" disabled={isSaving || serviceUnresolved || pricingReview.conflict} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">{isSaving ? <><Clock3 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-4 w-4" /> {appointment ? 'Save changes' : 'Save appointment'}</>}</button>}
        </footer>
      </form>
    </div>
  );
}

// A keyed workspace prevents old access-scope drafts/options from flashing during
// a render. Layout cleanup guards in-flight loads and saves before passive effects.
export default function AppointmentForm(props: AppointmentFormProps) {
  const currentUser = auth.currentUser;
  const profile = currentUser ? props.users.find(user => user.id === currentUser.uid || user.email === currentUser.email) : undefined;
  const branches = props.branches.filter(branch => hasAdministrativeAccess(profile?.role) || profile?.assignedBranches?.includes(branch.id));
  const scope = JSON.stringify([uiPermissionScope(profile), currentUser?.uid ?? null, profile?.role ?? null, profile?.active === true,
    [...(profile?.assignedBranches || [])].sort(), branches.map(branch => [branch.id, branch.status]).sort()]);
  const [invalidatedScope, setInvalidatedScope] = useState<string | null>(null);
  useLayoutEffect(() => subscribeProtectedDataInvalidation(() => setInvalidatedScope(scope)), [scope]);
  // A current denial clears the form and requires reopening/recovered scope,
  // rather than remounting a request that could create an authorization loop.
  if (!profile?.active || invalidatedScope === scope || (props.appointment && !branches.some(branch => branch.id === props.appointment.branchId))) {
    return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4"><div role="alert" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"><p className="text-sm text-slate-700">Appointment access changed. Close this form and reopen it after your access is refreshed.</p><button type="button" onClick={props.onClose} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Close</button></div></div>;
  }
  return <AppointmentFormWorkspace key={scope} {...props} branches={branches} defaultBranchId={branches.some(branch => branch.id === props.defaultBranchId) ? props.defaultBranchId : undefined} />;
}
