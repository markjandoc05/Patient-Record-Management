import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const saved = { fetch: globalThis.fetch, interval: globalThis.setInterval };
globalThis.setInterval = (() => 0) as any;
globalThis.fetch = (async () => new Response(JSON.stringify({ user: { uid: 'admin' }, csrfToken: 'synthetic' }))) as any;
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
try {
  const api = await import('../src/dataClient');
  const { auth } = await import('../src/session'); await auth.ready;
  const { publishPermissionProfile } = await import('../src/permissionState');
  const access = await import('../src/utils/accessApi');
  const record = await import('../src/utils/recordApi');
  const services = await import('../src/utils/servicesApi');
  const account = await import('../src/utils/userAccountApi');
  const developer = await import('../src/utils/developerToolsApi');
  const inventory = await import('../src/utils/inventoryApi');
  const login = await import('../src/utils/loginActivityApi');
  const files = await import('../src/utils/attachmentApi');
  let resets = 0; const stop = api.subscribeProtectedDataInvalidation(() => { resets++; });
  const requests: [string, () => Promise<any>][] = [
    ['access', () => access.updateUserAccess('staff', 0, { permissionChanges: { 'clinical.view': 'deny' } })],
    ['record', () => record.updatePatientRecord('patient', { name: 'Synthetic' })],
    ['Services', () => services.servicesRequest('/api/services')],
    ['user lifecycle', () => account.deactivateUserAccount('staff')],
    ['Developer', () => developer.fetchDeveloperMetrics()],
    ['inventory', () => inventory.transferRequest('create', {})],
    ['login activity', () => login.fetchLoginActivity()],
    ['attachment', () => files.fetchAttachmentBlob('synthetic')],
    ['generic write', () => api.updateDoc(api.doc(api.db, 'users', 'staff'), { fullName: 'Synthetic' })],
  ];
  for (const [name, run] of requests) for (const phase of ['token', 'response', 'body']) for (const status of [200, 401, 403]) {
    const token = deferred<string>(), response = deferred<Response>(), body = deferred<any>();
    let sent = 0;
    auth.currentUser!.getRequestToken = () => phase === 'token' ? token.promise : Promise.resolve('synthetic');
    globalThis.fetch = (async () => { sent++; if (phase === 'body') return { ok: status === 200, status, json: () => body.promise, blob: () => body.promise, text: () => body.promise } as any; return response.promise; }) as any;
    const pending = run().then(value => ({ value, error: null as any }), error => ({ value: null, error }));
    await flush(); api.invalidateProtectedData('permission changed'); const after = resets;
    token.resolve('synthetic'); response.resolve(new Response(JSON.stringify({ error: 'old denial', protected: 'obsolete' }), { status })); body.resolve({ error: 'old denial', protected: 'obsolete' });
    const result = await pending;
    check(result.error?.name === 'AbortError' && result.value === null, name + ' discards obsolete ' + phase + ' ' + status);
    check(resets === after, name + ' old response cannot invalidate new-scope cache');
    if (phase === 'token') check(sent === 0, name + ' obsolete token cannot issue request');
  }
  auth.currentUser!.getRequestToken = async () => 'synthetic';
  for (const [name, run] of requests) for (const status of [401, 403]) {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'current denial' }), { status })) as any;
    const before = resets; const result = await run().then(() => null, error => error);
    check(result?.name !== 'AbortError' && resets === before + 1, name + ' current denial still invalidates exactly once');
  }
  // Own profile must remain readable while protected subscriptions are reset,
  // but an identity change still invalidates that response.
  for (const identityChange of [false, true]) {
    const response = deferred<Response>(); globalThis.fetch = (() => response.promise) as any;
    const pending = api.getDoc(api.doc(api.db, 'users', 'admin')).then(value => ({ value, error: null as any }), error => ({ value: null, error }));
    await flush(); api.invalidateProtectedData(); const previous = auth.currentUser;
    if (identityChange) auth.currentUser = { ...previous!, uid: 'other' };
    response.resolve(new Response(JSON.stringify({ document: { id: 'admin', data: { role: 'admin', active: true } } })));
    const result = await pending; check(identityChange ? result.error?.name === 'AbortError' : result.value?.data().role === 'admin', 'own profile exemption remains identity bound'); auth.currentUser = previous;
  }
  publishPermissionProfile({ role: 'staff', active: true, permissionOverrides: { 'patients.view': 'deny' } });
  let deniedFetches = 0, cleared = false;
  globalThis.fetch = (async () => { deniedFetches++; throw Error('Denied subscription should not fetch'); }) as any;
  const unsub = api.onSnapshot(api.collection(api.db, 'patients'), value => { cleared = value.empty; });
  await flush(); check(cleared && deniedFetches === 0, 'known-denied subscription clears without a denial polling loop'); unsub(); publishPermissionProfile(null);
  const { default: Editor } = await import('../src/components/UserPermissionEditor');
  const { default: Details } = await import('../src/components/UserOperationalDetails');
  const target = { id: 'staff', role: 'staff', active: true, assignedBranches: ['A'], permissionOverrides: { 'clinical.view': 'deny' } };
  const admin = { role: 'admin', active: true };
  const render = (actor: any, t = target) => renderToStaticMarkup(React.createElement(Editor, { actor, target: t, onSaved: () => {} }));
  const html = render(admin);
  check(html.includes('Module Access') && html.includes('<details') && html.includes('<summary'), 'compact expandable module groups');
  check(html.includes('Role default: Allowed') && html.includes('value="deny" selected=""') && html.includes('Inherited'), 'role default and explicit denial shown');
  check(html.includes('sm:flex-row') && html.includes('w-full') && html.includes('htmlFor') === false && html.includes('for="permission-'), 'responsive layout and linked native labels');
  for (const actor of [{ role: 'manager', active: true, permissionOverrides: { 'users.manage': 'allow', 'access.manage': 'allow' } }, { ...admin, permissionOverrides: { 'access.manage': 'deny' } }]) check((render(actor).match(/<select[^>]*disabled/g) || []).length === 39, 'security selectors disabled without effective access.manage');
  check((render(admin, { ...target, id: 'admin' }).match(/<select[^>]*disabled/g) || []).length === 39, 'own override UI cannot escalate');
  check((render(admin, { ...target, role: 'support_developer' }).match(/<select[^>]*disabled/g) || []).length === 39, 'Support target protected');
  check(renderToStaticMarkup(React.createElement(Details, { actor: { role: 'manager', active: true, permissionOverrides: { 'users.manage': 'allow' } }, target })).includes('Save user details'), 'delegated operational details remain editable');
  stop(); console.log(`${checks} permission-scope adapter race, invalidation and Module Access rendering checks passed (controlled responses, not browser acceptance).`);
} finally { globalThis.fetch = saved.fetch; globalThis.setInterval = saved.interval; }
