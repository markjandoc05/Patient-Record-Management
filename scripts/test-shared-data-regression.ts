import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise the real shared helpers without accounts, database connections or
// production records. Requests and polling are controlled, not approximated by sleep.
const saved = { fetch: globalThis.fetch, timeout: globalThis.setTimeout, interval: globalThis.setInterval };
const timers: (() => void)[] = [];
const pending: { body: any; resolve: (r: Response) => void }[] = [];
const stops: (() => void)[] = [];
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const reply = (rows: any[], status = 200) => new Response(JSON.stringify(status === 200
  ? { documents: rows.map(({ id, ...data }) => ({ id, data })) } : { error: 'Synthetic request failure' }), { status });
try {
  globalThis.setTimeout = ((fn: any) => { timers.push(fn); return 0; }) as any;
  globalThis.setInterval = (() => 0) as any;
  globalThis.fetch = (async (url: any, options: any) => url === '/api/auth/session'
    ? new Response(JSON.stringify({ user: null }), { status: 401 })
    : new Promise<Response>(resolve => pending.push({ body: JSON.parse(options.body), resolve }))) as any;
  const { db, invalidateProtectedData } = await import('../src/dataClient');
  const { subscribeToSharedCollection, getAccessibleBranches } = await import('../src/utils/branchAccess');
  for (const path of ['patients', 'visits', 'branches', 'users']) {
    const output: any[][] = [], errors: any[] = [];
    const stop = subscribeToSharedCollection(db, path, rows => output.push(rows), error => errors.push(error));
    stops.push(stop); await flush();
    const first = pending.shift()!;
    check(first.body.path === path && first.body.constraints.length === 0, `${path}: no new branch restriction`);
    const fixtures = [{ id: `${path}-A`, branchId: 'A', homeBranchId: 'A' }, { id: `${path}-B`, branchId: 'B', homeBranchId: 'B' }];
    first.resolve(reply(fixtures)); await flush();
    check(output.at(-1)?.length === 2, `${path}: shared authorized rows load`);
    timers.shift()!(); await flush(); pending.shift()!.resolve(reply([], 503)); await flush();
    check(output.length === 1 && output.at(-1)?.length === 2 && errors.length === 1, `${path}: transient failure retains delivered data`);
    timers.shift()!(); await flush(); pending.shift()!.resolve(reply(fixtures)); await flush();
    check(output.length === 2 && output.at(-1)?.length === 2, `${path}: unchanged data recovers after failure`);
    timers.shift()!(); await flush(); pending.shift()!.resolve(reply([], 403)); await flush();
    check(output.at(-1)?.length === 0 && errors.length === 2, `${path}: denial clears protected cache`);
    timers.shift()!(); await flush();
    const stale = pending.shift()!; invalidateProtectedData(); const count = output.length;
    stale.resolve(reply(fixtures)); await flush();
    check(output.length === count && output.at(-1)?.length === 0, `${path}: response before invalidation cannot republish`);
    stop(); timers.length = 0;
  }
  const archiveRows: any[][] = [];
  const stopActive = subscribeToSharedCollection(db, 'visits', rows => archiveRows.push(rows)); stops.push(stopActive);
  await flush(); pending.shift()!.resolve(reply([{ id: 'linked-visit', patientId: 'patient-A', appointmentId: 'appointment-A', isArchived: false }])); await flush();
  check(archiveRows.at(-1)?.[0]?.appointmentId === 'appointment-A', 'Linked visit associations preserved');
  timers.shift()!(); await flush(); pending.shift()!.resolve(reply([{ id: 'linked-visit', isArchived: true }])); await flush();
  check(archiveRows.at(-1)?.length === 0, 'Archived record removed by existing active filter');
  timers.shift()!(); await flush(); pending.shift()!.resolve(reply([{ id: 'linked-visit', isArchived: true }])); await flush();
  check(archiveRows.at(-1)?.length === 0, 'Archived row stays absent on unchanged poll');
  timers.shift()!(); await flush(); pending.shift()!.resolve(reply([{ id: 'linked-visit', isArchived: false }])); await flush();
  check(archiveRows.at(-1)?.length === 1, 'Restored record returns without duplication');
  stopActive(); timers.length = 0;
  let archived: any[] = [];
  const stopArchived = subscribeToSharedCollection(db, 'visits', rows => { archived = rows; }, undefined, [], true); stops.push(stopArchived);
  await flush(); pending.shift()!.resolve(reply([{ id: 'archived', isArchived: true }])); await flush();
  check(archived.length === 1, 'Existing includeArchived option preserved');
  stopArchived(); timers.length = 0;
  const branches = [{ id: 'A' }, { id: 'B' }];
  check(getAccessibleBranches(branches, { role: 'staff', assignedBranches: ['A'] }).map(b => b.id).join() === 'A', 'Staff branch choices unchanged');
  check(getAccessibleBranches(branches, { role: 'admin' }).length === 2, 'Admin branch choices unchanged');
  const { default: PatientProfile } = await import('../src/components/PatientProfile');
  const html = renderToStaticMarkup(React.createElement(PatientProfile, {
    patient: { id: 'patient-A', name: 'Synthetic Parity Patient', homeBranchId: 'A' }, userRole: 'doctor',
    users: [], branches: [{ id: 'A', branchName: 'Synthetic A' }], visits: [], appointments: [],
    onClose: () => {}, onAddVisit: () => {}, onViewVisit: () => {}, onEditVisit: () => {}, onEditPatient: () => {},
  } as any));
  check(html.includes('Synthetic Parity Patient') && html.includes('Medical overview'), 'Actual patient profile renders authorized clinical view');
  console.log(`${checks} shared patient/visit/directory/cache/profile regression checks passed (synthetic controlled responses; profile rendering, not browser acceptance).`);
} finally {
  stops.forEach(stop => stop());
  globalThis.fetch = saved.fetch; globalThis.setTimeout = saved.timeout; globalThis.setInterval = saved.interval;
}
