import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Actual attachment/Gallery adapters and protected-request foundation. Only the
// browser image encoder and authentication bootstrap are controlled. No DB or
// browser session is accessed; these checks are deliberately late async replies.
const globals = globalThis as any;
const original = { fetch: globals.fetch, setInterval: globals.setInterval, setTimeout: globals.setTimeout };
const temporary = await mkdtemp(path.join(tmpdir(), 'vine-gallery-transport-'));
await symlink(path.join(process.cwd(), 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
globals.galleryTransportAuth = { currentUser: null, ready: Promise.resolve() };
globals.galleryTestImageCompression = async (file: File) => file;
globals.setInterval = () => 0; globals.setTimeout = () => 0;
await writeFile(path.join(temporary, 'platform.mjs'), 'export const auth=globalThis.galleryTransportAuth; export const db={};');
await writeFile(path.join(temporary, 'image.mjs'), 'export default (...args)=>globalThis.galleryTestImageCompression(...args);');
await writeFile(path.join(temporary, 'entry.ts'), [
  `export * from ${JSON.stringify(path.join(process.cwd(), 'src/utils/attachmentApi.ts'))};`,
  `export * from ${JSON.stringify(path.join(process.cwd(), 'src/utils/patientGalleryApi.ts'))};`,
  `export {invalidateProtectedData,subscribeProtectedDataInvalidation,onSnapshot,collection,db} from ${JSON.stringify(path.join(process.cwd(), 'src/dataClient.ts'))};`,
  `export {publishPermissionProfile} from ${JSON.stringify(path.join(process.cwd(), 'src/permissionState.ts'))};`,
].join('\n'));
await build({ entryPoints: [path.join(temporary, 'entry.ts')], outfile: path.join(temporary, 'entry.mjs'), bundle: true,
  platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'controlled-gallery-transport', setup(builder) {
    builder.onResolve({ filter: /(session|platform)$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
    builder.onResolve({ filter: /^browser-image-compression$/ }, () => ({ path: path.join(temporary, 'image.mjs') }));
  } }] });
const api = await import(pathToFileURL(path.join(temporary, 'entry.mjs')).href);
const auth = globals.galleryTransportAuth;
const flush = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
const photo = { id: 'photo', name: 'Synthetic.jpg', storagePath: 'synthetic/photo.jpg', contentType: 'image/jpeg' };
const user = () => ({ uid: 'synthetic', getRequestToken: async () => 'synthetic-token' });
const profile = (revision = 0) => ({ role: 'staff', active: true, staffDesignation: 'Nurse', assignedBranches: ['A'], accessRevision: revision });
const upload = { file: new File(['synthetic'], 'Synthetic.jpg', { type: 'image/jpeg' }), originalName: 'Synthetic.jpg',
  maxFileSizeMB: 5, note: 'Synthetic note', patientId: 'patient', resourceType: 'visit' as const, resourceId: 'visit',
  photoStage: 'before' as const, photoTakenAt: '2035-01-01T10:00', photoArea: 'Face / front' };
const metadata = { storagePath: photo.storagePath, expectedVersion: 2, stage: 'after' as const,
  takenAt: '2035-01-01T10:30', area: 'Face / front', note: 'Synthetic edited note' };
type Operation = 'preview' | 'upload' | 'metadata' | 'delete' | 'reload';
const perform = (operation: Operation, options: any = {}) => operation === 'preview' ? api.fetchAttachmentBlob(photo.storagePath, options)
  : operation === 'upload' ? api.uploadAttachment(upload, options) : operation === 'metadata' ? api.updateAttachmentPhoto(metadata, options)
    : operation === 'delete' ? api.deleteAttachment(photo.storagePath, options) : api.getGalleryVisit('visit', options);
const response = (status: number) => new Response(JSON.stringify(status === 200 ? { attachment: photo } : { error: 'Synthetic denial', code: 'TEST_DENIAL' }), { status });
let checks = 0;
const verify = (run: () => unknown) => { run(); checks++; };
let invalidations = 0;
const stop = api.subscribeProtectedDataInvalidation(() => invalidations++);
const reset = () => { auth.currentUser = user(); api.publishPermissionProfile(profile()); invalidations = 0; globals.galleryTestImageCompression = async (file: File) => file; };
try {
  for (const operation of ['preview', 'upload', 'metadata', 'delete', 'reload'] as const) {
    for (const status of [200, 401, 403, 409, 500]) {
      for (const change of ['current', 'identity', 'permission', 'invalidation', 'abort']) {
        reset(); let deliver!: (value: Response) => void, current = true; const controller = new AbortController();
        globals.fetch = () => new Promise(resolve => { deliver = resolve; });
        const pending = perform(operation, { signal: controller.signal, isCurrent: () => current });
        const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush(); assert.equal(typeof deliver, 'function');
        if (change === 'current') current = false;
        if (change === 'identity') auth.currentUser = { ...user(), uid: 'new-synthetic' };
        if (change === 'permission') api.publishPermissionProfile(profile(1));
        if (change === 'invalidation') api.invalidateProtectedData();
        if (change === 'abort') controller.abort();
        const before = invalidations; deliver(response(status)); await rejected;
        verify(() => assert.equal(invalidations, before, `Old ${operation} ${status} cannot invalidate a newer scope`));
      }
    }
  }
  // Body replies are a distinct async boundary, including HTTP error JSON.
  for (const operation of ['preview', 'upload', 'metadata', 'reload'] as const) for (const status of [200, 401, 403, 409]) {
    reset(); let body!: (value: unknown) => void, current = true;
    globals.fetch = async () => {
      const value = response(status);
      Object.defineProperty(value, operation === 'preview' && status === 200 ? 'blob' : 'json', { configurable: true,
        value: () => new Promise(resolve => { body = resolve; }) });
      return value;
    };
    const pending = perform(operation, { isCurrent: () => current }); const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush(); assert.equal(typeof body, 'function'); current = false;
    body(operation === 'preview' && status === 200 ? new Blob(['synthetic']) : { attachment: photo, error: 'OLD_BODY_DENIAL' });
    await rejected; verify(() => assert.equal(invalidations, 0));
  }
  for (const operation of ['preview', 'upload', 'metadata', 'delete', 'reload'] as const) for (const status of [401, 403]) {
    reset(); globals.fetch = async () => response(status);
    await assert.rejects(perform(operation), (error: any) => error.status === status && error.code === 'TEST_DENIAL');
    verify(() => assert.equal(invalidations, 1, 'A current denial invalidates exactly once'));
  }
  for (const operation of ['preview', 'upload', 'metadata', 'delete', 'reload'] as const) {
    reset(); let token!: (value: string) => void, fetches = 0;
    auth.currentUser = { ...user(), getRequestToken: () => new Promise(resolve => { token = resolve; }) };
    globals.fetch = async () => { fetches++; return response(200); };
    const pending = perform(operation); const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    api.publishPermissionProfile(profile(1)); token('synthetic-token'); await rejected;
    verify(() => assert.equal(fetches, 0, 'Old permission token cannot dispatch'));
  }
  for (const change of ['permission', 'identity', 'current', 'abort']) {
    reset(); let encoded!: (value: File) => void, current = true, fetches = 0; const controller = new AbortController();
    globals.galleryTestImageCompression = () => new Promise(resolve => { encoded = resolve; });
    globals.fetch = async () => { fetches++; return response(200); };
    const pending = perform('upload', { signal: controller.signal, isCurrent: () => current });
    const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    if (change === 'permission') api.publishPermissionProfile(profile(1));
    if (change === 'identity') auth.currentUser = { ...user(), uid: 'new-synthetic' };
    if (change === 'current') current = false;
    if (change === 'abort') controller.abort();
    encoded(upload.file); await rejected; verify(() => assert.equal(fetches, 0, 'Old image optimization cannot dispatch'));
  }
  for (const operation of ['preview', 'upload', 'metadata', 'delete', 'reload'] as const) {
    reset(); let failToken!: (error: Error) => void, fetches = 0;
    auth.currentUser = { ...user(), getRequestToken: () => new Promise((_resolve, reject) => { failToken = reject; }) };
    globals.fetch = async () => { fetches++; return response(200); };
    const pending = perform(operation); const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    api.publishPermissionProfile(profile(1)); failToken(new Error('OLD_TOKEN_ERROR')); await rejected;
    verify(() => { assert.equal(fetches, 0); assert.equal(invalidations, 0); });
  }
  reset(); let failEncoder!: (error: Error) => void;
  globals.galleryTestImageCompression = () => new Promise((_resolve, reject) => { failEncoder = reject; });
  const pendingEncoder = perform('upload'); const rejectedEncoder = assert.rejects(pendingEncoder, { name: 'AbortError' }); await flush();
  api.publishPermissionProfile(profile(1));
  const oldError = console.error; console.error = () => {};
  try { failEncoder(new Error('OLD_ENCODER_ERROR')); await rejectedEncoder; verify(() => assert.equal(invalidations, 0)); }
  finally { console.error = oldError; }
  reset(); let captured: any, capturedUrl: any;
  globals.fetch = async (url: any, init: any) => { captured = init; capturedUrl = url; return response(200); };
  assert.deepEqual(await perform('upload'), { attachment: photo });
  verify(() => {
    assert.equal(capturedUrl, '/api/attachments/upload'); assert.equal(captured.method, 'POST'); assert.ok(captured.body instanceof FormData);
    for (const [key, value] of Object.entries({ patientId: 'patient', resourceType: 'visit', resourceId: 'visit',
      photoStage: 'before', photoTakenAt: '2035-01-01T10:00', photoArea: 'Face / front', note: 'Synthetic note' })) assert.equal(captured.body.get(key), value);
    assert.equal(captured.body.get('file').name, 'Synthetic.jpg');
    assert.equal(new Headers(captured.headers).get('Authorization'), 'Bearer synthetic-token');
  });
  const legacy = { ...upload }; delete legacy.photoStage; delete legacy.photoTakenAt; delete legacy.photoArea;
  await api.uploadAttachment(legacy);
  verify(() => { for (const key of ['photoStage', 'photoTakenAt', 'photoArea']) assert.equal(captured.body.has(key), false); });
  await perform('metadata'); verify(() => { assert.equal(capturedUrl, '/api/attachments/photo'); assert.equal(captured.method, 'PATCH'); assert.deepEqual(JSON.parse(captured.body), metadata); });
  await perform('delete'); verify(() => { assert.equal(captured.method, 'DELETE'); assert.deepEqual(JSON.parse(captured.body), { storagePath: photo.storagePath }); });
  globals.fetch = async (url: any, init: any) => { captured = init; capturedUrl = url; return new Response(JSON.stringify({ document: { id: 'visit', data: { patientId: 'patient', attachments: [photo] } } })); };
  const refreshed = await perform('reload');
  verify(() => { assert.equal(capturedUrl, '/api/data/query'); assert.deepEqual(JSON.parse(captured.body), { kind: 'document', path: 'visits/visit', constraints: [] }); assert.equal(refreshed.id, 'visit'); assert.deepEqual(refreshed.attachments, [photo]); });
  globals.fetch = async () => new Response(JSON.stringify({ document: { id: 'visit', data: null } }));
  const missingVisit = await perform('reload'); verify(() => assert.equal(missingVisit, null));
  globals.fetch = async () => new Response(JSON.stringify({ document: { id: 'other-visit', data: {} } }));
  await assert.rejects(perform('reload'), /Invalid Visit response/); checks++;
  for (const method of ['openAttachment', 'downloadAttachment']) {
    reset(); let deliver!: (value: Response) => void, current = true, urls = 0, clicks = 0, closed = 0;
    const previousURL = URL.createObjectURL, oldWindow = globals.window, oldDocument = globals.document;
    URL.createObjectURL = () => { urls++; return 'blob:synthetic-gallery'; };
    globals.window = { open: () => ({ location: { href: '' }, close() { closed++; } }), setTimeout() {} };
    globals.document = { createElement: () => ({ click() { clicks++; }, remove() {} }), body: { appendChild() {} } };
    globals.fetch = () => new Promise(resolve => { deliver = resolve; });
    try {
      const pending = api[method](photo, { isCurrent: () => current }); const rejected = assert.rejects(pending, { name: 'AbortError' });
      await flush(); current = false; deliver(new Response(new Blob(['synthetic']))); await rejected;
      verify(() => { assert.equal(urls, 0); assert.equal(clicks, 0); assert.equal(invalidations, 0); if (method === 'openAttachment') assert.equal(closed, 1); });
    } finally { URL.createObjectURL = previousURL; globals.window = oldWindow; globals.document = oldDocument; }
  }
  globals.fetch = async () => response(409);
  await assert.rejects(perform('metadata'), (error: any) => error.status === 409);
  verify(() => assert.equal(invalidations, 0, 'A conflict preserves current protected data'));
  auth.currentUser = null;
  await assert.rejects(perform('preview'), (error: any) => error.status === 401); checks++;
  console.log(`${checks}/${checks} Gallery adapter/lifetime checks passed (controlled transport, not browser evidence).`);
} finally {
  stop(); Object.assign(globals, original); delete globals.galleryTransportAuth; delete globals.galleryTestImageCompression;
  await rm(temporary, { recursive: true, force: true });
}
