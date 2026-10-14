import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Download, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { auth, db } from '../platform';
import { doc, onSnapshot, subscribeProtectedDataInvalidation } from '../dataClient';
import { currentPermissionProfile, uiCan, uiPermissionScope } from '../permissionState';
import { hasCapability } from '../permissions';
import { DEFAULT_MEDIA_SETTINGS, IMAGE_OPTIMIZATION, normalizeMediaSettings } from '../mediaSettings';
import { GALLERY_PHOTO_LIMIT, isGalleryImage, parsePhotoInput, type GalleryPhotoStage } from '../patientGalleryPolicy';
import { deleteAttachment, downloadAttachment, fetchAttachmentBlob, openAttachment, uploadAttachment, type StoredAttachment } from '../utils/attachmentApi';
import { getGalleryVisit, updateAttachmentPhoto } from '../utils/patientGalleryApi';
import { formatDateTime } from '../utils';

type Props = { patientId: string; users: any[]; branches: any[]; visits: any[]; userRole?: string; patientArchived?: boolean };
type Photo = { visit: any; file: StoredAttachment };
type Details = { stage: GalleryPhotoStage; takenAt: string; area: string; note: string };
const field = 'w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-40';
const stageLabel = (file: StoredAttachment) => ({ before: 'Before', after: 'After', progress: 'Progress' }[file.photo?.stage || ''] || 'Unclassified');
const visitLabel = (visit: any) => String(visit.visitDate || '').replace('T', ' ') + ' · ' + (visit.serviceNameSnapshot || visit.treatmentService || visit.visitType || 'Visit');
const takenLabel = (file: StoredAttachment) => file.photo?.takenAt ? file.photo.takenAt.replace('T', ' ') + ' (' + file.photo.timezone + ')' : 'Photo date not recorded';
const visitContext = (visit: any) => JSON.stringify([visit?.id, visit?.patientId, visit?.branchId, visit?.isArchived === true]);
function galleryActor(props: Props) { return currentPermissionProfile() || props.users.find(user => user.id === auth.currentUser?.uid) || { role: props.userRole, active: true }; }
function scopeKey(props: Props) {
  const p = galleryActor(props);
  return JSON.stringify([props.patientId, !!props.patientArchived, auth.currentUser?.uid, uiPermissionScope(p), p.role, p.assignedBranches,
    props.visits.filter(v => v.patientId === props.patientId).map(visitContext).sort()]);
}
function canView(actor?: Parameters<typeof uiCan>[0]) { return uiCan(actor, 'patients.view') && uiCan(actor, 'visits.view') && uiCan(actor, 'clinical.view'); }
function canWrite(visit: any, props: Props) {
  const profile = galleryActor(props);
  return !props.patientArchived && visit && visit.patientId === props.patientId && visit.isArchived !== true
    && canView(profile) && hasCapability(profile, 'visits.attachments.manage', { branchId: visit.branchId });
}

