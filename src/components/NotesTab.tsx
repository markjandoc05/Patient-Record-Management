import React, { useState } from 'react';
import PrivateNotesList from './PrivateNotesList';

export default function NotesTab({ patient }: { patient: any }) {
  const [subTab, setSubTab] = useState<'general' | 'private'>('general');

  return (
    <div className="space-y-4">
      <div className="flex border-b mb-4">
        <button
          onClick={() => setSubTab('general')}
          className={`py-2 px-4 text-sm font-bold ${subTab === 'general' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500'}`}
        >
          General Notes
        </button>
        <button
          onClick={() => setSubTab('private')}
          className={`py-2 px-4 text-sm font-bold ${subTab === 'private' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500'}`}
        >
          Private Notes
        </button>
      </div>
      
      {subTab === 'general' ? (
        <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">
          {patient.notes || 'No general notes available.'}
        </div>
      ) : (
        <PrivateNotesList patientId={patient.id} />
      )}
    </div>
  );
}
