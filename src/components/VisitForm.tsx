import { uiRecordPermission } from '../permissionState';
import { uiCan, uiPermissionScope } from '../permissionState';
import AppointmentServicePicker, { type AppointmentServiceChoice } from './AppointmentServicePicker';
import VisitSessionUsagePicker, { type SessionUsageChoice } from './VisitSessionUsagePicker';
import { isVisitClinicallySealed } from '../utils/visitServicePolicy';
import { visitVersion } from '../utils/visitVersionPolicy';
import { ASSISTING_STAFF_MAX_LENGTH, isEligibleVisitPerformer, visitPerformerLabel, visitPerformerName } from '../utils/visitPerformerPolicy';
import { matchesPatientLookup } from '../utils/patientLookup';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, subscribeProtectedDataInvalidation, where } from '../dataClient';
import { CheckCircle2, Clock3, Search } from 'lucide-react';
import { db, auth } from '../platform';
import { hasPermission, Role, hasAdministrativeAccess } from '../rbac';
import { CustomDatePicker } from './CustomDatePicker';
import { createAppointmentRecord, createVisitRecord, updateVisitRecord, getVisitRecord, getAppointmentRecord } from '../utils/recordApi';
import { priceLabel } from '../servicesPolicy';
import { parseAppointmentSpecialPrice } from '../utils/appointmentSpecialPrice';
import { appointmentBookingPricePreview, readAppointmentBookingQuote } from '../utils/appointmentBookingQuote';
import { bookedSpecialPrice, expectedBookingContext, readVisitPriceQuote, samePerformedService } from '../utils/visitPricingPolicy';
import FileAttachmentSection from './FileAttachmentSection';
import ClinicalChartModal from './ClinicalChartModal';
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