function GalleryDialog({ title, children, onClose, disabled = false }: { title: string; children: React.ReactNode; onClose: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div data-gallery-dialog role="dialog" aria-modal="true" aria-label={title} ref={ref}
    className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-3 sm:p-6" onClick={event => { if (event.target === event.currentTarget && !disabled) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!disabled) onClose(); }
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3"><h3 className="text-lg font-bold text-slate-900">{title}</h3><button type="button" className={button} disabled={disabled} onClick={onClose} aria-label={'Close ' + title}><X size={18} /></button></header>
      <div className="overflow-auto p-4">{children}</div>
    </div>
  </div>, document.body);
}
function DetailFields({ prefix, value, onChange, disabled }: { prefix: string; value: Details; onChange: (value: Details) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-sm text-slate-700" htmlFor={prefix + '-stage'}>Photo label<select id={prefix + '-stage'} className={field} value={value.stage} onChange={event => onChange({ ...value, stage: event.target.value as GalleryPhotoStage })}><option value="before">Before</option><option value="after">After</option><option value="progress">Progress</option></select></label>
    <label className="space-y-1 text-sm text-slate-700" htmlFor={prefix + '-taken-at'}>Photo date and time<input id={prefix + '-taken-at'} className={field} type="datetime-local" required value={value.takenAt} onChange={event => onChange({ ...value, takenAt: event.target.value })} /><span className="block text-xs text-slate-600">Use the Visit clinic's local time.</span></label>
    <label className="space-y-1 text-sm text-slate-700" htmlFor={prefix + '-area'}>Treatment area or angle (optional)<input id={prefix + '-area'} className={field} maxLength={120} placeholder="e.g. Face — front" value={value.area} onChange={event => onChange({ ...value, area: event.target.value })} /></label>
    <label className="space-y-1 text-sm text-slate-700" htmlFor={prefix + '-note'}>Photo note (optional)<textarea id={prefix + '-note'} className={field} rows={2} maxLength={500} value={value.note} onChange={event => onChange({ ...value, note: event.target.value })} /></label>
  </fieldset>;
}
function GalleryWorkspace(props: Props & { scope: string }) {
  const [uploadOpen, setUploadOpen] = useState(false), [visitId, setVisitId] = useState('');
  const [draft, setDraft] = useState<Details>({ stage: 'before', takenAt: '', area: '', note: '' });
  const [selected, setSelected] = useState<File[]>([]), [localFiles, setLocalFiles] = useState<Record<string, StoredAttachment[]>>({});
  const [overrides, setOverrides] = useState<Record<string, StoredAttachment>>({}), [removed, setRemoved] = useState<string[]>([]);
  const [reloadedVisits, setReloadedVisits] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [uploadUncertain, setUploadUncertain] = useState(false);
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [dateFilter, setDateFilter] = useState(''), [page, setPage] = useState(1);
  const [compare, setCompare] = useState<string[]>([]), [comparisonOpen, setComparisonOpen] = useState(false), [zoom, setZoom] = useState<string | null>(null), [scale, setScale] = useState(1);
  const [editor, setEditor] = useState<{ photo: Photo; expectedVersion: number; value: Details } | null>(null), [removePhoto, setRemovePhoto] = useState<Photo | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({}), [previewErrors, setPreviewErrors] = useState<string[]>([]), [previewRetry, setPreviewRetry] = useState(0);
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(DEFAULT_MEDIA_SETTINGS), [settingsReady, setSettingsReady] = useState(false), [settingsRetry, setSettingsRetry] = useState(0);
  const lifetime = useRef({ active: false, generation: 0, request: null as AbortController | null });
  const latest = useRef(props); latest.current = props;
  const acknowledgedPaths = useRef(new Set<string>());
  const visits = props.visits.filter(v => v.patientId === props.patientId && v.isArchived !== true).map(v => {
    const saved = reloadedVisits[v.id];
    return saved && visitContext(saved) === visitContext(v) && JSON.stringify(v.attachments || []) === saved.originalAttachments ? { ...v, ...saved } : v;
  });
  const photos: Photo[] = [], documents: Photo[] = [];
  for (const visit of visits) {
    const files = new Map<string, StoredAttachment>();
    for (const file of [...(visit.attachments || []), ...(localFiles[visit.id] || [])]) {
      if (!file?.storagePath || removed.includes(file.storagePath)) continue;
      const updated = overrides[file.storagePath];
      const candidate = updated && (updated.photo?.version || 0) >= (file.photo?.version || 0) ? updated : file;
      const existing = files.get(file.storagePath);
      if (!existing || (candidate.photo?.version || 0) >= (existing.photo?.version || 0)) files.set(file.storagePath, candidate);
    }
    for (const file of files.values()) (isGalleryImage(file) ? photos : documents).push({ visit, file });
  }
  photos.sort((a, b) => String(b.file.photo?.takenAt || b.visit.visitDate || '').localeCompare(String(a.file.photo?.takenAt || a.visit.visitDate || '')));
  const all = [...photos, ...documents], currentVisit = visits.find(v => v.id === visitId);
  const eligible = visits.filter(v => canWrite(v, props));
  const photoTotal = photos.filter(p => p.visit.id === visitId).length;
  const remaining = Math.max(0, Math.min(GALLERY_PHOTO_LIMIT - photoTotal, settings.maxFilesPerRecord - all.filter(p => p.visit.id === visitId).length));
  const photoExtensions = settings.allowedExtensions.filter(ext => ['.jpg', '.jpeg', '.png', '.webp'].includes(ext));
  const filtered = photos.filter(p => (filter === 'all' || (p.file.photo?.stage || 'unclassified') === filter)
    && (!dateFilter || (p.file.photo?.takenAt || p.visit.visitDate || '').startsWith(dateFilter))
    && (!search || [p.file.name, p.file.photo?.area, p.visit.serviceNameSnapshot, p.visit.treatmentService, p.visit.visitType].join(' ').toLowerCase().includes(search.toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 12)), currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage]);
  const safeCompare = compare.filter(path => photos.some(p => p.file.storagePath === path));
  const zoomPhoto = photos.find(p => p.file.storagePath === zoom);
  const previewPaths = [...new Set([...shown.map(p => p.file.storagePath), ...safeCompare, ...(zoomPhoto ? [zoomPhoto.file.storagePath] : [])])];
  const previewKey = JSON.stringify([previewPaths, previewRetry]);
  const actorCurrent = () => lifetime.current.active && scopeKey(latest.current) === props.scope && canView(galleryActor(latest.current));
  const currentRecord = (photo: Photo) => latest.current.visits.some(v => visitContext(v) === visitContext(photo.visit) && v.isArchived !== true);
  useLayoutEffect(() => { lifetime.current.active = true; lifetime.current.generation++; return () => { lifetime.current.active = false; lifetime.current.generation++; lifetime.current.request?.abort(); }; }, []);
  useEffect(() => {
    let active = true;
    setSettingsReady(false);
    const stop = onSnapshot(doc(db, 'settings', 'media'), snapshot => {
      if (active && actorCurrent()) { setSettings(normalizeMediaSettings(snapshot.exists?.() ? snapshot.data() : {})); setSettingsReady(true); }
    }, () => { if (active && actorCurrent()) setSettingsReady(false); });
    return () => { active = false; stop(); };
  }, [settingsRetry]);
  const serverFilesKey = JSON.stringify(props.visits.flatMap(v => (v.attachments || []).map((file: StoredAttachment) => file.storagePath)));
  useLayoutEffect(() => {
    // A saved photo may be observed and deleted while its upload reply is still
    // pending. Keep that acknowledgement for this protected workspace lifetime.
    for (const visit of props.visits) for (const file of visit.attachments || []) acknowledgedPaths.current.add(file.storagePath);
    setLocalFiles(old => {
      let changed = false; const next: Record<string, StoredAttachment[]> = {};
      for (const [id, files] of Object.entries(old)) { next[id] = files.filter(file => !acknowledgedPaths.current.has(file.storagePath)); if (next[id].length !== files.length) changed = true; }
      return changed ? next : old;
    });
  }, [serverFilesKey, localFiles]);
  useEffect(() => {
    const controller = new AbortController(), created: string[] = []; let active = true;
    const current = () => active && actorCurrent() && !controller.signal.aborted;
    setUrls({}); setPreviewErrors([]);
    void Promise.all(previewPaths.map(async path => {
      try { const blob = await fetchAttachmentBlob(path, { signal: controller.signal, isCurrent: current }); if (!current()) return null; const url = URL.createObjectURL(blob); created.push(url); return [path, url] as const; }
      catch (failure: any) { if (current() && failure.name !== 'AbortError') setPreviewErrors(old => [...old, path]); return null; }
    })).then(values => { if (current()) setUrls(Object.fromEntries(values.filter(Boolean) as (readonly [string, string])[])); });
    return () => { active = false; controller.abort(); created.forEach(url => URL.revokeObjectURL(url)); };
  }, [previewKey]);
  useEffect(() => {
    const created: string[] = [], next: Record<string, string> = {};
    for (const [index, file] of selected.entries()) { const url = URL.createObjectURL(file); created.push(url); next[index] = url; }
    setDraftUrls(next);
    return () => created.forEach(url => URL.revokeObjectURL(url));
  }, [selected]);
  useEffect(() => { if (currentVisit && !canWrite(currentVisit, props) || visitId && !currentVisit) { setSelected([]); setUploadOpen(false); setVisitId(''); } }, [JSON.stringify(eligible.map(v => visitContext(v))), visitId]);
  const run = async (work: (options: { signal: AbortSignal; isCurrent: () => boolean }) => Promise<void>, photo?: Photo) => {
    if (busy || !actorCurrent()) return;
    lifetime.current.request?.abort(); const controller = new AbortController(), generation = lifetime.current.generation; lifetime.current.request = controller;
    const current = () => actorCurrent() && lifetime.current.generation === generation && lifetime.current.request === controller && !controller.signal.aborted
      && (!photo || currentRecord(photo) && canWrite(photo.visit, latest.current));
    setBusy(true); setError(''); setNotice('');
    try { await work({ signal: controller.signal, isCurrent: current }); }
    catch (failure: any) { if (current() && failure.name !== 'AbortError') setError(failure.message || 'Gallery action failed. Please retry.'); }
    finally { if (current()) setBusy(false); }
  };
  const chooseVisit = (id: string) => { setVisitId(id); setSelected([]); setError(''); const v = visits.find(v => v.id === id); setDraft({ stage: 'before', takenAt: String(v?.visitDate || '').slice(0, 16), area: '', note: '' }); };
  const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (busy || uploadUncertain || !settingsReady || !currentVisit || !canWrite(currentVisit, props)) return;
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (files.some(f => !photoExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) || f.size > IMAGE_OPTIMIZATION.maxSourceBytes)) { setError('Choose an allowed photo format up to 20 MB per image.'); return; }
    if (selected.length + files.length > remaining) { setError('This Visit can hold up to 4 photos. Select ' + Math.max(0, remaining - selected.length) + ' more at most.'); return; }
    setSelected(old => [...old, ...files]); setError('');
  };
  const upload = (event: React.FormEvent) => {
    event.preventDefault(); if (uploadUncertain || !settingsReady || !currentVisit || !canWrite(currentVisit, props) || !selected.length || selected.length > remaining) return;
    if (selected.some(file => !photoExtensions.some(ext => file.name.toLowerCase().endsWith(ext)))) { setError('The allowed photo formats changed. Remove these files and select an allowed format.'); return; }
    let input: Details; try { input = parsePhotoInput(draft); } catch (failure: any) { setError(failure.message); return; }
    const visit = currentVisit, pending = [...selected];
    void run(async options => {
      for (const file of pending) {
        let result;
        try { result = await uploadAttachment({ file, originalName: file.name, maxFileSizeMB: settings.maxFileSizeMB, note: input.note, patientId: props.patientId, resourceType: 'visit', resourceId: visit.id,
          photoStage: input.stage, photoTakenAt: input.takenAt, photoArea: input.area }, options); }
        catch (failure: any) { if (options.isCurrent() && (!failure.status || failure.status >= 500)) setUploadUncertain(true); throw failure; }
        if (!options.isCurrent()) return;
        if (!acknowledgedPaths.current.has(result.attachment.storagePath)) {
          setLocalFiles(old => ({ ...old, [visit.id]: [...(old[visit.id] || []), result.attachment] }));
        }
        setSelected(old => old.filter(value => value !== file));
      }
      if (options.isCurrent()) { setNotice('Photos uploaded.'); setUploadOpen(false); }
    }, { visit, file: pending[0] as any });
  };
  const reloadUpload = () => {
    if (!currentVisit) return; const visit = currentVisit;
    void run(async options => {
      const fresh = await getGalleryVisit(visit.id, options); if (!options.isCurrent()) return;
      if (!fresh || fresh.patientId !== props.patientId || fresh.isArchived || visitContext(fresh) !== visitContext(visit)) throw new Error('This Visit is no longer available. Close and reopen the patient.');
      setReloadedVisits(old => ({ ...old, [fresh.id]: { ...fresh, originalAttachments: JSON.stringify(latest.current.visits.find(v => v.id === fresh.id)?.attachments || []) } }));
      setLocalFiles(old => ({ ...old, [fresh.id]: [] })); setSelected([]); setUploadUncertain(false); setNotice('Saved Visit photos loaded. Review them, then select only missing photos.');
    }, { visit, file: {} as StoredAttachment });
  };
  const edit = (photo: Photo) => { setError(''); setEditor({ photo, expectedVersion: photo.file.photo?.version || 0,
    value: { stage: photo.file.photo?.stage || 'before', takenAt: photo.file.photo?.takenAt || String(photo.visit.visitDate || '').slice(0, 16), area: photo.file.photo?.area || '', note: photo.file.note || '' } }); };
  const saveDetails = (event: React.FormEvent) => {
    event.preventDefault(); if (!editor || !canWrite(editor.photo.visit, props)) return;
    let input: Details; try { input = parsePhotoInput(editor.value); } catch (failure: any) { setError(failure.message); return; }
    const opened = editor;
    void run(async options => {
      const result = await updateAttachmentPhoto({ storagePath: opened.photo.file.storagePath, expectedVersion: opened.expectedVersion, ...input }, options);
      if (options.isCurrent()) { setOverrides(old => ({ ...old, [result.attachment.storagePath]: result.attachment })); setEditor(null); setNotice('Photo details saved.'); }
    }, opened.photo);
  };
  const reloadPhoto = () => {
    if (!editor) return; const opened = editor;
    void run(async options => {
      const fresh = await getGalleryVisit(opened.photo.visit.id, options); if (!options.isCurrent()) return;
      if (!fresh || fresh.patientId !== props.patientId || fresh.isArchived || visitContext(fresh) !== visitContext(opened.photo.visit)) throw new Error('This Visit is no longer available. Close and reopen the patient.');
      setReloadedVisits(old => ({ ...old, [fresh.id]: { ...fresh, originalAttachments: JSON.stringify(latest.current.visits.find(v => v.id === fresh.id)?.attachments || []) } }));
      setLocalFiles(old => ({ ...old, [fresh.id]: [] }));
      setEditor(null); setNotice('Current photo details loaded. Open Edit photo to review them before saving.');
    }, opened.photo);
  };
  const remove = () => {
    if (!removePhoto) return; const chosen = removePhoto;
    void run(async options => { await deleteAttachment(chosen.file.storagePath, options); if (options.isCurrent()) { setRemoved(old => [...old, chosen.file.storagePath]); setCompare(old => old.filter(p => p !== chosen.file.storagePath)); setRemovePhoto(null); setNotice('Photo removed.'); } }, chosen);
  };
  const download = (photo: Photo, open = false) => { void run(async options => { if (open) await openAttachment(photo.file, options); else await downloadAttachment(photo.file, options); }); };
  const name = (uid?: string) => props.users.find(u => u.id === uid)?.fullName || 'Recorded staff';
  const photoView = (photo: Photo, large = false) => <figure className="min-w-0"><div className={'flex items-center justify-center overflow-auto rounded-xl bg-slate-100 ' + (large ? 'min-h-56' : 'aspect-[4/3]')}>
    {urls[photo.file.storagePath] && !previewErrors.includes(photo.file.storagePath) ? <img src={urls[photo.file.storagePath]} alt={stageLabel(photo.file) + ' · ' + (photo.file.photo?.area || photo.file.name)} onError={() => setPreviewErrors(old => [...old, photo.file.storagePath])} className={large ? 'max-h-[60vh] max-w-full object-contain' : 'h-full w-full object-contain'} style={large ? { transform: 'scale(' + scale + ')', transformOrigin: 'top left' } : undefined} /> : previewErrors.includes(photo.file.storagePath) ? <span className="text-sm text-rose-800">Photo preview unavailable</span> : <span role="status" className="text-sm text-slate-600">Loading photo…</span>}
    </div><figcaption className="mt-2 space-y-1 text-sm text-slate-700"><p className="font-semibold">{stageLabel(photo.file)}{photo.file.photo?.area ? ' · ' + photo.file.photo.area : ''}</p><p>{takenLabel(photo.file)}</p><p>{visitLabel(photo.visit)}</p>{photo.file.note && <p className="whitespace-pre-wrap break-words">{photo.file.note}</p>}</figcaption></figure>;
  return <section className="space-y-5" aria-labelledby="patient-gallery-heading">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="patient-gallery-heading" className="text-lg font-bold text-slate-900">Patient Gallery</h3><p className="mt-1 max-w-xl text-sm text-slate-600">Before, After and Progress photos linked to Visits. Keep up to four clear, relevant photos per Visit.</p></div>{eligible.length > 0 && <button type="button" className={primary} disabled={busy} onClick={() => { setUploadOpen(!uploadOpen); setEditor(null); setError(''); if (!visitId) chooseVisit(eligible[0].id); }}><Upload size={17} />Upload photos</button>}</header>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    {uploadOpen && <form onSubmit={upload} className="space-y-4 rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-slate-900">Upload Visit photos</h4><button type="button" className={button} disabled={busy} onClick={() => { setUploadOpen(false); setSelected([]); }} aria-label="Cancel photo upload"><X size={16} /></button></div>
      <label className="block space-y-1 text-sm text-slate-700" htmlFor="gallery-visit">Related Visit<select id="gallery-visit" className={field} disabled={busy || uploadUncertain} value={visitId} onChange={e => chooseVisit(e.target.value)}><option value="">Select a saved Visit</option>{eligible.map(v => <option value={v.id} key={v.id}>{visitLabel(v)} · {v.branchNameSnapshot || props.branches.find(b => b.id === v.branchId)?.branchName || 'Clinic'}</option>)}</select></label>
      <p className="text-sm font-semibold text-slate-800">Photos: {photoTotal} / 4 — {remaining} remaining</p>{photoTotal > 4 && <p className="text-sm text-slate-600">Older photos are kept. This Visit has reached the limit for new photos.</p>}
      <DetailFields prefix="gallery" value={draft} onChange={setDraft} disabled={busy || uploadUncertain} />
      <label className="block space-y-1 text-sm text-slate-700" htmlFor="gallery-files">Select photos<input id="gallery-files" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:font-semibold file:text-teal-800" type="file" accept={photoExtensions.join(',')} multiple disabled={busy || uploadUncertain || !settingsReady || !photoExtensions.length || !currentVisit || remaining === 0} onChange={selectFiles} /></label><p className="text-xs text-slate-600">Preview your selection before upload. Images are resized and stored privately; location metadata is removed during optimization.</p>
      {!settingsReady && <p role="status" className="text-sm text-slate-600">Loading upload settings… <button type="button" className="underline" onClick={() => setSettingsRetry(value => value + 1)}>Retry upload settings</button></p>}
      {settingsReady && !photoExtensions.length && <p className="text-sm text-slate-600">Photo uploads are disabled in the current file settings.</p>}
      {remaining === 0 && photoTotal < 4 && <p className="text-sm text-slate-600">This Visit has reached its total file limit.</p>}
      {uploadUncertain && <div role="alert" className="space-y-2 text-sm text-amber-900"><p>The upload result is uncertain. Reload saved Visit photos before selecting or uploading again.</p><button type="button" disabled={busy} className={button} onClick={reloadUpload}>Reload Visit photos</button></div>}
      {!!selected.length && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{selected.map((file, index) => <figure key={index} className="min-w-0"><img src={draftUrls[index]} alt={'Selected photo ' + (index + 1)} className="aspect-[4/3] w-full rounded-lg bg-slate-100 object-contain" /><figcaption className="mt-1 break-words text-xs text-slate-600">{file.name}</figcaption><button type="button" disabled={busy} className={button + ' mt-2 w-full'} onClick={() => setSelected(old => old.filter((_, i) => i !== index))} aria-label={'Remove selected photo ' + (index + 1)}>Remove</button></figure>)}</div>}
      <button type="submit" className={primary} disabled={busy || uploadUncertain || !settingsReady || !photoExtensions.length || !selected.length || selected.length > remaining}>{busy ? 'Uploading…' : 'Upload ' + selected.length + (selected.length === 1 ? ' photo' : ' photos')}</button>
    </form>}
    <div className="flex flex-wrap gap-3"><label className="min-w-40 flex-1 text-sm text-slate-700">Search treatment or area<input className={field} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search photos" /></label><label className="text-sm text-slate-700">Photo label<select className={field} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="all">All photos</option><option value="before">Before</option><option value="after">After</option><option value="progress">Progress</option><option value="unclassified">Unclassified</option></select></label><label className="text-sm text-slate-700">Photo date<input className={field} type="date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} /></label></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{filtered.length} {filtered.length === 1 ? 'photo' : 'photos'} · Choose two photos to compare across Visits.</p><button type="button" className={button} disabled={safeCompare.length !== 2} onClick={() => { setScale(1); setComparisonOpen(true); }}>Compare photos ({safeCompare.length}/2)</button></div>
    {!shown.length ? <div className="py-8 text-center"><Camera className="mx-auto mb-3 text-slate-500" size={28} /><h4 className="font-semibold text-slate-800">{photos.length ? 'No photos match these filters' : 'No Visit photos yet'}</h4><p className="mt-1 text-sm text-slate-600">{photos.length ? 'Change the label, date or search to see more photos.' : 'Save a Visit, then upload a few Before or After photos here.'}</p></div> : <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">{shown.map(photo => <article key={photo.file.storagePath} className="min-w-0 space-y-2">
      <button type="button" className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" onClick={() => { setZoom(photo.file.storagePath); setScale(1); }} aria-label={'Open photo ' + photo.file.name}>{photoView(photo)}</button>
      {previewErrors.includes(photo.file.storagePath) && <button type="button" className={button} onClick={() => setPreviewRetry(v => v + 1)}>Retry preview</button>}<p className="break-words text-xs text-slate-600">{photo.visit.branchNameSnapshot || props.branches.find(b => b.id === photo.visit.branchId)?.branchName || 'Recorded clinic'}{photo.file.uploadedAt ? ' · Uploaded ' + formatDateTime(photo.file.uploadedAt) : ''} · {name(photo.file.uploadedByUid)}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-label={'Compare ' + photo.file.name} aria-pressed={safeCompare.includes(photo.file.storagePath)} disabled={!safeCompare.includes(photo.file.storagePath) && safeCompare.length === 2} onClick={() => setCompare(old => old.includes(photo.file.storagePath) ? old.filter(p => p !== photo.file.storagePath) : [...old, photo.file.storagePath])}>{safeCompare.includes(photo.file.storagePath) ? 'Selected' : 'Compare'}</button><button type="button" className={button} disabled={busy} onClick={() => download(photo)} aria-label={'Download photo ' + photo.file.name}><Download size={16} /></button>{canWrite(photo.visit, props) && <><button type="button" className={button} disabled={busy} onClick={() => edit(photo)} aria-label={'Edit photo ' + photo.file.name}>Edit</button><button type="button" className={button} disabled={busy} onClick={() => { setError(''); setRemovePhoto(photo); }} aria-label={'Remove photo ' + photo.file.name}>Remove</button></>}</div>
    </article>)}</div>}
    {filtered.length > 12 && <div className="flex items-center justify-between"><button className={button} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous photos</button><p className="text-sm text-slate-600">Page {currentPage} of {pageCount}</p><button className={button} disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next photos</button></div>}
    {!!documents.length && <section className="space-y-2 border-t border-slate-200 pt-5"><h4 className="font-semibold text-slate-900">Other Visit files</h4>{documents.map(photo => <div key={photo.file.storagePath} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-800">{photo.file.name}</p><p className="text-xs text-slate-600">{visitLabel(photo.visit)}</p>{photo.file.note && <p className="text-sm text-slate-600">{photo.file.note}</p>}</div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => download(photo, true)} aria-label={'Open file ' + photo.file.name}>Open</button><button className={button} disabled={busy} onClick={() => download(photo)} aria-label={'Download file ' + photo.file.name}>Download</button></div></div>)}</section>}
    {editor && photos.some(p => p.file.storagePath === editor.photo.file.storagePath) && <GalleryDialog title="Edit photo details" disabled={busy} onClose={() => { setEditor(null); setError(''); }}><form onSubmit={saveDetails} className="space-y-4"><p className="text-sm text-slate-700">{editor.photo.file.name} · {visitLabel(editor.photo.visit)}</p><DetailFields prefix="gallery-edit" value={editor.value} onChange={value => setEditor(old => old && ({ ...old, value }))} disabled={busy} />{error && <div role="alert" className="space-y-2 text-sm text-rose-800"><p>{error}</p><button type="button" disabled={busy} className={button} onClick={reloadPhoto}>Reload photo</button></div>}<button type="submit" className={primary} disabled={busy}>Save photo details</button></form></GalleryDialog>}
    {removePhoto && photos.some(p => p.file.storagePath === removePhoto.file.storagePath) && <GalleryDialog title="Remove photo" disabled={busy} onClose={() => { setRemovePhoto(null); setError(''); }}><p className="mb-4 text-sm text-slate-700">Remove {removePhoto.file.name} from this Visit? This action is recorded in the audit history.</p>{error && <p role="alert" className="mb-3 text-sm text-rose-800">{error}</p>}<button type="button" className={primary} disabled={busy} onClick={remove}>Confirm remove photo</button></GalleryDialog>}
    {comparisonOpen && safeCompare.length === 2 && <GalleryDialog title="Photo comparison" onClose={() => setComparisonOpen(false)}><div className="grid gap-5 md:grid-cols-2">{safeCompare.map(path => <div key={path}>{photoView(photos.find(p => p.file.storagePath === path)!, true)}</div>)}</div></GalleryDialog>}
    {zoomPhoto && <GalleryDialog title="Photo preview" onClose={() => setZoom(null)}><div className="mb-3 flex gap-2"><button type="button" className={button} disabled={scale <= 1} onClick={() => setScale(s => Math.max(1, s - 0.5))} aria-label="Zoom out"><ZoomOut size={18} /></button><button type="button" className={button} disabled={scale >= 3} onClick={() => setScale(s => Math.min(3, s + 0.5))} aria-label="Zoom in"><ZoomIn size={18} /></button><span className="self-center text-sm text-slate-600">{Math.round(scale * 100)}%</span></div>{photoView(zoomPhoto, true)}</GalleryDialog>}
  </section>;
}
export default function PatientGallery(props: Props) {
  const scope = scopeKey(props), [invalidated, setInvalidated] = useState<string | null>(null);
  useLayoutEffect(() => subscribeProtectedDataInvalidation(() => setInvalidated(scope)), [scope]);
  if (!canView(galleryActor(props)) || invalidated === scope) return <p role="alert" className="text-sm text-slate-600">Gallery access changed. Close and reopen this patient after your access is refreshed.</p>;
  return <GalleryWorkspace key={scope} {...props} scope={scope} />;
}
