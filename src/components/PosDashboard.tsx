import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { hasCapability, permissionScopeKey } from '../permissions';
import { packagesRequest as request } from '../utils/packageCatalogueApi';
import { centsText, moneyCents, type PosLineInput } from '../posPolicy';
import type { VisitPosLaunch } from '../utils/visitBilling';
import SalesOverview from './SalesOverview';
import { salesRange } from '../utils/salesOverview';
import VisitBillingWorklist from './VisitBillingWorklist';
import { publishBillingRefresh, subscribeBillingRefresh } from '../utils/billingRefresh';
const field = 'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60';
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50';
const primary = button + ' !border-teal-600 !bg-teal-600 !text-white hover:!bg-teal-700';
const currency = (cents: number | string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(cents) / 100);
export default function PosDashboard(props: {
    userProfile: any;
    activeBranchId?: string;
    launch?: VisitPosLaunch | null;
    patientContext?: { id: string; name?: string };
    embedded?: boolean;
}) {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => subscribeProtectedDataInvalidation(() => setEpoch(n => n + 1)), []);
    const scope = JSON.stringify([auth.currentUser?.uid, permissionScopeKey(props.userProfile), props.userProfile?.role, props.userProfile?.active, props.userProfile?.isArchived, props.userProfile?.assignedBranches, props.activeBranchId, epoch, props.launch, props.patientContext?.id, props.embedded]);
    if (!hasCapability(props.userProfile, 'pos.view') || !hasCapability(props.userProfile, 'patients.view') || (props.launch && !hasCapability(props.userProfile, 'pos.view', { branchId: props.launch.branchId })))
        return <p className="text-sm text-slate-600">Billing access is unavailable.</p>;
    if (props.launch && !props.launch.invoiceId && !hasCapability(props.userProfile, 'pos.manage', { branchId: props.launch.branchId }))
        return <p className="text-sm text-slate-600">Invoice creation is unavailable.</p>;
    return <PosWorkspace key={scope} {...props}/>;
}
function PosWorkspace({ userProfile, activeBranchId, launch, patientContext, embedded }: {
    userProfile: any;
    activeBranchId?: string;
    launch?: VisitPosLaunch | null;
    patientContext?: { id: string; name?: string };
    embedded?: boolean;
}) {
    const life = useRef<AbortController | null>(null);
    useLayoutEffect(() => { const c = new AbortController(); life.current = c; return () => c.abort(); }, []);
    const api = (path: string, method = 'GET', body?: any, current?: () => boolean) => { const c = life.current!; return request('/api/pos' + path, method, body, c.signal, () => life.current === c && !c.signal.aborted && (!current || current())); };
    const [branches, setBranches] = useState<any[]>([]), [branch, setBranch] = useState(patientContext ? 'All' : launch?.branchId || (activeBranchId === 'All' ? '' : activeBranchId) || '');
    const [tab, setTab] = useState('invoices'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(0), [listEpoch, setListEpoch] = useState(0);
    const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading'), [readError, setReadError] = useState('');
    const [list, setList] = useState<any>({ invoices: [], total: 0 }), [page, setPage] = useState(1), [selected, setSelected] = useState<any>(null), [editing, setEditing] = useState(Boolean(launch && !launch.invoiceId));
    const [patient, setPatient] = useState(patientContext?.id || launch?.patientId || ''), [patientName, setPatientName] = useState(''), [patientNumber, setPatientNumber] = useState(''), [search, setSearch] = useState(''), [itemSearch, setItemSearch] = useState('');
    const [patientSearchOpen, setPatientSearchOpen] = useState(false), [confirmPatientChange, setConfirmPatientChange] = useState(false);
    const patientQuery = search.trim().length >= 2 ? search.trim() : '';
    const [options, setOptions] = useState<any>({ patients: [], services: [], packages: [], sources: [] });
    const [optionsState, setOptionsState] = useState<'loading' | 'ready' | 'error'>('loading'), [optionsError, setOptionsError] = useState(''), [optionsRetry, setOptionsRetry] = useState(0);
    const [items, setItems] = useState<(PosLineInput & {
        name: string;
        price?: string | null;
    })[]>([]), [notes, setNotes] = useState('');
    const [kind, setKind] = useState(hasCapability(userProfile, 'visits.view') ? 'visit' : 'service'), [choice, setChoice] = useState('');
    const [invoiceSearch, setInvoiceSearch] = useState(''), [invoiceStatus, setInvoiceStatus] = useState('all'), [invoiceFrom, setInvoiceFrom] = useState(''), [invoiceTo, setInvoiceTo] = useState('');
    const [sourceSearch, setSourceSearch] = useState(''), [sourcePage, setSourcePage] = useState(1);
    const [sourceResults, setSourceResults] = useState<any>({ sources: [], total: 0 });
    const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'error'>('ready'), [sourceError, setSourceError] = useState(''), [sourceRetry, setSourceRetry] = useState(0);
    const [launchState, setLaunchState] = useState<'loading' | 'ready' | 'error'>(launch ? 'loading' : 'ready'), [launchError, setLaunchError] = useState(''), [launchRetry, setLaunchRetry] = useState(0);
    const [amount, setAmount] = useState(''), [tender, setTender] = useState(''), [method, setMethod] = useState('cash'), [reference, setReference] = useState(''), [orNumber, setOrNumber] = useState(''), [voidReason, setVoidReason] = useState('');
    const [salesPeriod, setSalesPeriod] = useState(() => ({ range: salesRange('today'), preset: 'today' }));
    const [pending, setPending] = useState<any>(null), [confirmPost, setConfirmPost] = useState(false);
    const [correctionPayment, setCorrectionPayment] = useState<string | null>(null), [correctionReason, setCorrectionReason] = useState('');
    const flight = useRef(false);
    const latest = useRef(0), optionsGeneration = useRef(0), sourcesGeneration = useRef(0), launchGeneration = useRef(0), initialized = useRef(false);
    const can = (cap: any) => { const scopeBranch = selected?.branch_id || (branch === 'All' ? undefined : branch); return hasCapability(userProfile, cap, scopeBranch ? { branchId: scopeBranch } : {}); };
    // Refresh list reads on return/change without rehydrating invoice drafts,
    // payment entries, correction reasons or an unsaved Admin OR#.
    const listRefreshActive = useRef(false);
    listRefreshActive.current = tab === 'invoices' && !editing && !selected && readState !== 'error';
    useEffect(() => subscribeBillingRefresh(() => { if (listRefreshActive.current) setListEpoch(value => value + 1); }), []);
    useEffect(() => { api('/branches').then(data => { setBranches(data.branches); if (!branch)
        setBranch(data.branches.find((b: any) => b.status === 'Active')?.id || ''); }).catch(e => { if (e.name !== 'AbortError')
        setError(e.message); }); }, []);
    useLayoutEffect(() => {
        if (!branch || tab !== 'invoices')
            return;
        const generation = ++latest.current;
        setReadState('loading');
        setReadError('');
        setList({ invoices: [], total: 0 });
        const query = new URLSearchParams({ page: String(page), q: invoiceSearch, status: invoiceStatus });
        if (invoiceFrom) query.set('from', invoiceFrom);
        if (invoiceTo) query.set('to', invoiceTo);
        if (branch !== 'All') query.set('branchId', branch);
        if (patientContext) query.set('patientId', patientContext.id);
        const path = `/invoices?${query}`;
        api(path, 'GET', undefined, () => generation === latest.current).then(data => { if (generation !== latest.current)
            return; setReadState('ready'); setList(data); }).catch(e => { if (generation === latest.current && e.name !== 'AbortError') {
            setReadState('error'); setReadError(e.message); } });
        return () => { latest.current++; };
    }, [branch, tab, tick, listEpoch, page, invoiceSearch, invoiceStatus, invoiceFrom, invoiceTo, patientContext?.id]);
    useLayoutEffect(() => {
        if (!branch || !editing)
            return;
        const generation = ++optionsGeneration.current;
        setOptionsState('loading');
        setOptionsError('');
        setOptions({ patients: [], services: [], packages: [], sources: [] });
        const timer = setTimeout(() => {
            api(`/options?branchId=${encodeURIComponent(branch)}&patientId=${encodeURIComponent(patient)}&q=${encodeURIComponent(patientQuery)}&itemSearch=${encodeURIComponent(itemSearch)}`, 'GET', undefined, () => generation === optionsGeneration.current).then(data => {
                if (generation !== optionsGeneration.current)
                    return;
                setOptions(data);
                setOptionsState('ready');
                if (data.selectedPatient?.id === patient) {
                    setPatientName(data.selectedPatient.name);
                    setPatientNumber(data.selectedPatient.patientID || data.selectedPatient.id);
                }
            }).catch(e => { if (generation === optionsGeneration.current && e.name !== 'AbortError') {
                setOptionsState('error'); setOptionsError(e.message);
            } });
        }, 150);
        return () => { clearTimeout(timer); optionsGeneration.current++; };
    }, [branch, editing, patient, search, itemSearch, tick, optionsRetry]);
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
        if (!launch || launch.invoiceId || initialized.current || !editing || patient !== launch.patientId || branch !== launch.branchId)
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
    // Existing billing opens by exact ID for review, without entering draft mode
    // or relying on the first page of invoices. The server verifies Visit linkage.
    useLayoutEffect(() => {
        if (!launch?.invoiceId || initialized.current || patient !== launch.patientId || branch !== launch.branchId)
            return;
        const generation = ++launchGeneration.current;
        setLaunchState('loading');
        setLaunchError('');
        const query = new URLSearchParams({ patientId: launch.patientId, visitId: launch.visitId });
        api(`/invoices/${encodeURIComponent(launch.invoiceId)}?${query}`, 'GET', undefined, () => generation === launchGeneration.current && !initialized.current).then(data => {
            if (generation !== launchGeneration.current || initialized.current) return;
            if (!data || data.id !== launch.invoiceId || data.patient_id !== launch.patientId || data.branch_id !== launch.branchId)
                throw new Error('This invoice does not match the selected Visit. Return to Visits and refresh billing.');
            initialized.current = true;
            setSelected(data);
            setOrNumber(data.or_number || '');
            setLaunchState('ready');
        }).catch(e => {
            if (generation === launchGeneration.current && e.name !== 'AbortError') {
                setLaunchError(e.message);
                setLaunchState('error');
            }
        });
        return () => { launchGeneration.current++; };
    }, [branch, patient, launchRetry]);
    const perform = async (command: any) => {
        if (flight.current)
            return;
        flight.current = true;
        setBusy(true);
        setError('');
        setPending(command);
        try {
            const data = await api(command.path, command.method, command.body);
            publishBillingRefresh();
            setSelected(data);
            setEditing(false);
            setConfirmPost(false);
            setPending(null);
            setAmount('');
            setTender('');
            setReference('');
            setOrNumber(data.or_number || '');
            setVoidReason('');
            setCorrectionPayment(null);
            setCorrectionReason('');
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
    const open = async (id: string, preserveReferenceDraft = false) => {
        // Correction reload refreshes the version without replacing a separately
        // edited OR# (including an intentional clear). Normal Open still hydrates it.
        const keepReferenceDraft = preserveReferenceDraft && selected?.id === id && orNumber !== (selected.or_number || '');
        setBusy(true); setError(''); try {
        const data = await api('/invoices/' + id + (patientContext ? '?patientId=' + encodeURIComponent(patientContext.id) : ''));
        setSelected(data);
        if (!keepReferenceDraft) setOrNumber(data.or_number || '');
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
        if (invoice) setBranch(invoice.branch_id);
        setEditing(true);
        setError('');
        setSelected(invoice || null);
        setPatient(invoice?.patient_id || '');
        setPatientName(invoice?.patient_name || '');
        setPatientNumber('');
        setPatientSearchOpen(false);
        setConfirmPatientChange(false);
        setNotes(invoice?.notes || '');
        setSearch('');
        setItemSearch('');
        setChoice('');
        if (!invoice) setKind(can('visits.view') ? 'visit' : 'service');
        setItems(invoice ? invoice.items.map((l: any) => ({ ...l.snapshot.input, name: l.name, price: centsText(l.snapshot.originalAmount ?? l.amount_cents) })) : []);
    };
    const choices = kind === 'service' ? options.services : kind === 'package' ? options.packages : sourceResults.sources;
    const choosePatient = (choice: any) => {
        initialized.current = true;
        setPatient(choice.id); setPatientName(choice.name); setPatientNumber(choice.patientID || choice.id);
        setPatientSearchOpen(false); setSearch(''); setChoice(''); setSourcePage(1); setSourceSearch('');
        setLaunchState('ready'); setLaunchError(''); setConfirmPatientChange(false);
    };
    const clearPatient = () => {
        initialized.current = true;
        setPatient(''); setPatientName(''); setPatientNumber(''); setSearch(''); setPatientSearchOpen(true);
        setItems([]); setChoice(''); setItemSearch(''); setSourcePage(1); setSourceSearch('');
        setLaunchState('ready'); setLaunchError(''); setConfirmPatientChange(false);
    };
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
    const priceChanged = (line: typeof items[number]) => { if (line.kind === 'package' || line.amount === undefined) return false; try { return moneyCents(line.amount) !== moneyCents(line.price); } catch { return true; } };
    const needsReason = items.some(line => priceChanged(line) && !line.reason?.trim());
    const draftHint = !patient ? 'Choose a patient and add an item.' : !items.length ? 'Add an item to this invoice.'
        : preview === null ? items.some(l => l.kind === 'package' && !l.amount?.trim()) ? 'Enter a package selling price.' : 'Confirm missing prices before saving.'
        : needsReason ? 'Enter a reason for the price adjustment.' : confirmPatientChange ? 'Keep or change the current patient before saving.' : '';
    const lineAmount = (line: typeof items[number]) => { try { const value = moneyCents(line.amount !== undefined ? line.amount : line.price); return value === 0 ? 'Free' : currency(value); } catch { return 'Price needed'; } };
    const lineSource = (line: typeof items[number]) => line.kind === 'package' ? 'Package selling price' : priceChanged(line) ? 'Adjusted price' : line.kind === 'service' ? 'Clinic price' : 'Saved quote';
    const save = (e: React.FormEvent) => { e.preventDefault(); if (draftHint) return; send(selected ? '/invoices/' + selected.id : '/invoices', { expectedVersion: selected?.version || 0, patientId: patient, branchId: branch, notes, items: items.map(({ name, price, ...l }) => l) }, selected ? 'PATCH' : 'POST'); };
    const leave = () => { if (editing && !window.confirm('Discard these unsaved invoice entries?'))
        return; initialized.current = true; launchGeneration.current++; setLaunchState('ready'); setLaunchError(''); setEditing(false); setSelected(null); setError(''); setConfirmPost(false); setCorrectionPayment(null); setCorrectionReason(''); if (readState !== 'error') setListEpoch(value => value + 1); };
    const locked = busy || Boolean(pending) || launchState === 'loading';
    return <div className={embedded ? 'min-w-0 space-y-5' : 'mx-auto min-w-0 max-w-6xl space-y-6 py-4 sm:py-8'}>
  <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight text-slate-950">{patientContext ? 'Patient billing' : 'POS & Payments'}</h1><p className="mt-1 text-sm text-slate-600">{patientContext ? 'Invoices, payments and balances from your authorized clinics.' : 'Confirm prices, collect payments and track clinic balances.'}</p></div>{!patientContext && !selected && !editing && launchState === 'ready' && can('pos.manage') && <button className={primary} disabled={locked || !branch || branch === 'All'} onClick={() => start()}>New invoice</button>}</header>
  {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
  {pending && !busy && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The result is uncertain. Retry this same request before making another change. <button className={button} onClick={() => perform(pending)}>Retry request</button></div>}
  <div className="flex flex-wrap items-end gap-3"><label className="block w-full max-w-sm space-y-1 text-xs font-semibold text-slate-600">Clinic<select className={field} value={branch} disabled={locked || editing || Boolean(selected)} onChange={e => { setBranch(e.target.value); setPage(1); setError(''); }}><option value="">Select clinic</option><option value="All">All authorized clinics</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.status === 'Active' ? '' : ' (inactive)'}</option>)}</select></label>{!editing && !selected && launchState === 'ready' && <><button className={tab === 'invoices' && invoiceStatus !== 'outstanding' ? primary : button} disabled={locked} onClick={() => { setTab('invoices'); setInvoiceStatus('all'); setPage(1); }}>Invoices</button><button className={tab === 'invoices' && invoiceStatus === 'outstanding' ? primary : button} disabled={locked} onClick={() => { setTab('invoices'); setInvoiceStatus('outstanding'); setPage(1); }}>Outstanding balances</button>{!patientContext && can('visits.view') && <button className={tab === 'visits' ? primary : button} disabled={locked} onClick={() => setTab('visits')}>Visits needing billing</button>}{!patientContext && can('pos.sales') && <button className={tab === 'sales' ? primary : button} disabled={locked} onClick={() => setTab('sales')}>Sales overview</button>}<button className={button} disabled={locked} onClick={() => { setError(''); setTick(n => n + 1); }}>Refresh</button></>}{(editing || selected || (launch?.invoiceId && launchState !== 'ready')) && <button className={button} disabled={locked} onClick={leave}>{tab === 'sales' ? 'Back to sales overview' : tab === 'visits' ? 'Back to Visit billing' : 'Back to invoices'}</button>}</div>
  {launch?.invoiceId && launchState === 'loading' && <p role="status" className="text-sm text-slate-600">Loading linked invoice…</p>}
  {launch?.invoiceId && launchState === 'error' && <div role="alert" className="space-y-2 text-sm text-rose-800"><p>{launchError}</p><button type="button" className={button} onClick={() => setLaunchRetry(n => n + 1)}>Retry linked invoice</button></div>}
  {!editing && !selected && launchState === 'ready' && tab === 'invoices' && readState === 'loading' && <p role="status" className="text-sm text-slate-600">{branch ? 'Loading clinic records…' : 'Select a clinic to view records.'}</p>}
  {!editing && !selected && launchState === 'ready' && tab === 'invoices' && readState === 'error' && <p role="alert" className="text-sm text-rose-800">{readError} Use Refresh to try again.</p>}
  {!patientContext && tab === 'sales' && launchState === 'ready' && <div hidden={editing || Boolean(selected)}><SalesOverview userProfile={userProfile} branchId={branch} refresh={tick} active={!editing && !selected} period={salesPeriod} onPeriodChange={setSalesPeriod} onOpenInvoice={invoice => { setSelected(invoice); setOrNumber(invoice.or_number || ''); setError(''); }}/></div>}
  {!patientContext && tab === 'visits' && launchState === 'ready' && <div hidden={editing || Boolean(selected)}><VisitBillingWorklist userProfile={userProfile} branchId={branch} refresh={tick} active={!editing && !selected} onOpenInvoice={invoice => { setSelected(invoice); setOrNumber(invoice.or_number || ''); setError(''); }} onCreateInvoice={(visit, source) => { start(); setBranch(visit.branchId); setPatient(visit.patientId); setPatientName(visit.patientName); setPatientNumber(visit.patientNumber); setKind('visit'); setItems([{ kind: 'visit', id: source.id, expectedVersion: source.version, name: source.name, price: source.price }]); }}/></div>}
  {launch?.invoiceId && launchState !== 'ready' ? null : editing ? <form onSubmit={save} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Invoice draft">
   <h2 className="text-lg font-semibold">{selected ? 'Edit draft' : 'New invoice'}</h2>
   {launchState === 'loading' && <p role="status" className="text-sm text-slate-600">Loading saved Visit quote…</p>}
   {launchState === 'error' && <div role="alert" className="space-y-2 text-sm text-rose-800"><p>{launchError}</p><button type="button" className={button} onClick={() => setLaunchRetry(n => n + 1)}>Retry saved Visit</button></div>}
   <fieldset disabled={locked || launchState === 'error'} className="min-w-0 space-y-6">
    <section className="space-y-3" aria-label="Invoice patient">
     {patient ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4" aria-label="Selected patient">
      <div className="min-w-0"><p className="text-sm text-slate-600">Patient</p><p className="break-words font-semibold text-slate-950">{patientName || options.selectedPatient?.name || 'Selected patient'}</p><p className="break-all text-sm text-slate-600">{patientNumber || patient}</p></div>
      <button type="button" className={button} disabled={confirmPatientChange} onClick={() => items.length ? setConfirmPatientChange(true) : clearPatient()}>Change patient</button>
     </div> : <div className="space-y-2">
      <label className="block space-y-2 text-sm font-medium">Patient<input type="search" className={field} value={search} maxLength={100} placeholder="Search name or patient ID" aria-describedby="invoice-patient-help" aria-controls="invoice-patient-results" onFocus={() => setPatientSearchOpen(true)} onChange={e => { setSearch(e.target.value); setPatientSearchOpen(true); }} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Escape') setPatientSearchOpen(false); }}/></label>
      <p id="invoice-patient-help" className="text-xs text-slate-600">Type at least 2 characters to search by name or patient ID.</p>
      {patientSearchOpen && patientQuery && <div id="invoice-patient-results" className="space-y-2">
       {optionsState === 'loading' && <p role="status" className="text-sm text-slate-600">Searching patients…</p>}
       {optionsState === 'ready' && <><ul className="max-h-60 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200" aria-label="Matching patients">{options.patients.map((p: any) => <li key={p.id}><button type="button" className="min-h-11 w-full break-words px-3 py-3 text-left text-sm text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600" onClick={() => choosePatient(p)}>{p.name} · {p.patientID || p.id}</button></li>)}</ul>{!options.patients.length && <p className="text-sm text-slate-600">No matching patients. Try another name or ID.</p>}{options.patients.length === 30 && <p className="text-xs text-slate-600">Showing 30 matches. Refine your search to find another patient.</p>}</>}
      </div>}
     </div>}
     {confirmPatientChange && <div role="alert" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>Changing the patient will remove all invoice items. Your notes will be kept.</p><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setConfirmPatientChange(false)}>Keep current patient</button><button type="button" className={primary} onClick={clearPatient}>Confirm change patient</button></div></div>}
     {optionsState === 'error' && <div role="alert" className="space-y-2 text-sm text-rose-800"><p>{optionsError}</p><button type="button" className={button} onClick={() => setOptionsRetry(n => n + 1)}>Retry choices</button></div>}
    </section>
    <section className="min-w-0 space-y-4 border-t border-slate-200 pt-6" aria-labelledby="invoice-add-items-title">
     <h3 id="invoice-add-items-title" className="font-semibold text-slate-950">Add items</h3>
     <fieldset disabled={!patient || confirmPatientChange} className="min-w-0 space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
       <label className="min-w-0 space-y-2 text-sm font-medium">Item type<select className={field} value={kind} onChange={e => { setKind(e.target.value); setSourceSearch(''); setSourcePage(1); setChoice(''); }}>{can('visits.view') && <option value="visit">Saved Visit quote</option>}{can('appointments.view') && <option value="appointment">Saved booking quote</option>}<option value="service">Catalogue Service (separate sale)</option><option value="package">Package</option></select></label>
       {(kind === 'service' || kind === 'package') ? <label className="min-w-0 space-y-2 text-sm font-medium">{kind === 'service' ? 'Search Services' : 'Search packages'}<input type="search" className={field} value={itemSearch} maxLength={100} placeholder={kind === 'service' ? 'Search the clinic catalogue' : 'Search package names'} onChange={e => { setItemSearch(e.target.value); setChoice(''); }}/></label>
        : <label className="min-w-0 space-y-2 text-sm font-medium">Search saved quotes<input type="search" className={field} maxLength={100} value={sourceSearch} placeholder="Service, date, visit type or record ID" onChange={e => { setSourceSearch(e.target.value); setSourcePage(1); setChoice(''); }}/></label>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
       <label className="min-w-0 space-y-2 text-sm font-medium">Item<select className={field} value={choice} disabled={(['visit', 'appointment'].includes(kind) ? sourceState : optionsState) !== 'ready'} onChange={e => setChoice(e.target.value)}><option value="">Choose an item</option>{choices.map((o: any) => <option key={o.id} value={o.id}>{o.name}{o.date ? ` · ${o.date}` : ''}{o.price != null ? ` · ${currency(moneyCents(o.price))}` : kind === 'package' ? ' · Enter selling price after adding' : ' · Price needs confirmation'}</option>)}</select></label>
       <button type="button" className={button + ' self-end'} disabled={!choice || items.length >= 20 || (['visit', 'appointment'].includes(kind) ? sourceState : optionsState) !== 'ready'} onClick={add}>Add item</button>
      </div>
      {kind === 'service' && <p className="text-xs text-slate-600">Catalogue Services use this clinic’s price and are not linked to a Visit. Choose Saved Visit quote to bill a completed Visit.</p>}
      {kind === 'package' && <p className="text-xs text-slate-600">Enter the package selling price after adding it.</p>}
      {['visit', 'appointment'].includes(kind) && <p className="text-xs text-slate-600">Saved quotes keep their original amount, including any Special Price.</p>}
      {patient && ['service', 'package'].includes(kind) && optionsState === 'loading' && <p role="status" className="text-sm text-slate-600">Loading catalogue…</p>}
      {patient && ['service', 'package'].includes(kind) && optionsState === 'ready' && !choices.length && <p className="text-sm text-slate-600">No matching items. Try another search or item type.</p>}
      {['service', 'package'].includes(kind) && choices.length === 100 && <p className="text-xs text-slate-600">Showing 100 matches. Refine your search to find another item.</p>}
      {(kind === 'visit' || kind === 'appointment') && <section className="space-y-3" aria-label="Saved quote search">
       {patient && sourceState === 'loading' && <p role="status" className="text-sm text-slate-600">Loading saved quotes…</p>}
       {patient && sourceState === 'error' && <div role="alert" className="text-sm text-rose-800">{sourceError} <button type="button" className={button} onClick={() => setSourceRetry(n => n + 1)}>Retry saved quotes</button></div>}
       {patient && sourceState === 'ready' && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p>{sourceResults.total ? `${sourceResults.total} saved quotes · Page ${sourcePage}` : 'No matching saved quotes.'}</p><div className="flex gap-2"><button type="button" className={button} disabled={sourcePage <= 1} onClick={() => { setSourcePage(n => n - 1); setChoice(''); }}>Previous quotes</button><button type="button" className={button} disabled={sourcePage * 50 >= sourceResults.total} onClick={() => { setSourcePage(n => n + 1); setChoice(''); }}>Next quotes</button></div></div>}
      </section>}
     </fieldset>
    </section>
    <section className="min-w-0 space-y-3 border-t border-slate-200 pt-6" aria-label="Invoice items">
     <h3 className="font-semibold text-slate-950">Invoice items{items.length ? ` (${items.length})` : ''}</h3>
     {!items.length ? <p className="py-2 text-sm text-slate-600">No items added yet — choose an item above.</p> : <div className="divide-y divide-slate-200">{items.map((l, index) => <article key={l.kind + l.id} className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="min-w-0"><h4 className="break-words font-semibold text-slate-950">{l.name}</h4><p className="mt-1 text-sm text-slate-600">{l.kind === 'visit' ? 'Visit' : l.kind === 'appointment' ? 'Booking' : l.kind === 'package' ? 'Package' : 'Service'} · {lineSource(l)}</p><details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Catalogue / quote details</summary><p className="mt-1">Version {l.expectedVersion}</p>{['visit', 'appointment'].includes(l.kind) && can(l.kind === 'visit' ? 'visits.view' : 'appointments.view') && <p className="mt-1 break-all">{l.kind === 'visit' ? 'Visit' : 'Booking'} reference: {l.id}</p>}</details></div>
      <p className="text-lg font-semibold tabular-nums text-slate-950 sm:text-right">{lineAmount(l)}</p>
      <button type="button" className={button + ' self-start'} disabled={confirmPatientChange} onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</button>
      {l.kind === 'package' ? <label className="min-w-0 space-y-2 text-sm sm:col-span-3">Package selling price (PHP)<input className={field} inputMode="decimal" required value={l.amount ?? ''} disabled={confirmPatientChange} placeholder="Enter amount; 0 means Free" onChange={e => update(index, { amount: e.target.value })}/></label>
       : can('pos.adjust') ? <details className="min-w-0 text-sm sm:col-span-3"><summary className="cursor-pointer font-medium text-slate-700">Admin price adjustment (optional)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="space-y-2">Price override (optional, PHP)<input className={field} inputMode="decimal" disabled={confirmPatientChange} value={l.amount ?? ''} placeholder={l.price ?? 'No saved quote'} onChange={e => update(index, { amount: e.target.value === '' ? undefined : e.target.value })}/></label>{l.amount !== undefined && <label className="space-y-2">Adjustment reason<input className={field} required={priceChanged(l)} maxLength={1000} disabled={confirmPatientChange} value={l.reason ?? ''} onChange={e => update(index, { reason: e.target.value })}/></label>}</div></details> : null}
     </article>)}</div>}
    </section>
    <label className="block space-y-2 text-sm font-medium">Invoice notes<span className="ml-2 font-normal text-slate-600">Optional</span><textarea className={field} rows={2} maxLength={3000} value={notes} onChange={e => setNotes(e.target.value)}/></label>
    <div className="space-y-3 border-t border-slate-200 pt-5">
     <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-slate-600">Draft total</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{!items.length ? 'Add items to calculate' : preview === null ? 'Confirm prices' : currency(preview)}</p></div><button className={primary} disabled={Boolean(draftHint)}>{busy ? 'Saving…' : 'Save draft'}</button></div>
     {draftHint && <p role="status" className="text-sm text-slate-700">{draftHint}</p>}
     <p className="text-xs text-slate-600">Saving a draft creates no sale, payment or package sessions. Review it before posting.</p>
    </div>
   </fieldset></form> : selected ? <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Invoice details">
   <div className="flex flex-wrap justify-between gap-4"><div><h2 className="text-xl font-semibold">Invoice #{selected.number}</h2><p className="mt-1 text-sm">{selected.patient_name} · {selected.branch_name}</p><p className="mt-1 text-xs font-semibold uppercase text-teal-800">{selected.state}{selected.state === 'posted' ? selected.outstanding_cents === 0 ? ' · Paid' : selected.paid_cents ? ' · Partially paid' : ' · Unpaid' : ''}</p></div><div className="text-right"><p className="text-sm text-slate-600">Invoice total</p><p className="text-2xl font-semibold tabular-nums">{currency(selected.total_cents)}</p></div></div>
   <ul className="divide-y divide-slate-200">{selected.items.map((l: any) => <li key={l.id} className="flex justify-between gap-4 py-3 text-sm"><div className="min-w-0 break-words"><p className="font-medium">{l.name}</p><p className="text-xs text-slate-500">{l.kind === 'visit' ? 'Saved Visit quote' : l.kind === 'appointment' ? 'Saved booking quote' : l.kind === 'service' ? 'Catalogue Service · separate sale' : 'Package purchase'} · v{l.snapshot.input.expectedVersion}</p>{l.snapshot.input.reason && <p className="text-xs">Price reason: {l.snapshot.input.reason}</p>}{l.snapshot.packageTerms && <ul className="mt-1 text-xs text-slate-600">{l.snapshot.packageTerms.lines.map((s: any) => <li key={s.serviceId}>{s.serviceNameSnapshot} · {s.purchasedSessions} sessions</li>)}</ul>}</div><span className="shrink-0 font-semibold tabular-nums">{currency(l.amount_cents)}</span></li>)}</ul>
   {selected.notes && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{selected.notes}</p>}
   <div className="flex flex-wrap gap-8 rounded-xl bg-slate-50 p-4"><p className="text-sm">Collected (net) <strong className="ml-2 tabular-nums">{currency(selected.paid_cents)}</strong></p><p className="text-sm">Outstanding <strong className="ml-2 tabular-nums">{currency(selected.outstanding_cents)}</strong></p></div>
   {selected.items.some((l: any) => l.kind === 'package') && <p className="text-sm text-slate-600">{selected.state === 'draft' ? 'Posting creates linked Treatment Ledger purchases.' : selected.state === 'posted' && selected.outstanding_cents === 0 ? 'Package sessions are available in the Treatment Ledger.' : 'Package sessions remain locked.'} Sessions unlock only when the full invoice is paid.</p>}
   {!patientContext && selected.state === 'draft' && can('pos.manage') && <div className="space-y-3"><div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => start(selected)}>Edit draft</button><button className={primary} disabled={locked} onClick={() => setConfirmPost(true)}>Post invoice</button></div>{confirmPost && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>Confirm {currency(selected.total_cents)} for {selected.patient_name}. Posted prices cannot be edited.</p><button className={primary} disabled={locked} onClick={() => send(`/invoices/${selected.id}/post`, { expectedVersion: selected.version })}>Confirm and post</button> <button className={button} disabled={locked} onClick={() => setConfirmPost(false)}>Cancel</button></div>}</div>}
   {selected.state === 'posted' && selected.outstanding_cents > 0 && can('pos.collect') && <form onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/payments`, { expectedVersion: selected.version, method, amount, tender: method === 'cash' ? tender : amount, reference }); }} className="space-y-3 border-t border-slate-200 pt-4"><h3 className="font-semibold">Record payment</h3><fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Method<select className={field} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="gcash">GCash</option><option value="bank">Bank transfer</option></select></label><label className="space-y-1 text-sm">Payment amount (PHP)<input className={field} inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)}/></label>{method === 'cash' && <label className="space-y-1 text-sm">Cash tendered (PHP)<input className={field} inputMode="decimal" required value={tender} onChange={e => setTender(e.target.value)}/></label>}<label className="space-y-1 text-sm">Reference {method === 'cash' ? '(optional)' : '(required)'}<input className={field} required={method !== 'cash'} value={reference} maxLength={120} onChange={e => setReference(e.target.value)}/></label><button className={primary + ' sm:col-span-2'}>Record payment</button></fieldset><p className="text-xs text-slate-600">Enter payments already received. This records the payment; it does not charge a card or wallet.</p></form>}
   {selected.payments.length > 0 && <section aria-label="Payment acknowledgments" className="space-y-3"><h3 className="font-semibold">Payment acknowledgments</h3>{selected.payments.map((p: any) => <article key={p.id} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold tabular-nums">{currency(p.amount_cents)} · {p.method}{p.reversal ? ' · Reversed' : ''}</p><p className="text-xs text-slate-600">{new Date(p.recorded_at).toLocaleString()} · {p.actor.name}</p></div>{!patientContext && can('pos.adjust') && selected.state === 'posted' && !p.reversal && correctionPayment !== p.id && <button className={button} disabled={locked} onClick={() => { setCorrectionPayment(p.id); setCorrectionReason(''); setError(''); }}>Correct payment</button>}</div>
    {p.method === 'cash' && <p>Tendered {currency(p.tender_cents)} · Change {currency(Number(p.tender_cents) - Number(p.amount_cents))}</p>}{p.reference && <p className="break-words">Reference: {p.reference}</p>}<p className="break-all text-xs text-slate-500">Acknowledgment {p.id}</p>
    {p.reversal && <div className="space-y-1 border-t border-slate-200 pt-2"><p className="font-medium">Payment entry reversed</p><p className="whitespace-pre-wrap break-words">{p.reversal.reason}</p><p className="text-xs text-slate-600">{new Date(p.reversal.recorded_at).toLocaleString()} · {p.reversal.actor.name}</p><p className="break-all text-xs text-slate-500">Correction {p.reversal.id}</p></div>}
    {!patientContext && can('pos.adjust') && selected.state === 'posted' && !p.reversal && correctionPayment === p.id && <form aria-label="Payment correction" className="space-y-3 border-t border-slate-200 pt-3" onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/payments/${p.id}/reversal`, { expectedVersion: selected.version, reason: correctionReason }); }}>
     <h4 className="font-semibold">Reverse this payment entry?</h4><p className="max-w-prose text-sm text-slate-600">This corrects the full {currency(p.amount_cents)} recorded entry. It does not refund money. Record the correct payment afterward if needed.</p>
     <label className="block space-y-1 text-sm font-medium">Correction reason<textarea required maxLength={1000} rows={3} className={field} disabled={locked} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)}/></label>
     <div className="flex flex-wrap gap-2"><button className={primary} disabled={locked || !correctionReason.trim()}>Confirm reversal</button><button type="button" className={button} disabled={locked} onClick={() => { setCorrectionPayment(null); setCorrectionReason(''); setError(''); }}>Cancel correction</button><button type="button" className={button} disabled={locked} onClick={() => open(selected.id, true)}>Reload invoice for correction</button></div>
    </form>}
   </article>)}</section>}
   {selected.or_number && <p className="text-sm">OR#: {selected.or_number}</p>}
   {!patientContext && can('treatment_ledger.reference') && selected.state !== 'void' && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/reference`, { expectedVersion: selected.version, orNumber }, 'PATCH'); }}><label className="space-y-1 text-sm">Admin OR#<input className={field} disabled={locked} maxLength={120} value={orNumber} onChange={e => setOrNumber(e.target.value)}/></label><button className={button} disabled={locked}>Save reference</button></form>}
   {!patientContext && can('pos.adjust') && selected.state !== 'void' && selected.payments.length === 0 && <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-medium">Void unpaid invoice</summary><form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); send(`/invoices/${selected.id}/void`, { expectedVersion: selected.version, reason: voidReason }); }}><label className="grow space-y-1 text-sm">Reason<input required className={field} disabled={locked} value={voidReason} maxLength={1000} onChange={e => setVoidReason(e.target.value)}/></label><button className={button} disabled={locked}>Confirm void</button></form></details>}
   <details><summary className="cursor-pointer text-sm text-slate-600">Invoice history</summary><ul className="mt-2 space-y-2 text-xs text-slate-600">{selected.events.map((e: any) => <li key={e.id}>{new Date(e.recorded_at).toLocaleString()} · {e.kind} · {e.actor.name}{e.detail.reason ? ` · ${e.detail.reason}` : ''}</li>)}</ul></details>
  </section> : tab !== 'invoices' ? null : <section className="min-w-0 space-y-4" aria-label="Invoice lookup">
   <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label className="min-w-0 space-y-1 text-sm">Search invoices<input className={field} maxLength={100} value={invoiceSearch} placeholder={patientContext ? 'Invoice number or payment reference' : 'Patient, invoice number or payment reference'} onChange={e => { setInvoiceSearch(e.target.value); setPage(1); }}/></label>
    <label className="min-w-0 space-y-1 text-sm">Invoice status<select className={field} value={invoiceStatus} onChange={e => { setInvoiceStatus(e.target.value); setPage(1); }}><option value="all">All invoices</option><option value="draft">Draft</option><option value="unpaid">Unpaid</option><option value="partial">Partially paid</option><option value="paid">Paid</option><option value="void">Void</option><option value="outstanding">Outstanding balances</option></select></label>
    <label className="min-w-0 space-y-1 text-sm">Invoice date from<input type="date" className={field} value={invoiceFrom} onChange={e => { setInvoiceFrom(e.target.value); setPage(1); }}/></label>
    <label className="min-w-0 space-y-1 text-sm">Invoice date to<input type="date" className={field} value={invoiceTo} onChange={e => { setInvoiceTo(e.target.value); setPage(1); }}/></label>
   </div>
   <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600"><p>Dates use the invoice creation date in Asia/Manila.</p>{(invoiceSearch || invoiceStatus !== 'all' || invoiceFrom || invoiceTo) && <button className={button} onClick={() => { setInvoiceSearch(''); setInvoiceStatus('all'); setInvoiceFrom(''); setInvoiceTo(''); setPage(1); }}>Clear invoice filters</button>}</div>
   {patientContext && readState === 'ready' && list.summary && <section aria-label="Patient billing totals" className="space-y-2"><dl className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">{[['Invoiced', list.summary.invoicedCents], ['Paid', list.summary.paidCents], ['Outstanding', list.summary.outstandingCents]].map(([label, value]) => <div key={label}><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{currency(value)}</dd></div>)}</dl><p className="text-xs text-slate-600">Patient totals cover posted invoices in the selected authorized clinics across all dates. Search, date and status filters affect the list only.</p></section>}
   <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[800px] text-left text-sm" aria-label={patientContext ? 'Patient invoices' : 'Clinic invoices'}><thead className="bg-slate-50 text-slate-600"><tr>{['Invoice', ...(!patientContext ? ['Patient'] : []), 'Clinic', 'Invoice date', 'Status', 'Total', 'Collected', 'Remaining', ''].map((label, i) => <th key={i} className="p-4">{label || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{list.invoices.map((i: any) => <tr key={i.id} className="border-t border-slate-200"><th className="p-4">#{i.number}</th>{!patientContext && <td className="p-4">{i.patient_name}</td>}<td className="p-4">{i.branch_name}</td><td className="p-4 whitespace-nowrap">{new Date(i.created_at).toLocaleDateString('en-PH', {timeZone: 'Asia/Manila'})}</td><td className="p-4">{i.state}{i.state === 'posted' ? Number(i.total_cents) === Number(i.paid_cents) ? ' · Paid' : Number(i.paid_cents) > 0 ? ' · Partially paid' : ' · Unpaid' : ''}</td><td className="p-4 tabular-nums">{currency(i.total_cents)}</td><td className="p-4 tabular-nums">{currency(i.paid_cents)}</td><td className="p-4 tabular-nums">{currency(i.outstanding_cents)}</td><td className="p-4"><button className={button} disabled={locked} onClick={() => open(i.id)}>Open</button></td></tr>)}</tbody></table>{readState === 'ready' && !list.invoices.length && <p className="p-8 text-center text-sm text-slate-500">No matching invoices.{!patientContext && can('pos.manage') ? ' Adjust the filters or create a draft.' : ' Adjust the filters or clinic selection to view other authorized invoices.'}</p>}</div>
   <div className="flex items-center justify-end gap-3 text-sm"><button className={button} disabled={page <= 1 || locked || readState !== 'ready'} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page}{readState === 'ready' ? ` · ${list.total} invoices` : ''}</span><button className={button} disabled={page * 30 >= list.total || locked || readState !== 'ready'} onClick={() => setPage(n => n + 1)}>Next</button></div>
  </section>}
 </div>;
}
