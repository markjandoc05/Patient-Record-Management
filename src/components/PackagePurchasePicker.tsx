import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { packagesRequest } from '../utils/packageCatalogueApi';
import type { CataloguePackage } from '../packageCataloguePolicy';

const field = 'w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 disabled:bg-slate-100';
const button = 'min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
export default function PackagePurchasePicker({ branchId, value, onChange, disabled, needsReview }: {
  branchId: string; value: CataloguePackage | null; onChange: (value: CataloguePackage | null) => void; disabled: boolean; needsReview: boolean;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [list, setList] = useState({ key: '', packages: [] as CataloguePackage[], total: 0, error: '' });
  const [error, setError] = useState(''), [selecting, setSelecting] = useState(false);
  const life = useRef({ active: false, generation: 0, detail: null as AbortController | null });
  const key = JSON.stringify([branchId, search, page, retry]);
  useLayoutEffect(() => {
    life.current.active = true; life.current.generation++;
    return () => { life.current.active = false; life.current.generation++; life.current.detail?.abort(); };
  }, [branchId]);
  useEffect(() => {
    if (!branchId) return;
    const controller = new AbortController(), generation = life.current.generation;
    const current = () => life.current.active && life.current.generation === generation && !controller.signal.aborted;
    const query = new URLSearchParams({ branchId, selectableOnly: 'true', status: 'active', q: search, page: String(page) });
    void packagesRequest(`/api/packages?${query}`, 'GET', undefined, controller.signal, current).then(data => {
      if (!current()) return;
      if (!Array.isArray(data?.packages)) throw new Error('Invalid package response. Retry loading packages.');
      if (page > 1 && (page - 1) * 25 >= data.total) { setPage(Math.max(1, Math.ceil(data.total / 25))); return; }
      setList({ key, packages: data.packages, total: data.total, error: '' });
    }).catch(failure => { if (current() && failure.name !== 'AbortError') setList({ key, packages: [], total: 0, error: failure.message }); });
    return () => controller.abort();
  }, [key]);
  const visible = list.key === key ? list : null;
  const choose = async (id: string) => {
    if (disabled) return;
    life.current.detail?.abort(); onChange(null); setError('');
    const controller = new AbortController(), generation = life.current.generation; life.current.detail = controller;
    if (!id || !branchId) { setSelecting(false); return; }
    const current = () => life.current.active && life.current.generation === generation && life.current.detail === controller && !controller.signal.aborted;
    setSelecting(true);
    try {
      const saved = await packagesRequest(`/api/packages/${encodeURIComponent(id)}?branchId=${encodeURIComponent(branchId)}`, 'GET', undefined, controller.signal, current);
      if (!current()) return;
      if (saved?.id !== id || !saved.active || saved.eligible !== true || !Array.isArray(saved.lines) || !saved.lines.length) throw new Error('This package is unavailable at this clinic. Choose another package or use a manual purchase.');
      onChange(saved);
    } catch (failure: any) { if (current() && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (current()) setSelecting(false); }
  };
  return <section className="space-y-3" aria-label="Catalogue package selection">
    <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Find a package</span><input className={field} disabled={disabled || !branchId} value={search} placeholder="Search package names" onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
    {!branchId ? <p className="text-sm text-slate-600">Select a purchase clinic to see eligible packages.</p> : !visible ? <p role="status" className="text-sm text-slate-600">Loading packages…</p> : visible.error ? <div role="alert" className="text-sm text-rose-700"><p>{visible.error}</p><button type="button" className={button} disabled={disabled} onClick={() => setRetry(n => n + 1)}>Retry packages</button></div> : <>
      <label className="block space-y-1 text-xs font-semibold text-slate-600"><span>Catalogue package</span><select className={field} disabled={disabled || selecting} value={value?.id || ''} onChange={e => void choose(e.target.value)}>
        <option value="">Select a package</option>{value && <option value={value.id}>{value.name} · v{value.version}</option>}
        {visible.packages.filter(p => p.id !== value?.id).map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}
      </select></label>
      {!visible.total && <p className="text-sm text-slate-600">No eligible packages match. Adjust the search or use a manual package purchase.</p>}
      {visible.total > 25 && <div className="flex items-center gap-3"><button type="button" className={button} disabled={disabled || page <= 1} onClick={() => setPage(n => n - 1)}>Previous packages</button><span className="text-xs text-slate-600">Page {page}</span><button type="button" className={button} disabled={disabled || page * 25 >= visible.total} onClick={() => setPage(n => n + 1)}>Next packages</button></div>}
    </>}
    {selecting && <p role="status" className="text-sm text-slate-600">Loading selected package…</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {value && <div className="space-y-3 border-y border-slate-200 py-4" aria-label="Included package sessions">
      <p className="font-semibold text-slate-900">{value.name} <span className="font-normal text-slate-600">· version {value.version}</span></p>
      {value.description && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{value.description}</p>}
      <ul className="divide-y divide-slate-200">{value.lines.map(line => <li key={line.serviceId} className="flex items-start justify-between gap-4 py-2 text-sm"><span className="min-w-0 break-words">{line.currentServiceName || line.serviceName}</span><span className="shrink-0 tabular-nums">{line.sessions} sessions</span></li>)}</ul>
      <p className="text-xs leading-5 text-slate-600">These allowances are fixed for this purchase. Use Manual package for custom terms.</p>
      {needsReview && <p role="alert" className="text-sm text-amber-800">The package or an included Service changed. Reload and review before saving.</p>}
      <button type="button" className={button} disabled={disabled || selecting} onClick={() => void choose(value.id)}>Reload selected package</button>
    </div>}
  </section>;
}
