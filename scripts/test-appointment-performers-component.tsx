import assert from 'node:assert/strict';
import path from 'node:path';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

const harness = await buildControlledForms(['AppointmentForm', 'VisitForm', 'UserOperationalDetails', 'PatientAppointments', 'PatientTimeline', 'VisitHistoryDashboard', 'CalendarView', 'UserPermissionEditor', 'AppointmentsDashboard'], path.resolve(process.argv[2] || process.cwd()));
type ComponentName = 'AppointmentForm' | 'VisitForm' | 'UserOperationalDetails' | 'PatientAppointments' | 'PatientTimeline' | 'VisitHistoryDashboard' | 'CalendarView' | 'UserPermissionEditor' | 'AppointmentsDashboard';
const results: { name: string; passed: boolean; error?: string }[] = [];
const users = () => [
  { id: 'admin', email: 'admin@example.invalid', fullName: 'Synthetic Admin', role: 'admin', active: true, assignedBranches: ['A', 'B'] },
  { id: 'doctor', fullName: 'Original Doctor', role: 'doctor', active: true, assignedBranches: ['A', 'B'] },
  { id: 'nurse', fullName: 'Original Nurse', role: 'staff', staffDesignation: 'Nurse', active: true, assignedBranches: ['A'] },
  { id: 'medical', fullName: 'Medical Person', role: 'staff', staffDesignation: 'Medical Staff', active: true, assignedBranches: ['A', 'B'] },
  { id: 'reception', fullName: 'Reception Person', role: 'staff', staffDesignation: 'Reception/Admin Staff', active: true, assignedBranches: ['A'] },
  { id: 'ordinary', fullName: 'Ordinary Staff', role: 'staff', active: true, assignedBranches: ['A'] },
  { id: 'inactive', fullName: 'Inactive Nurse', role: 'staff', staffDesignation: 'Nurse', active: false, assignedBranches: ['A'] },
  { id: 'archived', fullName: 'Archived Nurse', role: 'staff', staffDesignation: 'Nurse', active: true, isArchived: true, assignedBranches: ['A'] },
  { id: 'outside', fullName: 'Other Branch Nurse', role: 'staff', staffDesignation: 'Nurse', active: true, assignedBranches: ['B'] },
];
class Fixture {
  renderer: Renderer; saves = 0; closes = 0;
  requests: { url: string; init: any; deliver: (body: any, status?: number) => void }[] = [];
  props: any;
  constructor(kind: ComponentName) {
    globals.servicesTestInvalidations = 0;
    globals.servicesTestAuth.currentUser = { uid: 'admin', email: 'admin@example.invalid', getRequestToken: async () => 'synthetic' };
    globals.fetch = (url: string, init: any) => new Promise(resolve => this.requests.push({ url, init,
      deliver: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) }));
    this.renderer = new Renderer(harness.components[kind]);
    this.props = { patients: [{ id: 'patient', name: 'Synthetic Patient' }], users: users(),
      branches: [{ id: 'A', branchName: 'Branch A', status: 'Active' }, { id: 'B', branchName: 'Branch B', status: 'Active' }],
      defaultBranchId: 'A', userRole: 'admin', appointments: [], visits: [], onSave: () => this.saves++, onClose: () => this.closes++ };
    if (kind === 'AppointmentForm') this.props.appointment = { id: 'booking', patientId: 'patient', branchId: 'A', doctorId: null, appointmentDate: '2035-01-01T10:00', visitType: 'Initial Consultation', status: 'Scheduled' };
    if (kind === 'VisitForm') this.props.appointment = { id: 'booking', patientId: 'patient', branchId: 'A', doctorId: null, appointmentDate: '2035-01-01T10:00', visitType: 'Treatment Session', status: 'Arrived' };
    if (kind === 'UserOperationalDetails') this.props = { actor: users()[0], target: users()[2] };
    if (kind === 'UserPermissionEditor') this.props = { actor: users()[0], target: { ...users()[2], accessRevision: 3 }, onSaved: (value: any) => { this.saves++; this.props.target = { ...this.props.target, ...value }; this.render(); } };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let index = 0; index < 8; index++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); if (this.renderer.dirty) this.render(); } }
  async start() { this.render(); await this.settle(); }
  node(id: string) { const node = find(this.renderer.tree, value => value.props?.id === id); assert.ok(node, 'missing ' + id); return node; }
  button(label: string) { const node = find(this.renderer.tree, value => value.type === 'button' && text(value).trim() === label); assert.ok(node, 'missing ' + label); return node; }
  async change(id: string, value: string) { this.node(id).props.onChange({ target: { value } }); await this.settle(); }
  latestSave() { return this.requests.filter(value => ['POST', 'PATCH'].includes(value.init.method)).at(-1); }
  async loaded() { for (const request of this.requests.filter(value => value.init.method === 'GET')) request.deliver({ services: [], total: 0 }); await this.settle(); }
  async save() { find(this.renderer.tree, value => value.type === 'form').props.onSubmit({ preventDefault() {} }); await this.settle(); }
  scope() { this.props.users = this.props.users.map((user: any) => user.id === 'admin' ? { ...user, role: 'manager', assignedBranches: ['A'] } : user); this.props.userRole = 'manager'; this.render(); }
  stop() { this.renderer.unmount(); globals.historyRows = undefined; }
}
async function test(kind: ConstructorParameters<typeof Fixture>[0], name: string, run: (fixture: Fixture) => Promise<void>) {
  const fixture = new Fixture(kind);
  try { await run(fixture); results.push({ name, passed: true }); }
  catch (error: any) { results.push({ name, passed: false, error: error.message }); }
  finally { fixture.stop(); }
}
try {
  await test('AppointmentForm', 'new booking defaults to Unassigned and permits branch date/time', async f => {
    f.props.appointment = undefined; await f.start(); await f.loaded();
    assert.equal(f.node('appointment-doctor').props.value, ''); assert.ok(text(f.node('appointment-doctor')).includes('Unassigned — assign later'));
    const date = find(f.renderer.tree, value => value.props?.['data-controlled-date']); assert.equal(date.props.disabled, false);
    assert.equal(f.button('10:00 AM').props.disabled, false);
    f.node('appointment-patient').props.onChange({ target: { value: 'Synthetic' } }); await f.settle();
    find(f.renderer.tree, value => value.type === 'button' && text(value).includes('Synthetic Patient')).props.onClick(); await f.settle();
    f.button('10:00 AM').props.onClick(); await f.settle(); await f.save();
    assert.equal(JSON.parse(f.latestSave()!.init.body).doctorId, null);
  });
  for (const visitType of ['Initial Consultation', 'Follow-up', 'Treatment Session', 'Assessment']) await test('AppointmentForm', visitType + ' saves unassigned appointment', async f => {
    await f.start(); await f.loaded(); await f.change('appointment-visit-type', visitType); await f.save();
    const payload = JSON.parse(f.latestSave()!.init.body); assert.equal(payload.doctorId, null); assert.equal(payload.visitType, visitType);
  });
  await test('AppointmentForm', 'unassigned time does not reserve doctor; later selection retains conflict checks', async f => {
    f.props.appointments = [{ id: 'occupied', doctorId: 'doctor', branchId: 'B', appointmentDate: '2035-01-01T10:00', status: 'Scheduled' }];
    await f.start(); await f.loaded(); assert.equal(f.button('10:00 AM').props.disabled, false);
    await f.change('appointment-doctor', 'doctor'); assert.equal(f.button('10:00 AM').props.disabled, true);
    await f.save(); assert.ok(!f.latestSave()); assert.ok(text(f.renderer.tree).includes('no longer available'));
    await f.change('appointment-doctor', ''); assert.equal(f.button('10:00 AM').props.disabled, false); await f.save();
    assert.equal(JSON.parse(f.latestSave()!.init.body).doctorId, null);
  });
  await test('AppointmentForm', 'later doctor assignment uses existing edit and canonical Service omission', async f => {
    f.props.appointment = { ...f.props.appointment, serviceId: 'old', serviceNameSnapshot: 'Historical service', serviceCatalogueVersion: 1, serviceDurationMinutesSnapshot: 20 };
    await f.start(); await f.loaded(); await f.change('appointment-doctor', 'doctor'); await f.save();
    const payload = JSON.parse(f.latestSave()!.init.body); assert.equal(payload.doctorId, 'doctor'); assert.ok(!Object.hasOwn(payload, 'serviceSelection'));
  });
  await test('AppointmentForm', 'historical deleted Doctor remains selected and readable without becoming Unassigned', async f => {
    f.props.mode = 'view'; f.props.appointment = { ...f.props.appointment, doctorId: 'deleted-doctor', doctorName: 'Historical Doctor Name' };
    await f.start(); assert.equal(f.node('appointment-doctor').props.value, 'deleted-doctor');
    const recorded = find(f.node('appointment-doctor'), node => node.type === 'option' && node.props.value === 'deleted-doctor');
    assert.ok(recorded && text(recorded).includes('Historical Doctor Name')); assert.equal(f.node('appointment-doctor').props.disabled, true); assert.equal(f.requests.length, 0);
  });
  await test('VisitForm', 'linked unassigned Visit requires real performer and accepts nurse with assistants', async f => {
    await f.start(); await f.loaded(); await f.save(); assert.ok(!f.latestSave());
    assert.ok(text(f.renderer.tree).includes('Select an active doctor, nurse or medical staff'));
    await f.change('visit-performed-by', 'nurse'); await f.change('visit-assisting-staff', 'Alice Example, Bob Example'); await f.save();
    const payload = JSON.parse(f.latestSave()!.init.body);
    assert.equal(payload.performedByUserId, 'nurse'); assert.equal(payload.assistingStaffText, 'Alice Example, Bob Example');
    assert.equal(payload.doctorId, null); assert.equal(payload.appointmentId, 'booking');
    for (const field of ['performedByNameSnapshot', 'performedByRoleSnapshot', 'performedByDesignationSnapshot']) assert.ok(!Object.hasOwn(payload, field));
    assert.equal(f.node('visit-performed-by').props.disabled, true); assert.equal(f.node('visit-assisting-staff').props.disabled, true);
  });
  await test('VisitForm', 'performer picker limits to active designated staff and doctors in selected branch', async f => {
    await f.start(); const options = text(f.node('visit-performed-by'));
    for (const label of ['Original Doctor', 'Original Nurse', 'Medical Person']) assert.ok(options.includes(label));
    for (const label of ['Reception Person', 'Ordinary Staff', 'Inactive Nurse', 'Archived Nurse', 'Other Branch Nurse']) assert.ok(!options.includes(label));
  });
  await test('VisitForm', 'assigned doctor prefills performer but actual nurse is a separate field', async f => {
    f.props.appointment.doctorId = 'doctor'; await f.start(); await f.loaded();
    assert.equal(f.node('visit-performed-by').props.value, 'doctor'); assert.equal(f.node('visit-doctor').props.disabled, true);
    await f.change('visit-performed-by', 'nurse'); await f.save();
    const payload = JSON.parse(f.latestSave()!.init.body); assert.equal(payload.doctorId, 'doctor'); assert.equal(payload.performedByUserId, 'nurse');
  });
  await test('VisitForm', 'Doctor actor with unassigned booking is offered only self under existing ownership rules', async f => {
    globals.servicesTestAuth.currentUser = { uid: 'doctor', email: 'doctor@example.invalid', getRequestToken: async () => 'synthetic' }; f.props.userRole = 'doctor';
    await f.start(); await f.loaded(); const options = text(f.node('visit-performed-by'));
    assert.ok(options.includes('Original Doctor')); assert.ok(!options.includes('Original Nurse') && !options.includes('Medical Person'));
    await f.change('visit-performed-by', 'nurse'); await f.save(); assert.ok(!f.latestSave());
    await f.change('visit-performed-by', 'doctor'); await f.save(); assert.equal(JSON.parse(f.latestSave()!.init.body).performedByUserId, 'doctor');
  });
  await test('VisitForm', 'Doctor actor own assigned booking can record an actual nurse performer', async f => {
    globals.servicesTestAuth.currentUser = { uid: 'doctor', email: 'doctor@example.invalid', getRequestToken: async () => 'synthetic' }; f.props.userRole = 'doctor'; f.props.appointment.doctorId = 'doctor';
    await f.start(); await f.loaded(); assert.ok(text(f.node('visit-performed-by')).includes('Original Nurse'));
    await f.change('visit-performed-by', 'nurse'); await f.save(); const payload = JSON.parse(f.latestSave()!.init.body);
    assert.equal(payload.doctorId, 'doctor'); assert.equal(payload.performedByUserId, 'nurse');
  });
  await test('VisitForm', 'walk-in nurse Visit allows branch date and time without doctor', async f => {
    f.props.appointment = undefined; await f.start(); await f.loaded();
    f.node('visit-patient').props.onChange({ target: { value: 'Synthetic' } }); await f.settle();
    find(f.renderer.tree, value => value.type === 'button' && text(value).includes('Synthetic Patient')).props.onClick(); await f.settle();
    await f.change('visit-performed-by', 'nurse'); const date = find(f.renderer.tree, value => value.props?.['data-controlled-date']); assert.equal(date.props.disabled, false);
    f.button('10:00 AM').props.onClick(); await f.settle(); await f.save(); assert.equal(JSON.parse(f.latestSave()!.init.body).doctorId, null);
  });
  await test('VisitForm', 'branch change clears an ineligible performer', async f => {
    f.props.appointment = undefined; f.props.visit = { id: 'visit', patientId: 'patient', branchId: 'A', doctorId: null, visitDate: '2035-01-01T10:00', visitType: 'Treatment Session', performedByUserId: 'nurse', performedByNameSnapshot: 'Original Nurse', performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse' };
    await f.start(); await f.loaded(); await f.change('visit-branch', 'B'); assert.equal(f.node('visit-performed-by').props.value, '');
    assert.ok(!text(f.node('visit-performed-by')).includes('Original Nurse')); await f.save(); assert.ok(!f.latestSave());
  });
  await test('VisitForm', 'historical missing performer retains snapshot and assistants on unrelated edit', async f => {
    f.props.appointment = undefined; f.props.visit = { id: 'visit', patientId: 'patient', branchId: 'A', doctorId: null, visitDate: '2035-01-01T10:00', visitType: 'Treatment Session', performedByUserId: 'deleted', performedByNameSnapshot: 'Historical Performer', performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse', assistingStaffText: 'Historical assistant' };
    await f.start(); await f.loaded(); assert.ok(text(f.node('visit-performed-by')).includes('Historical Performer'));
    await f.change('visit-notes', 'Unrelated clinical edit'); await f.save(); const payload = JSON.parse(f.latestSave()!.init.body);
    assert.ok(!Object.hasOwn(payload, 'performedByUserId') && !Object.hasOwn(payload, 'assistingStaffText'));
  });
  await test('VisitForm', 'legacy doctor-only edit does not stamp new performer fields', async f => {
    f.props.appointment = undefined; f.props.visit = { id: 'legacy', patientId: 'patient', branchId: 'A', doctorId: 'doctor', visitDate: '2035-01-01T10:00', visitType: 'Follow-up' };
    await f.start(); await f.loaded(); await f.save(); assert.ok(!Object.hasOwn(JSON.parse(f.latestSave()!.init.body), 'performedByUserId'));
  });
  await test('VisitForm', 'unchanged imported long assistant text remains editable and omitted', async f => {
    f.props.appointment = undefined; f.props.visit = { id: 'legacy', patientId: 'patient', branchId: 'A', doctorId: 'doctor', visitDate: '2035-01-01T10:00', visitType: 'Follow-up', assistingStaffText: '  Historical '.repeat(60) };
    await f.start(); await f.loaded(); await f.change('visit-notes', 'Other clinical note'); await f.save();
    assert.ok(f.latestSave()); assert.ok(!Object.hasOwn(JSON.parse(f.latestSave()!.init.body), 'assistingStaffText'));
  });
  await test('VisitForm', 'new assistant text over limit is rejected', async f => {
    await f.start(); await f.loaded(); await f.change('visit-performed-by', 'nurse'); await f.change('visit-assisting-staff', 'x'.repeat(501)); await f.save();
    assert.ok(!f.latestSave()); assert.ok(text(f.renderer.tree).includes('500 characters'));
  });
  await test('VisitForm', 'explicit assistant clearing is included', async f => {
    f.props.appointment = undefined; f.props.visit = { id: 'visit', patientId: 'patient', branchId: 'A', doctorId: 'doctor', visitDate: '2035-01-01T10:00', visitType: 'Follow-up', assistingStaffText: 'Old assistant' };
    await f.start(); await f.loaded(); await f.change('visit-assisting-staff', ''); await f.save(); assert.equal(JSON.parse(f.latestSave()!.init.body).assistingStaffText, '');
  });
  for (const response of [200, 401, 403, 409]) for (const change of ['scope', 'logout', 'unmount']) await test('VisitForm', `late new-field save ${response} discarded after ${change}`, async f => {
    await f.start(); await f.loaded(); await f.change('visit-performed-by', 'nurse'); await f.change('visit-assisting-staff', 'Old scope assistants'); await f.save(); const old = f.latestSave()!;
    if (change === 'scope') f.scope(); if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); } if (change === 'unmount') f.stop();
    old.deliver(response === 200 ? { id: 'visit' } : { error: 'OLD_SCOPE_ERROR' }, response); await f.settle();
    assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    assert.ok(!text(f.renderer.tree).includes('OLD_SCOPE_ERROR')); if (change !== 'unmount') assert.ok(!find(f.renderer.tree, node => node.props?.value === 'Old scope assistants'));
  });
  for (const response of [401, 403]) await test('VisitForm', `current performer save denial ${response} clears protected workspace`, async f => {
    await f.start(); await f.loaded(); await f.change('visit-performed-by', 'nurse'); await f.save(); f.latestSave()!.deliver({ error: 'Current scope denial' }, response); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.ok(!find(f.renderer.tree, node => node.props?.id === 'visit-performed-by'));
  });
  await test('UserOperationalDetails', 'operational save excludes access-bearing designation', async f => {
    await f.start(); assert.ok(!find(f.renderer.tree, node => node.type === 'select'));
    assert.ok(text(f.renderer.tree).includes('Module Access'));
    f.button('Save user details').props.onClick(); await f.settle();
    const payload = JSON.parse(f.latestSave()!.init.body);
    for (const field of ['staffDesignation', 'role', 'permissionOverrides', 'assignedBranches', 'accessRevision']) assert.ok(!Object.hasOwn(payload.operations[0].data, field));
  });
  await test('UserPermissionEditor', 'designation uses revisioned access API and updates inherited defaults', async f => {
    await f.start(); const select = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Staff designation'); assert.ok(select);
    assert.ok(text(select).includes('Nurse') && text(select).includes('Medical Staff') && text(select).includes('Reception/Admin Staff'));
    select.props.onChange({ target: { value: 'Medical Staff' } }); await f.settle();
    const request = f.latestSave()!; assert.equal(request.url, '/api/users/nurse/access');
    assert.deepEqual(JSON.parse(request.init.body), { expectedAccessRevision: 3, staffDesignation: 'Medical Staff' });
    request.deliver({ id:'nurse', accessRevision:4, staffDesignation:'Medical Staff', permissionOverrides:{} }); await f.settle();
    assert.equal(f.saves,1); assert.ok(text(f.renderer.tree).includes('Staff designation and inherited access saved'));
    const create = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Create Visits permission');
    assert.ok(text(create).replace(/\s+/g, ' ').includes('Inherited — Allow')); assert.equal(f.renderer.lateSetters,0);
  });
  await test('UserPermissionEditor', 'late designation reply preserves a newer target revision', async f=>{
    await f.start(); find(f.renderer.tree,node=>node.props?.['aria-label']==='Staff designation').props.onChange({target:{value:'Medical Staff'}}); await f.settle();
    const old=f.latestSave()!; f.props.target={...f.props.target,staffDesignation:'Reception/Admin Staff',accessRevision:5}; f.render(); await f.settle();
    old.deliver({id:'nurse',staffDesignation:'Medical Staff',accessRevision:4,permissionOverrides:{}}); await f.settle();
    assert.equal(f.saves,0); assert.equal(f.props.target.staffDesignation,'Reception/Admin Staff'); assert.ok(text(f.renderer.tree).includes('current designation has been retained'));
  });
  await test('UserPermissionEditor', 'late permission Allow cannot replace a newer designation, branch scope and Deny', async f => {
    await f.start();
    find(f.renderer.tree, node => node.props?.['aria-label'] === 'Edit Visits permission').props.onChange({ target: { value: 'allow' } });
    await f.settle();
    const old = f.latestSave()!;
    assert.deepEqual(JSON.parse(old.init.body), { expectedAccessRevision: 3, permissionChanges: { 'visits.edit': 'allow' } });
    const newerTarget = { ...f.props.target, staffDesignation: 'Reception/Admin Staff', assignedBranches: ['B'],
      accessRevision: 5, permissionOverrides: { 'visits.edit': 'deny' } };
    f.props.target = newerTarget; f.render(); await f.settle();
    old.deliver({ id: 'nurse', accessRevision: 4, permissionOverrides: { 'visits.edit': 'allow' } });
    await f.settle();
    assert.equal(f.saves, 0, 'obsolete results must not reach the parent merge');
    assert.deepEqual(f.props.target, newerTarget, 'retain the newer authoritative profile exactly');
    assert.equal(find(f.renderer.tree, node => node.props?.['aria-label'] === 'Edit Visits permission').props.value, 'deny');
    assert.ok(!text(f.renderer.tree).includes('Module access saved.'));
    assert.ok(text(f.renderer.tree).includes('current permissions have been retained'));
    assert.equal(f.renderer.lateSetters, 0);
  });
  for (const revision of [3, 4]) await test('UserPermissionEditor', 'current permission save remains accepted at displayed revision ' + revision, async f => {
    await f.start();
    find(f.renderer.tree, node => node.props?.['aria-label'] === 'Edit Visits permission').props.onChange({ target: { value: 'deny' } });
    await f.settle(); const request = f.latestSave()!;
    if (revision === 4) {
      f.props.target = { ...f.props.target, accessRevision: 4, permissionOverrides: { 'visits.edit': 'deny' } };
      f.render(); await f.settle();
    }
    request.deliver({ id: 'nurse', accessRevision: 4, permissionOverrides: { 'visits.edit': 'deny' } });
    await f.settle();
    assert.equal(f.saves, 1); assert.equal(f.props.target.accessRevision, 4);
    assert.equal(f.props.target.permissionOverrides['visits.edit'], 'deny');
    assert.ok(text(f.renderer.tree).includes('Module access saved.'));
  });
  for (const change of ['different target', 'archived target']) await test('UserPermissionEditor', 'pending permission save cannot update ' + change, async f => {
    await f.start();
    find(f.renderer.tree, node => node.props?.['aria-label'] === 'Edit Visits permission').props.onChange({ target: { value: 'allow' } });
    await f.settle(); const request = f.latestSave()!;
    f.props.target = { ...f.props.target, ...(change === 'different target' ? { id: 'medical' } : { isArchived: true }) };
    const currentTarget = f.props.target; f.render(); await f.settle();
    request.deliver({ id: 'nurse', accessRevision: 4, permissionOverrides: { 'visits.edit': 'allow' } });
    await f.settle(); assert.equal(f.saves, 0); assert.deepEqual(f.props.target, currentTarget);
  });
  for (const kind of ['self', 'delegated', 'archived']) await test('UserPermissionEditor', kind + ' cannot change medical designation', async f => {
    if(kind === 'self') f.props.target.id='admin';
    if(kind === 'delegated') f.props.actor={role:'manager',active:true,permissionOverrides:{'users.manage':'allow'}};
    if(kind === 'archived') f.props.target.isArchived=true;
    await f.start(); const select=find(f.renderer.tree,node=>node.props?.['aria-label']==='Staff designation');
    assert.equal(select.props.disabled,true); select.props.onChange({target:{value:'Nurse'}}); await f.settle(); assert.equal(f.requests.length,0);
  });
  for (const status of [403,409]) await test('UserPermissionEditor', 'designation '+status+' leaves old access unchanged', async f=>{
    await f.start(); find(f.renderer.tree,node=>node.props?.['aria-label']==='Staff designation').props.onChange({target:{value:'Medical Staff'}}); await f.settle();
    f.latestSave()!.deliver({error:'Designation save denied'},status); await f.settle();
    assert.equal(f.saves,0); assert.equal(f.props.target.staffDesignation,'Nurse'); assert.ok(text(f.renderer.tree).includes('Designation save denied'));
  });
  for(const id of ['nurse','medical']) await test('VisitForm', id+' completes linked Visit without explicit grants', async f=>{
    globals.servicesTestAuth.currentUser={uid:id,getRequestToken:async()=> 'synthetic'}; f.props.userRole='staff';
    await f.start(); await f.loaded(); await f.change('visit-performed-by',id); await f.save();
    const request=f.latestSave(); assert.ok(request);
    const payload=JSON.parse(request.init.body); assert.equal(payload.doctorId,null); assert.equal(payload.performedByUserId,id); assert.equal(payload.appointmentId,'booking');
    request.deliver({id:'completed'}); await f.settle(); assert.equal(f.saves,1); assert.equal(f.closes,1);
  });
  for(const id of ['nurse','medical','reception']) await test('AppointmentsDashboard', id+' appointment completion entry follows medical defaults', async f=>{
    const actor=users().find(user=>user.id===id)!; globals.servicesTestAuth.currentUser={uid:id,getRequestToken:async()=> 'synthetic'};
    globals.historyRows={ users:users(), branches:f.props.branches, patients:f.props.patients, visits:[], appointments:[{id:'booking',patientId:'patient',patientName:'Synthetic Patient',branchId:'A',doctorId:null,appointmentDate:'2035-01-01T10:00',visitType:'Treatment Session',status:'Arrived'}] };
    f.props={role:'staff',userProfile:actor,activeBranchId:'A'}; await f.start();
    const button=find(f.renderer.tree,node=>node.type==='button'&&text(node).trim()==='Create visit');
    if(id==='reception') assert.ok(!button);
    else { assert.ok(button); button.props.onClick(); await f.settle(); assert.ok(text(f.renderer.tree).includes('Add visit')); assert.equal(f.node('visit-doctor').props.value,''); }
  });
  for(const id of ['nurse','medical','reception']) await test('VisitHistoryDashboard', id+' Visit actions follow medical defaults', async f=>{
    const actor=users().find(user=>user.id===id)!; globals.servicesTestAuth.currentUser={uid:id,getRequestToken:async()=> 'synthetic'};
    globals.historyRows={users:users(),branches:f.props.branches,patients:f.props.patients,appointments:[],visits:[{id:'visit',patientId:'patient',patientName:'Synthetic Patient',branchId:'A',doctorId:null,visitDate:'2035-01-01T10:00',performedByUserId:id,performedByNameSnapshot:actor.fullName,performedByRoleSnapshot:'staff',performedByDesignationSnapshot:actor.staffDesignation,status:'Completed'}]};
    f.props={db:{},role:'staff',userProfile:actor,activeBranchId:'A'}; await f.start();
    const add=find(f.renderer.tree,node=>node.type==='button'&&text(node).trim()==='Add visit');
    const edit=find(f.renderer.tree,node=>node.props?.['aria-label']==='Edit visit for Synthetic Patient');
    if(id==='reception'){ assert.ok(!add); assert.ok(!edit); }
    else { assert.ok(add); assert.ok(edit); }
  });
  await test('UserOperationalDetails', 'ordinary Staff receives no designation management control', async f => {
    f.props.actor = users().find(user => user.id === 'ordinary'); await f.start(); assert.equal(f.renderer.tree, null); assert.equal(f.requests.length, 0);
  });
  await test('UserOperationalDetails', 'Doctor profile has no Staff designation selector', async f => {
    f.props.target = users().find(user => user.id === 'doctor'); await f.start(); assert.ok(!find(f.renderer.tree, node => node.type === 'select'));
  });
  await test('PatientAppointments', 'unassigned appointment card and details suppress a stale historical doctorName', async f => {
    f.props = { patientId: 'patient', users: users(), branches: f.props.branches, appointments: [{ id: 'unassigned', patientId: 'patient', branchId: 'A', doctorId: null, doctorName: 'Former assigned doctor', appointmentDate: '2035-01-01T10:00', visitType: 'Treatment Session', status: 'Scheduled' }] };
    await f.start(); assert.ok(text(f.renderer.tree).includes('Unassigned') && !text(f.renderer.tree).includes('Former assigned doctor'));
    find(f.renderer.tree, node => node.props?.onClick && text(node).includes('Unassigned')).props.onClick(); await f.settle();
    assert.ok(text(f.renderer.tree).split('Unassigned').length >= 3 && !text(f.renderer.tree).includes('Former assigned doctor')); assert.equal(f.requests.length, 0);
  });
  await test('CalendarView', 'calendar event tooltip uses Unassigned and retains existing appointment identity', async f => {
    const appointment = { id: 'booking', patientName: 'Synthetic Patient', doctorId: null, doctorName: 'Former assigned doctor', appointmentDate: '2035-01-01T10:00', visitType: 'Treatment Session', status: 'Scheduled' };
    f.props = { appointments: [appointment], onSelectEvent() {} }; await f.start();
    const calendar = find(f.renderer.tree, node => node.props?.['data-controlled-calendar']); assert.ok(calendar);
    assert.ok(calendar.props.events[0].tooltip.includes('Doctor: Unassigned') && !calendar.props.events[0].tooltip.includes('Former assigned doctor'));
    assert.equal(calendar.props.events[0].resource, appointment); assert.equal(calendar.props.tooltipAccessor, 'tooltip');
  });
  const historyVisit = (extra: any = {}) => ({ id: 'visit', patientId: 'patient', patientName: 'Synthetic Patient', branchId: 'A', doctorId: 'doctor', visitDate: '2035-01-01T10:00', visitType: 'Treatment Session', status: 'Completed',
    performedByUserId: 'nurse', performedByNameSnapshot: 'Historical Original Nurse', performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse', assistingStaffText: 'Synthetic Assistant One, Synthetic Assistant Two', createdBy: 'Synthetic Recording Admin', ...extra });
  await test('PatientTimeline', 'timeline and details preserve original performer despite renamed account and separate author/assistants', async f => {
    f.props = { patientId: 'patient', branches: f.props.branches, users: users().map(user => user.id === 'nurse' ? { ...user, fullName: 'RENAMED_DIRECTORY_PERSON' } : user), visits: [historyVisit()] };
    await f.start(); assert.ok(text(f.renderer.tree).includes('Historical Original Nurse') && !text(f.renderer.tree).includes('RENAMED_DIRECTORY_PERSON'));
    find(f.renderer.tree, node => node.props?.onClick && text(node).includes('Historical Original Nurse')).props.onClick(); await f.settle();
    const detail = text(f.renderer.tree); assert.ok(detail.includes('Performed by') && detail.includes('Recorded by') && detail.includes('Synthetic Recording Admin'));
    assert.ok(detail.includes('Assisting staff') && detail.includes('Synthetic Assistant One, Synthetic Assistant Two'));
    assert.equal(f.requests.length, 0);
  });
  await test('PatientTimeline', 'legacy Visit is labelled Recorded doctor without inferring actual performer', async f => {
    f.props = { patientId: 'patient', branches: f.props.branches, users: [], visits: [historyVisit({ performedByUserId: undefined, performedByNameSnapshot: undefined, doctorName: 'Historical Recorded Doctor', assistingStaffText: undefined })] };
    await f.start(); assert.ok(text(f.renderer.tree).includes('Recorded doctor') && text(f.renderer.tree).includes('Historical Recorded Doctor'));
    assert.ok(!text(f.renderer.tree).includes('Performed by')); assert.equal(f.requests.length, 0);
  });
  await test('VisitHistoryDashboard', 'Visit history searches retained performer and shows author and assistants separately', async f => {
    globals.historyRows = { visits: [historyVisit()], appointments: [], patients: f.props.patients, branches: f.props.branches, users: users().filter(user => user.id !== 'nurse') };
    f.props = { db: {}, role: 'admin', userProfile: users()[0] }; await f.start();
    const search = find(f.renderer.tree, node => node.type === 'input' && node.props?.placeholder?.includes('Search')); assert.ok(search);
    search.props.onChange({ target: { value: 'Historical Original Nurse' } }); await f.settle(); assert.ok(text(f.renderer.tree).includes('Historical Original Nurse'));
    f.button('View details').props.onClick(); await f.settle(); const detail = text(f.renderer.tree);
    assert.ok(detail.includes('Performed by') && detail.includes('Recorded by') && detail.includes('Synthetic Recording Admin'));
    assert.ok(detail.includes('Assisting staff') && detail.includes('Synthetic Assistant One, Synthetic Assistant Two')); assert.equal(f.requests.length, 0);
  });
  await test('VisitHistoryDashboard', 'legacy Visit details preserve Recorded doctor attribution', async f => {
    globals.historyRows = { visits: [historyVisit({ performedByUserId: undefined, performedByNameSnapshot: undefined, doctorName: 'Historic Doctor', assistingStaffText: undefined })], appointments: [], patients: f.props.patients, branches: f.props.branches, users: [] };
    f.props = { db: {}, role: 'admin', userProfile: users()[0] }; await f.start(); f.button('View details').props.onClick(); await f.settle();
    assert.ok(text(f.renderer.tree).includes('Recorded doctor') && text(f.renderer.tree).includes('Historic Doctor')); assert.ok(!text(f.renderer.tree).includes('Performed by'));
  });
} finally { await harness.cleanup(); }
const failures = results.filter(result => !result.passed);
for (const failure of failures) console.error(failure.name + ': ' + failure.error);
console.log(`Appointment/Visit performer component checks: ${results.length - failures.length}/${results.length} scenarios passed (controlled components, not browser evidence)`);
if (failures.length) process.exitCode = 1;
