import React, { useState } from 'react';
import { formatDateTime } from '../utils';

export default function PatientTimeline({ patientId, users, branches, visits }: { patientId: string, users: any[], branches: any[], visits: any[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null);
  const visitsPerPage = 5;

  const patientVisits = visits
    .filter(visit => visit.patientId === patientId)
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
    <div className="border-t pt-4">
      <h3 className="font-bold text-lg mb-4 text-slate-800">Visit History Timeline</h3>
      {patientVisits.length === 0 ? (
        <p className="text-sm text-slate-500">No visit history.</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {paginatedVisits.map((c) => (
              <div 
                key={c.id} 
                className="group border border-slate-200 rounded-xl p-5 cursor-pointer hover:border-teal-500 hover:shadow-sm bg-white transition duration-150"
                onClick={() => setSelectedVisit(c)}
              >
                <div className="flex justify-between items-center gap-4 pb-2.5">
                  <div>
                    <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[9px]">Date & Time</span>
                    <div className="text-sm sm:text-base text-slate-900 font-bold group-hover:text-teal-600 transition-all leading-tight">
                      {formatDateTime(c.visitDate)}
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(c.status)}`}>
                    {c.status}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-x-6 mt-3 pt-3 border-t border-slate-100 text-xs text-left">
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
                      <span className="text-slate-800 font-semibold text-sm block">
                        {c.servicePerformed || 'Consultation'}
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
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-w-lg w-full transform scale-100 transition duration-200">
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

              <div className="grid grid-cols-2 gap-4">
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

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Service Performed</span>
                  <span className="font-semibold text-slate-800">{selectedVisit.servicePerformed || 'Consultation'}</span>
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
