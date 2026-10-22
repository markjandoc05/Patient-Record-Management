import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { auth } from '../platform';
import { uiCan, uiPermissionScope } from '../permissionState';
import { inventoryRequest } from '../utils/inventoryApi';
import { downloadInventoryExcel, inventoryImportTemplate, readInventoryImportFile } from '../utils/inventoryExcel';
import { getActiveDateTimeInput, getActiveTimezoneSettings } from '../utils/timezone';
import { INVENTORY_IMPORT_MAX_ROWS, type InventoryImportPreview, type InventoryImportResult, type InventoryImportRow } from '../inventoryImportPolicy';

const field = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100 sm:text-sm';
const button = 'min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
const primary = 'min-h-11 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50';
type CommitPayload = { branchId: string; rows: InventoryImportRow[]; previewHash: string; commandId: string; occurredAt: string; notes: string };
type Props = { branchId: string; branchLabel: string; userProfile: any; onClose: () => void; onSaved: (result: InventoryImportResult) => void };

function checkedPreview(value: any, rows: InventoryImportRow[]): InventoryImportPreview {
  if (!value || typeof value.previewHash !== 'string' || !value.previewHash || !Array.isArray(value.rows)
    || value.rows.length !== rows.length || !value.rows.every((row: any) => row && ['ready', 'skip', 'error'].includes(row.status) && typeof row.message === 'string')
    || !['readyCount', 'skippedCount', 'errorCount'].every(key => Number.isInteger(value[key]) && value[key] >= 0)
    || value.readyCount + value.skippedCount + value.errorCount !== rows.length) throw new Error('The import preview could not be loaded. Refresh the preview to try again.');
  return value;
}

