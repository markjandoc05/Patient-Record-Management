import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Download, History, Package, Plus, Search, Upload, Users } from 'lucide-react';
import InventoryExcelImport from './InventoryExcelImport';
import { auth } from '../platform';
import { subscribeProtectedDataInvalidation } from '../dataClient';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { hasAdministrativeAccess } from '../rbac';
import { inventoryRequest, transferRequest } from '../utils/inventoryApi';
import { downloadInventoryExcel, inventoryExcelFile } from '../utils/inventoryExcel';
import { inventoryQuantity } from '../inventoryPolicy';
import { formatDateTime } from '../utils';
import { fromZonedTime } from 'date-fns-tz';
import { getActiveDateTimeInput, getActiveTimezoneSettings } from '../utils/timezone';

type Category = { id: string; name: string; active: boolean; version: number };
type Item = { id: string; name: string; sku: string; category: string; categoryId?: string | null; recordedCategory?: string; unit: string; lowStockThreshold: number };
type Supplier = { id: string; name: string; contactPerson?: string; email?: string; phone?: string };
type Branch = { id: string; branchName?: string; name?: string; status?: string };
type Stock = { itemId: string; branchId: string; quantity: number; version: number; issue?: string };
type Transfer = { id: string; itemId: string; fromBranchId: string; toBranchId: string; quantity: number; status: string; createdAt: any; createdBy?: string; fromBranchName?: string; toBranchName?: string };
type Overview = { categories: Category[]; items: Item[]; suppliers: Supplier[]; branches: Branch[]; stocks: Stock[]; transfers: Transfer[] };
type Movement = { id: string; kind: string; quantity: number; balanceAfter: number; occurredAt: any; recordedAt: any; actor?: { uid: string; name: string }; notes?: string; reference?: string; supplierName?: string; transferId?: string; fromBranchName?: string; toBranchName?: string };
type Editor = { kind: 'item' | 'supplier' | 'transfer' | 'receive' | 'use' | 'adjust'; item?: Item; stock?: Stock };
type StockSort = 'name-asc' | 'name-desc' | 'remaining-asc' | 'remaining-desc' | 'status';
const field = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100 sm:text-sm';
const button = 'min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
const primary = 'min-h-11 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
const blank: Overview = { categories: [], items: [], suppliers: [], branches: [], stocks: [], transfers: [] };
const branchName = (branch?: Branch) => branch?.branchName || branch?.name || 'Unknown branch';
const stockUnit = (item?: Item) => item?.unit || '(unit not recorded)';
const quantity = (value: number) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'Unavailable';
const movementName: Record<string, string> = { opening: 'Opening balance', receive: 'Received', use: 'Used', adjust: 'Correction', transfer_in: 'Transfer received', transfer_out: 'Transfer sent' };

export default function InventoryDashboard({ userProfile, activeBranchId }: { userProfile: any; activeBranchId?: string }) {
  const scope = JSON.stringify([uiPermissionScope(userProfile), auth.currentUser?.uid, userProfile?.role, userProfile?.active, userProfile?.assignedBranches, activeBranchId]);
  const [invalidated, setInvalidated] = useState<string | null>(null);
  useLayoutEffect(() => {
    setInvalidated(null);
    return subscribeProtectedDataInvalidation(() => setInvalidated(scope));
  }, [scope]);
  if (!uiCan(userProfile, 'inventory.view')) return <p className="p-6 text-sm text-slate-600">Inventory access is unavailable.</p>;
  if (invalidated === scope) return <div role="alert" className="space-y-3 p-6 text-sm text-slate-600"><p>Inventory access changed. Retry after your access is refreshed.</p><button className={button} type="button" onClick={() => setInvalidated(current => current === scope ? null : current)}>Retry inventory</button></div>;
  return <InventoryScope key={scope} userProfile={userProfile} activeBranchId={activeBranchId} />;
}

function InventoryScope({ userProfile, activeBranchId }: { userProfile: any; activeBranchId?: string }) {
  const [branchId, setBranchId] = useState(activeBranchId && activeBranchId !== 'All' ? activeBranchId : '');
  // Branch changes replace the workspace before obsolete forms/results render.
  return <InventoryWorkspace key={branchId} userProfile={userProfile} branchId={branchId} onBranch={setBranchId} />;
}

