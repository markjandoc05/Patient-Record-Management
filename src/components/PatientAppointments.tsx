import React, { useState } from 'react';
import { formatDateTime } from '../utils';

export default function PatientAppointments({ patientId, users, branches, appointments }: { patientId: string, users: any[], branches: any[], appointments: any[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null);
  const itemsPerPage = 5;

  const patientAppointments = appointments
    .filter(appointment => appointment.patientId === patientId && appointment.isArchived !== true)
    .sort((a, b) => (b.appointmentDate || '').localeCompare(a.appointmentDate || ''));

  const totalPages = Math.ceil(patientAppointments.length / itemsPerPage);
  const paginatedAppointments = patientAppointments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-50 text-green-700 ring-1 ring-green-600/10';
      case 'Cancelled':
        return 'bg-red-50 text-red-700 ring-1 ring-red-600/10';
      case 'Confirmed':
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10';
      case 'Arrived':
        return 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/10';
      case 'Rescheduled':
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/10';
      default:
        return 'bg-slate-50 text-slate-700 ring-1 ring-slate-600/10';
    }
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 sm:text-lg">Appointment history</h3>
          <p className="mt-0.5 text-xs text-slate-500">Scheduled clinic activity, newest first.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {patientAppointments.length} record{patientAppointments.length === 1 ? '' : 's'}
        </span>
      </div>
      {patientAppointments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No appointments scheduled yet.</div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {paginatedAppointments.map((appt) => (
              <div 
                key={appt.id} 
                className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition duration-150 hover:border-teal-500 hover:shadow-sm sm:p-5"
                onClick={() => setSelectedAppointment(appt)}
              >
                <div className="flex flex-col gap-2 pb-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Date & Time</span>
                    <div className="text-sm sm:text-base text-slate-900 font-bold group-hover:text-teal-600 transition-all leading-tight">
                      {formatDateTime(appt.appointmentDate)}
                    </div>
                  </div>
                  <span className={`w-fit shrink-0 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(appt.status)}`}>
                    {appt.status}
                  </span>
                </div>
                
                <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 text-left text-xs sm:grid-cols-2 sm:gap-x-6">
                  {/* Column 1 */}
                  <div className="space-y-2.5">
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Provider / Doctor</span>
                      <span className="text-slate-800 font-semibold text-sm block">
                        {users.find(u => u.id === appt.doctorId)?.fullName || users.find(u => u.id === appt.doctorId)?.name || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Branch Location</span>
                      <span className="text-slate-800 font-semibold text-sm block">
                        {branches.find(b => b.id === appt.branchId)?.branchName || 'N/A'}
                      </span>
                    </div>
                  </div>

                  {/* Column 2 */}
                  <div className="space-y-2.5">
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Visit Type</span>
                      <span className="text-slate-800 font-semibold text-sm block">
                        {appt.visitType}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Main Concern</span>
                      <span className="text-slate-800 font-semibold text-sm block line-clamp-1">
                        {appt.mainConcern || 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => prev - 1)}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-250 hover:bg-slate-50 text-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition duration-150"
              >
                Prev
              </button>
              <span className="text-xs text-slate-600 font-medium">
                Page {currentPage} of {totalPages} ({patientAppointments.length} total)
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => prev + 1)}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-250 hover:bg-slate-50 text-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition duration-150"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
      
      {selectedAppointment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl transition duration-200">
            <div className="bg-slate-50 px-6 py-4 flex justify-between items-center border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Appointment Detail Card</h3>
              <button 
                onClick={() => setSelectedAppointment(null)} 
                className="text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-full transition-colors"
                aria-label="Close"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="px-6 py-5 space-y-4 text-sm text-slate-750">
              <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Scheduled Date & Time</span>
                  <span className="text-base font-bold text-slate-950">{formatDateTime(selectedAppointment.appointmentDate)}</span>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(selectedAppointment.status)}`}>
                  {selectedAppointment.status}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Doctor / Provider</span>
                  <span className="font-semibold text-slate-800">
                    {users.find(u => u.id === selectedAppointment.doctorId)?.fullName || users.find(u => u.id === selectedAppointment.doctorId)?.name || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Branch Location</span>
                  <span className="font-semibold text-slate-800">
                    {branches.find(b => b.id === selectedAppointment.branchId)?.branchName || 'N/A'}
                  </span>
                </div>
              </div>

              <div className="pt-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Visit Type</span>
                <span className="font-semibold text-slate-800">{selectedAppointment.visitType}</span>
              </div>

              {selectedAppointment.mainConcern && (
                <div className="bg-teal-50/50 rounded-xl p-3 border border-teal-100/50">
                  <span className="text-[9px] text-teal-700 font-bold uppercase tracking-wider block mb-1">Main Concern</span>
                  <p className="text-teal-950 font-medium whitespace-pre-wrap">{selectedAppointment.mainConcern}</p>
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Appointment Notes</span>
                <p className="text-slate-700 whitespace-pre-wrap">{selectedAppointment.notes || 'No specified notes.'}</p>
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={() => setSelectedAppointment(null)} 
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-900 font-semibold text-xs text-white rounded-xl shadow-sm transition duration-150"
                >
                  Ok
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
