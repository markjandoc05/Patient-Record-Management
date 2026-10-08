import { uiCan } from '../permissionState';
import { uiRecordPermission } from '../permissionState';
import { parseEmergencyContact } from '../utils/emergencyContact';
import { findingFields, findingState, parseClinicalFindings, reportedFindingEdit } from '../utils/clinicalFindings';
import { possiblePatientDuplicates } from '../utils/patientDuplicates';
import { patientBirthLabel } from '../utils/patientBirth';
import { birthMode, parsePatientBirth } from '../utils/patientBirth';
import React, { useState, useEffect, useRef } from 'react';
import { canEditPatient, getPatientEditScope, hasPermission, Role } from '../rbac';
import { createPatientRecord, updatePatientRecord } from '../utils/recordApi';
import { getActiveDatePrefix } from '../utils/timezone';

const ErrorMessage = ({ error, id }: { error?: string; id?: string }) => {
  if (!error) return null;
  return <p id={id} className="text-rose-600 text-xs font-medium">{error}</p>;
}

export default function PatientForm({ db, user, users, patients, branches, userProfile, patient, defaultBranchId, onClose, onSave, onOpenExisting, lookupWarning }: { db: any, user: any, users: any[], patients: any[], branches: any[], userProfile: any, patient?: any, defaultBranchId?: string, onClose: () => void, onSave: () => void, onOpenExisting?: (patient: any) => void, lookupWarning?: string }) {
  const role = userProfile.role as Role;
  const editScope = getPatientEditScope(role);
  const isLimitedEdit = !!patient && editScope !== 'full';
  const canChangeHomeBranch = !patient || editScope === 'full' || editScope === 'operational';
  const [formData, setFormData] = useState({
    patientID: '',
    name: '', contactNumber: '', email: '', birthday: '', age: '', gender: 'Male', address: '', emergencyContact: '',
    dateRegistered: '',
    mainConcern: '', skinType: '', allergies: '', medications: '', medicalConditions: '',
    notes: '', status: 'Active',
    homeBranchId: '', homeBranchName: '',
    ...(patient || {}),
    birthDateStatus: birthMode(patient || {}), estimatedAge: patient?.estimatedAge ?? '',
    estimatedAgeAsOf: patient?.estimatedAgeAsOf || '', estimatedBirthYear: patient?.estimatedBirthYear ?? '',
    allergiesStatus: findingState(patient || {}, 'allergies'),
    medicationsStatus: findingState(patient || {}, 'medications'),
    medicalConditionsStatus: findingState(patient || {}, 'medicalConditions'),
    emergencyContactName: patient?.emergencyContactName || '',
    emergencyContactRelationship: patient?.emergencyContactRelationship || '',
    emergencyContactNumber: patient?.emergencyContactNumber || ''
  });

  const canSeeClinical = uiCan(role, 'clinical.view');
  const canWriteClinical = canSeeClinical && (!patient || uiCan(role, 'clinical.edit_draft'));
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ record?: any } | null>(null);
  const [acknowledgedMatches, setAcknowledgedMatches] = useState('');
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const matches = patient ? [] : possiblePatientDuplicates(formData, patients);
  const matchSignature = JSON.stringify([formData.name, formData.contactNumber, formData.email, formData.birthDateStatus, formData.birthday, matches.map(match => match.patient.id)]);
  const today = getActiveDatePrefix();
  const fieldClass = (field: string, extra = '') => `w-full border px-3 rounded-xl text-sm bg-white text-slate-800 font-medium outline-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 ${
    errors[field] ? 'border-rose-300 bg-rose-50/30' : 'border-slate-300'
  } ${extra}`;

  const closeForm = () => {
    if (isSaving) return;
    if (isDirty) setPendingClose({}); else onClose();
  };

  const setField = (field: string, value: string) => {
    setIsDirty(true);
    setFormData(previous => ({ ...previous, [field]: value }));
    setErrors(previous => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
    if (saveError) setSaveError('');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        if (pendingClose) setPendingClose(null);
        else if (isDirty) setPendingClose({});
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, isDirty, pendingClose, onClose]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
  useEffect(() => { if (pendingClose) keepEditingRef.current?.focus(); }, [pendingClose]);

  const calculateAge = (birthday: string) => {
    if (!birthday) return '';
    try { return parsePatientBirth({ birthday, birthDateStatus: 'exact' }, today).age ?? ''; }
    catch { return ''; }
  };
  const setBirthday = (value: string) => {
    setField('birthday', value);
    setFormData(previous => ({ ...previous, birthDateStatus: value ? 'exact' : 'unknown' }));
  };

  // Use the active clinic workspace as the default registration branch.
  useEffect(() => {
      if (!patient && !formData.homeBranchId) {
          const preferredBranchId = defaultBranchId || (userProfile.assignedBranches?.length === 1 ? userProfile.assignedBranches[0] : '');
          const branch = branches.find(b => b.id === preferredBranchId);
          if (branch) {
              setFormData(prev => ({ ...prev, homeBranchId: branch.id, homeBranchName: branch.branchName }));
          }
      }
  }, [branches, defaultBranchId, formData.homeBranchId, patient, userProfile.assignedBranches]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || pendingClose) return;
    setSaveError('');
    
    const name = String(formData.name || '').trim().replace(/\s+/g, ' ');
    const contactNumber = String(formData.contactNumber || '').trim();
    const contactDigits = contactNumber.replace(/\D/g, '');
    const email = String(formData.email || '').trim().toLowerCase();
    const birthday = String(formData.birthday || '');
    const age = birthday ? calculateAge(birthday) : '';
    const address = String(formData.address || '').trim();
    const mainConcern = String(formData.mainConcern || '').trim();
    const activeBranch = allowedBranches.some(branch => branch.id === formData.homeBranchId);

    const newErrors: Record<string, string> = {};
    if (!formData.homeBranchId) newErrors.homeBranchId = 'Select the clinic registering this patient.';
    else if (!activeBranch) newErrors.homeBranchId = 'The selected clinic is no longer active or available.';
    if (name.length < 2) newErrors.name = 'Enter the patient’s full name.';
    if (contactDigits.length < 7 || contactDigits.length > 15) newErrors.contactNumber = 'Enter a valid phone number with 7 to 15 digits.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = 'Enter a valid email address.';
    let birth: ReturnType<typeof parsePatientBirth> | undefined;
    try { birth = parsePatientBirth(formData, today); }
    catch (error: any) { newErrors.birthday = error.message; }
    let emergency: ReturnType<typeof parseEmergencyContact> | undefined;
    try { emergency = parseEmergencyContact(formData); }
    catch (error: any) { newErrors.emergencyContactNumber = error.message; }
    let findings: Record<string, string> = {};
    try { findings = parseClinicalFindings(formData); }
    catch (error: any) { newErrors.clinicalFindings = error.message; }
    if (!formData.gender) newErrors.gender = 'Select the patient’s gender.';
    if (canWriteClinical && (!patient || editScope === 'full') && !mainConcern) newErrors.mainConcern = 'Enter the patient’s main concern.';

    if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        setSaveError('Review the highlighted fields before saving.');
        window.requestAnimationFrame(() => {
          const firstInvalid = document.querySelector<HTMLElement>(`[data-patient-field="${Object.keys(newErrors)[0]}"]`);
          firstInvalid?.focus();
          firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return;
    }
    setErrors({});

    if (!patient) {
        const isDuplicate = formData.birthDateStatus === 'exact' && patients.some(p =>
            String(p.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === name.toLowerCase() &&
            String(p.contactNumber || '').replace(/\D/g, '') === contactDigits &&
            String(p.email || '').trim().toLowerCase() === email &&
            String(p.birthday || '') === birthday
        );
        if (isDuplicate) {
            setSaveError("A patient with these details already exists.");
            return;
        }
    }
    
    setIsSaving(true);
    if (patient) {
        if (!uiCan(role, 'patients.edit')) {
            setSaveError("You are not authorized to update patient records.");
            setIsSaving(false);
            return;
        }
    } else {
        if (!uiRecordPermission(role, 'patientRecord', 'create')) {
            setSaveError("You are not authorized to register patients.");
            setIsSaving(false);
            return;
        }
    }

    const fullRecordData = {
      name,
      contactNumber,
      email,
      ...birth!,
      gender: formData.gender,
      address,
      emergencyContact: String(formData.emergencyContact || '').trim(),
      ...emergency!,
      mainConcern,
      skinType: formData.skinType,
      ...findings,
      allergies: String(formData.allergies || '').trim(),
      medications: String(formData.medications || '').trim(),
      medicalConditions: String(formData.medicalConditions || '').trim(),
      notes: String(formData.notes || '').trim(),
      status: formData.status,
      homeBranchId: formData.homeBranchId
    };
    const demographicData = {
      name,
      contactNumber,
      email,
      ...birth!,
      gender: formData.gender,
      address,
      emergencyContact: String(formData.emergencyContact || '').trim(),
      ...emergency!
    };
    const dataToSave = patient && editScope === 'demographic'
      ? demographicData
      : patient && editScope === 'operational'
        ? { ...demographicData, homeBranchId: formData.homeBranchId, status: formData.status }
        : fullRecordData;
    
    try {
        if (patient) {
          await updatePatientRecord(patient.id, {
            ...dataToSave,
            expectedLastUpdatedAt: patient.lastUpdatedAt || null
          });
        } else {
          const savedPatient = await createPatientRecord(dataToSave);
          if (!savedPatient.id || !savedPatient.patientID) {
            throw new Error('The server did not confirm the new patient record. Please try again.');
          }
        }
        onSave();
        onClose();
    } catch (err: any) {
        console.error("Error saving patient:", err);
        setSaveError(err.message || "The patient record could not be saved. Please try again.");
    } finally {
        setIsSaving(false);
    }
  };

  const allowedBranches = branches.filter(b => b.status === 'Active');
  
  return (
    <div role="presentation" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center p-3 sm:p-4 z-[100] animate-fade-in">
      <form noValidate onSubmit={handleSubmit} aria-labelledby="patient-form-title" className="bg-white p-5 sm:p-7 rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto space-y-6 relative z-[101] shadow-2xl border border-slate-100">
        <div className="-mx-5 sm:-mx-7 -mt-5 sm:-mt-7 flex justify-between items-start gap-4 border-b border-slate-200 bg-white px-5 sm:px-7 py-5">
          <div>
            <h2 id="patient-form-title" className="text-xl sm:text-2xl font-bold text-slate-950 tracking-tight">
              {patient ? 'Edit patient' : 'Register patient'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {patient ? 'Update the patient profile and save verified changes.' : 'Create one shared patient profile that both clinic branches can access.'}
            </p>
          </div>
          <button type="button" aria-label="Close patient form" onClick={closeForm} disabled={isSaving} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {saveError && (
          <div role="alert" aria-live="polite" className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm font-medium">
            {saveError}
          </div>
        )}
        
        {pendingClose && <div role="alertdialog" aria-modal="false" aria-labelledby="patient-discard-title" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <h3 id="patient-discard-title" className="font-semibold text-slate-900">Discard unsaved patient information?</h3>
          <p className="text-sm text-slate-700">{pendingClose.record ? 'Opening the existing patient will discard the entries in this form.' : 'Your entries have not been saved. Keep editing or discard them.'}</p>
          <div className="flex flex-wrap gap-3">
            <button ref={keepEditingRef} type="button" onClick={() => setPendingClose(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Keep editing</button>
            <button type="button" onClick={() => { if (pendingClose.record) onOpenExisting?.(pendingClose.record); else onClose(); }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{pendingClose.record ? 'Discard entries and open patient' : 'Discard entries'}</button>
          </div>
        </div>}
        {!patient && lookupWarning && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-800">Existing-patient lookup could not refresh. Any matches may be out of date; an empty list does not confirm that this patient is new. Close the form and retry loading the directory.</p>}
        {!patient && matches.length > 0 && acknowledgedMatches !== matchSignature && <section aria-labelledby="patient-possible-matches" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <h3 id="patient-possible-matches" className="font-semibold text-slate-900">Possible existing patient</h3>
          <p className="text-sm text-slate-700">These details match existing records. Shared names or contacts can belong to different people. Review before registering.</p>
          <ul className="divide-y divide-amber-200">
            {matches.slice(0, 5).map(({ patient: existing, reasons }) => <li key={existing.id} className="py-3 space-y-1">
              <p className="font-semibold text-sm text-slate-900">{existing.name || 'Unnamed patient'} · {existing.patientID || existing.id}</p>
              <p className="text-xs text-slate-700">{reasons.join(' · ')}</p>
              <p className="text-xs text-slate-700">{patientBirthLabel(existing)} · {existing.contactNumber || 'No phone provided'} · {existing.homeBranchName || 'Clinic not provided'}{existing.isArchived ? ' · Archived' : existing.status === 'Inactive' ? ' · Inactive' : ''}</p>
              {onOpenExisting && <button type="button" disabled={isSaving} onClick={() => { if (isDirty) setPendingClose({ record: existing }); else onOpenExisting(existing); }} className="min-h-10 text-sm font-semibold underline disabled:opacity-50">Open existing patient {existing.patientID || existing.id}</button>}
            </li>)}
          </ul>
          {matches.length > 5 && <p className="text-sm text-slate-700">Showing 5 of {matches.length} possible matches. Use the directory to review all records.</p>}
          <button type="button" onClick={() => setAcknowledgedMatches(matchSignature)} className="min-h-10 text-sm font-semibold underline">Continue registration</button>
        </section>}

        <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
                <section className="space-y-4">
                    <div className="border-b border-slate-200 pb-3">
                      <h3 className="font-bold text-base text-slate-900">Patient information</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Identity, contact details, and registration clinic.</p>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5 col-span-2">
                            <label htmlFor="patient-home-branch" className="block text-xs font-semibold text-slate-600">Registration clinic <span className="text-rose-500">*</span></label>
                            <select 
                                id="patient-home-branch"
                                data-patient-field="homeBranchId"
                                aria-invalid={Boolean(errors.homeBranchId)}
                                aria-describedby={errors.homeBranchId ? 'patient-home-branch-error' : undefined}
                                className={fieldClass('homeBranchId', 'h-[42px]')}
                                value={formData.homeBranchId} 
                                onChange={e => {
                                    const b = branches.find(br => br.id === e.target.value);
                                    setField('homeBranchId', e.target.value);
                                    setFormData(previous => ({ ...previous, homeBranchName: b?.branchName || '' }));
                                }} 
                                disabled={!canChangeHomeBranch}
                                required
                            >
                                <option value="">Select clinic</option>
                                {allowedBranches.map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
                            </select>
                            <ErrorMessage id="patient-home-branch-error" error={errors.homeBranchId} />
                        </div>
                        {patient && editScope !== 'demographic' && (
                          <div className="space-y-1.5 col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient Status</label>
                            <select
                              className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium"
                              value={formData.status}
                              onChange={event => setField('status', event.target.value)}
                            >
                              {['Active', 'Ongoing Treatment', 'Completed', 'Inactive'].map(status => (
                                <option key={status} value={status}>{status}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        
                        <div className="space-y-1.5 col-span-2">
                            <label htmlFor="patient-generated-id" className="block text-xs font-semibold text-slate-600">Patient ID</label>
                            <input 
                                id="patient-generated-id"
                                type="text" 
                                className="w-full h-[42px] border border-slate-200 bg-slate-50 text-slate-500 px-3 rounded-xl text-sm font-medium cursor-not-allowed outline-none" 
                                value={formData.patientID || 'Auto-generated'} 
                                disabled 
                            />
                            {!patient && <p className="text-xs text-slate-400">Assigned automatically after a successful save.</p>}
                        </div>
                        
                        <div className="space-y-1.5 col-span-2">
                            <label htmlFor="patient-name" className="block text-xs font-semibold text-slate-600">Full name <span className="text-rose-500">*</span></label>
                            <input 
                                id="patient-name"
                                data-patient-field="name"
                                aria-invalid={Boolean(errors.name)}
                                aria-describedby={errors.name ? 'patient-name-error' : undefined}
                                type="text" 
                                value={formData.name} 
                                onChange={e => setField('name', e.target.value)}
                                autoComplete="name"
                                maxLength={120}
                                className={fieldClass('name', 'h-[42px]')}
                            />
                            <ErrorMessage id="patient-name-error" error={errors.name} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label htmlFor="patient-contact" className="block text-xs font-semibold text-slate-600">Mobile number <span className="text-rose-500">*</span></label>
                            <input 
                                id="patient-contact"
                                data-patient-field="contactNumber"
                                aria-invalid={Boolean(errors.contactNumber)}
                                aria-describedby={errors.contactNumber ? 'patient-contact-error' : undefined}
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                maxLength={40}
                                value={formData.contactNumber} 
                                onChange={e => setField('contactNumber', e.target.value)}
                                placeholder="e.g. +63 917 123 4567"
                                className={fieldClass('contactNumber', 'h-[42px]')}
                            />
                            <ErrorMessage id="patient-contact-error" error={errors.contactNumber} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label htmlFor="patient-email" className="block text-xs font-semibold text-slate-600">Email address (optional)</label>
                            <input 
                                id="patient-email"
                                data-patient-field="email"
                                aria-invalid={Boolean(errors.email)}
                                aria-describedby={errors.email ? 'patient-email-error' : undefined}
                                type="email" 
                                autoComplete="email"
                                maxLength={160}
                                value={formData.email} 
                                onChange={e => setField('email', e.target.value)}
                                placeholder="name@example.com"
                                className={fieldClass('email', 'h-[42px]')}
                            />
                            <ErrorMessage id="patient-email-error" error={errors.email} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label htmlFor="patient-birthday" className="block text-xs font-semibold text-slate-600">Birthday</label>
                            <input id="patient-birthday" data-patient-field="birthday" type="date" max={today} value={formData.birthday} onChange={e => setBirthday(e.target.value)} onInput={e => setBirthday(e.currentTarget.value)} aria-invalid={Boolean(errors.birthday)} aria-describedby="patient-birthday-error" className={fieldClass('birthday', 'h-[42px]')} />
                            <ErrorMessage id="patient-birthday-error" error={errors.birthday} />
                            {!formData.birthday && patient && ['estimated_age', 'estimated_year'].includes(birthMode(patient)) && <p className="text-xs text-slate-600">Previously recorded: {patientBirthLabel(patient)}</p>}
                        </div>
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label htmlFor="patient-age" className="block text-xs font-semibold text-slate-600">Age</label>
                            <input id="patient-age" type="text" value={calculateAge(formData.birthday)} readOnly className="w-full h-[42px] border border-slate-200 bg-slate-50 text-slate-700 px-3 rounded-xl text-sm" />
                        </div>

                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label htmlFor="patient-gender" className="block text-xs font-semibold text-slate-600">Gender <span className="text-rose-500">*</span></label>
                            <select 
                                id="patient-gender"
                                data-patient-field="gender"
                                aria-invalid={Boolean(errors.gender)}
                                value={formData.gender} 
                                onChange={e => setField('gender', e.target.value)}
                                className={fieldClass('gender', 'h-[42px]')}
                            >
                                <option value="">Select Gender</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                            <ErrorMessage id="patient-gender-error" error={errors.gender} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2">
                            <label htmlFor="patient-address" className="block text-xs font-semibold text-slate-600">Residential address (optional)</label>
                            <input 
                                id="patient-address"
                                data-patient-field="address"
                                aria-invalid={Boolean(errors.address)}
                                type="text" 
                                autoComplete="street-address"
                                maxLength={300}
                                value={formData.address} 
                                onChange={e => setField('address', e.target.value)}
                                className={fieldClass('address', 'h-[42px]')}
                            />
                            <ErrorMessage id="patient-address-error" error={errors.address} />
                        </div>
                        
                        <fieldset className="space-y-3 col-span-2">
                            <legend className="text-sm font-semibold text-slate-900">Emergency contact</legend>
                            <div className="space-y-1.5">
                                <label htmlFor="patient-emergency-name" className="block text-xs font-semibold text-slate-600">Contact name</label>
                                <input id="patient-emergency-name" type="text" maxLength={120} value={formData.emergencyContactName} onChange={e => setField('emergencyContactName', e.target.value)} className={fieldClass('emergencyContactName', 'h-[42px]')} />
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="patient-emergency-relationship" className="block text-xs font-semibold text-slate-600">Relationship</label>
                                <input id="patient-emergency-relationship" type="text" maxLength={80} value={formData.emergencyContactRelationship} onChange={e => setField('emergencyContactRelationship', e.target.value)} className={fieldClass('emergencyContactRelationship', 'h-[42px]')} />
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="patient-emergency-number" className="block text-xs font-semibold text-slate-600">Contact number</label>
                                <input id="patient-emergency-number" data-patient-field="emergencyContactNumber" type="tel" inputMode="tel" maxLength={40} value={formData.emergencyContactNumber} onChange={e => setField('emergencyContactNumber', e.target.value)} aria-invalid={Boolean(errors.emergencyContactNumber)} aria-describedby="patient-emergency-number-error" className={fieldClass('emergencyContactNumber', 'h-[42px]')} />
                                <ErrorMessage id="patient-emergency-number-error" error={errors.emergencyContactNumber} />
                            </div>
                            {formData.emergencyContact && <p className="text-xs text-slate-600">Previous emergency contact: {formData.emergencyContact}</p>}
                        </fieldset>

                    </div>
                </section>
            </div>
    
            {canSeeClinical && <div className="space-y-6">
                <section className="space-y-4">
                    <div className="border-b border-slate-200 pb-3">
                      <h3 className="font-bold text-base text-slate-900">Clinical intake</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Initial concern and relevant medical information.</p>
                    </div>
                    {isLimitedEdit && (
                      <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                        Clinical information is read-only for your role. A Doctor, Admin, or Support Developer must make clinical changes.
                      </p>
                    )}
                    
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label htmlFor="patient-main-concern" className="block text-xs font-semibold text-slate-600">Main concern <span className="text-rose-500">*</span></label>
                            <textarea 
                                id="patient-main-concern"
                                data-patient-field="mainConcern"
                                aria-invalid={Boolean(errors.mainConcern)}
                                maxLength={2000}
                                rows={2} 
                                value={formData.mainConcern} 
                                onChange={e => setField('mainConcern', e.target.value)}
                                disabled={isLimitedEdit || !canWriteClinical}
                                className={fieldClass('mainConcern', 'p-2.5')}
                            />
                            <ErrorMessage id="patient-main-concern-error" error={errors.mainConcern} />
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-600">Skin type</label>
                            <select 
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                value={formData.skinType} 
                                onChange={e => setField('skinType', e.target.value)}
                                disabled={isLimitedEdit || !canWriteClinical}
                            >
                                <option value="">Not assessed</option>
                                {['Oily', 'Dry', 'Combination', 'Sensitive', 'Normal'].map(type => <option key={type} value={type}>{type}</option>)}
                            </select>
                        </div>
                        
                        <div data-patient-field="clinicalFindings" tabIndex={-1} className="space-y-4">
                          <p className="text-xs text-slate-600">Record what is reported. Unknown is not a negative finding. These entries do not constitute clinician review.</p>
                          <ErrorMessage id="patient-findings-error" error={errors.clinicalFindings} />
                          {findingFields.map(field => {
                            const label = field === 'allergies' ? 'Allergies' : field === 'medications' ? 'Current medications' : 'Medical conditions';
                            return <div key={field} className="space-y-1.5">
                              <label htmlFor={`patient-${field}-details`} className="block text-xs font-semibold text-slate-600">{label}</label>
                              <textarea id={`patient-${field}-details`} rows={2} maxLength={field === 'allergies' ? 1000 : 2000} value={(formData as any)[field]} disabled={isLimitedEdit || !canWriteClinical} onChange={e => {
                                const value = e.target.value;
                                const reportedEdit = reportedFindingEdit(formData, field, value);
                                setField(field, value);
                                setFormData(previous => ({ ...previous, ...reportedEdit }));
                                setErrors(previous => { const next = { ...previous }; delete next.clinicalFindings; return next; });
                              }} className={fieldClass('clinicalFindings', 'p-2.5')} />
                            </div>;
                          })}
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-600">Notes / general observations</label>
                            <textarea 
                                className="w-full border border-slate-300 p-2.5 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                rows={2} 
                                maxLength={3000}
                                value={formData.notes} 
                                onChange={e => setField('notes', e.target.value)}
                                disabled={isLimitedEdit || !canWriteClinical}
                            />
                        </div>
                    </div>
                </section>
            </div>}
        </div>
    
        <div className="-mx-5 sm:-mx-7 -mb-5 sm:-mb-7 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 border-t border-slate-200 bg-white px-5 sm:px-7 py-4">
          <button 
            type="button" 
            onClick={closeForm}
            disabled={isSaving}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={isSaving} 
            className={`px-5 py-2.5 font-bold rounded-xl text-sm transition-all shadow-sm ${
              isSaving 
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                : 'bg-teal-600 hover:bg-teal-700 text-white hover:shadow'
            }`}
          >
            {isSaving ? 'Saving patient...' : (patient ? 'Save Changes' : 'Register Patient')}
          </button>
        </div>
      </form>
    </div>
  );
}
