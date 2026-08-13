import React, { useState, useEffect } from 'react';
import { formatDateTime } from '../utils';
import PatientTimeline from './PatientTimeline';
import PatientAppointments from './PatientAppointments';
import NotesTab from './NotesTab';
import AppointmentForm from './AppointmentForm';
import PatientMediaTab from './PatientMediaTab';

export default function PatientProfile({ patient, onClose, userRole, users, branches, visits, appointments }: { patient: any, onClose: () => void, userRole?: string, users: any[], branches: any[], visits: any[], appointments: any[] }) {
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const [activeTab, setActiveTab ] = useState<'visits' | 'appointments' | 'notes' | 'media'>('visits');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const summary = [
      { label: 'Last Visit', value: patient.lastVisitDate ? formatDateTime(patient.lastVisitDate) : 'N/A' },
      { label: 'Total Visits', value: patient.totalVisits || 0 },
      { label: 'Completed', value: patient.totalCompletedVisits || 0 },
      { label: 'No Shows', value: patient.totalNoShowVisits || 0 },
  ];

  const patientInfo = [
    { label: 'Patient ID', value: patient.patientID },
    { label: 'Full Name', value: patient.name },
    { label: 'Mobile Number', value: patient.contactNumber },
    { label: 'Email Address', value: patient.email },
    { label: 'Date of Birth', value: patient.birthday ? formatDateTime(patient.birthday) : 'N/A' },
    { label: 'Age', value: patient.age },
    { label: 'Gender', value: patient.gender },
    { label: 'Date Registered', value: patient.dateRegistered ? formatDateTime(patient.dateRegistered) : 'N/A' },
    { label: 'Address', value: patient.address },
    { label: 'Emergency Contact', value: patient.emergencyContact },
    { label: 'Created By', value: patient.createdByName || 'System User' },
    { label: 'Home Branch', value: patient.homeBranchName },
    { label: 'Created Branch', value: patient.createdBranchName },
    { label: 'Last Updated Branch', value: patient.lastUpdatedBranchName },
    { label: 'Created Date', value: patient.createdAt ? formatDateTime(patient.createdAt) : 'N/A' },
    { label: 'Last Updated By', value: patient.lastUpdatedByName || 'System User' },
    { label: 'Last Updated Date', value: patient.lastUpdatedAt ? formatDateTime(patient.lastUpdatedAt) : 'N/A' },
  ];

  const medicalInfo = [
    { label: 'Main Concern', value: patient.mainConcern },
    { label: 'Skin Type', value: patient.skinType },
    { label: 'Allergies', value: patient.allergies },
    { label: 'Current Medications', value: patient.medications },
    { label: 'Medical Conditions', value: patient.medicalConditions },
  ];

  return (
  <>
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex justify-end z-40 animate-fade-in">
      <div className="bg-white w-full max-w-2xl h-full p-5 sm:p-8 overflow-y-auto space-y-6 shadow-xl border-l border-slate-100">
        <div className="flex justify-between items-start border-b border-slate-100 pb-4 gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-950 leading-tight">{patient.name}</h2>
            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block mt-1">Patient Profile Card</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => setShowAddAppointment(true)} 
              className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 active:bg-teal-850 text-white font-bold text-xs sm:text-sm rounded-xl transition duration-150 shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
              </svg>
              <span>Add Appointment</span>
            </button>
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 p-2 rounded-xl transition-colors"
              aria-label="Close"
            >
              <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {summary.map((item, idx) => (
                <div 
                  key={idx} 
                  className={`bg-slate-50/50 hover:bg-slate-50/90 transition-colors p-3.5 rounded-xl border border-slate-150/70 ${
                    idx === 0 ? 'col-span-2 sm:col-span-2' : (idx === 3 ? 'col-span-2 sm:col-span-1' : 'col-span-1 sm:col-span-1')
                  }`}
                >
                    <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">{item.label}</div>
                    <div className="font-bold text-xs sm:text-sm text-slate-900 leading-tight break-words">{item.value}</div>
                </div>
            ))}
        </div>

        <div className="space-y-6">
            <div>
                <h3 className="font-bold text-lg mb-4 text-slate-800">Patient Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    {patientInfo.map((field, idx) => (
                        <div key={idx} className="flex flex-col">
                            <span className="text-xs text-slate-500 font-semibold uppercase">{field.label}</span>
                            <span className="font-medium text-slate-900">{field.value || 'N/A'}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="border-t pt-4">
                <h3 className="font-bold text-lg mb-4 text-slate-800">Medical Information</h3>
                <div className="space-y-4">
                    {medicalInfo.map((field, idx) => (
                        <div key={idx} className="flex flex-col">
                            <span className="text-xs text-slate-500 font-semibold uppercase">{field.label}</span>
                            <span className="font-medium text-slate-900 bg-slate-50 p-2 rounded">{field.value || 'N/A'}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Modern Interactive History Tabs */}
            <div className="border-t pt-6">
              <div className="flex border-b border-slate-200 mb-4 p-0.5 bg-slate-100 rounded-xl w-full sm:max-w-[400px]">
                <button
                  type="button"
                  onClick={() => setActiveTab('visits')}
                  className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all duration-150 ${
                    activeTab === 'visits'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Visit History
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('appointments')}
                  className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all duration-150 ${
                    activeTab === 'appointments'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Appointments List
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('notes')}
                    className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all duration-150 ${
                        activeTab === 'notes'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    Notes
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('media')}
                    className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all duration-150 ${
                        activeTab === 'media'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    Media Files
                </button>
              </div>

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


        </div>
      </div>
    </div>
    {showAddAppointment && <AppointmentForm patients={[patient]} branches={branches} users={users} onClose={() => setShowAddAppointment(false)} onSave={() => { setShowAddAppointment(false); onClose(); }} appointments={appointments} />}
  </>
  );
}