export default function InventoryExcelImport({ branchId, branchLabel, userProfile, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<InventoryImportRow[]>([]), [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<InventoryImportPreview | null>(null);
  const [occurredAt, setOccurredAt] = useState(getActiveDateTimeInput), [notes, setNotes] = useState('');
  const [timezone] = useState(() => getActiveTimezoneSettings().timezone || 'Asia/Manila');
  const [busy, setBusy] = useState<'file' | 'preview' | 'commit' | null>(null), [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const life = useRef({ active: false, generation: 0, request: null as AbortController | null });
  const scope = useRef(uiPermissionScope(userProfile)), uid = useRef(auth.currentUser?.uid);
  const pending = useRef<CommitPayload | null>(null);
  useLayoutEffect(() => {
    life.current.active = true;
    return () => { life.current.active = false; life.current.generation++; life.current.request?.abort(); };
  }, []);
  const allowed = uiCan(userProfile, 'inventory.view') && uiCan(userProfile, 'inventory.manage');
  const current = (generation = life.current.generation) => life.current.active && generation === life.current.generation
    && scope.current === uiPermissionScope(userProfile) && uid.current === auth.currentUser?.uid
    && uiCan(userProfile, 'inventory.view') && uiCan(userProfile, 'inventory.manage');
  const begin = () => { life.current.request?.abort(); life.current.request = null; setDownloading(false); return ++life.current.generation; };
  const close = () => {
    if (busy === 'commit') return;
    if (uncertain && !window.confirm('This import may have completed. Close and check inventory before importing this file again?')) return;
    life.current.request?.abort(); life.current.generation++;
    onClose();
  };
  const requestPreview = async (candidate: InventoryImportRow[], generation: number) => {
    if (!current(generation)) return;
    const controller = new AbortController(); life.current.request = controller;
    const active = () => current(generation) && life.current.request === controller && !controller.signal.aborted;
    setBusy('preview'); setError(''); setPreview(null);
    try {
      const response = await inventoryRequest('/api/inventory/import/preview', 'POST', { branchId, rows: candidate }, controller.signal, active);
      if (active()) setPreview(checkedPreview(response, candidate));
    } catch (failure: any) { if (active() && failure.name !== 'AbortError') setError(failure.message || 'The import preview failed. Refresh the preview to try again.'); }
    finally { if (active()) setBusy(null); }
  };
  const chooseFile = async (file?: File) => {
    if (!allowed || uncertain || busy === 'commit') return;
    const generation = begin();
    pending.current = null; setPreview(null); setRows([]); setError(''); setFileName(file?.name || ''); setBusy(null);
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024) { setError('Choose an .xlsx Excel file no larger than 2 MB.'); return; }
    setBusy('file');
    try {
      const candidate = await readInventoryImportFile(file);
      if (!current(generation)) return;
      if (!candidate.length || candidate.length > INVENTORY_IMPORT_MAX_ROWS) throw new Error(`Use between 1 and ${INVENTORY_IMPORT_MAX_ROWS} item rows in the Excel template.`);
      setRows(candidate);
      await requestPreview(candidate, generation);
    } catch (failure: any) { if (current(generation) && failure.name !== 'AbortError') { setBusy(null); setError(failure.message || 'This Excel file could not be read. Use the Excel template and try again.'); } }
  };
  const template = async () => {
    if (!allowed || downloading) return;
    const generation = life.current.generation;
    setDownloading(true); setError('');
    try {
      const bytes = await inventoryImportTemplate();
      if (current(generation)) downloadInventoryExcel(bytes, 'vine-inventory-import-template.xlsx');
    } catch (failure: any) { if (current(generation)) setError(failure.message || 'The Excel template could not be downloaded. Try again.'); }
    finally { if (current(generation)) setDownloading(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!current() || busy || !preview || preview.errorCount || !preview.readyCount) return;
    let payload = pending.current;
    if (!payload) {
      try {
        const date = fromZonedTime(occurredAt, timezone);
        if (!occurredAt || Number.isNaN(date.getTime())) throw new Error('Choose a valid opening stock date and time.');
        payload = { branchId, rows: rows.map(row => ({ ...row })), previewHash: preview.previewHash, commandId: crypto.randomUUID(), occurredAt: date.toISOString(), notes: notes.trim() };
        pending.current = payload;
      } catch (failure: any) { setError(failure.message); return; }
    }
    const generation = begin(), controller = new AbortController(); life.current.request = controller;
    const active = () => current(generation) && life.current.request === controller && !controller.signal.aborted;
    setBusy('commit'); setError('');
    try {
      const response = await inventoryRequest('/api/inventory/import/commit', 'POST', payload, controller.signal, active);
      if (!active()) return;
      if (!response || !Number.isInteger(response.importedCount) || !Number.isInteger(response.skippedCount) || !Array.isArray(response.itemIds)) throw new Error('The import result could not be confirmed. Retry the same import to check its result.');
      onSaved(response);
    } catch (failure: any) {
      if (!active() || failure.name === 'AbortError') return;
      const unknown = !failure.status || failure.status >= 500;
      setUncertain(unknown); setError(failure.message || 'The import failed. Try again.');
      if (!unknown) pending.current = null;
      if (failure.status === 409 && failure.code === 'IMPORT_PREVIEW_CHANGED') setPreview(null);
    } finally { if (active()) setBusy(null); }
  };

  return <section className="space-y-6">
    <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy === 'commit'} onClick={close}><ArrowLeft size={16} />Back to inventory</button>
    <header><h1 className="text-2xl font-semibold tracking-tight">Import inventory from Excel</h1><p className="mt-2 text-sm text-slate-600">Add new items and opening stock at {branchLabel}. Review each row before importing.</p></header>
    <div className="max-w-3xl space-y-3 text-sm leading-6 text-slate-600">
      <p>Use the template for up to {INVENTORY_IMPORT_MAX_ROWS} items. Existing SKUs are skipped, so existing item details and stock balances stay unchanged. An opening quantity of zero creates the item without adding stock.</p>
      <p>Category names must match an active category. Create any missing categories using Manage categories before importing.</p>
      <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={downloading || busy === 'commit' || !allowed} onClick={() => void template()}><Download size={16} />{downloading ? 'Preparing template…' : 'Download Excel template'}</button>
    </div>
    {!allowed && <p role="alert" className="text-sm text-rose-700">Inventory management access is required to import items.</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {uncertain && <p role="status" className="max-w-3xl text-sm leading-6 text-amber-800">The result is uncertain. Retry the same import to confirm its result. The file, date and notes are kept unchanged to prevent duplicate opening stock.</p>}
    <form className="space-y-6" onSubmit={submit}>
      <fieldset className="max-w-3xl space-y-5" disabled={busy === 'commit' || uncertain || !allowed}>
        <label className="block space-y-2 text-sm font-medium"><span>Excel file (.xlsx, up to 2 MB)</span><input className={`${field} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-slate-700`} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseFile(file); }} /></label>
        {fileName && <p className="break-words text-sm text-slate-600">Selected file: {fileName}</p>}
        <label className="block space-y-2 text-sm font-medium"><span>Opening stock date and time ({timezone})</span><input className={field} type="datetime-local" value={occurredAt} required onChange={event => setOccurredAt(event.target.value)} /></label>
        <label className="block space-y-2 text-sm font-medium"><span>Import notes (optional)</span><textarea className={field} rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      </fieldset>
      {busy === 'file' && <p role="status" className="text-sm text-slate-600">Reading Excel file…</p>}
      {busy === 'preview' && <p role="status" className="text-sm text-slate-600">Checking the import preview…</p>}
      {rows.length > 0 && <button type="button" className={button} disabled={!!busy || uncertain || !allowed} onClick={() => { const generation = begin(); pending.current = null; void requestPreview(rows, generation); }}>Refresh preview</button>}
      {preview && <section className="space-y-3" aria-label="Import preview"><h2 className="text-lg font-semibold">Review import</h2><p className="text-sm text-slate-600">{preview.readyCount} ready · {preview.skippedCount} skipped · {preview.errorCount} errors</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">Excel import row checks for {branchLabel}</caption><thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Row', 'Item / SKU', 'Category', 'Stock unit', 'Low-stock threshold', 'Opening quantity', 'Result'].map(heading => <th key={heading} scope="col" className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{preview.rows.map((row, index) => <tr key={`${row.rowNumber}-${index}`}><td className="px-4 py-3 tabular-nums">{row.rowNumber}</td><td className="max-w-xs break-words px-4 py-3"><p className="font-medium">{row.name}</p><p className="text-xs text-slate-500">{row.sku}</p></td><td className="max-w-48 break-words px-4 py-3">{row.category || 'Uncategorized'}</td><td className="max-w-32 break-words px-4 py-3">{row.unit}</td><td className="px-4 py-3 tabular-nums">{row.lowStockThreshold}</td><td className="px-4 py-3 tabular-nums">{row.openingQuantity}</td><td className={`max-w-xs px-4 py-3 ${row.status === 'error' ? 'text-rose-700' : row.status === 'skip' ? 'text-slate-600' : 'text-teal-800'}`}><p className="font-medium">{row.status === 'ready' ? 'Ready' : row.status === 'skip' ? 'Skipped' : 'Needs correction'}</p><p className="mt-1 text-xs leading-5">{row.message}</p></td></tr>)}</tbody></table></div>
        {preview.errorCount > 0 && <p className="text-sm text-rose-700">Correct the marked rows in Excel, then choose the updated file. Nothing has been imported.</p>}
        {!preview.errorCount && !preview.readyCount && <p className="text-sm text-slate-600">No new items to import. Existing SKUs have been skipped.</p>}
      </section>}
      <div className="flex flex-wrap gap-3"><button type="submit" className={primary} disabled={!!busy || !preview || !!preview.errorCount || !preview.readyCount || !allowed}>{busy === 'commit' ? 'Importing…' : uncertain ? 'Retry same import' : `Import ${preview?.readyCount || 0} new ${preview?.readyCount === 1 ? 'item' : 'items'}`}</button><button type="button" className={button} disabled={busy === 'commit'} onClick={close}>Cancel</button></div>
    </form>
  </section>;
}
