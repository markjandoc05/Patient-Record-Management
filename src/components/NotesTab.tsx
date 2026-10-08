import { uiCan } from '../permissionState';
import { clinicalPatientRoles } from '../rbac';
import React, { useState } from 'react';
import PrivateNotesList from './PrivateNotesList';

export default function NotesTab({ patient, userRole }: { patient: any; userRole?: string }) {
  const [subTab, setSubTab] = useState<'general' | 'private'>('general');
  const canViewPrivateNotes = uiCan(userRole, 'clinical.view') && uiCan(userRole, 'clinical.private_notes.view');

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-900 sm:text-lg">Patient notes</h3>
        <p className="mt-0.5 text-xs text-slate-500">General observations and role-restricted clinical notes.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 sm:w-fit sm:min-w-72">
        <button
          type="button"
          onClick={() => setSubTab('general')}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition sm:text-sm ${subTab === 'general' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          General Notes
        </button>
        {canViewPrivateNotes && (
          <button
            type="button"
            onClick={() => setSubTab('private')}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition sm:text-sm ${subTab === 'private' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Private Notes
          </button>
        )}
      </div>
      
      {subTab === 'general' ? (
        <div className="min-h-28 whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          {patient.notes || 'No general notes available.'}
        </div>
      ) : canViewPrivateNotes ? (
        <PrivateNotesList patientId={patient.id} userRole={userRole} />
      ) : (
        <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
          Private notes are not available for your role.
        </div>
      )}
    </div>
  );
}
