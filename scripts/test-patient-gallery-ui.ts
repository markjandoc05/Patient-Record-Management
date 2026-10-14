import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

// Real Gallery React handlers and protected adapters with deliberately delayed
// replies. The image encoder is controlled because these are Node form tests,
// not a real-browser codec, login, screen-size or storage acceptance claim.
const harness = await buildControlledForms(['PatientMediaTab'], process.cwd(), { mockImageCompression: true });
const baseActor = { id: 'nurse', role: 'staff', staffDesignation: 'Nurse', active: true,
  fullName: 'Synthetic Nurse', assignedBranches: ['A'], accessRevision: 0 };
const image = (id: string, extras: any = {}) => ({ id, name: `${id}.jpg`, storagePath: `synthetic/${id}.jpg`,
  contentType: 'image/jpeg', note: `Saved note ${id}`, uploadedAt: '2035-01-01T03:00:00Z', uploadedByUid: 'nurse', ...extras });
const classified = (id: string, stage = 'before', version = 2) => image(id, { photo: { schemaVersion: 1, stage,
  takenAt: '2035-01-01T11:00', area: 'Face / front', timezone: 'Asia/Manila', version, updatedByUid: 'nurse', updatedAt: '2035-01-01T04:00:00Z' } });
const visit = (id = 'visit-A', branchId = 'A', attachments: any[] = []) => ({ id, patientId: 'patient', branchId,
  visitDate: '2035-01-01T10:00', visitType: 'Treatment Session', doctorId: '', performedByUserId: 'nurse',
  performedByNameSnapshot: 'Synthetic Nurse', serviceNameSnapshot: 'Synthetic Facial', treatmentService: 'Synthetic Facial', attachments });
const document = { id: 'retained-document', name: 'retained.pdf', storagePath: 'synthetic/retained.pdf', contentType: 'application/pdf', note: 'Retained clinical document' };
type Pending = { url: string; init: any; deliver: (body: any, status?: number) => void; fail: () => void };
const all = (node: any, predicate: (value: any) => boolean): any[] => Array.isArray(node) ? node.flatMap(child => all(child, predicate))
  : node && typeof node === 'object' ? [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)] : [];
