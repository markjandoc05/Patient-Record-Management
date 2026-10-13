import React, { useEffect, useRef, useState } from 'react';
import { hasCapability, permissionDefinitions, defaultAllows, type PermissionId } from '../permissions';
import { STAFF_DESIGNATIONS } from '../staffDesignation';
import { hasAdministrativeAccess, isSupportDeveloper } from '../rbac';
import { auth } from '../platform';
import { updateUserAccess } from '../utils/accessApi';

export default function UserPermissionEditor({ actor, target, onSaved }: { actor: any; target: any; onSaved: (value: any) => void }) {
  const [busy, setBusy] = useState<PermissionId | 'staffDesignation' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const latestTarget = useRef(target);
  latestTarget.current = target;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const writable = hasCapability(actor, 'access.manage') && target.id !== auth.currentUser?.uid && !target.isArchived
    && (isSupportDeveloper(actor.role) || !isSupportDeveloper(target.role));
  const groups = [...new Set(permissionDefinitions.map(entry => entry[1]))];
  const change = async (permission: PermissionId, state: string) => {
    if (!writable || busy) return;
    setBusy(permission); setError(''); setMessage('');
    try {
      const result = await updateUserAccess(target.id, target.accessRevision ?? 0, { permissionChanges: { [permission]: state } });
      if (!alive.current) return;
      const current = latestTarget.current;
      if (current.id !== target.id || current.isArchived) return;
      if ((current.accessRevision ?? 0) > result.accessRevision) {
        setMessage('User access changed again. The current permissions have been retained.');
        return;
      }
      onSaved(result); setMessage('Module access saved.');
    } catch (failure: any) {
      if (alive.current && failure?.name !== 'AbortError') setError(failure.message || 'Access could not be saved. Reload this user and retry.');
    } finally { if (alive.current) setBusy(null); }
  };
  const changeDesignation = async (value: string) => {
    if (!writable || busy) return;
    setBusy('staffDesignation'); setError(''); setMessage('');
    try {
      const result = await updateUserAccess(target.id, target.accessRevision ?? 0, { staffDesignation: value || null });
      if (!alive.current) return;
      const current = latestTarget.current;
      if (current.id !== target.id || current.role !== 'staff' || current.isArchived) return;
      if ((current.accessRevision ?? 0) > result.accessRevision) {
        setMessage('Staff access changed again. The current designation has been retained.');
        return;
      }
      onSaved(result); setMessage('Staff designation and inherited access saved.');
    } catch (failure: any) {
      if (alive.current && failure?.name !== 'AbortError') setError(failure.message || 'Designation could not be saved. Reload this user and retry.');
    } finally { if (alive.current) setBusy(null); }
  };
  return <section className="col-span-full min-w-0 border-t border-slate-200 pt-4" aria-label="Module Access">
    <h3 className="text-sm font-semibold text-slate-900">Module Access</h3>
    <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Inherited access follows the role and Staff designation. Allow and Deny apply to this user. Assigned clinics and record restrictions still apply.</p>
    {target.role === 'staff' && <label className="mt-3 block text-sm text-slate-800">Staff designation<select aria-label="Staff designation" value={target.staffDesignation || ''} disabled={!writable || busy !== null} onChange={event => void changeDesignation(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 sm:w-64"><option value="">Not designated</option>{STAFF_DESIGNATIONS.map(value => <option key={value} value={value}>{value}</option>)}</select><span className="mt-1 block max-w-2xl text-xs leading-5 text-slate-600">Nurse and Medical Staff can create and complete Visits, edit clinical charts and manage Visit files. Signing still requires its separate permission. Reception keeps its existing access.</span></label>}
    {!writable && <p className="mt-2 text-xs text-slate-600">{target.id === auth.currentUser?.uid ? 'Another access administrator must change your overrides.' : 'Your current access permits viewing these permissions.'}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-teal-800">{message}</p>}
    <div className="mt-3 divide-y divide-slate-200">
      {groups.map(group => {
        const actions = permissionDefinitions.filter(entry => entry[1] === group);
        const count = actions.filter(([id]) => target.permissionOverrides?.[id]).length;
        return <details key={group} className="py-2">
          <summary className="cursor-pointer rounded-md py-2 text-sm font-medium text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">{group}{count > 0 && <span className="ml-2 text-xs font-normal text-slate-600">{count} explicit {count === 1 ? 'override' : 'overrides'}</span>}</summary>
          <div className="space-y-3 py-2">
            {actions.map(([id, , label]) => {
              const value = target.permissionOverrides?.[id] || 'inherit';
              const defaultAllowed = defaultAllows(target, id);
              const constrained = id === 'access.manage' && !hasAdministrativeAccess(target.role) || id === 'developer.access' && !isSupportDeveloper(target.role);
              return <div key={id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <label htmlFor={`permission-${target.id}-${id}`} className="text-sm text-slate-800">{label}</label>
                  <p className="text-xs leading-5 text-slate-600">Inherited default: {defaultAllowed ? 'Allowed' : 'Denied'}{constrained ? ' · Requires an authorized administrative role' : ''}{id === 'clinical.finalize' ? ' · Required separately to sign saved charts' : id === 'clinical.prescription_draft' ? ' · Workflow available with Clinical R1' : ''}</p>
                </div>
                <select id={`permission-${target.id}-${id}`} value={value} disabled={!writable || busy !== null} aria-label={`${label} permission`} onChange={event => void change(id, event.target.value)} className="w-full shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:bg-slate-100 sm:w-44">
                  <option value="inherit">Inherited — {defaultAllowed ? 'Allow' : 'Deny'}</option><option value="allow" disabled={constrained}>Allow</option><option value="deny">Deny</option>
                </select>
              </div>;
            })}
          </div>
        </details>;
      })}
    </div>
    {busy && <p role="status" className="mt-2 text-xs text-slate-600">Saving module access…</p>}
  </section>;
}
