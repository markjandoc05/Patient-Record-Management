import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { uiCan, uiPermissionScope } from '../permissionState';
import { packagesRequest } from '../utils/packageCatalogueApi';
import { parsePackageDefinition, type CataloguePackage } from '../packageCataloguePolicy';
import { formatDateTime } from '../utils';

const field = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100';
const button = 'min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
const primary = 'min-h-11 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';

function PackageEditor({ saved, userProfile, onClose, onSaved, onReload, opening }: {
  saved: CataloguePackage | null; userProfile: any; onClose: () => void; onSaved: () => void; onReload: (id: string) => void; opening: boolean;
}) {
  const [id] = useState(() => saved?.id || crypto.randomUUID());
  const [name, setName] = useState(saved?.name || ''), [description, setDescription] = useState(saved?.description || '');
  const [active, setActive] = useState(saved?.active ?? true);
  const initialRows = saved?.lines.map(l => ({ serviceId: l.serviceId, expectedServiceVersion: l.currentServiceVersion, name: l.currentServiceName || l.serviceName, sessions: l.sessions }))
    || [{ serviceId: '', expectedServiceVersion: 0, name: '', sessions: 1 }];
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [services, setServices] = useState({ key: '', rows: [] as any[], total: 0, error: '' });
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [error, setError] = useState('');
  const [history, setHistory] = useState<{ versions: CataloguePackage[]; page: number; total: number } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState('');
  const life = useRef({ active: false, request: null as AbortController | null, history: null as AbortController | null });
  const command = useRef({ key: '', id: crypto.randomUUID() });
  const writable = uiCan(userProfile, 'packages.manage');
  const serviceKey = JSON.stringify([search, page, retry]);
  const values = { name, description, active, rows };
  const dirty = JSON.stringify(values) !== JSON.stringify({ name: saved?.name || '', description: saved?.description || '', active: saved?.active ?? true, rows: initialRows });
  useLayoutEffect(() => { life.current.active = true; return () => { life.current.active = false; life.current.request?.abort(); life.current.history?.abort(); }; }, []);
  useEffect(() => {
    if (!writable) return;
    const controller = new AbortController(), current = () => life.current.active && !controller.signal.aborted;
    const query = new URLSearchParams({ q: search, page: String(page), pageSize: '25', status: 'all' });
    void packagesRequest(`/api/services?${query}`, 'GET', undefined, controller.signal, current).then(data => {
      if (current()) setServices({ key: serviceKey, rows: data.services, total: data.total, error: '' });
    }).catch(failure => { if (current() && failure.name !== 'AbortError') setServices({ key: serviceKey, rows: [], total: 0, error: failure.message }); });
    return () => controller.abort();
  }, [serviceKey, writable]);
  const visible = services.key === serviceKey ? services : null;
  const close = () => {
    if (busy || opening) return;
    if ((dirty || uncertain) && !window.confirm(uncertain ? 'The save may have completed. Close this editor and inspect the saved catalogue?' : 'Discard unsaved package changes?')) return;
    onClose();
  };
  const reload = () => { if (!busy && !opening && (!dirty || window.confirm('Replace this package draft with the latest saved version?'))) onReload(id); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || opening || conflict || !uiCan(userProfile, 'packages.manage')) return;
    let body;
    try {
      const content = { id, expectedVersion: saved?.version ?? 0, name, description, active,
        lines: rows.map(({ serviceId, expectedServiceVersion, sessions }) => ({ serviceId, expectedServiceVersion, sessions })) };
      const key = JSON.stringify(content); if (command.current.key !== key) command.current = { key, id: crypto.randomUUID() };
      body = parsePackageDefinition({ ...content, commandId: command.current.id }, !saved);
    } catch (failure: any) { setError(failure.message); return; }
    life.current.request?.abort(); const controller = new AbortController(); life.current.request = controller;
    const current = () => life.current.active && life.current.request === controller && !controller.signal.aborted;
    setBusy(true); setError('');
    try {
      await packagesRequest(saved ? `/api/packages/${id}` : '/api/packages', saved ? 'PATCH' : 'POST', body, controller.signal, current);
      if (current()) onSaved();
    } catch (failure: any) {
      if (!current() || failure.name === 'AbortError') return;
      setError(failure.message); setConflict(failure.status === 409);
      setUncertain(!failure.status || failure.status >= 500);
    } finally { if (current()) setBusy(false); }
  };
  const loadHistory = async (number = 1) => {
    if (!saved || busy) return;
    life.current.history?.abort(); const controller = new AbortController(); life.current.history = controller;
    const current = () => life.current.active && life.current.history === controller && !controller.signal.aborted;
    setHistoryBusy(true); setHistoryError('');
    try { const result = await packagesRequest(`/api/packages/${saved.id}/versions?page=${number}`, 'GET', undefined, controller.signal, current); if (current()) setHistory(result); }
    catch (failure: any) { if (current() && failure.name !== 'AbortError') setHistoryError(failure.message); }
    finally { if (current()) setHistoryBusy(false); }
  };
  return <section className="mx-auto max-w-4xl space-y-6">
    <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy || opening} onClick={close}><ArrowLeft size={16} />Back to packages</button>
    <header><h1 className="text-2xl font-semibold tracking-tight text-slate-950">{saved ? writable ? 'Edit package' : 'Package details' : 'Create package'}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{saved ? `Saved version ${saved.version}. Changes create the next version; existing purchases keep their original terms.` : 'Define the Services and session allowances staff can select in the Treatment Ledger.'}</p></header>
    {error && <div role="alert" className="space-y-2 text-sm text-rose-700"><p>{error}</p>{(conflict || uncertain) && <button type="button" className={button} disabled={busy || opening} onClick={reload}>Reload saved package</button>}</div>}
    {opening && <p role="status" className="text-sm text-slate-600">Reloading saved package…</p>}
    {uncertain && <p role="status" className="text-sm text-amber-800">The save result is uncertain. Retry the same save, or reload the saved package before making changes.</p>}
    <form onSubmit={submit} className="space-y-6">
      <fieldset disabled={!writable || busy || opening || uncertain} className="space-y-5">
        <label className="block space-y-2 text-sm font-medium"><span>Package name</span><input className={field} maxLength={160} required value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block space-y-2 text-sm font-medium"><span>Description (optional)</span><textarea className={field} rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Active for new purchases</label>
        <section className="space-y-4 border-y border-slate-200 py-5" aria-label="Package Service allowances"><h2 className="text-base font-semibold text-slate-900">Included Services and sessions</h2>
          {writable && <label className="block space-y-2 text-sm font-medium"><span>Find Services</span><input className={field} placeholder="Search canonical Services" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>}
          {writable && (!visible ? <p role="status" className="text-sm text-slate-600">Loading Services…</p> : visible.error ? <div role="alert" className="space-y-2 text-sm text-rose-700"><p>{visible.error}</p><button type="button" className={button} onClick={() => setRetry(n => n + 1)}>Retry Services</button></div> : null)}
          {rows.map((row, index) => <div key={index} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <label className="min-w-0 space-y-2 text-sm font-medium"><span>Service {index + 1}</span><select className={field} value={row.serviceId} disabled={writable && !visible} onChange={e => {
              const service = visible?.rows.find(s => s.id === e.target.value);
              setRows(previous => previous.map((r, i) => i === index ? { ...r, serviceId: service?.id || '', expectedServiceVersion: service?.version || 0, name: service?.name || '' } : r));
            }}><option value="">Choose a Service</option>{row.serviceId && !visible?.rows.some(s => s.id === row.serviceId) && <option value={row.serviceId}>{row.name}</option>}{visible?.rows.map(s => <option key={s.id} value={s.id}>{s.name}{!s.active ? ' (inactive)' : ''}</option>)}</select></label>
            <label className="space-y-2 text-sm font-medium"><span>Sessions</span><input className={field} type="number" min={1} max={10000} step={1} value={row.sessions || ''} onChange={e => setRows(previous => previous.map((r, i) => i === index ? { ...r, sessions: Number(e.target.value) } : r))} /></label>
            {writable && <button type="button" className={button} aria-label={`Remove Service ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows(previous => previous.filter((_, i) => i !== index))}>Remove</button>}
          </div>)}
          {writable && <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={rows.length >= 20} onClick={() => setRows(previous => [...previous, { serviceId: '', expectedServiceVersion: 0, name: '', sessions: 1 }])}><Plus className="mr-1 inline" size={15} />Add Service</button>{visible && visible.total > 25 && <><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous Services</button><button type="button" className={button} disabled={page * 25 >= visible.total} onClick={() => setPage(n => n + 1)}>Next Services</button></>}</div>}
          <p className="text-xs leading-5 text-slate-600">New purchases require every included Service to be active, available and priced or Free at the purchase clinic.</p>
        </section>
      </fieldset>
      {writable && <button className={primary} disabled={busy || conflict || opening}>{busy ? 'Saving package…' : uncertain ? 'Retry package save' : saved ? 'Save new version' : 'Create package'}</button>}
    </form>
    {saved && <section className="space-y-3 border-t border-slate-200 pt-5"><button type="button" className={button} disabled={busy || historyBusy} onClick={() => void loadHistory()}>View version history</button>{historyBusy && <p role="status" className="text-sm text-slate-600">Loading version history…</p>}{historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}{history && <><ol className="divide-y divide-slate-200">{history.versions.map(v => <li key={v.version} className="space-y-1 py-3 text-sm"><p className="font-semibold">Version {v.version} · {v.name} · {v.active ? 'Active' : 'Inactive'}</p><p className="text-xs text-slate-600">{formatDateTime(v.recordedAt)} · {v.actor.name}</p><p className="break-words text-slate-700">{v.lines.map(l => `${l.serviceName}: ${l.sessions} sessions`).join(' · ')}</p></li>)}</ol>{history.total > 25 && <div className="flex gap-3"><button type="button" className={button} disabled={historyBusy || history.page <= 1} onClick={() => void loadHistory(history.page - 1)}>Previous versions</button><button type="button" className={button} disabled={historyBusy || history.page * 25 >= history.total} onClick={() => void loadHistory(history.page + 1)}>Next versions</button></div>}</>}</section>}
  </section>;
}

export default function PackageCatalogueDashboard({ userProfile, activeBranchId, onServices }: any) {
  const scope = JSON.stringify([uiPermissionScope(userProfile), auth.currentUser?.uid, userProfile?.role, userProfile?.active, userProfile?.assignedBranches, activeBranchId]);
  const [invalidated, setInvalidated] = useState<string | null>(null);
  useLayoutEffect(() => {
    setInvalidated(null);
    // Capture the committed scope: App may publish refreshed access before
    // invalidating the old one. A denial must clear data without auto-refetching.
    return subscribeProtectedDataInvalidation(() => setInvalidated(scope));
  }, [scope]);
  if (!uiCan(userProfile, 'packages.view') || !uiCan(userProfile, 'services.view')) return <p className="p-6 text-sm text-slate-600">Package catalogue access is unavailable.</p>;
  if (invalidated === scope) return <div role="alert" className="space-y-3 p-6 text-sm text-slate-600">
    <p>Package catalogue access changed. Retry after your access is refreshed.</p>
    <div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={() => setInvalidated(current => current === scope ? null : current)}>Retry packages</button><button type="button" className={button} onClick={onServices}>Back to Services</button></div>
  </div>;
  return <PackageWorkspace key={scope} userProfile={userProfile} activeBranchId={activeBranchId} onServices={onServices} />;
}
function PackageWorkspace({ userProfile, activeBranchId, onServices }: any) {
  const writable = uiCan(userProfile, 'packages.manage');
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [list, setList] = useState({ key: '', packages: [] as CataloguePackage[], total: 0, error: '' });
  const [editor, setEditor] = useState<{ saved: CataloguePackage | null; key: string } | null>(null);
  const [error, setError] = useState(''), [opening, setOpening] = useState(false);
  const life = useRef({ active: false, detail: null as AbortController | null });
  const key = JSON.stringify([q, status, page, retry, activeBranchId]);
  useLayoutEffect(() => { life.current.active = true; return () => { life.current.active = false; life.current.detail?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(), current = () => life.current.active && !controller.signal.aborted;
    const query = new URLSearchParams({ q, status, page: String(page) });
    if (activeBranchId && activeBranchId !== 'All') query.set('branchId', activeBranchId);
    void packagesRequest(`/api/packages?${query}`, 'GET', undefined, controller.signal, current).then(data => {
      if (!current()) return;
      if (!Array.isArray(data?.packages)) throw new Error('Invalid package response. Retry loading packages.');
      if (page > 1 && (page - 1) * 25 >= data.total) { setPage(Math.max(1, Math.ceil(data.total / 25))); return; }
      setList({ key, packages: data.packages, total: data.total, error: '' });
    }).catch(failure => { if (current() && failure.name !== 'AbortError') setList({ key, packages: [], total: 0, error: failure.message }); });
    return () => controller.abort();
  }, [key]);
  const open = async (id: string) => {
    life.current.detail?.abort(); const controller = new AbortController(); life.current.detail = controller;
    const current = () => life.current.active && life.current.detail === controller && !controller.signal.aborted;
    setOpening(true); setError('');
    try { const saved = await packagesRequest(`/api/packages/${id}`, 'GET', undefined, controller.signal, current); if (current()) setEditor({ saved, key: crypto.randomUUID() }); }
    catch (failure: any) { if (current() && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (current()) setOpening(false); }
  };
  const close = () => { life.current.detail?.abort(); setOpening(false); setEditor(null); setRetry(n => n + 1); };
  const visible = list.key === key ? list : null;
  return <div className="p-4 text-slate-900 sm:p-6 lg:p-8">
    {error && <p role="alert" className="mb-4 text-sm text-rose-700">{error}</p>}
    {editor ? <PackageEditor key={editor.key} saved={editor.saved} userProfile={userProfile} onClose={close} onSaved={close} onReload={open} opening={opening} /> : <div className="space-y-6">
      <nav aria-label="Service catalogues" className="flex gap-2"><button type="button" className={button} onClick={onServices}>Services</button><button type="button" aria-current="page" className={primary}>Packages</button></nav>
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">Packages</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Reusable Service and session allowances for patient Treatment Ledger purchases.</p></div>{writable && <button type="button" className={`${primary} inline-flex items-center gap-2`} disabled={opening} onClick={() => { life.current.detail?.abort(); setOpening(false); setEditor({ saved: null, key: crypto.randomUUID() }); }}><Plus size={16} />Create package</button>}</header>
      <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1 basis-64"><span className="sr-only">Search packages</span><input className={field} placeholder="Search packages" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label><label><span className="sr-only">Filter package status</span><select className={`${field} sm:w-44`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
      {opening && <p role="status" className="text-sm text-slate-600">Loading package details…</p>}
      {!visible ? <p role="status" className="py-10 text-sm text-slate-600">Loading packages…</p> : visible.error ? <div role="alert" className="space-y-3 text-sm text-rose-700"><p>{visible.error}</p><button type="button" className={button} onClick={() => setRetry(n => n + 1)}>Retry packages</button></div> : !visible.packages.length ? <div role="status" className="border-y border-slate-200 py-10"><h2 className="font-semibold">{q || status !== 'all' ? 'No matching packages' : 'No packages yet'}</h2><p className="mt-2 text-sm text-slate-600">{q || status !== 'all' ? 'Adjust the search or status filter.' : writable ? 'Create a reusable package. Existing manual purchases remain available in the Treatment Ledger.' : 'An administrator can define reusable packages.'}</p></div> : <>
        <ul className="divide-y divide-slate-200 border-y border-slate-200" aria-label="Package catalogue">{visible.packages.map(p => <li key={p.id} className="flex flex-wrap items-start justify-between gap-4 py-5"><div className="min-w-0 flex-1 basis-64"><h2 className="break-words font-semibold text-slate-950">{p.name}</h2><p className="mt-1 text-xs text-slate-600">Version {p.version} · {p.active ? 'Active' : 'Inactive'}{p.eligible === false ? ' · Unavailable at selected clinic' : ''}</p><ul className="mt-3 space-y-1 text-sm text-slate-700">{p.lines.map(l => <li key={l.serviceId} className="break-words">{l.serviceName} · {l.sessions} sessions</li>)}</ul></div><button type="button" className={button} disabled={opening} aria-label={`${writable ? 'Edit' : 'View'} package ${p.name}`} onClick={() => void open(p.id)}>{writable ? 'Edit' : 'View'}</button></li>)}</ul>
        <nav aria-label="Package pages" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{visible.total} packages · Page {page} of {Math.max(1, Math.ceil(visible.total / 25))}</p><div className="flex gap-3"><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><button type="button" className={button} disabled={page * 25 >= visible.total} onClick={() => setPage(n => n + 1)}>Next</button></div></nav>
      </>}
    </div>}
  </div>;
}
