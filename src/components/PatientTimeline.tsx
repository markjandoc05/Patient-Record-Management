import { performedServiceLabel } from '../utils/visitServicePolicy';
import React, { useState } from 'react';
import { formatDateTime } from '../utils';

export default function PatientTimeline({ patientId, users, branches, visits }: { patientId: string, users: any[], branches: any[], visits: any[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null);
  const visitsPerPage = 5;

  const patientVisits = visits
    .filter(visit => visit.patientId === patientId && visit.isArchived !== true)
    .sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''));

  const totalPages = Math.ceil(patientVisits.length / visitsPerPage);
  const paginatedVisits = patientVisits.slice((currentPage - 1) * visitsPerPage, currentPage * visitsPerPage);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-50 text-green-700 ring-1 ring-green-600/10';
      case 'Cancelled':
      case 'No Show':
        return 'bg-red-50 text-red-700 ring-1 ring-red-600/10';
      case 'For Follow-up':
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/10';
      default:
        return 'bg-slate-50 text-slate-700 ring-1 ring-slate-600/10';
    }
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 sm:text-lg">Visit history</h3>
          <p className="mt-0.5 text-xs text-slate-500">Consultations and treatments, newest first.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {patientVisits.length} record{patientVisits.length === 1 ? '' : 's'}
        </span>
      </div>
      {patientVisits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No visit history available.</div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {paginatedVisits.map((c) => (
              <div 
                key={c.id} 
                className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition duration-150 hover:border-teal-500 hover:shadow-sm sm:p-5"
                onClick={() => setSelectedVisit(c)}
              >
                <div className="flex flex-col gap-2 pb-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Date & Time</span>
                    <div className="text-sm sm:text-base text-slate-900 font-bold group-hover:text-teal-600 transition-all leading-tight">
                      {formatDateTime(c.visitDate)}
                    </div>
                  </div>
                  <span className={`w-fit shrink-0 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(c.status)}`}>
                    {c.status}
                  </span>
                </div>
                
                <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 text-left text-xs sm:grid-cols-2 sm:gap-x-6">
                  {/* Column 1 */}
                  <div className="space-y-2.5">
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Provider / Doctor</span>
                      <span className="text-slate-800 font-semibold text-sm block">
                        {users.find(u => u.id === c.doctorId)?.fullName || users.find(u => u.id === c.doctorId)?.name || c.doctorId}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Branch Location</span>
                      <span className="text-slate-800 font-semibold text-sm block">
                        {branches.find(b => b.id === c.branchId)?.branchName || c.branchId}
                      </span>
                    </div>
                  </div>

                  {/* Column 2 */}
                  <div className="space-y-2.5">
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Service / Treatment</span>
                      <span className="block break-words text-sm font-semibold text-slate-800">
                        {performedServiceLabel(c)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Source</span>
                      <span className="text-slate-800 font-semibold text-sm block">
                        {c.visitSource}
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
                Page {currentPage} of {totalPages}
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
      
      {selectedVisit && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl transition duration-200">
            <div className="bg-slate-50 px-6 py-4 flex justify-between items-center border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Visit Detail Card</h3>
              <button 
                onClick={() => setSelectedVisit(null)} 
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
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Visit Date & Time</span>
                  <span className="text-base font-bold text-slate-950">{formatDateTime(selectedVisit.visitDate)}</span>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(selectedVisit.status)}`}>
                  {selectedVisit.status}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Doctor / Provider</span>
                  <span className="font-semibold text-slate-800">
                    {users.find(u => u.id === selectedVisit.doctorId)?.fullName || users.find(u => u.id === selectedVisit.doctorId)?.name || selectedVisit.doctorId}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Branch Location</span>
                  <span className="font-semibold text-slate-800">
                    {branches.find(b => b.id === selectedVisit.branchId)?.branchName || selectedVisit.branchId}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Service Performed</span>
                  <span className="font-semibold text-slate-800">{performedServiceLabel(selectedVisit)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Visit Source</span>
                  <span className="font-semibold text-slate-800">{selectedVisit.visitSource || 'N/A'}</span>
                </div>
              </div>

              {selectedVisit.diagnosis && (
                <div className="bg-teal-50/50 rounded-xl p-3 border border-teal-100/50">
                  <span className="text-[9px] text-teal-700 font-bold uppercase tracking-wider block mb-1">Diagnosis / Assessment</span>
                  <p className="text-teal-950 font-medium whitespace-pre-wrap">{selectedVisit.diagnosis}</p>
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                <span className="text-[9px] text-slate-505 font-bold uppercase tracking-wider block mb-1">Visit Notes</span>
                <p className="text-slate-700 whitespace-pre-wrap">{selectedVisit.notes || 'No specified notes.'}</p>
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={() => setSelectedVisit(null)} 
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
