import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { hasCapability, permissionScopeKey } from '../permissions';
import { packagesRequest as request } from '../utils/packageCatalogueApi';
import { centsText, moneyCents, type PosLineInput } from '../posPolicy';
const field = 'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60';
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50';
const primary = button + ' !border-teal-600 !bg-teal-600 !text-white hover:!bg-teal-700';
const currency = (cents: number | string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(cents) / 100);
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Launch = {
    patientId: string;
    branchId: string;
    visitId: string;
};
export default function PosDashboard(props: {
    userProfile: any;
    activeBranchId?: string;
    launch?: Launch | null;
}) {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => subscribeProtectedDataInvalidation(() => setEpoch(n => n + 1)), []);
    const scope = JSON.stringify([auth.currentUser?.uid, permissionScopeKey(props.userProfile), props.userProfile?.role, props.userProfile?.active, props.userProfile?.isArchived, props.userProfile?.assignedBranches, props.activeBranchId, epoch, props.launch]);
    return <PosWorkspace key={scope} {...props}/>;
}
function PosWorkspace({ userProfile, activeBranchId, launch }: {
    userProfile: any;
    activeBranchId?: string;
    launch?: Launch | null;
}) {
    const life = useRef<AbortController | null>(null);
    useLayoutEffect(() => { const c = new AbortController(); life.current = c; return () => c.abort(); }, []);
    const api = (path: string, method = 'GET', body?: any, current?: () => boolean) => { const c = life.current!; return request('/api/pos' + path, method, body, c.signal, () => life.current === c && !c.signal.aborted && (!current || current())); };
    const [branches, setBranches] = useState<any[]>([]), [branch, setBranch] = useState(launch?.branchId || (activeBranchId === 'All' ? '' : activeBranchId) || '');
    const [tab, setTab] = useState('invoices'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
    const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading'), [readError, setReadError] = useState('');
    const [list, setList] = useState<any>({ invoices: [], total: 0 }), [page, setPage] = useState(1), [selected, setSelected] = useState<any>(null), [editing, setEditing] = useState(Boolean(launch));
    const [patient, setPatient] = useState(launch?.patientId || ''), [patientName, setPatientName] = useState(''), [search, setSearch] = useState(''), [itemSearch, setItemSearch] = useState('');
    const [options, setOptions] = useState<any>({ patients: [], services: [], packages: [], sources: [] });
    const [items, setItems] = useState<(PosLineInput & {
        name: string;
        price?: string | null;
    })[]>([]), [notes, setNotes] = useState('');
    const [kind, setKind] = useState('service'), [choice, setChoice] = useState('');
    const [sourceSearch, setSourceSearch] = useState(''), [sourcePage, setSourcePage] = useState(1);
    const [sourceResults, setSourceResults] = useState<any>({ sources: [], total: 0 });
    const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'error'>('ready'), [sourceError, setSourceError] = useState(''), [sourceRetry, setSourceRetry] = useState(0);
    const [launchState, setLaunchState] = useState<'loading' | 'ready' | 'error'>(launch ? 'loading' : 'ready'), [launchError, setLaunchError] = useState(''), [launchRetry, setLaunchRetry] = useState(0);
    const [amount, setAmount] = useState(''), [tender, setTender] = useState(''), [method, setMethod] = useState('cash'), [reference, setReference] = useState(''), [orNumber, setOrNumber] = useState(''), [voidReason, setVoidReason] = useState('');
    const [from, setFrom] = useState(day()), [to, setTo] = useState(day()), [sales, setSales] = useState<any>(null), [allBranches, setAllBranches] = useState(false);
    const [pending, setPending] = useState<any>(null), [confirmPost, setConfirmPost] = useState(false);
    const flight = useRef(false);
    const latest = useRef(0), optionsGeneration = useRef(0), sourcesGeneration = useRef(0), launchGeneration = useRef(0), initialized = useRef(false);
    const can = (cap: any) => hasCapability(userProfile, cap, branch ? { branchId: branch } : {});
    useEffect(() => { api('/branches').then(data => { setBranches(data.branches); if (!branch)
        setBranch(data.branches.find((b: any) => b.status === 'Active')?.id || ''); }).catch(e => { if (e.name !== 'AbortError')
        setError(e.message); }); }, []);
    useLayoutEffect(() => {
        if (!branch)
            return;
        const generation = ++latest.current;
        setReadState('loading');
        setReadError('');
        setList({ invoices: [], total: 0 });
        setSales(null);
        const path = tab === 'sales' ? `/sales?from=${from}&to=${to}${allBranches ? '' : `&branchId=${encodeURIComponent(branch)}`}` : `/invoices?branchId=${encodeURIComponent(branch)}&page=${page}`;
        api(path, 'GET', undefined, () => generation === latest.current).then(data => { if (generation !== latest.current)
            return; setReadState('ready'); if (tab === 'sales')
            setSales(data);
        else
            setList(data); }).catch(e => { if (generation === latest.current && e.name !== 'AbortError') {
            setReadState('error'); setReadError(e.message); } });
        return () => { latest.current++; };
    }, [branch, tab, tick, page, from, to, allBranches]);
    useLayoutEffect(() => {
        if (!branch || !editing)
            return;
        const generation = ++optionsGeneration.current;
        setOptions({ patients: [], services: [], packages: [], sources: [] });
        const timer = setTimeout(() => {
            api(`/options?branchId=${encodeURIComponent(branch)}&patientId=${encodeURIComponent(patient)}&q=${encodeURIComponent(search)}&itemSearch=${encodeURIComponent(itemSearch)}`, 'GET', undefined, () => generation === optionsGeneration.current).then(data => {
                if (generation !== optionsGeneration.current)
                    return;
                setOptions(data);
            }).catch(e => { if (generation === optionsGeneration.current && e.name !== 'AbortError')
                setError(e.message); });
        }, 150);
        return () => { clearTimeout(timer); optionsGeneration.current++; };
    }, [branch, editing, patient, search, itemSearch, tick]);
    // Saved quotes use their own bounded pages; catalogue options must not truncate history.
    useLayoutEffect(() => {
        if (!editing || !patient || !branch || !['visit', 'appointment'].includes(kind))
            return;
        const generation = ++sourcesGeneration.current;
        setSourceState('loading');
        setSourceError('');
        setSourceResults({ sources: [], total: 0 });
        const timer = setTimeout(() => {
            api(`/sources?branchId=${encodeURIComponent(branch)}&patientId=${encodeURIComponent(patient)}&kind=${kind}&q=${encodeURIComponent(sourceSearch)}&page=${sourcePage}`, 'GET', undefined, () => generation === sourcesGeneration.current).then(data => {
                if (generation !== sourcesGeneration.current) return;
                setSourceResults(data);
                setSourceState('ready');
            }).catch(e => {
                if (generation === sourcesGeneration.current && e.name !== 'AbortError') {
                    setSourceError(e.message);
                    setSourceState('error');
                }
            });
        }, 150);
        return () => { clearTimeout(timer); sourcesGeneration.current++; };
    }, [branch, editing, patient, kind, sourceSearch, sourcePage, sourceRetry]);
    // Fetch the exact launched Visit even when it is outside the current result page.
    useLayoutEffect(() => {
        if (!launch || initialized.current || !editing || patient !== launch.patientId || branch !== launch.branchId)
            return;
        const generation = ++launchGeneration.current;
        setLaunchState('loading');
        setLaunchError('');
        api(`/sources/visit/${encodeURIComponent(launch.visitId)}?branchId=${encodeURIComponent(branch)}&patientId=${encodeURIComponent(patient)}`, 'GET', undefined, () => generation === launchGeneration.current && !initialized.current).then(data => {
            if (generation !== launchGeneration.current || initialized.current) return;
            const source = data.source;
            setItems([{ kind: 'visit', id: source.id, expectedVersion: source.version, name: source.name, price: source.price }]);
            initialized.current = true;
            setLaunchState('ready');
        }).catch(e => {
            if (generation === launchGeneration.current && e.name !== 'AbortError') {
                setLaunchError(e.message);
                setLaunchState('error');
            }
        });
        return () => { launchGeneration.current++; };
    }, [branch, editing, patient, launchRetry]);
    const perform = async (command: any) => {
        if (flight.current)
            return;
        flight.current = true;
        setBusy(true);
        setError('');
        setPending(command);
        try {
            const data = await api(command.path, command.method, command.body);
            setSelected(data);
            setEditing(false);
            setConfirmPost(false);
            setPending(null);
            setAmount('');
            setTender('');
            setReference('');
            setOrNumber(data.or_number || '');
            setVoidReason('');
            setTick(n => n + 1);
        }
        catch (e: any) {
            if (e.name !== 'AbortError') {
                setError(e.message);
                if (e.status && e.status < 500)
                    setPending(null);
            }
        }
        finally {
            flight.current = false;
            if (!life.current?.signal.aborted)
                setBusy(false);
        }
    };
    const send = (path: string, body: any, method = 'POST') => perform({ path, method, body: { ...body, commandId: crypto.randomUUID() } });
    const open = async (id: string) => { setBusy(true); setError(''); try {
        const data = await api('/invoices/' + id);
        setSelected(data);
        setOrNumber(data.or_number || '');
    }
    catch (e: any) {
        if (e.name !== 'AbortError')
            setError(e.message);
    }
    finally {
        if (!life.current?.signal.aborted)
            setBusy(false);
    } };
    const start = (invoice?: any) => {
        initialized.current = true;
        setLaunchState('ready');
        setLaunchError('');
        setSourceSearch('');
        setSourcePage(1);
        setEditing(true);
        setError('');
        setSelected(invoice || null);
        setPatient(invoice?.patient_id || '');
        setPatientName(invoice?.patient_name || '');
        setNotes(invoice?.notes || '');
        setSearch('');
        setItemSearch('');
        setChoice('');
        setItems(invoice ? invoice.items.map((l: any) => ({ ...l.snapshot.input, name: l.name, price: centsText(l.snapshot.originalAmount ?? l.amount_cents) })) : []);
    };
    const choices = kind === 'service' ? options.services : kind === 'package' ? options.packages : sourceResults.sources;
    const add = () => { const option = choices.find((o: any) => o.id === choice); if (!option)
        return; if (items.some(i => i.kind === kind && i.id === choice)) {
        setError('This item is already included.');
        return;
    } setItems([...items, { kind: kind as PosLineInput['kind'], id: choice, expectedVersion: option.version, name: option.name, price: option.price ?? null, ...(kind === 'package' ? { amount: '' } : {}) }]); setChoice(''); };
    const update = (index: number, patch: any) => setItems(items.map((l, i) => i === index ? { ...l, ...patch } : l));
    let preview: number | null = 0;
    try {
        for (const l of items)
            preview += moneyCents(l.amount !== undefined ? l.amount : l.price);
    }
    catch {
        preview = null;
    }
    const save = (e: React.FormEvent) => { e.preventDefault(); send(selected ? '/invoices/' + selected.id : '/invoices', { expectedVersion: selected?.version || 0, patientId: patient, branchId: branch, notes, items: items.map(({ name, price, ...l }) => l) }, selected ? 'PATCH' : 'POST'); };
    const leave = () => { if (editing && !window.confirm('Discard these unsaved invoice entries?'))
        return; setEditing(false); setSelected(null); setError(''); setConfirmPost(false); };
    const locked = busy || Boolean(pending) || launchState === 'loading';
    return <div className="mx-auto max-w-6xl space-y-6 py-4 sm:py-8">
  <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight text-slate-950">POS &amp; Payments</h1><p className="mt-1 text-sm text-slate-600">Confirm prices, collect payments and track clinic balances.</p></div>{!selected && !editing && can('pos.manage') && <button className={primary} disabled={locked || !branch} onClick={() => start()}>New invoice</button>}</header>
  {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
  {pending && !busy && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The result is uncertain. Retry this same request before making another change. <button className={button} onClick={() => perform(pending)}>Retry request</button></div>}
  <div className="flex flex-wrap items-end gap-3"><label className="block w-full max-w-sm space-y-1 text-xs font-semibold text-slate-600">Clinic<select className={field} value={branch} disabled={locked || editing || Boolean(selected)} onChange={e => { setBranch(e.target.value); setPage(1); setError(''); }}><option value="">Select clinic</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.status === 'Active' ? '' : ' (inactive)'}</option>)}</select></label>{!editing && !selected && <><button className={tab === 'invoices' ? primary : button} disabled={locked} onClick={() => setTab('invoices')}>Invoices</button>{can('pos.sales') && <button className={tab === 'sales' ? primary : button} disabled={locked} onClick={() => setTab('sales')}>Clinic sales</button>}<button className={button} disabled={locked} onClick={() => { setError(''); setTick(n => n + 1); }}>Refresh</button></>}{(editing || selected) && <button className={button} disabled={locked} onClick={leave}>Back to invoices</button>}</div>
  {!editing && !selected && readState === 'loading' && <p role="status" className="text-sm text-slate-600">{branch ? 'Loading clinic records…' : 'Select a clinic to view records.'}</p>}
  {!editing && !selected && readState === 'error' && <p role="alert" className="text-sm text-rose-800">{readError} Use Refresh to try again.</p>}
  {editing ? <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><h2 className="text-lg font-semibold">{selected ? 'Edit draft' : 'New invoice'}</h2>{launchState === 'loading' && <p role="status" className="text-sm text-slate-600">Loading saved Visit quote…</p>}{launchState === 'error' && <div role="alert" className="space-y-2 text-sm text-rose-800"><p>{launchError}</p><button type="button" className={button} onClick={() => setLaunchRetry(n => n + 1)}>Retry saved Visit</button></div>}<fieldset disabled={locked || launchState === 'error'} className="space-y-5">
   <div className="grid gap-4 sm:grid-cols-2"><label className="min-w-0 space-y-1 text-sm font-medium">Search patient<input className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or patient ID"/></label><label className="min-w-0 space-y-1 text-sm font-medium">Patient<select required className={field} value={patient} onChange={e => { initialized.current = true; setLaunchState('ready'); setLaunchError(''); setSourcePage(1); setSourceSearch(''); setChoice(''); setPatient(e.target.value); setPatientName(options.patients.find((p: any) => p.id === e.target.value)?.name || ''); setItems([]); }}><option value="">Choose patient</option>{patient && !options.patients.some((p: any) => p.id === patient) && <option value={patient}>{patientName || 'Selected patient'}</option>}{options.patients.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
   <p className="text-xs text-slate-600">Changing the patient clears invoice items. Saved quotes retain their Special Price; new Services use this clinic’s price. Package selling prices are entered here.</p>
   <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"><label className="min-w-0 space-y-1 text-sm font-medium">Item type<select className={field} value={kind} onChange={e => { setKind(e.target.value); setSourceSearch(''); setSourcePage(1); setChoice(''); }}><option value="service">Service</option><option value="package">Package</option><option value="visit">Saved Visit quote</option><option value="appointment">Saved booking quote</option></select></label><label className="min-w-0 space-y-1 text-sm font-medium">Item<select className={field} value={choice} disabled={!patient || (['visit', 'appointment'].includes(kind) && sourceState !== 'ready')} onChange={e => setChoice(e.target.value)}><option value="">Choose an item</option>{choices.map((o: any) => <option key={o.id} value={o.id}>{o.name}{o.date ? ` · ${o.date}` : ''}{o.price != null ? ` · ₱${o.price}` : ''} · v{o.version}</option>)}</select></label><button type="button" className={button + ' self-end'} disabled={!choice || items.length >= 20 || (['visit', 'appointment'].includes(kind) && sourceState !== 'ready')} onClick={add}>Add item</button></div>
   {(kind === 'service' || kind === 'package') && <label className="block space-y-1 text-xs font-medium text-slate-600">Search catalogue (up to 100 matches)<input className={field} value={itemSearch} onChange={e => setItemSearch(e.target.value)}/></label>}
   {(kind === 'visit' || kind === 'appointment') && <section className="space-y-3" aria-label="Saved quote search">
    <label className="block space-y-1 text-xs font-medium text-slate-600">Search saved quotes<input className={field} maxLength={100} disabled={!patient} value={sourceSearch} placeholder="Service, date, visit type or record ID" onChange={e => { setSourceSearch(e.target.value); setSourcePage(1); setChoice(''); }}/></label>
    {patient && sourceState === 'loading' && <p role="status" className="text-sm text-slate-600">Loading saved quotes…</p>}
    {patient && sourceState === 'error' && <div role="alert" className="text-sm text-rose-800">{sourceError} <button type="button" className={button} onClick={() => setSourceRetry(n => n + 1)}>Retry saved quotes</button></div>}
    {patient && sourceState === 'ready' && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p>{sourceResults.total ? `${sourceResults.total} saved quotes · Page ${sourcePage}` : 'No matching saved quotes.'}</p><div className="flex gap-2"><button type="button" className={button} disabled={sourcePage <= 1} onClick={() => { setSourcePage(n => n - 1); setChoice(''); }}>Previous quotes</button><button type="button" className={button} disabled={sourcePage * 50 >= sourceResults.total} onClick={() => { setSourcePage(n => n + 1); setChoice(''); }}>Next quotes</button></div></div>}
   </section>}
   <div className="divide-y divide-slate-200">{items.map((l, index) => <article key={l.kind + l.id} className="space-y-3 py-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{l.name}</h3><p className="text-xs text-slate-500">{l.kind} · version {l.expectedVersion}</p></div><button type="button" className={button} onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</button></div>
    {l.kind === 'package' || can('pos.adjust') ? <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">{l.kind === 'package' ? 'Package selling price (PHP)' : 'Price override (optional, PHP)'}<input className={field} inputMode="decimal" required={l.kind === 'package'} value={l.amount ?? ''} placeholder={l.price ?? 'No saved quote'} onChange={e => update(index, { amount: e.target.value === '' && l.kind !== 'package' ? undefined : e.target.value })}/></label>{l.kind !== 'package' && l.amount !== undefined && <label className="space-y-1 text-sm">Adjustment reason<input className={field} required maxLength={1000} value={l.reason ?? ''} onChange={e => update(index, { reason: e.target.value })}/></label>}</div> : <p className="text-sm font-semibold">{l.price == null ? 'Price unavailable — Admin confirmation needed' : currency(moneyCents(l.price))}</p>}
   </article>)}</div><label className="block space-y-1 text-sm font-medium">Invoice notes<textarea className={field} rows={2} maxLength={3000} value={notes} onChange={e => setNotes(e.target.value)}/></label>
   <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4"><p className="text-lg font-semibold">Draft total <span className="ml-3 tabular-nums">{preview === null ? 'Confirm prices' : currency(preview)}</span></p><button className={primary} disabled={!patient || !items.length || preview === null}>{busy ? 'Saving…' : 'Save draft'}</button></div><p className="text-xs text-slate-600">Saving a draft creates no sale, payment or package sessions. Review it before posting.</p>
  </fieldset></form> : selected ? <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Invoice details">
   <div className="flex flex-wrap justify-between gap-4"><div><h2 className="text-xl font-semibold">Invoice #{selected.number}</h2><p className="mt-1 text-sm">{selected.patient_name} · {selected.branch_name}</p><p className="mt-1 text-xs font-semibold uppercase text-teal-800">{selected.state}{selected.state === 'posted' ? selected.outstanding_cents === 0 ? ' · Paid' : selected.paid_cents ? ' · Partially paid' : ' · Unpaid' : ''}</p></div><div className="text-right"><p className="text-sm text-slate-600">Invoice total</p><p className="text-2xl font-semibold tabular-nums">{currency(selected.total_cents)}</p></div></div>
   <ul className="divide-y divide-slate-200">{selected.items.map((l: any) => <li key={l.id} className="flex justify-between gap-4 py-3 text-sm"><div className="min-w-0 break-words"><p className="font-medium">{l.name}</p><p className="text-xs text-slate-500">{l.kind} · v{l.snapshot.input.expectedVersion}</p>{l.snapshot.input.reason && <p className="text-xs">Price reason: {l.snapshot.input.reason}</p>}{l.snapshot.packageTerms && <ul className="mt-1 text-xs text-slate-600">{l.snapshot.packageTerms.lines.map((s: any) => <li key={s.serviceId}>{s.serviceNameSnapshot} · {s.purchasedSessions} sessions</li>)}</ul>}</div><span className="shrink-0 font-semibold tabular-nums">{currency(l.amount_cents)}</span></li>)}</ul>
   {selected.notes && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{selected.notes}</p>}
   <div className="flex flex-wrap gap-8 rounded-xl bg-slate-50 p-4"><p className="text-sm">Collected <strong className="ml-2 tabular-nums">{currency(selected.paid_cents)}</strong></p><p className="text-sm">Outstanding <strong className="ml-2 tabular-nums">{currency(selected.outstanding_cents)}</strong></p></div>
   {selected.items.some((l: any) => l.kind === 'package') && <p className="text-sm text-slate-600">{selected.state === 'draft' ? 'Posting creates linked Treatment Ledger purchases.' : selected.state === 'posted' && selected.outstanding_cents === 0 ? 'Package sessions are available in the Treatment Ledger.' : 'Package sessions remain locked.'} Sessions unlock only when the full invoice is paid.</p>}
   {selected.state === 'draft' && can('pos.manage') && <div className="space-y-3"><div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => start(selected)}>Edit draft</button><button className={primary} disabled={locked} onClick={() => setConfirmPost(true)}>Post invoice</button></div>{confirmPost && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>Confirm {currency(selected.total_cents)} for {selected.patient_name}. Posted prices cannot be edited.</p><button className={primary} disabled={locked} onClick={() => send(`/invoices/${selected.id}/post`, { expectedVersion: selected.version })}>Confirm and post</button> <button className={button} disabled={locked} onClick={() => setConfirmPost(false)}>Cancel</button></div>}</div>}
   {selected.state === 'posted' && selected.outstanding_cents > 0 && can('pos.collect') && <form onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/payments`, { expectedVersion: selected.version, method, amount, tender: method === 'cash' ? tender : amount, reference }); }} className="space-y-3 border-t border-slate-200 pt-4"><h3 className="font-semibold">Record payment</h3><fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Method<select className={field} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="gcash">GCash</option><option value="bank">Bank transfer</option></select></label><label className="space-y-1 text-sm">Payment amount (PHP)<input className={field} inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)}/></label>{method === 'cash' && <label className="space-y-1 text-sm">Cash tendered (PHP)<input className={field} inputMode="decimal" required value={tender} onChange={e => setTender(e.target.value)}/></label>}<label className="space-y-1 text-sm">Reference {method === 'cash' ? '(optional)' : '(required)'}<input className={field} required={method !== 'cash'} value={reference} maxLength={120} onChange={e => setReference(e.target.value)}/></label><button className={primary + ' sm:col-span-2'}>Record payment</button></fieldset><p className="text-xs text-slate-600">Enter payments already received. This records the payment; it does not charge a card or wallet.</p></form>}
   {selected.payments.length > 0 && <section aria-label="Payment acknowledgments" className="space-y-3"><h3 className="font-semibold">Payment acknowledgments</h3>{selected.payments.map((p: any) => <article key={p.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">{currency(p.amount_cents)} · {p.method}</p><p className="text-xs text-slate-600">{new Date(p.recorded_at).toLocaleString()} · {p.actor.name}</p>{p.method === 'cash' && <p className="mt-1">Tendered {currency(p.tender_cents)} · Change {currency(Number(p.tender_cents) - Number(p.amount_cents))}</p>}{p.reference && <p className="break-words">Reference: {p.reference}</p>}<p className="mt-1 break-all text-xs text-slate-500">Acknowledgment {p.id}</p></article>)}</section>}
   {selected.or_number && <p className="text-sm">OR#: {selected.or_number}</p>}
   {can('treatment_ledger.reference') && selected.state !== 'void' && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/reference`, { expectedVersion: selected.version, orNumber }, 'PATCH'); }}><label className="space-y-1 text-sm">Admin OR#<input className={field} disabled={locked} maxLength={120} value={orNumber} onChange={e => setOrNumber(e.target.value)}/></label><button className={button} disabled={locked}>Save reference</button></form>}
   {can('pos.adjust') && selected.state !== 'void' && selected.paid_cents === 0 && <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-medium">Void unpaid invoice</summary><form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/void`, { expectedVersion: selected.version, reason: voidReason }); }}><label className="grow space-y-1 text-sm">Reason<input required className={field} disabled={locked} value={voidReason} maxLength={1000} onChange={e => setVoidReason(e.target.value)}/></label><button className={button} disabled={locked}>Confirm void</button></form></details>}
   <details><summary className="cursor-pointer text-sm text-slate-600">Invoice history</summary><ul className="mt-2 space-y-2 text-xs text-slate-600">{selected.events.map((e: any) => <li key={e.id}>{new Date(e.recorded_at).toLocaleString()} · {e.kind} · {e.actor.name}{e.detail.reason ? ` · ${e.detail.reason}` : ''}</li>)}</ul></details>
  </section> : tab === 'sales' ? <section className="space-y-4"><div className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm">From<input type="date" className={field} value={from} onChange={e => setFrom(e.target.value)}/></label><label className="space-y-1 text-sm">To<input type="date" className={field} value={to} onChange={e => setTo(e.target.value)}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allBranches} onChange={e => setAllBranches(e.target.checked)}/>All authorized clinics</label></div><p className="text-xs text-slate-600">Sales use the posting date; collections use the payment date (Asia/Manila). Outstanding is the current balance across all dates. Quotes, drafts, voids and session usage are excluded from sales.</p>{sales && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Clinic', 'Invoiced sales', 'Collected', 'Outstanding now'].map(s => <th key={s} className="p-4">{s}</th>)}</tr></thead><tbody>{[...sales.branches, { id: 'total', name: 'Total', ...sales.totals }].map((r: any) => <tr key={r.id} className="border-t border-slate-200"><th className="p-4">{r.name}</th><td className="p-4 tabular-nums">{currency(r.sales)}</td><td className="p-4 tabular-nums">{currency(r.collected)}</td><td className="p-4 tabular-nums">{currency(r.outstanding)}</td></tr>)}</tbody></table></div>}</section> : <section className="space-y-3"><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['Invoice', 'Patient', 'Status', 'Total', 'Collected', ''].map((s, i) => <th key={i} className="p-4">{s || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{list.invoices.map((i: any) => <tr key={i.id} className="border-t border-slate-200"><th className="p-4">#{i.number}</th><td className="p-4">{i.patient_name}</td><td className="p-4">{i.state}{i.state === 'posted' ? Number(i.total_cents) === Number(i.paid_cents) ? ' · Paid' : Number(i.paid_cents) > 0 ? ' · Partially paid' : ' · Unpaid' : ''}</td><td className="p-4 tabular-nums">{currency(i.total_cents)}</td><td className="p-4 tabular-nums">{currency(i.paid_cents)}</td><td className="p-4"><button className={button} disabled={locked} onClick={() => open(i.id)}>Open</button></td></tr>)}</tbody></table>{readState === 'ready' && !list.invoices.length && <p className="p-8 text-center text-sm text-slate-500">No invoices in this clinic.{can('pos.manage') ? ' Create a draft to begin.' : ''}</p>}</div><div className="flex items-center justify-end gap-3 text-sm"><button className={button} disabled={page <= 1 || locked} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page}</span><button className={button} disabled={page * 30 >= list.total || locked} onClick={() => setPage(n => n + 1)}>Next</button></div></section>}
 </div>;
}
