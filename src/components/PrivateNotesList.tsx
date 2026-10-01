import React, { useState, useEffect } from 'react';
import { db, auth } from '../platform';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, limit } from '../dataClient';
import { formatDateTime } from '../utils';
import { logActivity } from '../utils/auditLogger';

export default function PrivateNotesList({ patientId, userRole }: { patientId: string; userRole?: string }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState('');
  const [user, setUser] = useState(auth.currentUser);
  const [noteLimit, setNoteLimit] = useState(5);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    return auth.onAuthStateChanged(setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, `patients/${patientId}/privateNotes`),
      orderBy('createdAt', 'desc'),
      limit(noteLimit)
    );
    return onSnapshot(q, (snap) => {
        setNotes(snap.docs.map(d => ({id: d.id, ...d.data()})));
        if (snap.docs.length < noteLimit) {
            setHasMore(false);
        } else {
            setHasMore(true);
        }
    });
  }, [patientId, noteLimit, user]);

  const handleAddNote = async () => {
    if (!newNote.trim() || !user) return;
    await addDoc(collection(db, `patients/${patientId}/privateNotes`), {
      patientId,
      authorId: user.uid,
      authorName: user.displayName || 'Unknown',
      note: newNote,
      createdAt: serverTimestamp()
    });
    await logActivity({
      action: 'UPDATE',
      resource: 'Patient',
      resourceId: patientId,
      changes: [{ field: 'privateNotes', oldValue: null, newValue: null }],
      userProfile: { role: userRole },
    });
    setNewNote('');
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="flex-1 border rounded-lg p-2 text-sm"
          placeholder="Add a private note..."
        />
        <button onClick={handleAddNote} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Add</button>
      </div>
      <div className="space-y-2">
        {notes.map(n => (
          <div key={n.id} className="bg-slate-50 p-3 rounded-lg text-sm">
            <p className="text-slate-800">{n.note}</p>
            <div className="text-[10px] text-slate-400 mt-1">{n.authorName} • {n.createdAt?.toDate ? formatDateTime(n.createdAt.toDate()) : 'Saving…'}</div>
          </div>
        ))}
        {hasMore && (
            <button 
                onClick={() => setNoteLimit(prev => prev + 5)}
                className="w-full text-center text-xs text-teal-600 font-bold py-2 hover:underline"
            >
                Load More
            </button>
        )}
      </div>
    </div>
  );
}
