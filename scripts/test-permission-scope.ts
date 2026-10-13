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
  // A queued profile refresh can be newer than the editor's last rendered props.
  const latestTarget = { id: 'nurse', role: 'staff', active: true, staffDesignation: 'Reception/Admin Staff',
    accessRevision: 5, assignedBranches: ['B'], permissionOverrides: { 'visits.edit': 'deny' } as Record<string, 'allow' | 'deny'> };
  const otherTarget = { ...latestTarget, id: 'other', assignedBranches: ['A'] };
  const oldGrant = { id: 'nurse', accessRevision: 4, staffDesignation: 'Nurse',
    assignedBranches: ['A'], permissionOverrides: { 'visits.edit': 'allow' as const } };
  const staleMerge = access.mergeUserAccessResult([latestTarget, otherTarget], oldGrant);
  check(staleMerge[0] === latestTarget && staleMerge[1] === otherTarget, 'queued older reply preserves exact latest target and unrelated profiles');
  check(staleMerge[0].accessRevision === 5 && staleMerge[0].permissionOverrides['visits.edit'] === 'deny', 'old Allow cannot rewind the latest revision or Deny');
  check(staleMerge[0].staffDesignation === 'Reception/Admin Staff' && staleMerge[0].assignedBranches[0] === 'B', 'old reply cannot restore removed designation or branch scope');
  const newerMerge = access.mergeUserAccessResult(staleMerge, { ...oldGrant, accessRevision: 6 });
  check(newerMerge[0].accessRevision === 6 && newerMerge[0].permissionOverrides['visits.edit'] === 'allow', 'genuinely newer authorized reply remains accepted');
  check(newerMerge[0].role === 'staff' && newerMerge[0].active && newerMerge[1] === otherTarget, 'new partial reply preserves unrelated profile fields and accounts');
  const echo = access.mergeUserAccessResult(newerMerge, { id: 'nurse', accessRevision: 6, permissionOverrides: { 'visits.edit': 'allow' } });
  check(echo[0].accessRevision === 6 && echo[0].staffDesignation === 'Nurse', 'same-revision echo retains current metadata');
  const legacyMerge = access.mergeUserAccessResult([{ id: 'legacy', role: 'staff', assignedBranches: ['A'] }],
    { id: 'legacy', accessRevision: 1, permissionOverrides: { 'visits.edit': 'deny' } });
  check((legacyMerge[0] as any).accessRevision === 1 && legacyMerge[0].assignedBranches[0] === 'A', 'legacy missing revision still accepts its first authorized result');
  const missingMerge = access.mergeUserAccessResult(staleMerge, { ...oldGrant, id: 'removed', accessRevision: 6 });
  check(missingMerge[0] === latestTarget && missingMerge[1] === otherTarget && missingMerge.length === 2, 'late result cannot recreate an absent target');
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
  check(html.includes('Inherited default: Allowed') && html.includes('value="deny" selected=""') && html.includes('Inherited'), 'inherited default and explicit denial shown');
  check(html.includes('sm:flex-row') && html.includes('w-full') && html.includes('htmlFor') === false && html.includes('for="permission-'), 'responsive layout and linked native labels');
  for (const actor of [{ role: 'manager', active: true, permissionOverrides: { 'users.manage': 'allow', 'access.manage': 'allow' } }, { ...admin, permissionOverrides: { 'access.manage': 'deny' } }]) check((render(actor).match(/<select[^>]*disabled/g) || []).length === 40, 'security and designation selectors disabled without effective access.manage');
  check((render(admin, { ...target, id: 'admin' }).match(/<select[^>]*disabled/g) || []).length === 40, 'own override/designation UI cannot escalate');
  check((render(admin, { ...target, role: 'support_developer' }).match(/<select[^>]*disabled/g) || []).length === 39, 'Support target protected');
  check(renderToStaticMarkup(React.createElement(Details, { actor: { role: 'manager', active: true, permissionOverrides: { 'users.manage': 'allow' } }, target })).includes('Save user details'), 'delegated operational details remain editable');
  stop(); console.log(`${checks} permission-scope adapter race, invalidation and Module Access rendering checks passed (controlled responses, not browser acceptance).`);
} finally { globalThis.fetch = saved.fetch; globalThis.setInterval = saved.interval; }