function InventoryWorkspace({ userProfile, branchId, onBranch }: { userProfile: any; branchId: string; onBranch: (id: string) => void }) {
  const manage = uiCan(userProfile, 'inventory.manage'), transfer = uiCan(userProfile, 'inventory.transfer');
  const admin = manage && hasAdministrativeAccess(currentPermissionProfile()?.role || userProfile?.role);
  const [tab, setTab] = useState<'stocks' | 'suppliers' | 'transfers'>('stocks');
  const [search, setSearch] = useState(''), [categoryFilter, setCategoryFilter] = useState('all'), [retry, setRetry] = useState(0);
  const [stockSort, setStockSort] = useState<StockSort>('name-asc');
  const [managingCategories, setManagingCategories] = useState(false);
  const [importing, setImporting] = useState(false), [exporting, setExporting] = useState(false);
  const [result, setResult] = useState({ key: -1, data: blank, error: '' });
  const [editor, setEditor] = useState<Editor | null>(null), [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [completing, setCompleting] = useState<string | null>(null);
  const life = useRef({ active: false, request: null as AbortController | null });
  const excelRequest = useRef<AbortController | null>(null);
  const viewKey = JSON.stringify([tab, search, categoryFilter, stockSort, retry, editor?.kind, managingCategories, importing]);
  const currentView = useRef(viewKey); currentView.current = viewKey;
  useLayoutEffect(() => { life.current.active = true; return () => { life.current.active = false; life.current.request?.abort(); excelRequest.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(), current = () => life.current.active && !controller.signal.aborted;
    const query = branchId ? `?${new URLSearchParams({ branchId })}` : '';
    void inventoryRequest(`/api/inventory${query}`, 'GET', undefined, controller.signal, current).then(data => {
      if (!current()) return;
      if (!data || !['items', 'suppliers', 'branches', 'stocks', 'transfers'].every(key => Array.isArray(data[key]))) throw new Error('Inventory could not be loaded. Retry inventory.');
      if (!branchId && data.branches.length) { onBranch((data.branches.find((branch: Branch) => branch.status === 'Active') || data.branches[0]).id); return; }
      setResult({ key: retry, data: { ...data, categories: Array.isArray(data.categories) ? data.categories : [] }, error: '' });
    }).catch(failure => { if (current() && failure.name !== 'AbortError') setResult({ key: retry, data: blank, error: failure.message }); });
    return () => controller.abort();
  }, [branchId, retry]);
  const visible = result.key === retry ? result : null;
  const data = visible?.data || blank, branch = data.branches.find(b => b.id === branchId);
  const activeBranch = branch?.status === 'Active';
  const open = (next: Editor) => { if (completing) return; setMessage(''); setError(''); setHistoryItem(null); setEditor(next); };
  const saved = () => { setEditor(null); setMessage('Inventory updated.'); setError(''); setRetry(n => n + 1); };
  const complete = async (entry: Transfer) => {
    if (!transfer || completing || !window.confirm('Complete this transfer? Stock will move between the two branches.')) return;
    life.current.request?.abort(); const controller = new AbortController(); life.current.request = controller;
    const current = () => life.current.active && life.current.request === controller && !controller.signal.aborted;
    setCompleting(entry.id); setError(''); setMessage('');
    try { await transferRequest('complete', { id: entry.id }, controller.signal, current); if (current()) { setMessage('Transfer completed.'); setRetry(n => n + 1); } }
    catch (failure: any) { if (current() && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (current()) setCompleting(null); }
  };
  if (importing && visible && !visible.error) return <div className="mx-auto max-w-6xl p-4 sm:p-6"><InventoryExcelImport branchId={branchId} branchLabel={branchName(branch)} userProfile={userProfile} onClose={() => setImporting(false)} onSaved={result => { setImporting(false); setMessage(`Imported ${result.importedCount} new ${result.importedCount === 1 ? 'item' : 'items'}. ${result.skippedCount} existing ${result.skippedCount === 1 ? 'SKU' : 'SKUs'} skipped.`); setError(''); setRetry(n => n + 1); }} /></div>;
  if (managingCategories && visible && !visible.error) return <div className="mx-auto max-w-4xl p-4 sm:p-6"><InventoryCategories categories={data.categories} branchId={branchId} userProfile={userProfile} onClose={() => { setManagingCategories(false); setRetry(n => n + 1); }} /></div>;
  if (editor && visible && !visible.error) return <div className="mx-auto max-w-4xl p-4 sm:p-6"><InventoryEditor key={`${editor.kind}-${editor.item?.id || ''}`} editor={editor} data={data} branchId={branchId} userProfile={userProfile} onClose={() => setEditor(null)} onSaved={saved} onReload={() => { setEditor(null); setRetry(n => n + 1); }} /></div>;
  const categoryOptions = new Map(data.categories.filter(category => category.active || categoryFilter === `category:${category.id}` || data.items.some(item => item.categoryId === category.id)).map(category => [`category:${category.id}`, `${category.name}${category.active ? '' : ' (inactive)'}`]));
  for (const item of data.items) {
    if (item.categoryId && !categoryOptions.has(`category:${item.categoryId}`)) categoryOptions.set(`category:${item.categoryId}`, item.category || 'Category unavailable');
    if (!item.categoryId && item.category) categoryOptions.set(`recorded:${item.category}`, `${item.category} (recorded text)`);
  }
  const matching = data.items.filter(item => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(search.trim().toLowerCase())
    && (categoryFilter === 'all' || categoryFilter === 'uncategorized' && !item.categoryId && !item.category || categoryFilter === (item.categoryId ? `category:${item.categoryId}` : item.category ? `recorded:${item.category}` : 'uncategorized')));
  const branchStocks = new Map<string, Stock>();
  for (const stock of data.stocks) {
    if (stock.branchId === branchId && !branchStocks.has(stock.itemId)) branchStocks.set(stock.itemId, stock);
  }
  const remaining = (item: Item): number | null => {
    const stock = branchStocks.get(item.id);
    if (!stock) return 0;
    return !stock.issue && Number.isFinite(stock.quantity) ? stock.quantity : null;
  };
  const statusPriority = (item: Item) => {
    const stock = branchStocks.get(item.id);
    if (stock?.issue) return 0;
    if (!Number.isFinite(item.lowStockThreshold)) return 3;
    return (stock?.quantity ?? 0) <= item.lowStockThreshold ? 1 : 2;
  };
  // Sort only the filtered copy; stock records and their movement history stay unchanged.
  matching.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
      || a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base', numeric: true })
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (stockSort === 'remaining-asc' || stockSort === 'remaining-desc') {
      const left = remaining(a), right = remaining(b);
      // Unavailable balances belong last in either direction, rather than looking like zero.
      if (left === null || right === null) return left === right ? byName : left === null ? 1 : -1;
      return (stockSort === 'remaining-asc' ? left - right : right - left) || byName;
    }
    if (stockSort === 'status') return statusPriority(a) - statusPriority(b) || byName;
    return stockSort === 'name-desc' ? -byName : byName;
  });
  const exportExcel = async () => {
    if (exporting || completing || !visible || visible.error || !branchId || !uiCan(userProfile, 'inventory.view')) return;
    const controller = new AbortController(), scope = uiPermissionScope(userProfile), uid = auth.currentUser?.uid;
    excelRequest.current?.abort(); excelRequest.current = controller;
    const current = () => life.current.active && excelRequest.current === controller && !controller.signal.aborted
      && uiPermissionScope(userProfile) === scope && auth.currentUser?.uid === uid && currentView.current === viewKey;
    setExporting(true); setError(''); setMessage('');
    try {
      // Reauthorize against the server immediately before preparing a download.
      const fresh: Overview = await inventoryRequest(`/api/inventory?${new URLSearchParams({ branchId })}`, 'GET', undefined, controller.signal, current);
      if (!current()) return;
      const authorizedBranch = fresh.branches.find(b => b.id === branchId);
      if (!authorizedBranch) throw new Error('This branch is no longer available. Reload inventory.');
      let headers: string[], rows: (string | number | Date | null)[][], sheet: string;
      if (tab === 'stocks') {
        sheet = 'Stock levels'; headers = ['Item name', 'SKU', 'Category', 'Stock unit', 'Remaining', 'Low-stock threshold', 'Status', 'Review note'];
        const items = new Map(fresh.items.map(item => [item.id, item]));
        const stocks = new Map(fresh.stocks.filter(stock => stock.branchId === branchId).map(stock => [stock.itemId, stock]));
        rows = matching.flatMap(shown => {
          const item = items.get(shown.id); if (!item) return [];
          const stock = stocks.get(item.id), balance = !stock ? 0 : stock.issue || !Number.isFinite(stock.quantity) ? null : stock.quantity;
          const threshold = Number.isFinite(item.lowStockThreshold) ? item.lowStockThreshold : null;
          const status = balance === null ? 'Needs review' : threshold === null ? 'Threshold not set' : balance <= threshold ? 'Low stock' : 'In stock';
          return [[item.name, item.sku, item.category || 'Uncategorized', stockUnit(item), balance, threshold, status, stock?.issue || '']];
        });
      } else if (tab === 'suppliers') {
        sheet = 'Suppliers'; headers = ['Supplier name', 'Contact person', 'Email', 'Phone'];
        rows = fresh.suppliers.map(supplier => [supplier.name, supplier.contactPerson || '', supplier.email || '', supplier.phone || '']);
      } else {
        sheet = 'Stock transfers'; headers = ['Item name', 'SKU', 'From branch', 'To branch', 'Quantity', 'Stock unit', 'Status', 'Created at (UTC)', 'Completed at (UTC)', 'Notes'];
        const date = (value: any) => { const parsed = new Date(value?.__timestamp || value || ''); return Number.isFinite(parsed.getTime()) ? parsed : null; };
        rows = fresh.transfers.map(entry => {
          const item = fresh.items.find(item => item.id === entry.itemId);
          return [item?.name || entry.itemId, item?.sku || '', entry.fromBranchName || branchName(fresh.branches.find(b => b.id === entry.fromBranchId)), entry.toBranchName || branchName(fresh.branches.find(b => b.id === entry.toBranchId)), entry.quantity, stockUnit(item), entry.status, date(entry.createdAt), date((entry as any).completedAt), String((entry as any).notes || '')];
        });
      }
      const exportedAt = new Date().toISOString();
      const bytes = await inventoryExcelFile(sheet, headers, rows, { branchName: branchName(authorizedBranch), exportedAt });
      if (!current()) return;
      downloadInventoryExcel(bytes, `vine-inventory-${tab}-${branchId}-${exportedAt.slice(0, 10)}.xlsx`);
      setMessage(tab === 'stocks' ? 'Excel export downloaded for the items shown in your current view.' : 'Excel export downloaded.');
    } catch (failure: any) { if (current() && failure.name !== 'AbortError') setError(failure.message || 'The Excel export failed. Try again.'); }
    finally { if (life.current.active && excelRequest.current === controller) setExporting(false); }
  };
  return <div className="mx-auto max-w-7xl space-y-6 p-4 text-slate-900 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Inventory Management</h1><p className="mt-2 text-sm text-slate-500">Receive stock, record usage and keep track of each branch.</p></div><div className="flex flex-wrap gap-3">
      {visible && !visible.error && branchId && <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={exporting || !!completing} onClick={() => void exportExcel()}><Download size={16} />{exporting ? 'Preparing Excel…' : 'Export Excel'}</button>}
      {visible && !visible.error && tab === 'stocks' && manage && <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={exporting || !!completing || !activeBranch} onClick={() => { setHistoryItem(null); setError(''); setMessage(''); setImporting(true); }}><Upload size={16} />Import Excel</button>}
      {visible && !visible.error && (tab === 'stocks' && manage ? <><button type="button" className={button} disabled={!!completing} onClick={() => { setHistoryItem(null); setManagingCategories(true); }}>Manage categories</button><button className={`${primary} inline-flex items-center gap-2`} disabled={!!completing} onClick={() => open({ kind: 'item' })}><Plus size={16} />Add Item</button></> : tab === 'suppliers' && manage ? <button className={`${primary} inline-flex items-center gap-2`} disabled={!!completing} onClick={() => open({ kind: 'supplier' })}><Plus size={16} />Add Supplier</button> : tab === 'transfers' && transfer && branchId ? <button className={`${primary} inline-flex items-center gap-2`} disabled={!!completing || !activeBranch || data.branches.filter(b => b.status === 'Active').length < 2 || !data.items.length} onClick={() => open({ kind: 'transfer' })}><ArrowLeftRight size={16} />New Transfer</button> : null)}</div></header>
    <nav className="flex overflow-x-auto border-b border-slate-200" aria-label="Inventory sections">{([{ id: 'stocks', name: 'Stocks & Levels', icon: Package }, { id: 'suppliers', name: 'Suppliers', icon: Users }, { id: 'transfers', name: 'Stock Transfers', icon: ArrowLeftRight }] as const).map(({ id, name, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-teal-600 ${tab === id ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`} onClick={() => { setTab(id); setHistoryItem(null); setSearch(''); }}><Icon size={16} />{name}</button>)}</nav>
    {message && <p role="status" className="text-sm text-teal-800">{message}</p>}{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {!visible ? <p role="status" className="py-10 text-sm text-slate-600">Loading inventory…</p> : visible.error ? <div role="alert" className="space-y-3 py-6 text-sm text-rose-700"><p>{visible.error}</p><button type="button" className={button} onClick={() => setRetry(n => n + 1)}>Retry inventory</button></div> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-48 space-y-2 text-sm font-medium"><span>Clinic branch</span><select className={field} value={branchId} onChange={e => onBranch(e.target.value)} disabled={!data.branches.length}>{!data.branches.length && <option value="">No authorized branches</option>}{data.branches.map(b => <option key={b.id} value={b.id}>{branchName(b)}</option>)}</select></label>
        {tab === 'stocks' && <>
          <label className="min-w-0 flex-1 basis-56 space-y-2 text-sm font-medium"><span>Search items</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={16} /><input className={`${field} pl-10`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, SKU or category" /></div></label>
          <label className="min-w-0 flex-1 basis-44 space-y-2 text-sm font-medium"><span>Filter by category</span><select className={field} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">All categories</option><option value="uncategorized">Uncategorized</option>{[...categoryOptions].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="min-w-0 flex-1 basis-56 space-y-2 text-sm font-medium"><span>Sort by</span><select className={field} value={stockSort} onChange={e => setStockSort(e.target.value as StockSort)}>
            <option value="name-asc">Name: A–Z</option>
            <option value="name-desc">Name: Z–A</option>
            <option value="remaining-asc">Remaining: low to high</option>
            <option value="remaining-desc">Remaining: high to low</option>
            <option value="status">Status: needs attention first</option>
          </select></label>
        </>}
        <button type="button" className={button} disabled={!!completing} onClick={() => { setHistoryItem(null); setRetry(n => n + 1); }}>Refresh inventory</button>
      </div>
      {!data.branches.length && <p role="status" className="text-sm text-slate-600">No inventory branches are available to your account.</p>}{branch && !activeBranch && <p role="status" className="text-sm text-amber-800">This branch is inactive. Stock balances and history remain available; new stock movements are unavailable.</p>}
      {tab === 'stocks' && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Branch stock levels"><div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600">{branch ? branchName(branch) : 'Branch stock'} · Quantities use each item’s stock unit.</div>{!branchId ? <p role="status" className="p-8 text-sm text-slate-500">Select an authorized branch to see stock balances.</p> : !matching.length ? <div role="status" className="space-y-2 p-8 text-center"><p className="font-semibold">{search || categoryFilter !== 'all' ? 'No matching items' : 'No inventory items yet'}</p><p className="text-sm text-slate-500">{search || categoryFilter !== 'all' ? 'Try another search or category filter.' : manage ? 'Add an item, then receive its opening stock.' : 'An authorized administrator can add inventory items.'}</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-4">Item details</th><th className="px-4 py-4 text-right">Remaining</th><th className="px-4 py-4">Status</th><th className="px-4 py-4">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{matching.map(item => { const stock = branchStocks.get(item.id); const balance = stock?.quantity ?? 0; return <tr key={item.id} className="align-top hover:bg-slate-50/50"><td className="px-4 py-4"><p className="font-semibold text-slate-900">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.sku} · {item.category || 'Uncategorized'}</p><p className="mt-1 text-xs text-slate-500">Low-stock threshold: {Number.isFinite(item.lowStockThreshold) ? `${quantity(item.lowStockThreshold)} ${stockUnit(item)}` : 'Not set'}</p></td><td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums">{stock?.issue ? 'Unavailable' : `${quantity(balance)} ${stockUnit(item)}`}</td><td className="px-4 py-4">{stock?.issue ? <span className="text-xs text-amber-800">Needs review</span> : Number.isFinite(item.lowStockThreshold) && balance <= item.lowStockThreshold ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"><AlertTriangle size={13} />Low stock</span> : <span className="text-xs text-slate-600">{Number.isFinite(item.lowStockThreshold) ? 'In stock' : 'Threshold not set'}</span>}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2">{manage && <><button className={button} disabled={!!completing || !activeBranch || !!stock?.issue} onClick={() => open({ kind: 'receive', item, stock })}>Receive</button><button className={button} disabled={!!completing || !activeBranch || !!stock?.issue || balance <= 0} onClick={() => open({ kind: 'use', item, stock })}>Use</button></>}<button className={`${button} inline-flex items-center gap-1.5`} disabled={!branchId} onClick={() => setHistoryItem(item)}><History size={15} />History</button>{admin && <button className={button} disabled={!!completing || !activeBranch || !!stock?.issue} onClick={() => open({ kind: 'adjust', item, stock })}>Adjust</button>}</div>{stock?.issue && <p className="mt-2 max-w-xs text-xs text-amber-800">{stock.issue}</p>}</td></tr>; })}</tbody></table></div>}</section>}
      {tab === 'suppliers' && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Inventory suppliers">{!data.suppliers.length ? <div role="status" className="space-y-2 p-8 text-center"><p className="font-semibold">No suppliers yet</p><p className="text-sm text-slate-500">{manage ? 'Add a supplier to reference stock receipts.' : 'Supplier details will appear here when added.'}</p></div> : <ul className="divide-y divide-slate-100">{data.suppliers.map(s => <li key={s.id} className="space-y-1 p-4"><h2 className="font-semibold">{s.name}</h2>{s.contactPerson && <p className="text-sm text-slate-600">{s.contactPerson}</p>}<p className="break-words text-sm text-slate-500">{[s.email, s.phone].filter(Boolean).join(' · ') || 'No contact details recorded'}</p></li>)}</ul>}</section>}
      {tab === 'transfers' && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Stock transfers"><p className="border-b border-slate-100 p-4 text-sm text-slate-500">Transfers involving {branchName(branch)}. Both branches must be authorized. Pending transfers move stock only when completed.</p>{!data.transfers.length ? <p role="status" className="p-8 text-center text-sm text-slate-500">No stock transfers for this branch.</p> : <ul className="divide-y divide-slate-100">{data.transfers.map(entry => <li key={entry.id} className="flex flex-wrap items-start justify-between gap-4 p-4"><div className="min-w-0 space-y-1"><h2 className="font-semibold">{data.items.find(i => i.id === entry.itemId)?.name || entry.itemId}</h2><p className="text-sm text-slate-600">{entry.fromBranchName || branchName(data.branches.find(b => b.id === entry.fromBranchId))} → {entry.toBranchName || branchName(data.branches.find(b => b.id === entry.toBranchId))}</p><p className="text-sm text-slate-600">{quantity(entry.quantity)} {stockUnit(data.items.find(i => i.id === entry.itemId))} · {entry.status}</p><p className="text-xs text-slate-500">Created {formatDateTime(entry.createdAt)}</p></div>{transfer && entry.status === 'pending' && <button className={button} disabled={!!completing || data.branches.find(b => b.id === entry.fromBranchId)?.status !== 'Active' || data.branches.find(b => b.id === entry.toBranchId)?.status !== 'Active'} onClick={() => void complete(entry)}>{completing === entry.id ? 'Completing…' : 'Complete transfer'}</button>}</li>)}</ul>}</section>}
      {historyItem && branchId && <InventoryHistory key={historyItem.id} item={historyItem} branchId={branchId} branchLabel={branchName(branch)} onClose={() => setHistoryItem(null)} />}
    </>}
  </div>;
}

function InventoryEditor({ editor, data, branchId, userProfile, onClose, onSaved, onReload }: { editor: Editor; data: Overview; branchId: string; userProfile: any; onClose: () => void; onSaved: () => void; onReload: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ name: '', sku: '', categoryId: '', unit: '', lowStockThreshold: '0', contactPerson: '', email: '', phone: '', itemId: editor.item?.id || '', toBranchId: '', quantity: '', occurredAt: getActiveDateTimeInput(), supplierId: '', reference: '', notes: '' }));
  const initial = useRef(JSON.stringify(values));
  const [timezone] = useState(() => getActiveTimezoneSettings().timezone || 'Asia/Manila');
  const [id] = useState(() => crypto.randomUUID());
  const command = useRef({ key: '', id: crypto.randomUUID() });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const life = useRef({ active: false, request: null as AbortController | null });
  useLayoutEffect(() => { life.current.active = true; return () => { life.current.active = false; life.current.request?.abort(); }; }, []);
  const dirty = initial.current !== JSON.stringify(values), kind = editor.kind;
  const allowed = uiCan(userProfile, kind === 'transfer' ? 'inventory.transfer' : 'inventory.manage') && (kind !== 'adjust' || hasAdministrativeAccess(currentPermissionProfile()?.role || userProfile?.role));
  const movement = kind === 'receive' || kind === 'use' || kind === 'adjust';
  const title = ({ item: 'Add item', supplier: 'Add supplier', transfer: 'New stock transfer', receive: 'Receive stock', use: 'Record stock usage', adjust: 'Correct stock balance' })[kind];
  const set = (name: string, value: string) => setValues(previous => ({ ...previous, [name]: value }));
  const close = () => { if (!busy && (!(dirty || uncertain) || window.confirm(uncertain ? 'This action may have completed. Close and check inventory history before recording it again?' : 'Discard unsaved inventory changes?'))) onClose(); };
  const text = (name: string, label: string, required = false, maxLength = 160, type = 'text') => <label className="block space-y-2 text-sm font-medium"><span>{label}</span><input className={field} type={type} required={required} maxLength={maxLength} value={values[name]} onChange={e => set(name, e.target.value)} /></label>;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || conflict || !allowed) return;
    let payload: Record<string, unknown>, path: string;
    try {
      if (kind === 'item') { path = '/api/inventory/items'; payload = { id, name: values.name.trim(), sku: values.sku.trim(), categoryId: values.categoryId || null, unit: values.unit.trim(), lowStockThreshold: Number(values.lowStockThreshold) }; }
      else if (kind === 'supplier') { path = '/api/inventory/suppliers'; payload = { id, name: values.name.trim(), contactPerson: values.contactPerson.trim(), email: values.email.trim(), phone: values.phone.trim() }; }
      else {
        const amount = inventoryQuantity(Number(values.quantity), kind === 'adjust');
        const occurredAt = movement ? fromZonedTime(values.occurredAt, timezone) : null; if (occurredAt && Number.isNaN(occurredAt.getTime())) throw new Error('Choose a valid date and time.');
        if (kind === 'adjust' && !values.notes.trim()) throw new Error('Enter a reason for this stock correction.');
        if (kind === 'transfer') { path = '/api/inventory/transfers/create'; payload = { itemId: values.itemId, fromBranchId: branchId, toBranchId: values.toBranchId, quantity: amount, notes: values.notes.trim() }; }
        else { path = '/api/inventory/movements'; payload = { action: kind, itemId: editor.item!.id, branchId, quantity: amount, occurredAt: occurredAt!.toISOString(), notes: values.notes.trim(), reference: values.reference.trim(), ...(kind === 'receive' && values.supplierId ? { supplierId: values.supplierId } : {}), ...(kind === 'adjust' ? { expectedVersion: editor.stock?.version ?? 0 } : {}) }; }
        const key = JSON.stringify(payload); if (command.current.key !== key) command.current = { key, id: crypto.randomUUID() }; payload.commandId = command.current.id;
      }
    } catch (failure: any) { setError(failure.message); return; }
    life.current.request?.abort(); const controller = new AbortController(); life.current.request = controller;
    const current = () => life.current.active && life.current.request === controller && !controller.signal.aborted;
    setBusy(true); setError('');
    try { await inventoryRequest(path, 'POST', payload, controller.signal, current); if (current()) onSaved(); }
    catch (failure: any) { if (current() && failure.name !== 'AbortError') { setError(failure.message); setUncertain(!failure.status || failure.status >= 500); setConflict(failure.status === 409 && failure.code !== 'CATEGORY_INACTIVE'); } }
    finally { if (current()) setBusy(false); }
  };
  return <section className="space-y-6"><button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy} onClick={close}><ArrowLeft size={16} />Back to inventory</button><header><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-slate-600">{editor.item ? `${editor.item.name} · ${branchName(data.branches.find(b => b.id === branchId))}` : kind === 'transfer' ? 'Move stock between branches your account can access.' : kind === 'item' ? 'Use one consistent stock unit. Receive stock after creating the item.' : 'Supplier details are optional on stock receipts.'}</p></header>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}{uncertain && <p role="status" className="text-sm text-amber-800">The result is uncertain. Retry the same action, or close and inspect stock history before recording it again.</p>}{conflict && <div className="space-y-3"><p className="text-sm text-amber-800">The stock or record changed. Reload the current balance before making another change.</p><button type="button" className={button} onClick={() => { if (!dirty || window.confirm('Close this draft and reload the latest inventory?')) onReload(); }}>Close and reload inventory</button></div>}
    <form className="space-y-5" onSubmit={submit}><fieldset disabled={busy || uncertain || conflict || !allowed} className="space-y-5">
      {kind === 'item' && <>{text('name', 'Item name', true, 200)}<div className="grid gap-5 sm:grid-cols-2">{text('sku', 'SKU', true, 80)}<label className="block space-y-2 text-sm font-medium"><span>Category (optional)</span><select className={field} value={values.categoryId} onChange={e => set('categoryId', e.target.value)}><option value="">Uncategorized</option>{data.categories.filter(category => category.active).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div><div className="grid gap-5 sm:grid-cols-2">{text('unit', 'Stock unit', true, 40)}<label className="block space-y-2 text-sm font-medium"><span>Low-stock threshold</span><input className={field} type="number" min="0" step="0.001" max="1000000000" required value={values.lowStockThreshold} onChange={e => set('lowStockThreshold', e.target.value)} /></label></div><p className="text-xs leading-5 text-slate-500">Examples: piece, bottle, vial or mL. This release keeps one unit per item, without unit conversions. Manage categories from Stocks & Levels before adding an item if needed.</p></>}
      {kind === 'supplier' && <>{text('name', 'Supplier name', true, 200)}{text('contactPerson', 'Contact person (optional)', false, 120)}<div className="grid gap-5 sm:grid-cols-2">{text('email', 'Email (optional)', false, 200, 'email')}{text('phone', 'Phone (optional)', false, 80, 'tel')}</div></>}
      {kind === 'transfer' && <><label className="block space-y-2 text-sm font-medium"><span>Item</span><select className={field} required value={values.itemId} onChange={e => set('itemId', e.target.value)}><option value="">Choose an item</option>{data.items.map(item => <option key={item.id} value={item.id}>{item.name} · {stockUnit(item)}</option>)}</select></label><div className="grid gap-5 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium"><span>From branch</span><input className={field} readOnly value={branchName(data.branches.find(b => b.id === branchId))} /></label><label className="block space-y-2 text-sm font-medium"><span>To branch</span><select className={field} required value={values.toBranchId} onChange={e => set('toBranchId', e.target.value)}><option value="">Choose a destination</option>{data.branches.filter(b => b.id !== branchId && b.status === 'Active').map(b => <option key={b.id} value={b.id}>{branchName(b)}</option>)}</select></label></div></>}
      {(movement || kind === 'transfer') && <><div className="grid gap-5 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium"><span>{kind === 'adjust' ? 'Quantity change (+ to add, − to subtract)' : `Quantity${editor.item ? ` (${stockUnit(editor.item)})` : ''}`}</span><input className={field} required type="number" step="0.001" max="1000000000" min={kind === 'adjust' ? '-1000000000' : '0.001'} value={values.quantity} onChange={e => set('quantity', e.target.value)} /></label>{movement && <label className="block space-y-2 text-sm font-medium"><span>Date and time ({timezone})</span><input className={field} required type="datetime-local" value={values.occurredAt} onChange={e => set('occurredAt', e.target.value)} /></label>}</div>{editor.item && <p className="text-sm text-slate-600">Current balance: <span className="font-semibold tabular-nums">{quantity(editor.stock?.quantity ?? 0)} {stockUnit(editor.item)}</span>{values.quantity && Number.isFinite(Number(values.quantity)) && <span> · Resulting balance: {quantity((editor.stock?.quantity ?? 0) + (kind === 'use' ? -1 : 1) * Number(values.quantity))} {stockUnit(editor.item)}</span>}</p>}{kind === 'receive' && <label className="block space-y-2 text-sm font-medium"><span>Supplier (optional)</span><select className={field} value={values.supplierId} onChange={e => set('supplierId', e.target.value)}><option value="">No supplier reference</option>{data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}{movement && text('reference', 'Reference (optional)', false, 160)}<label className="block space-y-2 text-sm font-medium"><span>{kind === 'adjust' ? 'Correction reason' : 'Notes (optional)'}</span><textarea className={field} rows={3} maxLength={2000} required={kind === 'adjust'} value={values.notes} onChange={e => set('notes', e.target.value)} /></label>{kind === 'transfer' && <p className="text-xs leading-5 text-slate-500">Creating a transfer does not reserve stock. Quantity and the movement time are recorded when the transfer is completed; the server checks the source balance again then.</p>}</>}
    </fieldset><div className="flex flex-wrap gap-3"><button type="submit" className={primary} disabled={busy || conflict || !allowed}>{busy ? 'Saving…' : uncertain ? 'Retry same action' : kind === 'transfer' ? 'Create transfer' : kind === 'item' ? 'Create item' : kind === 'supplier' ? 'Create supplier' : 'Save stock movement'}</button><button type="button" className={button} disabled={busy} onClick={close}>Cancel</button></div></form>
  </section>;
}

function InventoryCategories({ categories, branchId, userProfile, onClose }: { categories: Category[]; branchId: string; userProfile: any; onClose: () => void }) {
  const [list, setList] = useState(categories), [loading, setLoading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ saved: Category | null; active?: boolean; key: string } | null>(null);
  const life = useRef({ active: false, request: null as AbortController | null });
  const allowed = uiCan(userProfile, 'inventory.manage');
  useLayoutEffect(() => { life.current.active = true; return () => { life.current.active = false; life.current.request?.abort(); }; }, []);
  const reload = async (editingId?: string) => {
    life.current.request?.abort(); const controller = new AbortController(); life.current.request = controller;
    const current = () => life.current.active && life.current.request === controller && !controller.signal.aborted;
    setLoading(true); setError('');
    try {
      const query = branchId ? `?${new URLSearchParams({ branchId })}` : '';
      const response = await inventoryRequest(`/api/inventory${query}`, 'GET', undefined, controller.signal, current);
      if (!current()) return;
      if (!Array.isArray(response?.categories)) throw new Error('Categories could not be loaded. Retry categories.');
      setList(response.categories);
      if (editingId) {
        const saved = response.categories.find((category: Category) => category.id === editingId);
        if (!saved) throw new Error('This category is unavailable. Close this draft and review the category list.');
        setEditing({ saved, key: crypto.randomUUID() });
      }
    } catch (failure: any) { if (current() && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (current()) setLoading(false); }
  };
  if (editing) return <InventoryCategoryEditor key={editing.key} saved={editing.saved} initialActive={editing.active} userProfile={userProfile} opening={loading} reloadError={error} onClose={() => { setEditing(null); setError(''); }} onReload={() => void reload(editing.saved?.id)} onSaved={() => { setEditing(null); setMessage('Category saved.'); void reload(); }} />;
  return <section className="space-y-6">
    <button type="button" className={`${button} inline-flex items-center gap-2`} onClick={onClose}><ArrowLeft size={16} />Back to inventory</button>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Inventory categories</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Organize inventory items. Inactive categories remain on existing items and are unavailable for new items.</p></div>{allowed && <button type="button" className={primary} disabled={loading} onClick={() => { setError(''); setMessage(''); setEditing({ saved: null, key: crypto.randomUUID() }); }}>Add category</button>}</header>
    {message && <p role="status" className="text-sm text-teal-800">{message}</p>}
    {loading ? <p role="status" className="py-6 text-sm text-slate-600">Loading categories…</p> : error ? <div role="alert" className="space-y-3 text-sm text-rose-700"><p>{error}</p><button type="button" className={button} onClick={() => void reload()}>Retry categories</button></div> : !list.length ? <p role="status" className="border-y border-slate-200 py-8 text-sm text-slate-600">No categories yet. Items can remain Uncategorized.</p> : <ul className="divide-y divide-slate-200 border-y border-slate-200" aria-label="Inventory categories">{list.map(category => <li key={category.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><h2 className="break-words font-semibold">{category.name}</h2><p className="mt-1 text-xs text-slate-500">{category.active ? 'Active' : 'Inactive'} · Version {category.version}</p></div>{allowed && <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-label={`Rename category ${category.name}`} onClick={() => { setError(''); setMessage(''); setEditing({ saved: category, key: crypto.randomUUID() }); }}>Rename</button><button type="button" className={button} aria-label={`${category.active ? 'Deactivate' : 'Reactivate'} category ${category.name}`} onClick={() => { setError(''); setMessage(''); setEditing({ saved: category, active: !category.active, key: crypto.randomUUID() }); }}>{category.active ? 'Deactivate' : 'Reactivate'}</button></div>}</li>)}</ul>}
  </section>;
}

function InventoryCategoryEditor({ saved, initialActive, userProfile, opening, reloadError, onClose, onReload, onSaved }: { saved: Category | null; initialActive?: boolean; userProfile: any; opening: boolean; reloadError: string; onClose: () => void; onReload: () => void; onSaved: () => void }) {
  const [id] = useState(() => saved?.id || crypto.randomUUID());
  const [name, setName] = useState(saved?.name || ''), [active, setActive] = useState(initialActive ?? saved?.active ?? true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false);
  const life = useRef({ active: false, request: null as AbortController | null }), command = useRef({ key: '', id: crypto.randomUUID() });
  const writable = uiCan(userProfile, 'inventory.manage'), dirty = name !== (saved?.name || '') || active !== (saved?.active ?? true);
  useLayoutEffect(() => { life.current.active = true; return () => { life.current.active = false; life.current.request?.abort(); }; }, []);
  const close = () => { if (!busy && !opening && (!(dirty || uncertain) || window.confirm(uncertain ? 'The category may have saved. Close and inspect the category list before trying another change?' : 'Discard unsaved category changes?'))) onClose(); };
  const reload = () => { if (!busy && !opening && (!dirty || window.confirm('Replace this category draft with the latest saved version?'))) onReload(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || opening || conflict || !writable) return;
    if (!name.trim()) { setError('Enter a category name.'); return; }
    const content = { id, name: name.trim(), active, expectedVersion: saved?.version ?? 0 }, key = JSON.stringify(content);
    if (command.current.key !== key) command.current = { key, id: crypto.randomUUID() };
    life.current.request?.abort(); const controller = new AbortController(); life.current.request = controller;
    const current = () => life.current.active && life.current.request === controller && !controller.signal.aborted;
    setBusy(true); setError('');
    try {
      await inventoryRequest(saved ? `/api/inventory/categories/${encodeURIComponent(id)}` : '/api/inventory/categories', saved ? 'PATCH' : 'POST', { ...content, commandId: command.current.id }, controller.signal, current);
      if (current()) onSaved();
    } catch (failure: any) { if (current() && failure.name !== 'AbortError') { setError(failure.message); setConflict(failure.status === 409 && failure.code !== 'CATEGORY_NAME_EXISTS'); setUncertain(!failure.status || failure.status >= 500); } }
    finally { if (current()) setBusy(false); }
  };
  return <section className="space-y-6">
    <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy || opening} onClick={close}><ArrowLeft size={16} />Back to categories</button>
    <header><h1 className="text-2xl font-semibold tracking-tight">{saved ? 'Edit category' : 'Add category'}</h1><p className="mt-2 text-sm text-slate-600">{saved ? `Version ${saved.version}. Renaming updates the category label on linked items; recorded category text remains unchanged.` : 'Create an active category for new inventory items.'}</p></header>
    {(error || reloadError) && <p role="alert" className="text-sm text-rose-700">{reloadError || error}</p>}
    {opening && <p role="status" className="text-sm text-slate-600">Reloading saved category…</p>}
    {conflict && <div className="space-y-3"><p className="text-sm text-amber-800">The category changed. Your draft is preserved. Review the saved category before trying again.</p>{saved && <button type="button" className={button} disabled={busy || opening} onClick={reload}>Reload saved category</button>}</div>}
    {uncertain && <p role="status" className="text-sm text-amber-800">The save result is uncertain. Retry the same save, or close and review the category list before making another change.</p>}
    <form className="space-y-5" onSubmit={submit}><fieldset className="space-y-5" disabled={busy || opening || uncertain || conflict || !writable}>
      <label className="block space-y-2 text-sm font-medium"><span>Category name</span><input className={field} required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      {saved && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Active for new items</label>}
    </fieldset><div className="flex flex-wrap gap-3"><button type="submit" className={primary} disabled={busy || opening || conflict || !writable}>{busy ? 'Saving category…' : uncertain ? 'Retry same category save' : 'Save category'}</button><button type="button" className={button} disabled={busy || opening} onClick={close}>Cancel</button></div></form>
  </section>;
}

function InventoryHistory({ item, branchId, branchLabel, onClose }: { item: Item; branchId: string; branchLabel: string; onClose: () => void }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ key: '', movements: [] as Movement[], total: 0, error: '' });
  const life = useRef(false), key = `${page}-${retry}`;
  useLayoutEffect(() => { life.current = true; return () => { life.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), current = () => life.current && !controller.signal.aborted;
    const query = new URLSearchParams({ branchId, page: String(page) });
    void inventoryRequest(`/api/inventory/items/${encodeURIComponent(item.id)}/history?${query}`, 'GET', undefined, controller.signal, current).then(data => {
      if (!current()) return;
      if (!Array.isArray(data?.movements) || !Number.isFinite(data.total)) throw new Error('Stock history could not be loaded. Retry history.');
      if (page > 1 && (page - 1) * 25 >= data.total) { setPage(Math.max(1, Math.ceil(data.total / 25))); return; }
      setResult({ key, movements: data.movements, total: data.total, error: '' });
    }).catch(failure => { if (current() && failure.name !== 'AbortError') setResult({ key, movements: [], total: 0, error: failure.message }); });
    return () => controller.abort();
  }, [key, branchId, item.id]);
  const visible = result.key === key ? result : null;
  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Item movement history"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{item.name} · Stock history</h2><p className="mt-1 text-sm text-slate-500">{branchLabel} · Dated, attributed stock movements.</p></div><button type="button" className={button} onClick={onClose}>Close history</button></header>{!visible ? <p role="status" className="text-sm text-slate-600">Loading stock history…</p> : visible.error ? <div role="alert" className="space-y-3 text-sm text-rose-700"><p>{visible.error}</p><button type="button" className={button} onClick={() => setRetry(n => n + 1)}>Retry history</button></div> : <>{!visible.movements.length ? <p role="status" className="py-4 text-sm text-slate-500">No stock movements recorded for this item at this branch.</p> : <ol className="divide-y divide-slate-100">{visible.movements.map(entry => <li key={entry.id} className="space-y-2 py-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><p className="font-semibold">{movementName[entry.kind] || entry.kind} · <span className="tabular-nums">{entry.quantity > 0 ? '+' : ''}{quantity(entry.quantity)} {stockUnit(item)}</span></p><p className="tabular-nums">Balance: {quantity(entry.balanceAfter)} {stockUnit(item)}</p></div><p className="text-xs leading-5 text-slate-500">{formatDateTime(entry.occurredAt)} · {entry.actor?.name || 'Historical record'}<br />Recorded {formatDateTime(entry.recordedAt)}</p>{entry.fromBranchName && entry.toBranchName && <p className="break-words text-sm font-medium text-slate-700">{entry.fromBranchName} → {entry.toBranchName}</p>}{entry.supplierName && <p className="text-sm text-slate-600">Supplier: {entry.supplierName}</p>}{entry.reference && <p className="break-words text-sm text-slate-600">Reference: {entry.reference}</p>}{entry.notes && <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{entry.notes}</p>}{entry.transferId && <p className="break-all text-xs text-slate-500">Transfer: {entry.transferId}</p>}</li>)}</ol>}{visible.total > 25 && <nav aria-label="Stock history pages" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{visible.total} movements · Page {page} of {Math.max(1, Math.ceil(visible.total / 25))}</p><div className="flex gap-3"><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><button type="button" className={button} disabled={page * 25 >= visible.total} onClick={() => setPage(n => n + 1)}>Next</button></div></nav>}</>}</section>;
}
