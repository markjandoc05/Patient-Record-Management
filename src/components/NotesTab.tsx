import React, { useState } from 'react';
import PrivateNotesList from './PrivateNotesList';

export default function NotesTab({ patient, userRole }: { patient: any; userRole?: string }) {
  const [subTab, setSubTab] = useState<'general' | 'private'>('general');
  const canViewPrivateNotes = ['admin', 'manager', 'doctor', 'support_developer'].includes(userRole || '');

  return (
    <div className="space-y-4">
      <div className="flex border-b mb-4">
        <button
          onClick={() => setSubTab('general')}
          className={`py-2 px-4 text-sm font-bold ${subTab === 'general' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500'}`}
        >
          General Notes
        </button>
        {canViewPrivateNotes && (
          <button
            onClick={() => setSubTab('private')}
            className={`py-2 px-4 text-sm font-bold ${subTab === 'private' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500'}`}
          >
            Private Notes
          </button>
        )}
      </div>
      
      {subTab === 'general' ? (
        <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">
          {patient.notes || 'No general notes available.'}
        </div>
      ) : canViewPrivateNotes ? (
        <PrivateNotesList patientId={patient.id} />
      ) : (
        <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
          Private notes are not available for your role.
        </div>
      )}
    </div>
  );
}
