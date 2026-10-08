import { uiCan } from '../permissionState';
import { clinicalFindingLabel } from '../utils/clinicalFindings';
import { birthMode, patientBirthLabel } from '../utils/patientBirth';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Images,
  MapPin,
  StickyNote,
  UserRound,
  UserX,
  X,
} from 'lucide-react';
import { formatDateTime } from '../utils';
import PatientTimeline from './PatientTimeline';
import PatientAppointments from './PatientAppointments';
import NotesTab from './NotesTab';
import AppointmentForm from './AppointmentForm';
import PatientMediaTab from './PatientMediaTab';

type ProfileTab = 'visits' | 'appointments' | 'notes' | 'media';

function displayValue(value: unknown, fallback = 'Not provided') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function DetailItem({ label, value, className = '' }: { label: string; value: unknown; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-3 ${className}`}>
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold leading-5 text-slate-800">
        {displayValue(value)}
      </dd>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-bold text-slate-900 sm:text-lg">{title}</h3>
      <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">{description}</p>
    </div>
  );
}

export default function PatientProfile({
  patient,
  onClose,
  userRole,
  users,
  branches,
  visits,
  appointments,
}: {
  patient: any;
  onClose: () => void;
  userRole?: string;
  users: any[];
  branches: any[];
  visits: any[];
  appointments: any[];
}) {
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const clinicalAccess = uiCan(userRole, 'clinical.view');
  const [activeTab, setActiveTab] = useState<ProfileTab>(clinicalAccess ? 'visits' : 'appointments');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const patientVisits = useMemo(
    () => visits
      .filter(visit => visit.patientId === patient.id && visit.isArchived !== true)
      .sort((left, right) => String(right.visitDate || '').localeCompare(String(left.visitDate || ''))),
    [patient.id, visits],
  );
  const patientAppointments = useMemo(
    () => appointments.filter(appointment => appointment.patientId === patient.id && appointment.isArchived !== true),
    [appointments, patient.id],
  );

  const lastVisit = patientVisits[0];
  const completedVisits = patientVisits.filter(visit => visit.status === 'Completed').length;
  const noShowVisits = patientVisits.filter(visit => visit.status === 'No Show').length;
  const initials = String(patient.name || 'Patient')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part.charAt(0).toUpperCase())
    .join('') || 'P';
  const patientStatus = patient.isArchived ? 'Archived' : displayValue(patient.status, 'Active');
  const statusClass = patient.isArchived
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : patientStatus === 'Active'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : patientStatus === 'Completed'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-slate-100 text-slate-700';

  const summary = [
    {
      label: 'Last visit',
      value: lastVisit?.visitDate ? formatDateTime(lastVisit.visitDate) : 'No visits yet',
      icon: Clock3,
      wide: true,
    },
    { label: 'Total visits', value: patientVisits.length, icon: Activity },
    { label: 'Completed', value: completedVisits, icon: CheckCircle2 },
    { label: 'No shows', value: noShowVisits, icon: UserX },
  ];

  const tabs: Array<{ id: ProfileTab; label: string; count?: number; icon: typeof Activity }> = [
    { id: 'visits', label: 'Visits', count: patientVisits.length, icon: Activity },
    { id: 'appointments', label: 'Appointments', count: patientAppointments.length, icon: CalendarDays },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'media', label: 'Media', icon: Images },
  ].filter(tab => clinicalAccess || tab.id === 'appointments') as typeof tabs;

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-profile-title"
      >
        <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl">
          <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-700 text-sm font-extrabold tracking-wide text-white shadow-sm sm:h-14 sm:w-14 sm:text-base">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="patient-profile-title" className="break-words text-xl font-extrabold leading-tight text-slate-950 sm:text-2xl">
                      {displayValue(patient.name, 'Unnamed patient')}
                    </h2>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusClass}`}>
                      {patientStatus}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound size={13} aria-hidden="true" />
                      {displayValue(patient.patientID, 'No patient ID')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={13} aria-hidden="true" />
                      {displayValue(patient.homeBranchName, 'No primary branch')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex w-full items-center gap-2 lg:w-auto">
                {!patient.isArchived && (
                  <button
                    type="button"
                    onClick={() => setShowAddAppointment(true)}
                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-500/15 sm:text-sm lg:flex-none"
                  >
                    <CalendarPlus size={17} aria-hidden="true" />
                    New appointment
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-500/10"
                  aria-label="Close patient profile"
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <main className="space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8">
              {clinicalAccess && <section aria-label="Patient activity summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {summary.map(item => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${item.wide ? 'col-span-2 lg:col-span-2' : 'col-span-1'}`}
                    >
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        <Icon size={14} className="text-teal-600" aria-hidden="true" />
                        {item.label}
                      </div>
                      <p className="mt-2 break-words text-sm font-extrabold leading-5 text-slate-900 sm:text-base">{item.value}</p>
                    </div>
                  );
                })}
              </section>}

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <SectionHeading title="Identity & contact" description="Core patient and emergency contact information." />
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DetailItem label="Mobile number" value={patient.contactNumber} />
                    <DetailItem label="Email address" value={patient.email} />
                    <DetailItem label="Date of birth" value={patientBirthLabel(patient)} />
                    <DetailItem label="Age / Gender" value={[birthMode(patient) === 'exact' ? patient.age : null, patient.gender].filter(value => value !== null && value !== undefined && value !== '').join(' • ')} />
                    <DetailItem label="Address" value={patient.address} className="sm:col-span-2" />
                    <DetailItem label="Emergency contact name" value={patient.emergencyContactName} />
                    <DetailItem label="Relationship" value={patient.emergencyContactRelationship} />
                    <DetailItem label="Emergency contact number" value={patient.emergencyContactNumber} />
                    {patient.emergencyContact && <DetailItem label="Previous emergency contact" value={patient.emergencyContact} className="sm:col-span-2" />}
                  </dl>
                </section>

                <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <SectionHeading title="Clinic record" description="Registration, ownership, and latest record activity." />
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DetailItem label="Primary branch" value={patient.homeBranchName} />
                    <DetailItem label="Date registered" value={patient.dateRegistered ? formatDateTime(patient.dateRegistered) : null} />
                    <DetailItem label="Created by" value={patient.createdByName || 'System user'} />
                    <DetailItem label="Last updated by" value={patient.lastUpdatedByName || 'System user'} />
                    <DetailItem label="Last updated" value={patient.lastUpdatedAt ? formatDateTime(patient.lastUpdatedAt) : null} className="sm:col-span-2" />
                  </dl>

                  <details className="group mt-3 rounded-xl border border-slate-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
                      Record audit details
                      <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <dl className="grid grid-cols-1 gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                      <DetailItem label="Created branch" value={patient.createdBranchName} />
                      <DetailItem label="Last updated branch" value={patient.lastUpdatedBranchName} />
                      <DetailItem label="Created date" value={patient.createdAt ? formatDateTime(patient.createdAt) : null} className="sm:col-span-2" />
                    </dl>
                  </details>
                </section>
              </div>

              {clinicalAccess && <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <SectionHeading title="Medical overview" description="High-level clinical information available to authorized clinic users." />
                <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-teal-700">Main concern</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-teal-950">
                    {displayValue(patient.mainConcern)}
                  </p>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailItem label="Skin type" value={patient.skinType || 'Not assessed'} />
                  <DetailItem label="Allergies" value={clinicalFindingLabel(patient, 'allergies')} />
                  <DetailItem label="Current medications" value={clinicalFindingLabel(patient, 'medications')} />
                  <DetailItem label="Medical conditions" value={clinicalFindingLabel(patient, 'medicalConditions')} />
                </dl>
              </section>}

              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-3 sm:p-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Patient record sections">
                    {tabs.map(tab => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => setActiveTab(tab.id)}
                          className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold transition focus:outline-none focus:ring-4 focus:ring-teal-500/10 sm:text-sm ${
                            isActive
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <Icon size={15} className="shrink-0" aria-hidden="true" />
                          <span className="truncate">{tab.label}</span>
                          {typeof tab.count === 'number' && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${isActive ? 'bg-white/15 text-white' : 'bg-white text-slate-500'}`}>
                              {tab.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-h-56 p-4 sm:p-5">
                  {activeTab === 'visits' ? (
                    <PatientTimeline patientId={patient.id} users={users} branches={branches} visits={visits} />
                  ) : activeTab === 'appointments' ? (
                    <PatientAppointments patientId={patient.id} users={users} branches={branches} appointments={appointments} />
                  ) : activeTab === 'notes' ? (
                    <NotesTab patient={patient} userRole={userRole} />
                  ) : (
                    <PatientMediaTab patientId={patient.id} users={users} branches={branches} visits={visits} />
                  )}
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>

      {showAddAppointment && (
        <AppointmentForm
          patients={[patient]}
          branches={branches}
          users={users}
          onClose={() => setShowAddAppointment(false)}
          onSave={() => {
            setShowAddAppointment(false);
            onClose();
          }}
          appointments={appointments}
        />
      )}
    </>
  );
}