function VisitFormWorkspace({
  patients, branches, users, defaultBranchId, onClose, onSave, appointment, visit, userRole, visits = [], appointments = [],
  onReloadVisit,
}: VisitFormProps & { onReloadVisit: (record: any) => void }) {
  const initialDateTime = visit?.visitDate || appointment?.appointmentDate || '';
  const [isSaving, setIsSaving] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [patientId, setPatientId] = useState(visit?.patientId || appointment?.patientId || '');
  const [patientSearch, setPatientSearch] = useState('');
  const [isPatientMenuOpen, setIsPatientMenuOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(visit?.doctorId || appointment?.doctorId || '');
  const [performedByUserId, setPerformedByUserId] = useState(visit?.performedByUserId || visit?.doctorId || appointment?.doctorId || '');
  const [performerChanged, setPerformerChanged] = useState(false);
  const [assistingStaffText, setAssistingStaffText] = useState(visit?.assistingStaffText || '');
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
  const openedVersion = useRef(visitVersion(visit));
  const [visitConflict, setVisitConflict] = useState(false);
  const [savedReview, setSavedReview] = useState<any>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reviewLifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');
  const [logs, setLogs] = useState<any[]>([]);
  const [booked, setBooked] = useState(() => appointment || appointments.find(item => item.id === visit?.appointmentId));
  const [serviceChoice, setServiceChoice] = useState<AppointmentServiceChoice>(() => !visit && booked?.serviceId
    ? { kind: 'selected', branchId: booked.branchId, serviceId: booked.serviceId,
      expectedVersion: booked.serviceCatalogueVersion || 0, name: booked.serviceNameSnapshot || 'Booked Service',
      duration: booked.serviceDurationMinutesSnapshot || 0, referencePrice: '', reviewRequired: false, verificationPending: true }
    : { kind: 'unchanged' });
  const inheritedService = useRef(!visit && Boolean(appointment));
  const [specialPrice, setSpecialPrice] = useState(() => visit ? readVisitPriceQuote(visit)?.specialPrice ?? '' : bookedSpecialPrice(booked));
  const [specialPriceChanged, setSpecialPriceChanged] = useState(false);
  const [specialPriceNotice, setSpecialPriceNotice] = useState(false);
  const [bookingConflict, setBookingConflict] = useState(false);
  const [bookingReview, setBookingReview] = useState<any>(null);
  const [bookingReviewError, setBookingReviewError] = useState('');
  const [bookingReviewLoading, setBookingReviewLoading] = useState(false);
  const bookingReviewLifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  const serviceUnresolved = (serviceChoice.kind === 'unchanged' && Boolean(visit?.serviceId) && branchId !== visit.branchId)
    || (serviceChoice.kind === 'selected' && (serviceChoice.branchId !== branchId || serviceChoice.reviewRequired || serviceChoice.verificationPending === true));
  const recordedTreatmentText = typeof visit?.treatmentService === 'string' ? visit.treatmentService.trim() : '';
  const showRecordedTreatment = Boolean(recordedTreatmentText) && (!visit?.serviceId
    || recordedTreatmentText !== String(visit.serviceNameSnapshot || '').trim());
  const sealed = Boolean(visit?.isArchived) || isVisitClinicallySealed(visit);
  // Keep submitted intent immutable; revisions distinguish replacement, removal,
  // confirmation of a newer version, and A→B→A even when the final ID matches.
  const serviceIntent = useRef({ revision: 0, choice: serviceChoice });
  const savedVisitId = useRef<string | undefined>(visit?.id);
  const [serviceSaveNotice, setServiceSaveNotice] = useState('');
  const [sessionUsage, setSessionUsage] = useState<SessionUsageChoice | null>(null);
  const [sessionBinding, setSessionBinding] = useState({ active: false, loading: Boolean(visit?.id) && !sealed
    && uiCan(userRole, 'treatment_ledger.view') && uiCan(userRole, 'patients.view') && uiCan(userRole, 'visits.view') && uiCan(userRole, 'clinical.view') });
  const [sessionRetryLocked, setSessionRetryLocked] = useState(false);
  const clientVisitId = useRef(crypto.randomUUID());
  const bindingLocked = sessionBinding.active || sessionBinding.loading;
  const effectiveServiceId = serviceChoice.kind === 'selected' ? serviceChoice.serviceId : serviceChoice.kind === 'removed' ? '' : visit?.serviceId || '';
  const effectiveServiceVersion = serviceChoice.kind === 'selected' ? serviceChoice.expectedVersion : serviceChoice.kind === 'removed' ? null : visit?.serviceCatalogueVersion ?? null;
  const savedQuote = readVisitPriceQuote(visit), bookedQuote = readAppointmentBookingQuote(booked);
  const sameSavedContext = samePerformedService(visit, branchId, effectiveServiceId || null, effectiveServiceVersion);
  const sameBookedContext = !visit && samePerformedService(booked, branchId, effectiveServiceId || null, effectiveServiceVersion);
  const servicePrice = serviceUnresolved ? null : savedQuote && sameSavedContext ? savedQuote.servicePrice
    : bookedQuote && sameBookedContext ? bookedQuote.servicePrice
    : serviceChoice.kind === 'selected' ? serviceChoice.referencePrice || null : null;
  const visitPrice = appointmentBookingPricePreview(servicePrice, specialPrice);
  const saveLifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  useLayoutEffect(() => {
    saveLifetime.current.active = true; saveLifetime.current.generation++; setIsSaving(false);
    return () => { saveLifetime.current.active = false; saveLifetime.current.generation++; saveLifetime.current.request?.abort(); };
  }, [branchId]);
  useLayoutEffect(() => {
    bookingReviewLifetime.current.active = true; bookingReviewLifetime.current.generation++;
    setBookingReview(null); setBookingReviewError(''); setBookingReviewLoading(false);
    return () => { bookingReviewLifetime.current.active = false; bookingReviewLifetime.current.generation++; bookingReviewLifetime.current.request?.abort(); };
  }, [branchId]);
  useLayoutEffect(() => {
    reviewLifetime.current.active = true; reviewLifetime.current.generation++;
    setSavedReview(null); setReviewError(''); setReviewing(false); setReloading(false); setReloadConfirmation(false);
    return () => { reviewLifetime.current.active = false; reviewLifetime.current.generation++; reviewLifetime.current.request?.abort(); };
  }, [branchId]);
  const setCurrentServiceChoice = (next: AppointmentServiceChoice) => {
    serviceIntent.current = { revision: serviceIntent.current.revision + 1, choice: next };
    setServiceChoice(next);
  };
  const clearSpecialForContext = () => {
    if (specialPrice !== '') { setSpecialPrice(''); setSpecialPriceChanged(true); setSpecialPriceNotice(true); }
    clearError('specialPrice');
  };
  const changeService = (next: AppointmentServiceChoice) => {
    inheritedService.current = false;
    const id = next.kind === 'selected' ? next.serviceId : next.kind === 'removed' ? '' : visit?.serviceId || '';
    const version = next.kind === 'selected' ? next.expectedVersion : next.kind === 'removed' ? null : visit?.serviceCatalogueVersion ?? null;
    if (id !== effectiveServiceId || version !== effectiveServiceVersion) clearSpecialForContext();
    setCurrentServiceChoice(next); clearError('serviceSelection'); setSaveError(''); setServiceSaveNotice('');
  };
  const requireServiceReview = () => {
    const current = serviceIntent.current.choice;
    if (current.kind === 'selected' && !current.reviewRequired) setCurrentServiceChoice({ ...current, reviewRequired: true, verificationPending: false });
  };


  const isAppointment = Boolean(appointment);
  const canViewHistory = hasAdministrativeAccess(userRole);
  const selectedPatient = patients.find(patient => patient.id === patientId);
  const doctors = useMemo(() => users.filter(user => user.role?.toLowerCase() === 'doctor' && user.active !== false
    && (userRole !== 'doctor' || user.id === auth.currentUser?.uid)), [userRole, users]);
  const availableDoctors = useMemo(() => branchId
    ? doctors.filter(doctor => doctor.assignedBranches?.includes(branchId) || doctor.id === (visit?.doctorId || appointment?.doctorId || ''))
    : [], [appointment?.doctorId, branchId, doctors, visit?.doctorId]);
  const needsOwnDoctorPerformer = userRole === 'doctor' && !(doctorId === auth.currentUser?.uid
    && (booked ? Boolean(booked.doctorId) : !visit?.appointmentId));
  const availablePerformers = useMemo(() => users.filter(user => isEligibleVisitPerformer(user, branchId)
    && (!needsOwnDoctorPerformer || user.id === auth.currentUser?.uid)), [branchId, needsOwnDoctorPerformer, users]);
  const originalPerformerId = visit?.performedByUserId || visit?.doctorId || '';
  const unchangedPerformerContext = Boolean(visit) && branchId === visit.branchId && doctorId === (visit.doctorId || '')
    && `${selectedDate}T${selectedTime}` === visit.visitDate?.slice(0, 16);
  const retainedPerformer = unchangedPerformerContext && performedByUserId === originalPerformerId;
  const historicalPerformer = retainedPerformer && Boolean(originalPerformerId)
    && !availablePerformers.some(user => user.id === originalPerformerId);
  const historicalDoctorId = visit?.doctorId || appointment?.doctorId;
  const historicalDoctorName = visit?.doctorName || appointment?.doctorName
    || users.find(user => user.id === historicalDoctorId)?.fullName
    || users.find(user => user.id === historicalDoctorId)?.name || 'Recorded doctor';
  const effectiveDoctorId = booked && !booked.doctorId && (!visit || performerChanged) ? '' : doctorId;
  const visiblePatients = useMemo(() => {
    const needle = patientSearch.trim().toLowerCase();
    if (!needle || patientId) return [];
    return patients.filter(patient => patient.isArchived !== true)
      .filter(patient => matchesPatientLookup(patient, needle))
      .slice(0, 8);
  }, [patientId, patientSearch, patients]);

  const clearError = (field: string) => setErrors(current => {
    if (!current[field]) return current;
    const next = { ...current };
    delete next[field];
    return next;
  });
  const fieldClass = (field: string, extra = '') => `w-full rounded-xl border bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 ${errors[field] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-300'} ${extra}`;
  const closeForm = () => { if (!isSaving && !reloading) onClose(); };

  const reviewBooking = async () => {
    if (!appointment?.id || savedVisitId.current || isSaving || bookingReviewLoading) return;
    bookingReviewLifetime.current.request?.abort();
    const controller = new AbortController(), generation = bookingReviewLifetime.current.generation;
    bookingReviewLifetime.current.request = controller;
    const current = () => bookingReviewLifetime.current.active && bookingReviewLifetime.current.generation === generation
      && bookingReviewLifetime.current.request === controller && !controller.signal.aborted;
    setBookingReview(null); setBookingReviewError(''); setBookingReviewLoading(true);
    try {
      const record = await getAppointmentRecord(appointment.id, { signal: controller.signal, current });
      if (!current()) return;
      expectedBookingContext(record);
      if (!branches.some(branch => branch.id === record.branchId)) throw new Error('You no longer have access to this booking branch. Your draft has been kept.');
      setBookingReview(record);
    } catch (error: any) {
      if (current() && error.name !== 'AbortError') setBookingReviewError(error?.message || 'Could not review this booking. Your draft has been kept.');
    } finally { if (current()) setBookingReviewLoading(false); }
  };
  const useReviewedBooking = () => {
    const record = bookingReview;
    if (!record || isSaving || bookingReviewLoading || savedVisitId.current) return;
    if (record.patientId !== patientId || record.branchId !== branchId || (record.doctorId || '') !== (booked?.doctorId || '')
      || record.appointmentDate?.slice(0, 16) !== `${selectedDate}T${selectedTime}` || record.isArchived || record.visitHistoryCreated) {
      setBookingReviewError('This booking’s patient, clinic, assignment, schedule or Visit status changed. Your draft has been kept. Close and reopen the booking before proceeding.'); return;
    }
    let nextChoice = serviceIntent.current.choice;
    if (inheritedService.current) {
      if (!record.serviceId) nextChoice = { kind: 'removed' };
      else if (nextChoice.kind !== 'selected' || nextChoice.branchId !== record.branchId
        || nextChoice.serviceId !== record.serviceId || nextChoice.expectedVersion !== record.serviceCatalogueVersion) {
        nextChoice = { kind: 'selected', branchId: record.branchId, serviceId: record.serviceId,
          expectedVersion: record.serviceCatalogueVersion || 0, name: record.serviceNameSnapshot || 'Booked Service',
          duration: record.serviceDurationMinutesSnapshot || 0, referencePrice: '', reviewRequired: false, verificationPending: true };
      }
      if (nextChoice !== serviceIntent.current.choice) setCurrentServiceChoice(nextChoice);
    }
    if (!specialPriceChanged) {
      const id = nextChoice.kind === 'selected' ? nextChoice.serviceId : null;
      const version = nextChoice.kind === 'selected' ? nextChoice.expectedVersion : null;
      setSpecialPrice(samePerformedService(record, branchId, id, version) ? bookedSpecialPrice(record) : '');
    }
    setBooked(record); setBookingConflict(false); setBookingReview(null); setBookingReviewError(''); setSaveError('');
  };

  const reviewSavedVisit = async (replaceDraft = false) => {
    const id = savedVisitId.current;
    if (!id || isSaving || reviewing || reloading) return;
    reviewLifetime.current.request?.abort();
    const controller = new AbortController(), generation = reviewLifetime.current.generation;
    reviewLifetime.current.request = controller;
    const current = () => reviewLifetime.current.active && reviewLifetime.current.generation === generation
      && reviewLifetime.current.request === controller && !controller.signal.aborted;
    setReviewError(''); setReviewing(true); setReloading(replaceDraft);
    try {
      const record = await getVisitRecord(id, { signal: controller.signal, current });
      if (!current()) return;
      const actor = users.find(user => user.id === auth.currentUser?.uid || user.email === auth.currentUser?.email);
      if (!uiRecordPermission(actor || userRole, 'visitHistory', 'update')
        || !branches.some(branch => branch.id === record.branchId)
        || (userRole === 'doctor' && record.doctorId !== auth.currentUser?.uid)) {
        throw new Error('You can no longer edit this saved Visit. Your draft has been kept; close and refresh your access.');
      }
      if (replaceDraft) {
        if (visitVersion(record) === null) throw new Error('The saved Visit has invalid version metadata. Your draft has been kept.');
        onReloadVisit(record);
      } else setSavedReview(record);
    } catch (error: any) {
      if (current() && error.name !== 'AbortError') setReviewError(error?.message || 'Could not load the saved Visit. Your draft has been kept.');
    } finally { if (current()) { setReviewing(false); setReloading(false); } }
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isSaving && !reloading && !document.querySelector('[data-clinical-chart-dialog]')) closeForm(); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isSaving, reloading]);

  useEffect(() => {
    if (!visit?.id || !canViewHistory || activeTab !== 'history') return;
    const auditQuery = query(collection(db, 'audit_logs'), where('resourceId', '==', visit.id), where('resource', '==', 'Visit'), orderBy('timestamp', 'desc'), limit(50));
    void getDocs(auditQuery).then(snapshot => setLogs(snapshot.docs.map(document => ({ id: document.id, ...document.data() } as any))))
      .catch(error => console.error('Failed to load visit audit logs:', error));
  }, [activeTab, canViewHistory, visit?.id]);

  const isSlotAvailable = (time: string) => {
    if (!branchId || !selectedDate) return false;
    const leadDoctorId = availablePerformers.find(user => user.id === performedByUserId && user.role === 'doctor')?.id;
    const reservedDoctorIds = [effectiveDoctorId, leadDoctorId].filter(Boolean);
    if (!reservedDoctorIds.length) return true;
    const dateTime = `${selectedDate}T${time}`;
    const visitConflict = visits.some(item => item.id !== savedVisitId.current && item.isArchived !== true && reservedDoctorIds.some(id => item.doctorId === id || (item.performedByRoleSnapshot === 'doctor' && item.performedByUserId === id)) && item.visitDate?.slice(0, 16) === dateTime && item.status !== 'Cancelled');
    const appointmentConflict = appointments.some(item => item.id !== appointment?.id && item.id !== visit?.appointmentId && item.isArchived !== true && reservedDoctorIds.includes(item.doctorId) && item.appointmentDate?.slice(0, 16) === dateTime && !['Cancelled', 'No Show'].includes(item.status));
    return !visitConflict && !appointmentConflict;
  };

  const selectPatient = (patient: any) => {
    setPatientId(patient.id);
    setPatientSearch('');
    setIsPatientMenuOpen(false);
    clearError('patientId');
  };

  const handleBranchChange = (nextBranchId: string) => {
    if (nextBranchId !== branchId) { inheritedService.current = false; clearSpecialForContext(); }
    if (nextBranchId !== branchId && !visit?.serviceId && serviceChoice.kind === 'selected') setCurrentServiceChoice({ kind: 'unchanged' });
    setBranchId(nextBranchId);
    clearError('branchId');
    if (!doctors.some(doctor => doctor.id === doctorId && doctor.assignedBranches?.includes(nextBranchId))) setDoctorId('');
    if (!users.some(user => user.id === performedByUserId && isEligibleVisitPerformer(user, nextBranchId))) {
      setPerformedByUserId('');
      setPerformerChanged(true);
    }
  };

  const changeDoctor = (nextDoctorId: string) => {
    setDoctorId(nextDoctorId);
    clearError('doctorId');
    clearError('visitDate');
    if (!performerChanged && !visit?.performedByUserId) setPerformedByUserId(nextDoctorId);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || sealed || reloading || visitConflict || bookingConflict) return;
    const actorProfile = users.find(user => user.id === auth.currentUser?.uid || user.email === auth.currentUser?.email);
    if (!uiRecordPermission(actorProfile || userRole, 'visitHistory', visit ? 'update' : 'create')) {
      setSaveError('You are not authorized to save this visit.');
      return;
    }
    const visitDate = selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : '';
    const validationErrors: Record<string, string> = {};
    let specialPriceCommand: string | null | undefined;
    if (specialPriceChanged) {
      try { specialPriceCommand = parseAppointmentSpecialPrice(specialPrice); }
      catch (error: any) { validationErrors.specialPrice = error.message; }
    }
    if (sessionUsage && !sessionUsage.valid) validationErrors.sessionUsage = 'Choose a matching package balance and a whole session count within its remaining balance.';
    if (serviceUnresolved) validationErrors.serviceSelection = serviceChoice.kind === 'selected' && serviceChoice.verificationPending
      ? 'The booked Service is still being checked. Please wait or choose another Service.'
      : 'Confirm an eligible performed Service, choose another, or explicitly remove it before saving.';
    if (!patientId || !selectedPatient) validationErrors.patientId = 'Select a patient from the results.';
    if (!branchId) validationErrors.branchId = 'Select the clinic for this visit.';
    if (!retainedPerformer && !availablePerformers.some(user => user.id === performedByUserId)) {
      validationErrors.performedByUserId = 'Select an active doctor, nurse or medical staff member for this clinic.';
    }
    if (assistingStaffText.length > ASSISTING_STAFF_MAX_LENGTH && (!visit || assistingStaffText !== (visit.assistingStaffText || ''))) {
      validationErrors.assistingStaffText = `Use ${ASSISTING_STAFF_MAX_LENGTH} characters or fewer for assisting staff.`;
    }
    if (!selectedDate) validationErrors.visitDate = 'Select the visit date.';
    if (!selectedTime) validationErrors.visitDate = 'Select an available time slot.';
    if (!visitType) validationErrors.visitType = 'Select the visit type.';
    if (selectedTime && !isSlotAvailable(selectedTime)) validationErrors.visitDate = 'This time slot is no longer available. Choose another slot.';
    if (appointment?.visitHistoryCreated && !savedVisitId.current) validationErrors.visitDate = 'A visit record has already been created for this appointment.';
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      setSaveError('Review the highlighted fields before saving.');
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-visit-field="${Object.keys(validationErrors)[0]}"]`)?.focus());
      return;
    }

    setErrors({});
    setSaveError('');
    setServiceSaveNotice('');
    setIsSaving(true);
    const submittedVisitId = savedVisitId.current, submittedVisitVersion = openedVersion.current;
    const submittedIntent = serviceIntent.current;
    const submittedChoice = submittedIntent.choice;
    const visitData = {
      ...(savedVisitId.current ? { expectedVisitVersion: openedVersion.current } : {}),
      ...(!savedVisitId.current && appointment ? { expectedBookingContext: expectedBookingContext(booked) } : {}),
      ...(specialPriceChanged ? { specialPrice: specialPriceCommand } : {}),
      ...(sessionUsage ? { sessionUsage: { commandId: sessionUsage.commandId, lineId: sessionUsage.lineId, sessions: sessionUsage.sessions, expectedLineVersion: sessionUsage.expectedLineVersion, expectedUsageVersion: 0 }, ...(!savedVisitId.current ? { clientVisitId: clientVisitId.current } : {}) } : {}),
      ...(submittedChoice.kind === 'unchanged' ? {} : { serviceSelection: submittedChoice.kind === 'removed' ? null : { serviceId: submittedChoice.serviceId, expectedVersion: submittedChoice.expectedVersion } }),
      // Untouched historical records keep their original provider representation.
      ...(!visit || performerChanged || !retainedPerformer ? { performedByUserId } : {}),
      ...(!visit || assistingStaffText !== (visit.assistingStaffText || '') ? { assistingStaffText } : {}),
      patientId, visitDate, branchId,
      // A previously unassigned booking keeps its booking assignment. The server
      // derives a Visit doctor only when the actual lead is a doctor.
      doctorId: effectiveDoctorId || null,
      visitType, treatmentService, mainConcern, notes, diagnosis, treatmentPlan, visitOutcome: outcome, followUpRequired, nextVisitDate, followUpInstructions, appointmentId: visit?.appointmentId || appointment?.id || null,
    };
    const controller = new AbortController(), generation = saveLifetime.current.generation;
    saveLifetime.current.request = controller;
    const current = () => saveLifetime.current.active && saveLifetime.current.generation === generation
      && saveLifetime.current.request === controller && !controller.signal.aborted;
    const currentIntent = () => current() && serviceIntent.current.revision === submittedIntent.revision;
    // Authorization belongs to the protected scope, even if Service intent changes.
    // Keep the adapter's 401/403 invalidation guard separate from UI intent checks.
    const requestScope = { signal: controller.signal, current };
    try {
      const saved = savedVisitId.current ? await updateVisitRecord(savedVisitId.current, visitData, requestScope) : await createVisitRecord(visitData, requestScope);
      if (!current()) return;
      if (!saved.id) throw new Error('The server did not confirm the visit record. Please try again.');
      // A successful create already exists on the server. Preserve its identity so
      // saving the newer draft updates it instead of creating a second Visit.
      savedVisitId.current = saved.id;
      if (!Number.isSafeInteger(saved.visitVersion) || Number(saved.visitVersion) < 0
        || (submittedVisitId && saved.visitVersion !== Number(submittedVisitVersion) + 1)) {
        setVisitConflict(true);
        setSaveError('The server confirmed this Visit but not its version. Your draft has been kept. Review the saved Visit before saving again.');
        return;
      }
      openedVersion.current = saved.visitVersion!;
      if (!currentIntent()) {
        setServiceSaveNotice('The submitted Visit was saved. Your newer Service choice is still unsaved; save again to apply it.');
        return;
      }
      if (followUpRequired && confirm('The visit has been saved. Would you like to create the recommended follow-up appointment now?')) {
        try {
          const defaultDate = getActiveDatePrefix(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const leadDoctorId = availablePerformers.find(user => user.id === performedByUserId && user.role === 'doctor')?.id;
          await createAppointmentRecord({ patientId, branchId, doctorId: effectiveDoctorId || leadDoctorId || null, appointmentDate: `${nextVisitDate || defaultDate}T10:00`, status: 'Scheduled', visitType: 'Follow-up', mainConcern: '', notes: followUpInstructions }, requestScope);
          if (!currentIntent()) return;
          alert('Follow-up appointment created.');
        } catch (followUpError: any) {
          if (!currentIntent() || followUpError.name === 'AbortError') return;
          console.error('Visit saved, but follow-up creation failed:', followUpError);
          alert(`The visit was saved, but the follow-up appointment was not created: ${followUpError?.message || 'Please try again from Appointments.'}`);
        }
      }
      if (!currentIntent()) return;
      onSave();
      onClose();
    } catch (error: any) {
      if (!current() || error.name === 'AbortError') return;
      if (['VISIT_VERSION_CHANGED', 'VISIT_VERSION_REQUIRED', 'VISIT_VERSION_INVALID'].includes(error.code)) {
        setVisitConflict(true); setSavedReview(null); setReloadConfirmation(false);
        setSaveError(error.message); return;
      }
      if (['APPOINTMENT_BOOKING_CHANGED', 'APPOINTMENT_BOOKING_REVIEW_REQUIRED'].includes(error.code)) {
        setBookingConflict(true); setBookingReview(null); setBookingReviewError(''); setSaveError(error.message); return;
      }
      if (!currentIntent()) return;
      if (error.code === 'SERVICE_VERSION_CHANGED') requireServiceReview();
      if (sessionUsage && (!error.status || error.status >= 500 || error.code === 'CREATE_RETRY_CHANGED')) {
        setSessionRetryLocked(true);
        setServiceSaveNotice(error.code === 'CREATE_RETRY_CHANGED'
          ? 'This Visit may already exist. Close and reload Visit history to review the saved record before making changes.'
          : 'The save result is uncertain. This submitted draft is fixed so Retry can safely reuse the same Visit and session command. Close and reopen to inspect the saved record before making changes.');
      }
      console.error('Error saving visit:', error);
      setSaveError(error?.message || 'The visit could not be saved. Please try again.');
    } finally {
      if (current()) setIsSaving(false);
    }
  };

  return (
    <><div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4 animate-fade-in">
      <form noValidate onSubmit={handleSubmit} aria-labelledby="visit-form-title" className="relative z-[101] max-h-[92vh] w-full max-w-5xl space-y-6 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl sm:p-7">
        <header className="-mx-5 -mt-5 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:-mx-7 sm:-mt-7 sm:px-7">
          <div><h2 id="visit-form-title" className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{visit ? 'Edit visit' : 'Add visit'}</h2><p className="mt-1 text-sm text-slate-500">{appointment ? 'Complete the linked appointment and record the clinical visit.' : visit ? 'Update the visit record and save verified changes.' : 'Record a completed walk-in visit in the shared patient record.'}</p></div>
          <button type="button" aria-label="Close visit form" onClick={closeForm} disabled={isSaving || reloading} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </header>

        {visit?.id && uiCan(userRole, 'clinical.view') && uiCan(userRole, 'visits.view') && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3"><p className="text-xs text-teal-900">Charting uses this saved Visit. Save Visit changes before updating its chart.</p><button type="button" disabled={isSaving || reloading} onClick={() => { if (!isSaving && !reloading) setShowChart(true); }} className="min-h-9 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white">Open chart</button></div>}
        {sealed && <p role="status" className="text-sm text-amber-700">This archived, signed or finalized Visit is read-only. Visit record amendments are not configured.</p>}
        {saveError && <div role="alert" aria-live="polite" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{saveError}</div>}
        {visitConflict && <section aria-label="Visit save conflict" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
          <p className="font-semibold">Your unsaved notes and other changes are still in this form.</p>
          <p>Review what was saved. Reloading replaces this draft; it does not merge or overwrite the saved Visit.</p>
          <button type="button" disabled={reviewing || reloading} onClick={() => void reviewSavedVisit()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold text-teal-800 disabled:opacity-50">{reviewing && !reloading ? 'Loading saved Visit…' : 'Review saved Visit'}</button>
          {reviewError && <p role="alert" className="text-rose-700">{reviewError}</p>}
          {savedReview && <div className="space-y-3 rounded-lg border border-amber-200 bg-white p-3">
            <h3 className="font-semibold">Latest saved Visit</h3>
            <p className="text-xs text-slate-600">{formatDateTime(savedReview.visitDate)} · {branches.find(branch => branch.id === savedReview.branchId)?.branchName || 'Recorded clinic'} · {savedReview.serviceNameSnapshot || savedReview.treatmentService || savedReview.visitType}</p>
            {savedReview.updatedBy && <p className="text-xs text-slate-600">Last saved by {savedReview.updatedBy}{savedReview.updatedAt ? ' · ' + formatDateTime(savedReview.updatedAt) : ''}</p>}
            <dl className="grid gap-3 sm:grid-cols-2">{[['Clinical notes', 'notes'], ['Diagnosis', 'diagnosis'], ['Treatment plan', 'treatmentPlan'], ['Main concern', 'mainConcern'], ['Assisting staff', 'assistingStaffText'], ['Follow-up instructions', 'followUpInstructions']].map(([label, field]) => <div key={field} className="min-w-0"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{typeof savedReview[field] === 'string' ? savedReview[field] || 'Not recorded' : savedReview[field] == null ? 'Not recorded' : 'Previously recorded non-text content'}</dd></div>)}</dl>
            <p className="text-xs text-slate-600">Saved Visit quote: {readVisitPriceQuote(savedReview)?.total != null ? priceLabel(readVisitPriceQuote(savedReview)!.total!) : 'Price not set'}</p>
            {!reloadConfirmation ? <button type="button" disabled={reviewing || reloading} onClick={() => setReloadConfirmation(true)} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">Reload saved Visit</button> : <div className="space-y-2 border-t border-amber-200 pt-3"><p>Reloading will discard your unsaved notes and all other draft changes. Keep or copy anything you need before continuing.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={reloading} onClick={() => setReloadConfirmation(false)} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">Keep my draft</button><button type="button" disabled={reviewing || reloading} onClick={() => void reviewSavedVisit(true)} className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white">{reloading ? 'Reloading…' : 'Discard draft and reload'}</button></div></div>}
          </div>}
        </section>}
        {bookingConflict && <section aria-label="Booking review required" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">The appointment booking changed. Your unsaved notes and Special Price are still in this form.</p>
          <p>Review the latest booking before saving this Visit. A deliberately changed performed Service is kept.</p>
          <button type="button" disabled={bookingReviewLoading || isSaving} onClick={() => void reviewBooking()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold text-teal-800 disabled:opacity-50">{bookingReviewLoading ? 'Loading latest booking…' : 'Review latest booking'}</button>
          {bookingReviewError && <p role="alert" className="text-rose-700">{bookingReviewError}</p>}
          {bookingReview && <div className="space-y-2 rounded-lg border border-amber-200 bg-white p-3">
            <h3 className="font-semibold">Latest saved booking</h3>
            <p>Booked Service: {bookingReview.serviceId ? bookingReview.serviceNameSnapshot || 'Recorded Service' : 'No Service'}</p>
            <p>Saved booking quote: {readAppointmentBookingQuote(bookingReview)?.total != null ? priceLabel(readAppointmentBookingQuote(bookingReview)!.total!) : bookedSpecialPrice(bookingReview) ? priceLabel(bookedSpecialPrice(bookingReview)) : 'Price not set'}</p>
            <button type="button" disabled={bookingReviewLoading || isSaving} onClick={useReviewedBooking} className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white">Use reviewed booking</button>
          </div>}
        </section>}
        {serviceSaveNotice && <p role="status" className="text-sm text-teal-700">{serviceSaveNotice}</p>}
        {visit && canViewHistory && <div className="inline-flex rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setActiveTab('form')} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === 'form' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Details</button><button type="button" onClick={() => setActiveTab('history')} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>History</button></div>}

        {activeTab === 'history' ? <section className="space-y-3"><h3 className="text-base font-bold text-slate-900">Visit history</h3>{logs.length ? logs.map(log => <article key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><div className="flex justify-between gap-3 text-xs text-slate-500"><span>{formatDateTime(log.timestamp)}</span><span className="font-bold text-teal-700">{log.action}</span></div><p className="mt-2 text-slate-700">{log.details}</p><p className="mt-2 text-xs text-slate-500">Updated by {log.userName || log.userEmail || 'Unknown user'}</p></article>) : <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No recorded visit changes.</p>}</section> : (
          <fieldset disabled={sealed || isSaving || sessionRetryLocked || reloading} className="grid gap-8 md:grid-cols-2">
            <section className="space-y-4"><div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Visit information</h3><p className="mt-0.5 text-xs text-slate-500">Patient, clinic, provider, and completed visit time.</p></div>
              {appointment && <p className="rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-2.5 text-xs font-medium text-teal-800">This visit keeps the booked patient, clinic, doctor assignment and schedule. Record who actually performed the visit below.</p>}
              <div className="relative space-y-1.5"><label htmlFor="visit-patient" className="text-xs font-semibold text-slate-600">Patient <span className="text-rose-500">*</span></label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id="visit-patient" data-visit-field="patientId" aria-invalid={Boolean(errors.patientId)} disabled={isAppointment || Boolean(visit)} value={patientId ? (selectedPatient?.name || '') : patientSearch} onChange={event => { setPatientSearch(event.target.value); setPatientId(''); setIsPatientMenuOpen(true); clearError('patientId'); }} onFocus={() => setIsPatientMenuOpen(true)} placeholder="Search name, ID or mobile number" autoComplete="off" className={fieldClass('patientId', `h-[42px] pl-9 ${(isAppointment || visit) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)} /></div>{selectedPatient && <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{selectedPatient.name}</p><p className="mt-0.5 text-xs text-slate-500">{selectedPatient.patientID || 'Patient record'}{selectedPatient.contactNumber ? ` · ${selectedPatient.contactNumber}` : ''}</p></div>{!isAppointment && !visit && <button type="button" onClick={() => { setPatientId(''); setPatientSearch(''); setIsPatientMenuOpen(false); }} className="shrink-0 text-xs font-bold text-teal-700 transition hover:text-teal-900">Change</button>}</div>}{errors.patientId && <p className="text-xs font-medium text-rose-600">{errors.patientId}</p>}{isPatientMenuOpen && !patientId && patientSearch.trim() && <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">{visiblePatients.length ? visiblePatients.map(patient => <button key={patient.id} type="button" onMouseDown={event => event.preventDefault()} onClick={() => selectPatient(patient)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 text-left text-sm last:border-0 hover:bg-slate-50"><span className="font-semibold text-slate-800">{patient.name}</span><span className="shrink-0 text-xs text-slate-500">{patient.patientID || 'No ID'}</span></button>) : <p className="px-3 py-3 text-sm text-slate-500">No active patients match this search.</p>}</div>}</div>
              <div className="space-y-1.5"><label htmlFor="visit-branch" className="text-xs font-semibold text-slate-600">Clinic <span className="text-rose-500">*</span></label><select id="visit-branch" data-visit-field="branchId" value={branchId} onChange={event => handleBranchChange(event.target.value)} disabled={isAppointment || bindingLocked} className={fieldClass('branchId', `h-[42px] ${isAppointment ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">Select clinic</option>{branches.filter(branch => branch.status === 'Active' || branch.id === (visit?.branchId || appointment?.branchId || '')).map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}</select>{errors.branchId && <p className="text-xs font-medium text-rose-600">{errors.branchId}</p>}</div>
              <div className="space-y-1.5"><label htmlFor="visit-doctor" className="text-xs font-semibold text-slate-600">{isAppointment ? 'Booked doctor (optional)' : 'Doctor (optional)'}</label><select id="visit-doctor" data-visit-field="doctorId" value={doctorId} onChange={event => changeDoctor(event.target.value)} disabled={isSaving || isAppointment || !branchId || bindingLocked} className={fieldClass('doctorId', `h-[42px] ${(isAppointment || !branchId) ? 'cursor-not-allowed bg-slate-50 text-slate-500' : ''}`)}><option value="">Unassigned</option>{historicalDoctorId && !availableDoctors.some(doctor => doctor.id === historicalDoctorId) && <option value={historicalDoctorId}>{historicalDoctorName} (recorded)</option>}{availableDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.fullName || doctor.name}</option>)}</select>{errors.doctorId && <p className="text-xs font-medium text-rose-600">{errors.doctorId}</p>}</div>
              <div className="space-y-1.5">
                <label htmlFor="visit-performed-by" className="text-xs font-semibold text-slate-600">Performed by <span className="text-rose-500">*</span></label>
                <select id="visit-performed-by" data-visit-field="performedByUserId" aria-invalid={Boolean(errors.performedByUserId)} aria-describedby="visit-performed-by-hint" value={performedByUserId} disabled={isSaving || !branchId || bindingLocked} onChange={event => { setPerformedByUserId(event.target.value); setPerformerChanged(true); clearError('performedByUserId'); clearError('visitDate'); }} className={fieldClass('performedByUserId', 'h-[42px]')}>
                  <option value="">{visit && !originalPerformerId ? 'Not recorded — historical Visit' : !branchId ? 'Select a clinic first' : needsOwnDoctorPerformer ? 'Select yourself as the performer' : 'Select doctor, nurse or medical staff'}</option>
                  {historicalPerformer && <option value={originalPerformerId}>{visitPerformerName(visit, users)} (recorded)</option>}
                  {availablePerformers.map(user => <option key={user.id} value={user.id}>{retainedPerformer && user.id === originalPerformerId && visit?.performedByUserId ? `${visitPerformerName(visit, users)} (recorded)` : visitPerformerLabel(user)}</option>)}
                </select>
                <p id="visit-performed-by-hint" className="text-xs text-slate-600">{needsOwnDoctorPerformer ? 'Your Doctor access allows you to record this visit with yourself as the lead. An authorized clinical or administrative recorder can record a nurse-led visit.' : 'Select the person who led this visit. This is separate from the booked doctor and the person recording the Visit.'}</p>
                {!availablePerformers.length && !sealed && <p className="text-xs text-amber-700">No eligible active performers are listed for this clinic. Ask an administrator to review staff designation and clinic assignment.</p>}
                {errors.performedByUserId && <p className="text-xs font-medium text-rose-600">{errors.performedByUserId}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="visit-assisting-staff" className="text-xs font-semibold text-slate-600">Assisting staff (optional)</label>
                <textarea id="visit-assisting-staff" data-visit-field="assistingStaffText" value={assistingStaffText} disabled={isSaving || bindingLocked} onChange={event => { setAssistingStaffText(event.target.value); clearError('assistingStaffText'); }} maxLength={ASSISTING_STAFF_MAX_LENGTH} rows={2} aria-describedby="visit-assisting-staff-hint" aria-invalid={Boolean(errors.assistingStaffText)} placeholder="e.g. Maria Santos, John Cruz, Ana Reyes" className={fieldClass('assistingStaffText', 'p-3')} />
                <p id="visit-assisting-staff-hint" className="text-xs text-slate-600">Enter additional staff names, separated by commas. Names are descriptive and do not assign accounts or grant access.</p>
                {errors.assistingStaffText && <p className="text-xs font-medium text-rose-600">{errors.assistingStaffText}</p>}
              </div>
              <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-600">Visit date <span className="text-rose-500">*</span></label><div data-visit-field="visitDate" tabIndex={-1}><CustomDatePicker value={selectedDate} onChange={date => { setSelectedDate(date); clearError('visitDate'); }} disabled={isAppointment || !branchId || bindingLocked} className={errors.visitDate ? 'border-rose-300 bg-rose-50/30' : ''} /></div>{errors.visitDate && <p className="text-xs font-medium text-rose-600">{errors.visitDate}</p>}</div>
              <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-semibold text-slate-600">Time slot <span className="text-rose-500">*</span></label>{branchId && selectedDate && <span className="text-[11px] text-slate-400">Times shown in clinic time</span>}</div>{!branchId ? <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-medium text-amber-700">Select a clinic to view visit times.</p> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-2"><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{timeSlots.map(time => { const available = isSlotAvailable(time); const selected = selectedTime === time; return <button key={time} type="button" disabled={isAppointment || !available || bindingLocked} onClick={() => { setSelectedTime(time); clearError('visitDate'); }} className={`rounded-lg border px-1 py-2 text-[11px] font-bold transition ${selected ? 'border-teal-600 bg-teal-600 text-white' : available ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-500 hover:bg-teal-50' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'}`}>{formatSlot(time)}</button>; })}</div></div>}</div>
            </section>
            <section className="space-y-6"><section className="space-y-4"><div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Clinical intake</h3><p className="mt-0.5 text-xs text-slate-500">Visit type, clinical findings, and treatment notes.</p></div><div className="space-y-1.5"><label htmlFor="visit-type" className="text-xs font-semibold text-slate-600">Visit type <span className="text-rose-500">*</span></label><select id="visit-type" data-visit-field="visitType" value={visitType} onChange={event => { setVisitType(event.target.value); clearError('visitType'); }} className={fieldClass('visitType', 'h-[42px]')}>{['Initial Consultation', 'Follow-up', 'Treatment Session', 'Assessment'].map(type => <option key={type} value={type}>{type}</option>)}</select>{errors.visitType && <p className="text-xs font-medium text-rose-600">{errors.visitType}</p>}</div>{booked?.serviceId && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">Booked Service: {booked.serviceNameSnapshot || 'Historical Service'} · {booked.serviceDurationMinutesSnapshot ?? 'Unknown'} min · v{booked.serviceCatalogueVersion ?? 'Unknown'}. The appointment booking remains unchanged.</p>}
              {booked && !booked.serviceId && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">Booked Service: No Service. Choose a performed Service only if one was provided.</p>}
              <AppointmentServicePicker key={branchId} fieldId="visit-service" label="Performed Service (optional)" branchId={branchId} readOnly={sealed || bindingLocked} recorded={visit} choice={serviceChoice} onChange={changeService} onBookedVerified={setCurrentServiceChoice} onReviewRequired={requireServiceReview} unresolved={serviceUnresolved} error={errors.serviceSelection} />
              <section aria-label="Visit pricing" className="space-y-4 rounded-xl border border-slate-200 p-3">
                {booked && <p className="text-xs text-slate-600">Saved booking quote: {bookedQuote?.total != null ? priceLabel(bookedQuote.total) : bookedSpecialPrice(booked) ? priceLabel(bookedSpecialPrice(booked)) : 'Price not set'}. Visit pricing is recorded separately.</p>}
                <div className="space-y-1.5">
                  <label htmlFor="visit-special-price" className="text-xs font-semibold text-slate-600">Special Price:</label>
                  <div className="relative"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">₱</span><input id="visit-special-price" data-visit-field="specialPrice" type="text" inputMode="decimal" maxLength={32} value={specialPrice} disabled={sealed || isSaving || sessionRetryLocked} aria-invalid={Boolean(errors.specialPrice)} aria-describedby="visit-special-price-hint" onChange={event => { if (sealed || isSaving || sessionRetryLocked) return; setSpecialPrice(event.target.value); setSpecialPriceChanged(true); setSpecialPriceNotice(false); clearError('specialPrice'); setSaveError(''); }} placeholder="Optional amount" className={fieldClass('specialPrice', 'h-[42px] pl-7')} /></div>
                  <p id="visit-special-price-hint" className="text-xs text-slate-600">Overrides the Service price for this Visit quote. Leave blank to use the Service price. ₱0 means Free.</p>
                  {specialPriceNotice && <p role="status" className="text-xs text-amber-700">Special Price cleared because the performed Service or clinic changed. Enter it again if it still applies.</p>}
                  {errors.specialPrice && <p className="text-xs text-rose-600">{errors.specialPrice}</p>}
                </div>
                <section aria-label="Visit Price Summary" data-visit-price-summary="true" className="space-y-3 border-t border-slate-200 pt-4">
                  <h4 className="text-sm font-semibold text-slate-800">Visit Price Summary</h4>
                  <dl className="space-y-2 text-sm">
                    <div data-visit-price-row="servicePrice" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-slate-600">Service price</dt><dd className="font-medium tabular-nums text-slate-800">{visitPrice.servicePrice === null ? 'Price not set' : priceLabel(visitPrice.servicePrice)}</dd></div>
                    <div data-visit-price-row="specialPrice" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-slate-600">Special Price</dt><dd className="font-medium tabular-nums text-slate-800">{visitPrice.invalid ? 'Invalid amount' : visitPrice.specialPrice === null ? 'Not entered' : priceLabel(visitPrice.specialPrice)}</dd></div>
                    <div data-visit-price-row="total" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-slate-200 pt-2"><dt className="font-semibold text-slate-800">Visit total (quote)</dt><dd aria-live="polite" aria-atomic="true" className="font-semibold tabular-nums text-slate-900">{visitPrice.invalid ? 'Enter a valid Special Price' : visitPrice.total === null ? 'Price not set' : priceLabel(visitPrice.total)}</dd></div>
                  </dl>
                  <p className="text-xs text-slate-600">This quote is saved with the Visit. Payments and package session usage are recorded separately.</p>
                </section>
              </section>
              <VisitSessionUsagePicker patientId={patientId} branchId={branchId} serviceId={effectiveServiceId} visitId={visit?.id} visitDate={`${selectedDate}T${selectedTime}`} disabled={sealed || isSaving || sessionRetryLocked} readOnly={sealed} serviceUnresolved={serviceUnresolved} userRole={userRole} value={sessionUsage} onChange={setSessionUsage} onBinding={(active, loading) => setSessionBinding({ active, loading })} />
              {errors.sessionUsage && <p role="alert" className="text-xs text-rose-700">{errors.sessionUsage}</p>}
              {showRecordedTreatment && <div className="space-y-1.5"><label htmlFor="visit-legacy-service" className="text-xs font-semibold text-slate-600">Previously recorded treatment</label><input id="visit-legacy-service" value={treatmentService} onChange={event => setTreatmentService(event.target.value)} readOnly={Boolean(visit?.serviceId) || serviceChoice.kind === 'selected'} className={fieldClass('treatmentService', 'h-[42px]')} /><p className="text-xs text-slate-500">Saved treatment text is preserved when you edit other details. Choose a Service above for a new selection.</p></div>}<div className="space-y-1.5"><label htmlFor="visit-concern" className="text-xs font-semibold text-slate-600">Main concern</label><textarea id="visit-concern" value={mainConcern} onChange={event => setMainConcern(event.target.value)} maxLength={2000} rows={3} placeholder="Describe the reason for this visit" className={fieldClass('mainConcern', 'p-3')} /></div><div className="space-y-1.5"><label htmlFor="visit-diagnosis" className="text-xs font-semibold text-slate-600">Diagnosis</label><textarea id="visit-diagnosis" value={diagnosis} onChange={event => setDiagnosis(event.target.value)} maxLength={3000} rows={3} placeholder="Record the diagnosis or assessment" className={fieldClass('diagnosis', 'p-3')} /></div><div className="space-y-1.5"><label htmlFor="visit-plan" className="text-xs font-semibold text-slate-600">Treatment plan</label><textarea id="visit-plan" value={treatmentPlan} onChange={event => setTreatmentPlan(event.target.value)} maxLength={5000} rows={3} placeholder="Record the agreed treatment plan" className={fieldClass('treatmentPlan', 'p-3')} /></div><div className="space-y-1.5"><label htmlFor="visit-notes" className="text-xs font-semibold text-slate-600">Clinical notes</label><textarea id="visit-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={5000} rows={4} placeholder="Add relevant clinical or aftercare notes" className={fieldClass('notes', 'p-3')} /></div>{visit && <FileAttachmentSection patientId={patientId} appointmentId={visit.appointmentId || null} visitId={visit.id} />}</section>
              <section className="space-y-4"><div className="border-b border-slate-200 pb-3"><h3 className="text-base font-bold text-slate-900">Outcome & follow-up</h3><p className="mt-0.5 text-xs text-slate-500">Close the visit and optionally plan the next appointment.</p></div><div className="space-y-1.5"><label htmlFor="visit-outcome" className="text-xs font-semibold text-slate-600">Outcome</label><select id="visit-outcome" value={outcome} onChange={event => setOutcome(event.target.value)} className={fieldClass('visitOutcome', 'h-[42px]')}><option value="">Select outcome</option><option value="Completed">Completed</option></select></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={followUpRequired} onChange={event => setFollowUpRequired(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />Follow-up required</label>{followUpRequired && <div className="space-y-4 rounded-xl border border-teal-100 bg-teal-50/40 p-3"><div className="space-y-1.5"><label className="text-xs font-semibold text-slate-600">Recommended follow-up date</label><CustomDatePicker value={nextVisitDate} onChange={setNextVisitDate} min={getActiveDatePrefix()} /></div><div className="space-y-1.5"><label htmlFor="visit-follow-up-instructions" className="text-xs font-semibold text-slate-600">Follow-up instructions</label><textarea id="visit-follow-up-instructions" value={followUpInstructions} onChange={event => setFollowUpInstructions(event.target.value)} maxLength={2000} rows={3} placeholder="Add instructions for the next visit" className={fieldClass('followUpInstructions', 'p-3')} /></div></div>}</section>
            </section>
          </fieldset>
        )}
        <footer className="-mx-5 -mb-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:-mx-7 sm:-mb-7 sm:flex-row sm:justify-end sm:px-7"><button type="button" onClick={closeForm} disabled={isSaving || reloading} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">Cancel</button>{activeTab === 'form' && <button type="submit" disabled={isSaving || sealed || reloading || visitConflict || bookingConflict || serviceUnresolved} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">{isSaving ? <><Clock3 className="h-4 w-4 animate-spin" />Saving…</> : <><CheckCircle2 className="h-4 w-4" />{visit ? 'Save changes' : 'Save visit'}</>}</button>}</footer>
      </form>
    </div>{showChart && visit?.id && <ClinicalChartModal visit={visit} users={users} userRole={userRole} onClose={() => setShowChart(false)} />}</>
  );
}

// Only a confirmed, successful reload replaces a draft. Scope changes remount
// this boundary; ordinary record polling never changes its opened save version.
function VisitDraftBoundary(props: VisitFormProps) {
  const [replacement, setReplacement] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  return <VisitFormWorkspace key={revision} {...props} visit={replacement || props.visit}
    onReloadVisit={record => { setReplacement(record); setRevision(value => value + 1); }} />;
}

// New linked drafts must start from an authorized, fresh booking, rather than
// the appointment object captured when its action menu was opened.
function VisitBookingBoundary(props: VisitFormProps) {
  const needsBooking = !props.visit && Boolean(props.appointment?.id);
  const [record, setRecord] = useState<any>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    if (!needsBooking) return;
    const controller = new AbortController(); let active = true;
    const current = () => active && !controller.signal.aborted;
    setRecord(null); setError('');
    void getAppointmentRecord(props.appointment.id, { signal: controller.signal, current }).then(latest => {
      if (!current()) return;
      expectedBookingContext(latest);
      if (!props.branches.some(branch => branch.id === latest.branchId)) throw new Error('You no longer have access to this booking branch.');
      if (latest.isArchived || latest.visitHistoryCreated) throw new Error('This appointment is archived or already has a Visit. Close and refresh the appointment list.');
      setRecord(latest);
    }).catch(failure => { if (current() && failure.name !== 'AbortError') setError(failure?.message || 'Could not load the latest booking.'); });
    return () => { active = false; controller.abort(); };
  }, [needsBooking, props.appointment?.id, attempt]);
  if (!needsBooking) return <VisitDraftBoundary {...props} />;
  if (record) return <VisitDraftBoundary {...props} appointment={record} />;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"><section aria-label="Load appointment booking" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : <p role="status" className="text-sm text-slate-700">Loading latest booking…</p>}
    <div className="flex flex-wrap gap-3"><button type="button" onClick={props.onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Close</button>{error && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">Retry booking load</button>}</div>
  </section></div>;
}

// Reuse the appointment scope boundary: stale transports may complete after
// abort, but old drafts/options/denials cannot affect the new workspace.
export default function VisitForm(props: VisitFormProps) {
  const user = auth.currentUser;
  const profile = user ? props.users.find(value => value.id === user.uid || value.email === user.email) : undefined;
  const branches = props.branches.filter(branch => hasAdministrativeAccess(profile?.role) || profile?.assignedBranches?.includes(branch.id));
  const scope = JSON.stringify([uiPermissionScope(profile), user?.uid ?? null, profile?.role, props.userRole, profile?.active === true,
    [...(profile?.assignedBranches || [])].sort(), branches.map(branch => [branch.id, branch.status]).sort(), props.visit?.id, props.visit?.isArchived, props.appointment?.id]);
  const [invalidatedScope, setInvalidatedScope] = useState<string | null>(null);
  useLayoutEffect(() => subscribeProtectedDataInvalidation(() => setInvalidatedScope(scope)), [scope]);
  const sourceBranch = props.visit?.branchId || props.appointment?.branchId;
  if (!profile?.active || invalidatedScope === scope || (sourceBranch && !branches.some(branch => branch.id === sourceBranch))) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"><div role="alert" className="space-y-4 rounded-2xl bg-white p-6"><p>Visit access changed. Close and reopen after your access is refreshed.</p><button type="button" onClick={props.onClose}>Close</button></div></div>;
  }
  return <VisitBookingBoundary key={scope} {...props} branches={branches} userRole={profile.role}
    appointments={props.appointments?.filter(item => branches.some(branch => branch.id === item.branchId))}
    defaultBranchId={branches.some(branch => branch.id === props.defaultBranchId) ? props.defaultBranchId : undefined} />;
}