class Fixture {
  renderer = new Renderer(harness.components.PatientMediaTab); requests: Pending[] = []; actor: any = { ...baseActor };
  props: any; created: string[] = []; revoked: string[] = []; delayedPreviews = false; previewReplies: Pending[] = []; downloads: string[] = [];
  originals = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  constructor() {
    globals.servicesTestAuth.currentUser = { uid: 'nurse', getRequestToken: async () => 'synthetic' };
    globals.servicesTestInvalidations = 0; globals.galleryTestImageCompression = async (file: File) => file;
    globals.servicesTestMediaSettings = undefined;
    globals.document.documentElement = { classList: { add() {}, remove() {} } };
    globals.document.createElement = () => { const anchor = { download: '', click: () => this.downloads.push(anchor.download), remove() {} }; return anchor; }; globals.document.body.appendChild = () => {};
    globals.window.open = () => ({ location: { href: '' }, close() {} }); globals.window.setTimeout = () => 0;
    URL.createObjectURL = () => { const url = `blob:gallery-${this.created.length + 1}`; this.created.push(url); return url; };
    URL.revokeObjectURL = url => { this.revoked.push(url); };
    this.props = { patientId: 'patient', users: [this.actor], userRole: 'staff', patientArchived: false,
      branches: [{ id: 'A', branchName: 'Synthetic A', status: 'Active' }, { id: 'B', branchName: 'Synthetic B', status: 'Active' }],
      visits: [visit()] };
    globals.fetch = (url: string, init: any = {}) => {
      if (url.startsWith('/api/attachments/content?') && !this.delayedPreviews) return Promise.resolve(new Response(new Blob(['synthetic-photo'], { type: 'image/jpeg' })));
      return new Promise<Response>((resolve, reject) => {
        const pending = { url, init, deliver: (body: any, status = 200) => resolve(new Response(body instanceof Blob ? body : JSON.stringify(body), { status })),
          fail: () => reject(new TypeError('Synthetic network interrupted')) };
        (url.startsWith('/api/attachments/content?') ? this.previewReplies : this.requests).push(pending);
      });
    };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let n = 0; n < 12; n++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); await new Promise<void>(resolve => setImmediate(resolve)); if (this.renderer.dirty) this.render(); } }
  async start() { this.render(); await this.settle(); }
  async media(settings: any) {
    globals.servicesTestMediaSettings = settings;
    for (const listener of [...globals.galleryTestMediaListeners]) listener({ exists: () => settings !== undefined && settings !== null, data: () => settings });
    await this.settle();
  }
  node(id: string) { const found = find(this.renderer.tree, node => node.props?.id === id); assert.ok(found, 'Missing node: ' + id); return found; }
  disabled(id: string) {
    const scan = (node: any, inherited = false): boolean | undefined => {
      if (Array.isArray(node)) { for (const child of node) { const found = scan(child, inherited); if (found !== undefined) return found; } }
      else if (node && typeof node === 'object') { const disabled = inherited || node.type === 'fieldset' && Boolean(node.props.disabled);
        if (node.props?.id === id) return disabled || Boolean(node.props.disabled); return scan(node.props?.children, disabled); }
    };
    const value = scan(this.renderer.tree); assert.notEqual(value, undefined, id); return value;
  }
  buttons() { return all(this.renderer.tree, node => node.type === 'button'); }
  button(label: string) { const found = this.buttons().find(node => node.props['aria-label'] === label || text(node).replace(/\s/g, '') === label.replace(/\s/g, '')); assert.ok(found, 'Missing button: ' + label); return found; }
  async click(label: string) { const button = this.button(label); if (!button.props.disabled) { button.props.onClick(); await this.settle(); } }
  async change(id: string, value: any) { const node = this.node(id); if (!this.disabled(id)) node.props.onChange({ target: { value, checked: value } }); await this.settle(); }
  async filter(label: string, value: string) {
    const parent = find(this.renderer.tree, node => node.type === 'label' && text(node).trim().startsWith(label)); assert.ok(parent, 'Missing label ' + label);
    const control = find(parent.props.children, node => ['input', 'select'].includes(node.type)); assert.ok(control);
    control.props.onChange({ target: { value } }); await this.settle();
  }
  async chooseFiles(names: string[]) {
    const files = names.map(name => new File(['synthetic'], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }));
    const input = this.node('gallery-files'); if (!this.disabled('gallery-files')) input.props.onChange({ target: { files, value: 'chosen' } }); await this.settle();
  }
  async uploadDraft(names = ['selected.jpg']) {
    await this.click('Upload photos'); await this.change('gallery-visit', 'visit-A'); await this.chooseFiles(names);
    await this.change('gallery-stage', 'before'); await this.change('gallery-taken-at', '2035-01-01T10:00');
    await this.change('gallery-area', 'Face / front'); await this.change('gallery-note', 'Synthetic uploaded note');
  }
  async submit() { const form = find(this.renderer.tree, node => node.type === 'form'); assert.ok(form, 'Missing form'); form.props.onSubmit({ preventDefault() {} }); await this.settle(); }
  request(method: string) { const request = [...this.requests].reverse().find(row => row.init.method === method); assert.ok(request, 'Missing ' + method + ' request'); return request; }
  metadata(id = 'saved') { return this.props.visits[0].attachments.find((file: any) => file.id === id); }
  scope(change: string) {
    if (change === 'patient') { this.props.patientId = 'new-patient'; this.props.visits = []; }
    if (change === 'account') globals.servicesTestAuth.currentUser = { uid: 'other-nurse', getRequestToken: async () => 'synthetic' };
    if (change === 'permission') { this.actor = { ...this.actor, accessRevision: this.actor.accessRevision + 1 }; this.props.users = [this.actor]; }
    if (change === 'branch') { this.actor = { ...this.actor, assignedBranches: ['B'] }; this.props.users = [this.actor]; }
    if (change === 'visit-archive') this.props.visits = this.props.visits.map((record: any) => ({ ...record, isArchived: true }));
    if (change === 'visit-branch') this.props.visits = this.props.visits.map((record: any) => ({ ...record, branchId: 'B' }));
    if (change === 'patient-archive') this.props.patientArchived = true;
    if (change === 'invalidate') for (const listener of [...globals.appointmentInvalidationListeners]) listener();
    if (change === 'unmount') this.stop(); else this.render();
  }
  stop() { this.renderer.unmount(); }
  cleanup() { this.stop(); URL.createObjectURL = this.originals.createObjectURL; URL.revokeObjectURL = this.originals.revokeObjectURL; }
}
const results: { name: string; passed: boolean; error?: string }[] = [];
async function check(name: string, run: (fixture: Fixture) => Promise<void>) {
  const fixture = new Fixture();
  try { await run(fixture); results.push({ name, passed: true }); }
  catch (error: any) { results.push({ name, passed: false, error: error.message }); }
  finally { fixture.cleanup(); }
}
try {
  await check('empty Gallery explains saved Visit photos and does not hide documents', async f => {
    await f.start(); assert.match(text(f.renderer.tree), /Gallery/); assert.match(text(f.renderer.tree), /No.*photo/i);
    assert.ok(f.button('Upload photos'));
  });
  await check('historical Unclassified photos above four stay visible and are not rewritten', async f => {
    const legacy = Array.from({ length: 5 }, (_, n) => image(`legacy-${n + 1}`));
    f.props.visits = [visit('visit-A', 'A', [...legacy, document]), visit('other-patient', 'B', [image('OTHER_PATIENT')])];
    f.props.visits[1].patientId = 'other-patient'; await f.start();
    assert.match(text(f.renderer.tree), /Unclassified/); assert.doesNotMatch(text(f.renderer.tree), /OTHER_PATIENT/);
    for (const file of legacy) assert.ok(f.button('Open photo ' + file.name));
    assert.deepEqual(f.props.visits[0].attachments, [...legacy, document]); assert.equal(f.requests.length, 0);
  });
  await check('branch-eligible Nurse can upload without a Doctor and cannot choose unauthorized Visit', async f => {
    f.props.visits = [visit(), visit('visit-B', 'B'), { ...visit('archived', 'A'), isArchived: true }]; await f.start();
    await f.click('Upload photos'); const values = all(f.node('gallery-visit'), n => n.type === 'option').map(n => n.props.value);
    assert.ok(values.includes('visit-A')); assert.ok(!values.includes('visit-B')); assert.ok(!values.includes('archived'));
  });
  for (const permission of ['clinical.view', 'visits.attachments.manage']) await check(`explicit ${permission} denial removes Gallery writes`, async f => {
    f.actor = { ...f.actor, permissionOverrides: { [permission]: 'deny' } }; f.props.users = [f.actor]; await f.start();
    assert.ok(!f.buttons().some(node => text(node).trim() === 'Upload photos'));
  });
  await check('archived patient cannot upload or alter saved photos', async f => {
    f.props.patientArchived = true; f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start();
    assert.ok(!f.buttons().some(node => /^(Upload photos|Edit photo|Remove photo)/.test(node.props['aria-label'] || text(node).trim())));
    assert.ok(f.button('Open photo saved.jpg'));
  });
  await check('photo selection previews and cap reject the fifth selected photo', async f => {
    await f.start(); await f.uploadDraft(['one.jpg', 'two.jpg', 'three.jpg', 'four.jpg']);
    assert.equal(f.created.length, 4); await f.chooseFiles(['fifth.jpg']); assert.match(text(f.renderer.tree), /4|four/i);
    await f.click('Remove selected photo 1'); assert.ok(f.revoked.includes(f.created[0]));
    await f.chooseFiles(['replacement.jpg']); assert.ok(f.button('Upload 4 photos')); assert.equal(f.requests.length, 0);
  });
  await check('existing images count toward cap while documents do not', async f => {
    f.props.visits = [visit('visit-A', 'A', [image('old-1'), image('old-2'), image('old-3'), document])]; await f.start();
    await f.uploadDraft(['last-slot.jpg']); await f.chooseFiles(['excess.jpg']); assert.ok(f.button('Upload 1 photo'));
    assert.equal(f.requests.length, 0); assert.match(text(f.renderer.tree), /remaining|4/i);
  });
  await check('existing overall file limit takes precedence when three photos and two documents fill the Visit', async f => {
    f.props.visits = [visit('visit-A', 'A', [image('old-1'), image('old-2'), image('old-3'), document, { ...document, id: 'second-document', storagePath: 'synthetic/second.pdf', name: 'second.pdf' }])];
    await f.start(); await f.click('Upload photos'); assert.equal(f.disabled('gallery-files'), true);
    assert.match(text(f.renderer.tree), /0\s+remaining/); await f.chooseFiles(['fifth-file-limit.jpg']);
    assert.equal(f.button('Upload 0 photos').props.disabled, true); assert.equal(f.requests.length, 0);
  });
  await check('configured overall two-file limit leaves one photo slot with one retained document', async f => {
    globals.servicesTestMediaSettings = { maxFilesPerRecord: 2, maxFileSizeMB: 1, allowedExtensions: ['.jpg', '.png', '.pdf'] };
    f.props.visits = [visit('visit-A', 'A', [document])]; await f.start(); await f.uploadDraft(['allowed.jpg']);
    await f.chooseFiles(['excess.jpg']); assert.ok(f.button('Upload 1 photo')); assert.match(text(f.renderer.tree), /1\s+remaining/);
  });
  await check('configured JPG-only policy excludes PNG from selector and rejects it before upload', async f => {
    globals.servicesTestMediaSettings = { maxFilesPerRecord: 5, maxFileSizeMB: 1, allowedExtensions: ['.jpg', '.pdf'] };
    await f.start(); await f.click('Upload photos'); assert.equal(f.node('gallery-files').props.accept, '.jpg');
    await f.chooseFiles(['not-allowed.png']); assert.equal(f.button('Upload 0 photos').props.disabled, true);
    assert.equal(f.requests.length, 0);
  });
  await check('configured document-only policy disables new Gallery photos while retaining old images', async f => {
    globals.servicesTestMediaSettings = { maxFilesPerRecord: 5, maxFileSizeMB: 1, allowedExtensions: ['.pdf'] };
    f.props.visits = [visit('visit-A', 'A', [image('retained')])]; await f.start(); assert.ok(f.button('Open photo retained.jpg'));
    await f.click('Upload photos'); assert.equal(f.disabled('gallery-files'), true);
    await f.chooseFiles(['not-allowed.jpg']); assert.equal(f.button('Upload 0 photos').props.disabled, true); assert.equal(f.requests.length, 0);
  });
  await check('configured stored image size reaches the optimizer and blocks oversized encoded data before dispatch', async f => {
    globals.servicesTestMediaSettings = { maxFilesPerRecord: 5, maxFileSizeMB: 0.1, allowedExtensions: ['.jpg'] };
    globals.galleryTestImageCompression = async () => new File([new Uint8Array(200_000)], 'encoded.jpg', { type: 'image/jpeg' });
    await f.start(); await f.uploadDraft(['small-source.jpg']); await f.submit();
    assert.match(text(f.renderer.tree), /storage limit/); assert.equal(f.requests.filter(request => request.url === '/api/attachments/upload').length, 0);
  });
  for (const change of ['patient', 'account', 'permission', 'branch', 'invalidate', 'unmount']) await check(`old media-settings callback after ${change} cannot alter a new Gallery or set unmounted state`, async f => {
    await f.start(); const old = [...globals.galleryTestMediaListeners][0]; assert.equal(typeof old, 'function');
    f.scope(change); await f.settle(); const before = text(f.renderer.tree);
    old({ exists: () => true, data: () => ({ maxFilesPerRecord: 1, maxFileSizeMB: 0.1, allowedExtensions: ['.pdf'] }) }); await f.settle();
    assert.equal(f.renderer.lateSetters, 0); assert.equal(globals.servicesTestInvalidations, 0);
    if (change !== 'unmount') assert.equal(text(f.renderer.tree), before);
  });
  await check('Gallery file selector rejects a document without removing old documents', async f => {
    f.props.visits = [visit('visit-A', 'A', [document])]; await f.start(); await f.click('Upload photos');
    await f.change('gallery-visit', 'visit-A'); await f.chooseFiles(['bad.pdf']); assert.match(text(f.renderer.tree), /photo|image/i);
    assert.ok(!f.buttons().some(node => /^Upload 1 photo$/.test(text(node).trim()))); assert.equal(f.requests.length, 0);
  });
  await check('stage/date/search filters preserve documents and reset pagination', async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('before'), classified('after', 'after'), classified('progress', 'progress'), image('legacy'), document])];
    await f.start(); await f.filter('Photo label', 'after'); assert.ok(f.button('Open photo after.jpg'));
    assert.ok(!f.buttons().some(node => node.props['aria-label'] === 'Open photo before.jpg')); assert.ok(f.button('Open file retained.pdf'));
    await f.filter('Photo date', '2035-01-02'); assert.match(text(f.renderer.tree), /No photos match/);
    await f.filter('Photo date', ''); await f.filter('Photo label', 'unclassified'); assert.ok(f.button('Open photo legacy.jpg'));
    await f.filter('Search treatment or area', 'NOT_FOUND'); assert.match(text(f.renderer.tree), /No photos match/);
    assert.ok(f.button('Open file retained.pdf'));
  });
  await check('existing document download retains its original name and protected handling', async f => {
    f.props.visits = [visit('visit-A', 'A', [document])]; await f.start(); await f.click('Download file retained.pdf');
    assert.deepEqual(f.downloads, ['retained.pdf'], text(f.renderer.tree)); assert.equal(f.created.length, 1); assert.ok(f.revoked.includes(f.created[0]));
  });
  await check('photo preview supports zoom and closes without altering saved content', async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start(); await f.click('Open photo saved.jpg');
    assert.ok(find(f.renderer.tree, node => node.props?.role === 'dialog' && node.props?.['aria-label'] === 'Photo preview'));
    await f.click('Zoom in'); assert.match(text(f.renderer.tree), /150/); await f.click('Zoom out'); assert.match(text(f.renderer.tree), /100/);
    await f.click('Close Photo preview'); assert.ok(!find(f.renderer.tree, node => node.props?.['aria-label'] === 'Photo preview'));
    assert.equal(f.requests.length, 0);
  });
  await check('upload sends Visit binding and user details; partial batch Retry excludes confirmed photo', async f => {
    await f.start(); await f.uploadDraft(['one.jpg', 'two.jpg']); await f.submit();
    const first = f.request('POST'); assert.equal(first.init.body.get('resourceId'), 'visit-A');
    assert.equal(first.init.body.get('photoStage'), 'before'); assert.equal(first.init.body.get('photoArea'), 'Face / front');
    first.deliver({ attachment: classified('uploaded-one') }); await f.settle();
    const second = f.request('POST'); assert.notEqual(second, first); assert.equal(second.init.body.get('file').name, 'two.jpg');
    second.deliver({ error: 'Second upload rejected before storage' }, 400); await f.settle();
    assert.ok(f.button('Upload 1 photo')); await f.submit(); const retry = f.request('POST');
    assert.equal(retry.init.body.get('file').name, 'two.jpg');
    assert.equal(f.requests.filter(request => request.init.method === 'POST' && request.init.body.get('file').name === 'one.jpg').length, 1);
  });
  for (const failure of ['network', '503']) await check(`uncertain ${failure} upload cannot resend until explicit saved-Visit refresh`, async f => {
    await f.start(); await f.uploadDraft(['uncertain.jpg']); await f.submit(); const original = f.request('POST');
    if (failure === 'network') original.fail(); else original.deliver({ error: 'Storage acknowledgement interrupted' }, 503);
    await f.settle(); assert.match(text(f.renderer.tree), /upload result is uncertain/);
    assert.equal(f.button('Upload 1 photo').props.disabled, true);
    for (const id of ['gallery-files', 'gallery-visit', 'gallery-stage', 'gallery-taken-at', 'gallery-area', 'gallery-note']) assert.equal(f.disabled(id), true);
    const before = f.requests.length; await f.chooseFiles(['duplicate.jpg']); await f.submit(); assert.equal(f.requests.length, before);
    await f.click('Reload Visit photos'); const lookup = f.request('POST'); assert.equal(lookup.url, '/api/data/query');
    lookup.deliver({ document: { id: 'visit-A', data: visit('visit-A', 'A', [classified('committed-photo')]) } }); await f.settle();
    assert.ok(f.button('Open photo committed-photo.jpg')); assert.equal(f.button('Upload 0 photos').props.disabled, true);
    assert.equal(f.disabled('gallery-files'), false); assert.doesNotMatch(text(f.renderer.tree), /upload result is uncertain/);
    assert.ok(!find(f.renderer.tree, node => node.props?.alt === 'Selected photo 1'));
    await f.chooseFiles(['missing-only.jpg']); await f.submit(); const next = f.request('POST');
    assert.equal(next.init.body.get('file').name, 'missing-only.jpg');
    assert.equal(f.requests.filter(request => request.url === '/api/attachments/upload').length, 2);
  });
  await check('metadata 409 keeps draft and opened version despite parent snapshot refresh', async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start(); await f.click('Edit photo saved.jpg');
    await f.change('gallery-edit-note', 'Unsaved old photo note');
    f.props.visits = [visit('visit-A', 'A', [classified('saved', 'after', 3)])]; f.render(); await f.settle(); await f.submit();
    const stale = f.request('PATCH'); assert.equal(JSON.parse(stale.init.body).expectedVersion, 2);
    stale.deliver({ error: 'Photo details changed.', code: 'PHOTO_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.node('gallery-edit-note').props.value, 'Unsaved old photo note');
    await f.submit(); assert.equal(JSON.parse(f.request('PATCH').init.body).expectedVersion, 2);
    f.request('PATCH').deliver({ error: 'Photo details changed.', code: 'PHOTO_VERSION_CHANGED' }, 409); await f.settle();
    await f.click('Reload photo'); const refresh = f.request('POST');
    refresh.deliver({ document: { id: 'visit-A', data: visit('visit-A', 'A', [classified('saved', 'after', 3)]) } }); await f.settle();
    assert.ok(!find(f.renderer.tree, node => node.props?.id === 'gallery-edit-note'));
    await f.click('Edit photo saved.jpg'); await f.submit(); assert.equal(JSON.parse(f.request('PATCH').init.body).expectedVersion, 3);
    assert.equal(globals.servicesTestInvalidations, 0);
  });
  await check('fresh server metadata wins over locally uploaded photo and explicit reload advances the editor', async f => {
    await f.start(); await f.uploadDraft(['uploaded.jpg']); await f.submit();
    const local = classified('uploaded', 'before', 1); f.request('POST').deliver({ attachment: local }); await f.settle();
    await f.click('Edit photo uploaded.jpg'); await f.change('gallery-edit-note', 'Draft based on upload version one');
    const fresh = { ...classified('uploaded', 'after', 2), note: 'Concurrent saved version two note' };
    f.props.visits = [visit('visit-A', 'A', [fresh])]; f.render(); await f.settle();
    assert.match(text(f.renderer.tree), /Concurrent saved version two note/);
    await f.submit(); assert.equal(JSON.parse(f.request('PATCH').init.body).expectedVersion, 1);
    f.request('PATCH').deliver({ error: 'Photo details changed.', code: 'PHOTO_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.node('gallery-edit-note').props.value, 'Draft based on upload version one');
    await f.click('Reload photo'); f.request('POST').deliver({ document: { id: 'visit-A', data: visit('visit-A', 'A', [fresh]) } }); await f.settle();
    await f.click('Edit photo uploaded.jpg'); assert.equal(f.node('gallery-edit-note').props.value, 'Concurrent saved version two note');
    await f.change('gallery-edit-note', 'Reviewed edit based on two'); await f.submit();
    assert.equal(JSON.parse(f.request('PATCH').init.body).expectedVersion, 2);
  });
  await check('authoritative metadata reload does not restore a deleted locally uploaded photo', async f => {
    await f.start(); await f.uploadDraft(['uploaded.jpg']); await f.submit();
    f.request('POST').deliver({ attachment: classified('uploaded', 'before', 1) }); await f.settle();
    await f.click('Edit photo uploaded.jpg'); await f.submit(); f.request('PATCH').deliver({ error: 'Photo no longer exists.' }, 404); await f.settle();
    await f.click('Reload photo'); f.request('POST').deliver({ document: { id: 'visit-A', data: visit('visit-A', 'A', []) } }); await f.settle();
    assert.ok(!f.buttons().some(node => node.props['aria-label'] === 'Open photo uploaded.jpg'));
    assert.ok(!find(f.renderer.tree, node => node.props?.id === 'gallery-edit-note')); assert.match(text(f.renderer.tree), /No Visit photos yet/);
  });
  await check('parent acknowledgement retires the upload overlay so a later server deletion stays removed', async f => {
    await f.start(); await f.uploadDraft(['uploaded.jpg']); await f.submit();
    const uploaded = classified('uploaded', 'before', 1);
    f.request('POST').deliver({ attachment: uploaded }); await f.settle(); assert.ok(f.button('Open photo uploaded.jpg'));
    f.props.visits = [visit('visit-A', 'A', [uploaded])]; f.render(); await f.settle();
    assert.ok(f.button('Open photo uploaded.jpg'));
    const savedPreviewUrls = all(f.renderer.tree, node => node.type === 'img' && typeof node.props.src === 'string').map(node => node.props.src);
    assert.ok(savedPreviewUrls.length > 0);
    f.props.visits = [visit('visit-A', 'A', [])]; f.render();
    assert.ok(!f.buttons().some(node => node.props['aria-label'] === 'Open photo uploaded.jpg'), 'Deleted photo disappears in the first render');
    await f.settle();
    for (const url of savedPreviewUrls) assert.ok(f.revoked.includes(url), 'Deleted-photo preview URL revoked');
    assert.match(text(f.renderer.tree), /No Visit photos yet/);
    await f.click('Upload photos'); assert.match(text(f.renderer.tree), /Photos:\s+0\s+\/\s+4/);
    assert.match(text(f.renderer.tree), /4\s+remaining/); assert.equal(f.disabled('gallery-files'), false);
  });
  await check('parent acknowledgement and deletion before the upload reply cannot restore the deleted photo', async f => {
    await f.start(); await f.uploadDraft(['delayed.jpg']); await f.submit();
    const pending = f.request('POST'), uploaded = classified('delayed', 'before', 1);
    f.props.visits = [visit('visit-A', 'A', [uploaded])]; f.render(); await f.settle();
    assert.ok(f.button('Open photo delayed.jpg'));
    const urls = all(f.renderer.tree, node => node.type === 'img').map(node => node.props.src);
    f.props.visits = [visit('visit-A', 'A', [])]; f.render(); await f.settle();
    pending.deliver({ attachment: uploaded }, 201); await f.settle();
    assert.ok(!f.buttons().some(node => node.props['aria-label'] === 'Open photo delayed.jpg'));
    assert.match(text(f.renderer.tree), /No Visit photos yet/);
    for (const url of urls) assert.ok(f.revoked.includes(url));
    await f.click('Upload photos'); assert.match(text(f.renderer.tree), /Photos:\s+0\s+\/\s+4/);
    assert.match(text(f.renderer.tree), /4\s+remaining/); assert.equal(f.disabled('gallery-files'), false);
    assert.equal(globals.servicesTestInvalidations, 0);
  });
  for (const change of ['delete', 'parent deletion', 'metadata filter change']) {
    await check(`last photo leaving page two through ${change} reveals the remaining first page immediately`, async f => {
      const photos = Array.from({ length: 13 }, (_, index) => classified('paged-' + String(index + 1).padStart(2, '0')));
      f.props.visits = [visit('visit-A', 'A', photos.slice(0, 4)), visit('visit-2', 'A', photos.slice(4, 8)),
        visit('visit-3', 'A', photos.slice(8, 12)), visit('visit-4', 'A', photos.slice(12))];
      await f.start(); if (change === 'metadata filter change') await f.filter('Photo label', 'before');
      await f.click('Next photos'); assert.ok(f.button('Open photo paged-13.jpg'));
      if (change === 'delete') {
        await f.click('Remove photo paged-13.jpg'); await f.click('Confirm remove photo');
        f.request('DELETE').deliver({});
      } else if (change === 'parent deletion') {
        f.props.visits = f.props.visits.map((record: any) => ({ ...record, attachments: record.attachments.filter((file: any) => file.id !== 'paged-13') }));
        f.render();
        assert.ok(f.button('Open photo paged-01.jpg'), 'No empty first-render flash after the authoritative list shrinks');
      } else {
        await f.click('Edit photo paged-13.jpg'); await f.change('gallery-edit-stage', 'after'); await f.submit();
        f.request('PATCH').deliver({ attachment: classified('paged-13', 'after', 3) });
      }
      await f.settle();
      assert.equal(f.buttons().filter(node => String(node.props['aria-label'] || '').startsWith('Open photo ')).length, 12);
      assert.ok(f.button('Open photo paged-01.jpg'));
      assert.doesNotMatch(text(f.renderer.tree), /No photos match these filters/);
      assert.ok(!f.buttons().some(node => text(node).trim() === 'Previous photos'));
      await f.filter('Search treatment or area', 'paged-01'); assert.ok(f.button('Open photo paged-01.jpg'));
      await f.filter('Search treatment or area', ''); assert.ok(f.button('Open photo paged-01.jpg'));
    });
  }
  await check('failed image decoding removes the broken preview and Retry fetches a new protected preview', async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start();
    const preview = find(f.renderer.tree, node => node.type === 'img' && node.props.onError); assert.ok(preview);
    const oldUrl = preview.props.src; preview.props.onError(); await f.settle();
    assert.match(text(f.renderer.tree), /Photo preview unavailable/);
    assert.ok(!find(f.renderer.tree, node => node.type === 'img' && node.props.src === oldUrl));
    await f.click('Retry preview'); assert.ok(f.revoked.includes(oldUrl));
    const retried = find(f.renderer.tree, node => node.type === 'img' && node.props.onError); assert.ok(retried);
    assert.notEqual(retried.props.src, oldUrl); assert.doesNotMatch(text(f.renderer.tree), /Photo preview unavailable/);
  });
  await check('two same-patient photos across Visits compare; a third does not replace them', async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('before')]), visit('visit-B', 'B', [classified('after', 'after'), image('third')])];
    await f.start(); await f.click('Compare before.jpg'); await f.click('Compare after.jpg');
    assert.match(text(f.renderer.tree), /Before|After/); assert.equal(f.button('Compare third.jpg').props.disabled, true);
    await f.click('Compare third.jpg'); await f.click('Compare photos (2/2)');
    const comparison = find(f.renderer.tree, node => node.props?.role === 'dialog' && node.props?.['aria-label'] === 'Photo comparison');
    assert.ok(comparison); assert.match(text(comparison), /Saved note before/); assert.match(text(comparison), /Saved note after/);
  });
  for (const operation of ['preview', 'upload', 'metadata', 'delete']) for (const status of [200, 401, 403, 409]) {
    for (const change of ['patient', 'account', 'permission', 'branch', 'visit-archive', 'visit-branch', 'patient-archive', 'invalidate', 'unmount']) {
      await check(`old ${operation} ${status} after ${change} cannot publish or invalidate`, async f => {
        let pending: Pending;
        if (operation === 'preview') {
          f.delayedPreviews = true; f.props.visits = [visit('visit-A', 'A', [classified('saved')])];
          await f.start(); pending = f.previewReplies[0]; assert.ok(pending);
        } else if (operation === 'upload') {
          await f.start(); await f.uploadDraft(); await f.submit(); pending = f.request('POST');
        } else {
          f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start();
          if (operation === 'metadata') { await f.click('Edit photo saved.jpg'); await f.change('gallery-edit-note', 'OLD_UNSAVED_PHOTO'); await f.submit(); pending = f.request('PATCH'); }
          else { await f.click('Remove photo saved.jpg'); await f.click('Confirm remove photo'); pending = f.request('DELETE'); }
        }
        const urlsBefore = f.created.length; f.scope(change);
        pending.deliver(status === 200 ? operation === 'preview' ? new Blob(['old-scope-photo']) : { attachment: classified('OLD_SAVED_PHOTO') }
          : { error: 'OLD_GALLERY_ERROR' }, status); await f.settle();
        assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
        assert.doesNotMatch(text(f.renderer.tree), /OLD_GALLERY_ERROR|OLD_UNSAVED_PHOTO|OLD_SAVED_PHOTO/);
        if (operation === 'preview') assert.equal(f.created.length, urlsBefore, 'Late preview must not create an object URL');
      });
    }
  }
  await check('protected invalidation revokes every saved/selected URL and closes all Gallery editors', async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start(); await f.uploadDraft();
    assert.ok(f.created.length > 0); const prior = [...f.created]; f.scope('invalidate'); await f.settle();
    for (const url of prior) assert.ok(f.revoked.includes(url), 'URL revoked: ' + url);
    assert.ok(!find(f.renderer.tree, node => node.props?.id === 'gallery-note'));
  });
  for (const status of [401, 403]) await check(`current metadata denial ${status} invalidates protected data`, async f => {
    f.props.visits = [visit('visit-A', 'A', [classified('saved')])]; await f.start(); await f.click('Edit photo saved.jpg'); await f.submit();
    f.request('PATCH').deliver({ error: 'Current Gallery denial' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1);
  });
  // Exercise the existing Visit attachment selector itself, including legacy
  // images, documents and its unchanged overall-file/permission restrictions.
  const attachmentHarness = await buildControlledForms(['FileAttachmentSection'], process.cwd(), { mockImageCompression: true, mockAttachmentDocuments: true });
  try {
    for (const scenario of [
      { name: 'over-limit legacy photos still permit PDF-only selection', images: 5, documents: 0, incoming: 'pdf', allowed: true },
      { name: 'over-limit legacy photos still reject an additional image', images: 5, documents: 0, incoming: 'jpg', allowed: false },
      { name: 'four photos permit PDF-only selection within the total-file limit', images: 4, documents: 0, incoming: 'pdf', allowed: true },
      { name: 'three photos permit a fourth image', images: 3, documents: 0, incoming: 'jpg', allowed: true },
      { name: 'four photos reject a fifth image', images: 4, documents: 0, incoming: 'jpg', allowed: false },
      { name: 'legacy PDF selection still respects the configured total-file limit', images: 5, documents: 7, incoming: 'pdf', allowed: false },
      { name: 'explicit attachment denial still disables legacy PDF selection', images: 5, documents: 0, incoming: 'pdf', allowed: false, denied: true },
    ]) {
      const renderer = new Renderer(attachmentHarness.components.FileAttachmentSection), alerts: string[] = [];
      const attachments = [...Array.from({ length: scenario.images }, (_, index) => image('legacy-selector-' + index)),
        ...Array.from({ length: scenario.documents }, (_, index) => ({ ...document, id: 'document-' + index, storagePath: 'synthetic/document-' + index + '.pdf' }))];
      const retained = JSON.stringify(attachments);
      const props = { patientId: 'patient', appointmentId: null, visitId: 'visit-A' };
      globals.servicesTestAuth.currentUser = { uid: 'nurse', getRequestToken: async () => 'synthetic' };
      globals.servicesTestMediaSettings = { maxFilesPerRecord: 12, maxFileSizeMB: 1, allowedExtensions: ['.jpg', '.pdf'] };
      globals.attachmentTestDocuments = { 'visits/visit-A': { attachments } };
      globals.alert = (message: string) => alerts.push(message);
      globals.fetch = async () => new Response(new Blob(['synthetic-photo'], { type: 'image/jpeg' }));
      attachmentHarness.modules.FileAttachmentSection.publishPermissionProfile({ ...baseActor,
        ...(scenario.denied ? { permissionOverrides: { 'visits.attachments.manage': 'deny' } } : {}) });
      const settle = async () => { for (let n = 0; n < 12; n++) { renderer.passives.splice(0).forEach(run => run()); await flush(); if (renderer.dirty) renderer.render(props); } };
      try {
        renderer.render(props); await settle();
        const selector = find(renderer.tree, node => node.props?.id === 'file-upload'); assert.ok(selector);
        assert.equal(Boolean(selector.props.disabled), Boolean(scenario.denied));
        const selected = new File(['synthetic'], 'selected.' + scenario.incoming, { type: scenario.incoming === 'pdf' ? 'application/pdf' : 'image/jpeg' });
        if (!selector.props.disabled) selector.props.onChange({ target: { files: [selected] } }); await settle();
        assert.equal(/Preview:\s*selected\./.test(text(renderer.tree)), scenario.allowed);
        assert.equal(alerts.length, scenario.allowed || scenario.denied ? 0 : 1);
        assert.equal(JSON.stringify(attachments), retained, 'Existing files and legacy notes stay unchanged');
        results.push({ name: scenario.name, passed: true });
      } catch (failure: any) { results.push({ name: scenario.name, passed: false, error: failure.message }); }
      finally { renderer.unmount(); }
    }
  } finally { delete globals.attachmentTestDocuments; await attachmentHarness.cleanup(); }
  console.log(JSON.stringify(results, null, 2));
  console.log(`Patient Gallery actual component checks: ${results.filter(result => result.passed).length}/${results.length} passed (not browser evidence).`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally { delete globals.galleryTestImageCompression; await harness.cleanup(); }
