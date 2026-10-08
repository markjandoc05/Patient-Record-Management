import React, { useState, useEffect, useRef } from 'react';
import { hasCapability } from '../permissions';
import { isSupportDeveloper } from '../rbac';
import { auth, db } from '../platform';
import { doc, updateDoc, captureProtectedRequestScope } from '../dataClient';

export default function UserOperationalDetails({ actor, target }: { actor: any; target: any }) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [name, setName] = useState(target.fullName || '');
  const [contact, setContact] = useState(target.contactNumber || '');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const writable = hasCapability(actor, 'users.manage') && !target.isArchived && (isSupportDeveloper(actor.role) || !isSupportDeveloper(target.role));
  const save = async () => {
    if (!writable || busy) return;
    const current = captureProtectedRequestScope();
    setBusy(true); setMessage('');
    try {
      await updateDoc(doc(db, 'users', target.id), { fullName: name.trim(), contactNumber: contact.trim(), lastUpdatedBy: auth.currentUser!.uid, lastUpdatedDate: new Date().toISOString() });
      current(); if (alive.current) setMessage('User details saved.');
    } catch (error: any) { try { current(); } catch { return; } if (alive.current && error.name !== 'AbortError') setMessage(error.message || 'User details could not be saved.'); }
    finally { if (alive.current) setBusy(false); }
  };
  if (!writable) return null;
  return <fieldset className="col-span-full space-y-3 border-t border-slate-200 pt-4" disabled={busy}>
    <legend className="px-1 text-sm font-semibold text-slate-900">User details</legend>
    <p className="text-xs text-slate-600">Operational details do not change roles, clinic access or permissions.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-700">Full name<input value={name} maxLength={120} onChange={event => setName(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" /></label>
      <label className="text-xs text-slate-700">Contact number<input value={contact} maxLength={100} onChange={event => setContact(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" /></label>
    </div>
    <button type="button" onClick={() => void save()} disabled={!name.trim() || busy} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save user details'}</button>
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
  </fieldset>;
}
