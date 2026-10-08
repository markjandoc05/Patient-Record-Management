import { uiCan, uiPermissionScope } from '../permissionState';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { canManageServices, parseServicePrice, priceInput, priceLabel, effectiveServicePrice, type PriceInput } from '../servicesPolicy';
import { servicesRequest } from '../utils/servicesApi';
import { auth } from '../platform';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100';
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
const primaryClass = 'rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115e59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
function Failure({ error, retry }: { error: string; retry?: () => void }) {
  return <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-900"><p>{error}</p>{retry && <button type="button" className={`${buttonClass} mt-3`} onClick={retry}>Reload and review</button>}</div>;
}
function PriceFields({ value, onChange, branch = false, label, id }: { value: PriceInput; onChange: (p: PriceInput) => void; branch?: boolean; label: string; id: string }) {
  return <div className="space-y-2"><label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
    <select id={id} className={inputClass} value={value.mode} onChange={e => onChange(e.target.value === 'priced' ? { mode: 'priced', amount: '' } : { mode: e.target.value as 'free' | 'unpriced' | 'inherit' })}>
      <option value={branch ? 'inherit' : 'unpriced'}>{branch ? 'Use standard price' : 'Not configured'}</option><option value="priced">{branch ? 'Override price' : 'Priced'}</option><option value="free">Free</option>
    </select>{value.mode === 'priced' && <div><label htmlFor={`${id}-amount`} className="mb-1 block text-sm text-slate-700">Amount (PHP)</label><input id={`${id}-amount`} className={inputClass} inputMode="decimal" value={value.amount} onChange={e => onChange({ mode: 'priced', amount: e.target.value })} required placeholder="0.00" /></div>}
  </div>;
}
type AccessGeneration = React.MutableRefObject<{ scope: string; generation: number }>;
// Reuse the dashboard's authorization generation; local lifetime/request identity
// also prevents a closed editor or replaced save from publishing a late result.
function useServicesMutation(scope: string, accessGeneration: AccessGeneration) {
  const lifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  useLayoutEffect(() => {
    lifetime.current.active = true; lifetime.current.generation++;
    return () => { lifetime.current.active = false; lifetime.current.generation++; lifetime.current.request?.abort(); };
  }, [scope]);
  return () => {
    lifetime.current.request?.abort();
    const controller = new AbortController(); lifetime.current.request = controller;
    const generation = lifetime.current.generation, access = accessGeneration.current.generation;
    return {
      signal: controller.signal,
      current: () => accessGeneration.current.scope === scope && accessGeneration.current.generation === access && lifetime.current.active && lifetime.current.generation === generation && lifetime.current.request === controller && !controller.signal.aborted,
      finish: () => { if (lifetime.current.request === controller) lifetime.current.request = null; },
    };
  };
}
function ServiceEditor({ service, categories, branches, writable, pricing, onClose, onSaved, onReload, loadError, scope, accessGeneration }: any) {
  const beginMutation = useServicesMutation(scope, accessGeneration);
  const [id] = useState(() => service?.id || crypto.randomUUID());
  const [name, setName] = useState(service?.name || '');
  const [categoryId, setCategoryId] = useState(service?.category_id || '');
  const [description, setDescription] = useState(service?.description || '');
  const [duration, setDuration] = useState(String(service?.default_duration_minutes || 30));
  const [active, setActive] = useState(service?.active ?? true);
  const [price, setPrice] = useState<PriceInput>(() => priceInput(service?.standard_price ?? null));
  const [settings, setSettings] = useState<Record<string, { available: boolean; price: PriceInput; exists: boolean }>>(() => Object.fromEntries(branches.map((b: any) => {
    const s = service?.branchSettings?.find((r: any) => r.branch_id === b.id);
    return [b.id, { available: s?.available ?? false, price: priceInput(s?.price_override ?? null, true), exists: !!s }];
  })));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const updateBranch = (branchId: string, patch: any) => setSettings(current => ({ ...current, [branchId]: { ...current[branchId], ...patch } }));
  const preview = (p: PriceInput, branch = false) => { try { return parseServicePrice(p, branch); } catch { return undefined; } };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (saving || !writable || conflict) return;
    const request = beginMutation();
    setError('');
    try {
      parseServicePrice(price);
      const branchSettings = branches.filter((b: any) => settings[b.id].exists || settings[b.id].available || settings[b.id].price.mode !== 'inherit').map((b: any) => {
        parseServicePrice(settings[b.id].price, true); return { branchId: b.id, available: settings[b.id].available, price: settings[b.id].price };
      });
      setSaving(true);
      await servicesRequest(service ? `/api/services/${id}` : '/api/services', service ? 'PATCH' : 'POST', {
        ...(service ? { expectedVersion: service.version } : { id }), name, categoryId: categoryId || null, description, defaultDurationMinutes: Number(duration), standardPrice: price, active, branchSettings,
      }, request.signal, request.current);
      // The server may already have committed. Discard obsolete UI completion;
      // current-scope GET/version checks reconcile it without an automatic retry.
      if (request.current()) onSaved();
    } catch (e: any) { if (request.current()) { setError(e.message); setConflict(e.code === 'STALE_VERSION' || e.code === 'CREATE_CONFLICT'); } }
    finally { if (request.current()) setSaving(false); request.finish(); }
  };
  return <section className="mx-auto max-w-4xl space-y-6">
    <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} disabled={saving} onClick={onClose}><ArrowLeft size={16} /> Back to services</button>
    <div><h2 tabIndex={-1} ref={heading} className="text-2xl font-semibold tracking-tight text-slate-950 outline-none">{service ? writable ? 'Edit service' : 'Service details' : 'Create service'}</h2><p className="mt-2 text-sm text-slate-600">Configure the catalogue and branch prices. Duration is descriptive; scheduling is unchanged.</p></div>
    {loadError && <Failure error={loadError} retry={onReload} />}
    {error && <Failure error={error} retry={conflict ? onReload : undefined} />}
    <form onSubmit={save} className="space-y-8"><fieldset disabled={!writable || saving || conflict} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="service-name" className="mb-2 block text-sm font-medium text-slate-700">Service name</label><input id="service-name" className={inputClass} required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></div>
      <div><label htmlFor="service-category" className="mb-2 block text-sm font-medium text-slate-700">Category</label><select id="service-category" className={inputClass} value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Uncategorized</option>{categories.filter((c: any) => c.active || c.id === categoryId).map((c: any) => <option key={c.id} value={c.id}>{c.name}{!c.active ? ' (inactive)' : ''}</option>)}</select></div></div>
      <div><label htmlFor="service-description" className="mb-2 block text-sm font-medium text-slate-700">Description</label><textarea id="service-description" rows={3} className={inputClass} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="service-duration" className="mb-2 block text-sm font-medium text-slate-700">Default duration (minutes)</label><input id="service-duration" className={inputClass} required type="number" min={1} max={1440} step={1} value={duration} onChange={e => setDuration(e.target.value)} /><p className="mt-2 text-xs text-slate-600">Estimated treatment duration, not a reserved time interval.</p></div><fieldset disabled={!pricing}><PriceFields id="service-price" label="Standard price" value={price} onChange={setPrice} /></fieldset></div>
      <label className="flex items-center gap-3 text-sm font-medium text-slate-800"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-teal-700" /> Active service</label>
      <section className="space-y-4 border-t border-slate-200 pt-6"><div><h3 className="text-lg font-semibold text-slate-950">Branch availability and prices</h3><p className="mt-1 text-sm text-slate-600">Enable each branch explicitly. An override replaces the standard price.</p></div>
      {branches.length === 0 && <p className="text-sm text-slate-600">No accessible branches are configured.</p>}
      {branches.map((b: any) => {
        const row = settings[b.id], standard = preview(price), override = preview(row.price, true);
        const effective = standard === undefined || override === undefined ? 'Enter a valid amount' : priceLabel(effectiveServicePrice(standard, override).amount);
        const originallyEnabled = service?.branchSettings?.some((s: any) => s.branch_id === b.id && s.available);
        return <div key={b.id} className="grid gap-4 border-b border-slate-200 pb-5 sm:grid-cols-[1fr_1fr]"><div><h4 className="font-semibold text-slate-900">{b.name || b.id}</h4><p className="mt-1 text-xs text-slate-600">{b.status === 'Active' ? 'Active branch' : 'Inactive branch — unavailable operationally'}</p><label className="mt-3 flex items-center gap-3 text-sm text-slate-800"><input aria-label={`Available at ${b.name || b.id}`} type="checkbox" checked={row.available} disabled={b.status !== 'Active' && !originallyEnabled} onChange={e => updateBranch(b.id, { available: e.target.checked })} className="h-4 w-4 accent-teal-700" /> Available</label></div><div><fieldset disabled={!pricing}><PriceFields id={`branch-price-${b.id}`} label={`Price at ${b.name || b.id}`} branch value={row.price} onChange={p => updateBranch(b.id, { price: p })} /></fieldset><p className="mt-2 text-sm text-slate-700">Configured price: <strong>{effective}</strong>{(!row.available || !active || b.status !== 'Active') && ' · Unavailable'}</p></div></div>;
      })}</section>
    </fieldset>{writable && <div className="flex flex-wrap gap-3"><button type="submit" disabled={saving || conflict} className={primaryClass}>{saving ? 'Saving…' : 'Save service'}</button><button type="button" disabled={saving} className={buttonClass} onClick={onClose}>Cancel</button></div>}</form>
  </section>;
}
function CategoryManager({ categories, onRefresh, scope, accessGeneration }: any) {
  const beginMutation = useServicesMutation(scope, accessGeneration);
  const [editing, setEditing] = useState<any>(null), [id, setId] = useState(() => crypto.randomUUID()), [name, setName] = useState(''), [active, setActive] = useState(true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const reset = () => { setEditing(null); setId(crypto.randomUUID()); setName(''); setActive(true); setError(''); setConflict(false); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy || conflict) return; const request = beginMutation(); setBusy(true); setError('');
    try { await servicesRequest(editing ? `/api/service-categories/${editing.id}` : '/api/service-categories', editing ? 'PATCH' : 'POST', { ...(editing ? { expectedVersion: editing.version } : { id }), name, active }, request.signal, request.current); if (request.current()) { reset(); onRefresh(); } }
    catch (e: any) { if (request.current()) { setError(e.message); setConflict(e.code === 'STALE_VERSION' || e.code === 'CREATE_CONFLICT'); } } finally { if (request.current()) setBusy(false); request.finish(); }
  };
  return <section className="space-y-4 border-t border-slate-200 pt-6"><h2 className="text-lg font-semibold text-slate-950">Manage categories</h2>
    {error && <Failure error={error} retry={conflict ? () => { reset(); onRefresh(); } : undefined} />}
    <form onSubmit={save} className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 basis-56"><label htmlFor="category-name" className="mb-2 block text-sm font-medium text-slate-700">{editing ? 'Category name' : 'New category name'}</label><input id="category-name" className={inputClass} required maxLength={80} disabled={busy || conflict} value={name} onChange={e => setName(e.target.value)} /></div><label className="flex items-center gap-2 py-3 text-sm"><input type="checkbox" checked={active} disabled={busy || conflict} onChange={e => setActive(e.target.checked)} /> Active category</label><button className={primaryClass} disabled={busy || conflict}>{busy ? 'Saving…' : editing ? 'Save category' : 'Create category'}</button>{editing && <button type="button" className={buttonClass} disabled={busy} onClick={reset}>Cancel edit</button>}</form>
    <ul className="divide-y divide-slate-200">{categories.map((c: any) => <li key={c.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0 break-words text-sm text-slate-800">{c.name} <span className="text-slate-600">· {c.active ? 'Active' : 'Inactive'}</span></span><button type="button" className={buttonClass} disabled={busy} aria-label={`Edit category ${c.name}`} onClick={() => { setEditing(c); setName(c.name); setActive(c.active); setError(''); setConflict(false); }}>Edit</button></li>)}</ul>
  </section>;
}
export default function ServicesDashboard({ userProfile, activeBranchId }: any) {
  const global = canManageServices(userProfile?.role);
  const assigned = global ? [] : [...new Set<string>(Array.isArray(userProfile?.assignedBranches) ? userProfile.assignedBranches.filter((id: unknown): id is string => typeof id === 'string') : [])].sort();
  // Reuse the session identity and Services policy. A keyed workspace removes old
  // protected state during the scope-change render, before any passive effects.
  const scope = JSON.stringify([uiPermissionScope(userProfile), auth.currentUser?.uid ?? null, userProfile?.role ?? null, userProfile?.active === true, global, assigned, activeBranchId]);
  const accessGeneration = useRef({ scope, generation: 0 });
  useLayoutEffect(() => {
    accessGeneration.current = { scope, generation: accessGeneration.current.generation + 1 };
    return () => { accessGeneration.current.generation++; };
  }, [scope]);
  return <ServicesWorkspace key={scope} scope={scope} accessGeneration={accessGeneration} userProfile={userProfile} activeBranchId={activeBranchId} />;
}
function ServicesWorkspace({ userProfile, activeBranchId, scope, accessGeneration }: any) {
  const writable = uiCan(userProfile, 'services.manage');
  const pricing = uiCan(userProfile, 'services.pricing');
  const [data, setData] = useState<any>(null), [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [q, setQ] = useState(''), [search, setSearch] = useState('');
  const [category, setCategory] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<any>(null), [managingCategories, setManagingCategories] = useState(false);
  const lifetime = useRef({ generation: 0, active: false });
  const detailRequest = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    lifetime.current.generation++; lifetime.current.active = true;
    return () => { lifetime.current.generation++; lifetime.current.active = false; detailRequest.current?.abort(); };
  }, [scope]);
  useEffect(() => { const timer = setTimeout(() => { setSearch(q); setPage(1); }, 250); return () => clearTimeout(timer); }, [q]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const generation = lifetime.current.generation;
    const access = accessGeneration.current.generation;
    const current = () => accessGeneration.current.scope === scope && accessGeneration.current.generation === access && lifetime.current.active && lifetime.current.generation === generation && !controller.signal.aborted;
    const params = new URLSearchParams({ q: search, status, page: String(page), pageSize: '25' });
    if (category) params.set('categoryId', category);
    if (activeBranchId && activeBranchId !== 'All') params.set('branchId', activeBranchId);
    Promise.all([servicesRequest(`/api/services?${params}`, 'GET', undefined, controller.signal, current), servicesRequest('/api/service-categories', 'GET', undefined, controller.signal, current)])
      .then(([result, c]) => { if (!current()) return; if (page > 1 && (page - 1) * 25 >= result.total) { setPage(Math.max(1, Math.ceil(result.total / 25))); return; } setData(result); setCategories(c.categories); })
      .catch(e => { if (current()) setError(e.message); }).finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [search, status, category, page, refresh, activeBranchId, scope]);
  const close = () => { detailRequest.current?.abort(); detailRequest.current = null; setEditor(null); };
  const open = async (id: string) => {
    if (!lifetime.current.active) return;
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    const generation = lifetime.current.generation;
    const access = accessGeneration.current.generation;
    const current = () => accessGeneration.current.scope === scope && accessGeneration.current.generation === access && lifetime.current.active && lifetime.current.generation === generation && !controller.signal.aborted;
    setError('');
    try {
      const detail = await servicesRequest(`/api/services/${id}`, 'GET', undefined, controller.signal, current);
      if (current()) setEditor({ service: detail, branches: detail.branches, key: `${id}-${detail.version}` });
    } catch (e: any) { if (current()) setError(e.message); }
    finally { if (detailRequest.current === controller) detailRequest.current = null; }
  };
  const saved = () => { if (!lifetime.current.active) return; close(); setRefresh(v => v + 1); };
  return <div className="p-4 text-slate-900 sm:p-6 lg:p-8">
    {editor ? <ServiceEditor key={editor.key} service={editor.service} branches={editor.branches} categories={categories} writable={writable} pricing={pricing} loadError={error} onClose={close} onSaved={saved} onReload={() => editor.service ? open(editor.service.id) : saved()} scope={scope} accessGeneration={accessGeneration} /> : <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">Services</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Manage treatments, estimated duration, branch availability, and current prices.</p></div>{writable && <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={loading || !!error} onClick={() => setManagingCategories(v => !v)}>{managingCategories ? 'Close categories' : 'Manage categories'}</button><button className={`${primaryClass} inline-flex items-center gap-2`} disabled={loading || !!error} onClick={() => { close(); setEditor({ service: null, branches: data.branches, key: crypto.randomUUID() }); }}><Plus size={16} /> Create service</button></div>}</header>
      <div className="flex flex-wrap gap-3"><div className="relative min-w-0 flex-1 basis-64"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-600" /><input aria-label="Search services" className={`${inputClass} pl-9`} placeholder="Search services" value={q} onChange={e => setQ(e.target.value)} /></div><select aria-label="Filter by category" className={`${inputClass} sm:w-52`} value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="">All categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}{!c.active ? ' (inactive)' : ''}</option>)}</select><select aria-label="Filter by service status" className={`${inputClass} sm:w-40`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      {error ? <Failure error={error} retry={() => setRefresh(v => v + 1)} /> : loading ? <p role="status" className="py-10 text-sm text-slate-600">Loading services…</p> : data?.services.length === 0 ? <div role="status" className="border-y border-slate-200 py-12"><h2 className="font-semibold text-slate-900">{q || category || status !== 'all' ? 'No matching services' : 'No services yet'}</h2><p className="mt-2 text-sm text-slate-600">{q || category || status !== 'all' ? 'Adjust the search or filters.' : writable ? 'Create a service and enable the branches where it is offered.' : 'An administrator can configure the service catalogue.'}</p></div> : <>
        <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><caption className="sr-only">Service catalogue</caption><thead className="bg-slate-50 text-slate-700"><tr>{['Service', 'Standard price', 'Duration', 'Status', 'Branches', 'Action'].map(h => <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{data?.services.map((s: any) => <tr key={s.id}><td className="min-w-40 px-4 py-4"><p className="max-w-72 break-words font-semibold text-slate-950">{s.name}</p><p className="mt-1 text-xs text-slate-600">{s.category_name || 'Uncategorized'}{s.category_active === false ? ' (inactive category)' : ''}</p></td><td className="whitespace-nowrap px-4 py-4 tabular-nums">{priceLabel(s.standard_price)}</td><td className="whitespace-nowrap px-4 py-4">{s.default_duration_minutes} min</td><td className="px-4 py-4">{s.active ? 'Active' : 'Inactive'}</td><td className="min-w-48 px-4 py-4"><p>{s.branches.filter((b: any) => b.operationallyAvailable).length} of {s.branches.length} available</p>{s.branches.map((b: any) => <p key={b.id} className="mt-1 text-xs text-slate-600">{b.name || b.id}: {b.operationallyAvailable ? priceLabel(b.effectivePrice.amount) : 'Unavailable'}</p>)}</td><td className="px-4 py-4"><button className={buttonClass} aria-label={`${writable ? 'Edit' : 'View'} service ${s.name}`} onClick={() => open(s.id)}>{writable ? 'Edit' : 'View'}</button></td></tr>)}</tbody></table></div>
        <nav aria-label="Service pages" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{data.total} services · Page {page} of {Math.max(1, Math.ceil(data.total / 25))}</p><div className="flex gap-2"><button className={buttonClass} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><button className={buttonClass} disabled={page * 25 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></div></nav>
      </>}{managingCategories && writable && !loading && !error && <CategoryManager categories={categories} onRefresh={() => setRefresh(v => v + 1)} scope={scope} accessGeneration={accessGeneration} />}
    </div>}
  </div>;
}
