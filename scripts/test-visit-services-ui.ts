import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// Deterministic execution of the actual form/picker/adapters; controlled transport
// deliberately delivers responses after abort. This is not browser evidence.
const target = path.resolve(process.argv[2] || process.cwd());
const require = createRequire(path.join(target, 'package.json'));
const temporary = await mkdtemp(path.join(tmpdir(), 'vine-visit-services-ui-'));
await symlink(path.join(target, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
const globals = globalThis as any;
const saved = { fetch: globals.fetch, window: globals.window, document: globals.document, confirm: globals.confirm, alert: globals.alert };
globals.servicesTestAuth = { currentUser: { uid: 'doctor', email: 'doctor@example.invalid', getRequestToken: async () => 'synthetic' } };
globals.servicesTestInvalidations = 0; globals.appointmentInvalidationListeners = new Set();
globals.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: any) { callback(); } };
globals.document = { querySelector() { return null; } };
await writeFile(path.join(temporary, 'react.mjs'), `import actual from ${JSON.stringify(require.resolve('react'))};\nexport default actual;\n${['useState','useRef','useEffect','useLayoutEffect','useMemo'].map(name => `export const ${name}=(...args)=>globalThis.servicesTestHooks.${name}(...args);`).join('\n')}`);
await writeFile(path.join(temporary, 'platform.mjs'), 'export const auth=globalThis.servicesTestAuth; export const db={};');
await writeFile(path.join(temporary, 'data.mjs'), `export {captureProtectedRequestScope,protectedFetch} from "./foundation.mjs"; export function invalidateProtectedData(){globalThis.servicesTestInvalidations++;for(const f of globalThis.appointmentInvalidationListeners)f();}
export function subscribeProtectedDataInvalidation(f){globalThis.appointmentInvalidationListeners.add(f);return()=>globalThis.appointmentInvalidationListeners.delete(f);}
export const collection=(_db,name)=>({path:name});export const onSnapshot=(ref,cb)=>{cb({docs:(globalThis.historyRows?.[ref.path]||[]).map(row=>({id:row.id,data:()=>row}))});return()=>{};};export const query=()=>({}),limit=()=>({}),orderBy=()=>({}),where=()=>({}),getDocs=async()=>({docs:[]});`);
await writeFile(path.join(temporary, 'time.mjs'), "export const getActiveDatePrefix=()=> '2028-01-01';export const getActiveDateTimeInput=()=> '2028-01-01T09:00';");
await writeFile(path.join(temporary, 'utils.mjs'), 'export const formatDateTime=value=>value;');
await writeFile(path.join(temporary, 'branches.mjs'), `export const getAccessibleBranches=b=>b;export function subscribeToSharedCollection(_db,name,cb){cb(globalThis.historyRows?.[name]||[]);return()=>{}};export function subscribeToBranchScopedCollection(_db,name,_field,_profile,cb){cb(globalThis.historyRows?.[name]||[]);return()=>{}}`);
await writeFile(path.join(temporary, 'attachments.mjs'), 'export default ()=>null;');
await writeFile(path.join(temporary, 'date.mjs'), 'export const CustomDatePicker=()=>null;');
const plugins = [{ name: 'controlled-appointments', setup(b: any) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(temporary, 'react.mjs') }));
  b.onResolve({ filter: /session$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /foundation\.mjs$/ }, () => ({ path: path.join(temporary, 'foundation.mjs'), external: true }));
  b.onResolve({ filter: /platform$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /dataClient$/ }, () => ({ path: path.join(temporary, 'data.mjs') }));
  b.onResolve({ filter: /utils\/timezone$/ }, () => ({ path: path.join(temporary, 'time.mjs') }));
  b.onResolve({ filter: /^\.\.\/utils$/ }, () => ({ path: path.join(temporary, 'utils.mjs') }));
  b.onResolve({ filter: /utils\/branchAccess$/ }, () => ({path:path.join(temporary,'branches.mjs')}));
  b.onResolve({ filter: /FileAttachmentSection$/ }, () => ({path:path.join(temporary,'attachments.mjs')}));
  b.onResolve({ filter: /CustomDatePicker$/ }, () => ({ path: path.join(temporary, 'date.mjs') }));
} }];
await build({ entryPoints: [path.join(target, 'src/dataClient.ts')], outfile: path.join(temporary, 'foundation.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins });
await build({ entryPoints: [path.join(target, 'src/components/VisitForm.tsx')], outfile: path.join(temporary, 'form.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'transform', packages: 'external', plugins });
for(const name of ['PatientTimeline','VisitHistoryDashboard'])await build({entryPoints:[path.join(target,'src/components/'+name+'.tsx')],outfile:path.join(temporary,name+'.mjs'),bundle:true,platform:'node',format:'esm',jsx:'transform',packages:'external',plugins});
const {default:Timeline}=await import(pathToFileURL(path.join(temporary,'PatientTimeline.mjs')).href);
const {default:History}=await import(pathToFileURL(path.join(temporary,'VisitHistoryDashboard.mjs')).href);
const { default: Form } = await import(pathToFileURL(path.join(temporary, 'form.mjs')).href);
const flush = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
type Frame = { hooks: any[]; cursor: number; mounted: boolean };
class Renderer {
  frames = new Map<string, Frame>(); visited = new Set<string>(); frame!: Frame;
  layouts: (() => void)[] = []; passives: (() => void)[] = []; dirty = false; lateSetters = 0; tree: any;
  constructor(public component:any = Form) {
    const effect = (run: () => any, deps: any[], layout: boolean) => {
      const frame=this.frame, i=frame.cursor++, previous=frame.hooks[i];
      if (!previous || deps.some((v,j)=>!Object.is(v,previous.deps[j]))) {
        const next={deps,cleanup:undefined,layout};frame.hooks[i]=next;
        (layout?this.layouts:this.passives).push(()=>{if(frame.mounted){previous?.cleanup?.();next.cleanup=run();}});
      }
    };
    globals.servicesTestHooks = {
      useMemo: (callback:any) => callback(),
      useState: (initial: any) => { const frame=this.frame,i=frame.cursor++; if(!(i in frame.hooks)) frame.hooks[i]={value:typeof initial==='function'?initial():initial}; return [frame.hooks[i].value,(value:any)=>{if(!frame.mounted){this.lateSetters++;return;}frame.hooks[i].value=typeof value==='function'?value(frame.hooks[i].value):value;this.dirty=true;}]; },
      useRef: (initial:any) => { const frame=this.frame,i=frame.cursor++;if(!(i in frame.hooks))frame.hooks[i]={current:initial};return frame.hooks[i]; },
      useEffect: (run:any,deps:any[])=>effect(run,deps,false), useLayoutEffect: (run:any,deps:any[])=>effect(run,deps,true),
    };
  }
  expand(node:any,location:string):any {
    if(Array.isArray(node))return node.map((child,i)=>this.expand(child,location+'/'+i));
    if(!node||typeof node!=='object'||!node.props)return node;
    if(typeof node.type==='function') {
      const key=location+':'+node.type.name+':'+(node.key??'');this.visited.add(key);
      let frame=this.frames.get(key);if(!frame){frame={hooks:[],cursor:0,mounted:true};this.frames.set(key,frame);}
      this.frame=frame;frame.cursor=0;
      return this.expand(node.type(node.props),key);
    }
    return {...node,props:{...node.props,children:this.expand(node.props.children,location+'/children')}};
  }
  render(props:any) {
    this.visited.clear();this.dirty=false;
    this.tree=this.expand({type:this.component,props},'root');
    for(const [key,frame] of this.frames)if(!this.visited.has(key)){frame.mounted=false;frame.hooks.forEach(h=>{if(h?.cleanup)h.layout?h.cleanup():this.passives.push(h.cleanup);});this.frames.delete(key);}
    this.layouts.splice(0).forEach(run=>run());return this.tree;
  }
  unmount(){for(const frame of this.frames.values()){frame.mounted=false;frame.hooks.forEach(h=>h?.cleanup?.());}this.frames.clear();this.passives=[];}
}
function find(node:any, predicate:(node:any)=>boolean):any {
  if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}}
  else if(node&&typeof node==='object'){if(predicate(node))return node;return find(node.props?.children,predicate);}
}
function text(node:any):string {return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):String(node??'');}const service = (id='priced', mode='priced', version=1) => ({ id, name:'Synthetic '+id, version, active:true, default_duration_minutes:45,
  branches:[{id:'A',operationallyAvailable:true,effectivePrice:{mode,amount:mode==='priced'?'123.45':mode==='free'?'0.00':null}},{id:'B',operationallyAvailable:true,effectivePrice:{mode,amount:mode==='priced'?'123.45':mode==='free'?'0.00':null}}] });
class Fixture {
  renderer = new Renderer(); requests: { url: string; init: any; deliver: (body: any, status?: number) => void; fail: () => void }[] = [];
  saves = 0; closes = 0;
  autoBookingRead = true; freshBooking: any = undefined;
  props: any = { patients:[{id:'patient',name:'Synthetic patient'}],branches:[{id:'A',branchName:'A',status:'Active'},{id:'B',branchName:'B',status:'Active'}],
    users:[{id:'doctor',email:'doctor@example.invalid',role:'doctor',active:true,assignedBranches:['A','B']},{id:'provider',role:'doctor',active:true,assignedBranches:['A','B']}],
    visit:{id:'visit',patientId:'patient',doctorId:'doctor',branchId:'A',visitDate:'2029-01-01T10:00',visitType:'Initial Consultation',status:'Completed',treatmentService:'  Legacy custom care  '},userRole:'doctor',
    appointments:[],onSave:()=>{this.saves++;},onClose:()=>{this.closes++;} };
  constructor(){globals.servicesTestInvalidations=0;globals.servicesTestAuth.currentUser={uid:'doctor',email:'doctor@example.invalid',getRequestToken:async()=> 'synthetic'};
    globals.fetch=(url:string,init:any)=>url === '/api/records/patients/patient/treatment-ledger' ? Promise.resolve(new Response(JSON.stringify({ patientId:'patient', purchases:[], events:[], activeVisitUsages:[], branches:[], capabilities:{canPurchase:false,canAdjust:false,canEditOrNumber:false}, redemptionPolicy:'authorized_branches' }))) : new Promise((resolve,reject)=> {
      const request = {url,init,deliver:(body:any,status=200)=>{ const receipt = status === 200 && url.startsWith('/api/records/visits') && body?.id && !Object.hasOwn(body, 'visitVersion') ? { ...body, visitVersion: init.method === 'PATCH' ? Number(JSON.parse(init.body).expectedVisitVersion) + 1 : 1 } : body; resolve(new Response(JSON.stringify(receipt),{status})); },fail:()=>reject(new TypeError('Synthetic network failure'))};
      this.requests.push(request);
      const query = url === '/api/data/query' ? JSON.parse(init.body) : null;
      if (this.autoBookingRead && query?.path?.startsWith('appointments/')) {
        const record = this.freshBooking === undefined ? this.props.appointment : this.freshBooking;
        request.deliver({document:{id:query.path.slice('appointments/'.length),data:record}});
      }
    });}
  render(){this.renderer.render(this.props);}
  async settle(){for(let i=0;i<8;i++){this.renderer.passives.splice(0).forEach(run=>run());await flush();if(this.renderer.dirty)this.render();}}
  async start(){this.render();await this.settle();}
  node(id:string){const node=find(this.renderer.tree,(n:any)=>n.props?.id===id);assert.ok(node,'missing '+id);return node;}
  button(label:string){const node=find(this.renderer.tree,(n:any)=>n.type==='button'&&text(n).trim()===label);assert.ok(node,'missing '+label);return node;}
  latestBookingRead(){return this.requests.filter(r=>r.url === '/api/data/query' && JSON.parse(r.init.body).path?.startsWith('appointments/')).at(-1)!;}
  latestGet(){return this.requests.filter(r=>r.init.method==='GET').at(-1)!;}
  latestSave(){return this.requests.filter(r=>r.url.startsWith('/api/records/')&&(r.init.method==='PATCH'||r.init.method==='POST')).at(-1)!;}
  async loaded(rows=[service(),service('free','free'),service('unpriced','unpriced')],total=rows.length){this.requests.filter(r=>r.init.method==='GET'&&r.url.startsWith('/api/services?')).at(-1)!.deliver({services:rows,total});await this.settle();}
  async select(id='priced'){this.node('visit-service').props.onChange({target:{value:id}});await this.settle();}
  async branch(id='B'){this.node('visit-branch').props.onChange({target:{value:id}});this.render();await this.settle();}
  async save(){find(this.renderer.tree,(n:any)=>n.type==='form').props.onSubmit({preventDefault(){}});await this.settle();}
  scope(){this.props={...this.props,users:this.props.users.map((u:any)=>u.id==='doctor'?{...u,assignedBranches:['A']}:u),branches:this.props.branches.filter((b:any)=>b.id==='A')};this.render();}
  stop(){this.renderer.unmount();}
}
// A minimal hook runner executes production handlers; effects and keyed lifetime
// are modeled explicitly, including the interval before passive cleanup.
const results: { name: string; passed: boolean; error?: string }[]=[];
async function test(name:string,run:(f:Fixture)=>Promise<void>){const f=new Fixture();try{await run(f);results.push({name,passed:true});}catch(error:any){results.push({name,passed:false,error:error.message});}finally{f.stop();}}
try {
  const visitWriteCount = (f: Fixture) => f.requests.filter(r => r.url.startsWith('/api/records/visits') && ['POST', 'PATCH'].includes(r.init.method)).length;
  const savedRecord = (f: Fixture, extra: any = {}) => ({ ...f.props.visit, id: 'visit', visitVersion: 2, notes: 'LATEST_SAVED_NOTES', diagnosis: 'LATEST_SAVED_DIAGNOSIS', ...extra });
  const latestReview = (f: Fixture) => f.requests.filter(r => r.url === '/api/data/query').at(-1)!;
  const triggerVisitConflict = async (f: Fixture) => {
    await f.start(); await f.loaded([]); f.node('visit-notes').props.onChange({ target: { value: 'MY_UNSAVED_NOTES' } }); await f.settle(); await f.save();
    f.latestSave().deliver({ error: 'Visit changed. Your draft has been kept.', code: 'VISIT_VERSION_CHANGED' }, 409); await f.settle();
  };
  await test('legacy Visit sends opened version zero without inventing record metadata', async f => {
    await f.start(); await f.loaded([]); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.expectedVisitVersion, 0); assert.ok(!Object.hasOwn(body, 'visitVersion'));
  });
  await test('live Visit polling cannot rebase or replace unsaved notes', async f => {
    f.props.visit = { ...f.props.visit, visitVersion: 4 }; await f.start(); await f.loaded([]);
    f.node('visit-notes').props.onChange({ target: { value: 'MY_UNSAVED_NOTES' } }); await f.settle();
    f.props.visit = { ...f.props.visit, visitVersion: 5, notes: 'NEW_SERVER_NOTES' }; f.render(); await f.settle();
    assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES'); await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).expectedVisitVersion, 4);
  });
  for (const code of ['VISIT_VERSION_CHANGED', 'VISIT_VERSION_REQUIRED', 'VISIT_VERSION_INVALID']) await test(code + ' preserves all clinical draft values and blocks blind retry', async f => {
    await f.start(); await f.loaded([]);
    for (const id of ['visit-notes', 'visit-diagnosis', 'visit-plan', 'visit-concern']) f.node(id).props.onChange({ target: { value: 'DRAFT_' + id } }); await f.settle(); await f.save();
    f.latestSave().deliver({ error: 'Visit needs review', code }, 409); await f.settle();
    for (const id of ['visit-notes', 'visit-diagnosis', 'visit-plan', 'visit-concern']) assert.equal(f.node(id).props.value, 'DRAFT_' + id);
    assert.equal(f.button('Save changes').props.disabled, true); await f.save(); assert.equal(visitWriteCount(f), 1); assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(globals.servicesTestInvalidations, 0);
  });
  await test('Review saved Visit shows latest notes without replacing or rebasing the draft', async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle();
    assert.deepEqual(JSON.parse(latestReview(f).init.body), { path: 'visits/visit', kind: 'document' });
    latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f) } }); await f.settle();
    assert.match(text(f.renderer.tree), /LATEST_SAVED_NOTES/); assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES');
    f.button('Reload saved Visit').props.onClick(); await f.settle(); f.button('Keep my draft').props.onClick(); await f.settle();
    assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES'); assert.equal(f.button('Save changes').props.disabled, true); assert.equal(visitWriteCount(f), 1);
  });
  await test('confirmed reload fetches fresh state before replacing the draft and its opened version', async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle(); latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f) } }); await f.settle();
    f.button('Reload saved Visit').props.onClick(); await f.settle(); f.button('Discard draft and reload').props.onClick(); await f.settle();
    assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES');
    latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f, { visitVersion: 3, notes: 'NEWER_SAVED_NOTES' }) } }); await f.settle(); await f.loaded([]);
    assert.equal(f.node('visit-notes').props.value, 'NEWER_SAVED_NOTES'); assert.ok(!text(f.renderer.tree).includes('MY_UNSAVED_NOTES'));
    f.node('visit-notes').props.onChange({ target: { value: 'REVIEWED_NEW_EDIT' } }); await f.settle(); await f.save();
    assert.equal(JSON.parse(f.latestSave().init.body).expectedVisitVersion, 3); f.latestSave().deliver({ id: 'visit', visitVersion: 4 }); await f.settle(); assert.equal(f.saves, 1); assert.equal(f.closes, 1);
  });
  for (const failure of [503, 'network', 'missing'] as const) await test('confirmed reload ' + failure + ' never discards unsaved notes', async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle(); latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f) } }); await f.settle();
    f.button('Reload saved Visit').props.onClick(); await f.settle(); f.button('Discard draft and reload').props.onClick(); await f.settle();
    if (failure === 'network') latestReview(f).fail(); else latestReview(f).deliver(failure === 'missing' ? { document: { id: 'visit', data: null } } : { error: 'Review unavailable' }, failure === 503 ? 503 : 200); await f.settle();
    assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES'); assert.equal(f.button('Save changes').props.disabled, true); assert.equal(f.closes, 0); assert.equal(globals.servicesTestInvalidations, 0);
  });
  for (const status of [200, 401, 403]) for (const change of ['branch', 'scope', 'logout', 'invalidate', 'unmount']) await test('late Visit review ' + status + ' cannot affect ' + change, async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle(); const old = latestReview(f);
    if (change === 'branch') await f.branch('B'); if (change === 'scope') f.scope(); if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); } if (change === 'invalidate') { for (const fn of globals.appointmentInvalidationListeners) fn(); f.render(); } if (change === 'unmount') f.stop();
    old.deliver(status === 200 ? { document: { id: 'visit', data: savedRecord(f, { notes: 'STALE_PRIVATE_REVIEW' }) } } : { error: 'STALE_REVIEW_DENIAL' }, status); await flush();
    assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0); if (change !== 'unmount') { await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /STALE_PRIVATE_REVIEW|STALE_REVIEW_DENIAL/); }
  });
  for (const status of [401, 403]) await test('current Visit review denial ' + status + ' invalidates normally', async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle(); latestReview(f).deliver({ error: 'Current review denied' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.match(text(f.renderer.tree), /Visit access changed/);
  });
  for (const change of ['branch', 'scope', 'logout', 'invalidate', 'unmount']) await test('old Visit version conflict cannot lock a new ' + change + ' workspace', async f => {
    await f.start(); await f.loaded([]); await f.save(); const old = f.latestSave();
    if (change === 'branch') await f.branch('B'); if (change === 'scope') f.scope(); if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); } if (change === 'invalidate') { for (const fn of globals.appointmentInvalidationListeners) fn(); f.render(); } if (change === 'unmount') f.stop();
    old.deliver({ error: 'STALE_RECORD_CONFLICT', code: 'VISIT_VERSION_CHANGED' }, 409); await flush(); assert.equal(f.renderer.lateSetters, 0); assert.equal(globals.servicesTestInvalidations, 0);
    if (change !== 'unmount') { await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /STALE_RECORD_CONFLICT/); }
  });
  await test('record-level conflict still blocks an obsolete save after same-scope Service intent changes', async f => {
    await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave(); await f.select('free');
    old.deliver({ error: 'Saved Visit changed', code: 'VISIT_VERSION_CHANGED' }, 409); await f.settle(); assert.equal(f.node('visit-service').props.value, 'free'); assert.equal(f.button('Save changes').props.disabled, true); await f.save(); assert.equal(visitWriteCount(f), 1);
  });
  await test('acknowledged saved version is used for an unsaved newer Service intent', async f => {
    f.props.visit = { ...f.props.visit, visitVersion: 6 }; await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave(); await f.select('free'); old.deliver({ id: 'visit', visitVersion: 7 }); await f.settle(); await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).expectedVisitVersion, 7);
  });
  await test('missing version receipt keeps the created identity and prevents duplicate create', async f => {
    const original = f.props.visit; delete f.props.visit; f.props.appointment = { ...original, id: 'booking', appointmentDate: original.visitDate }; await f.start(); await f.loaded([]); await f.save();
    f.latestSave().deliver({ id: 'created-visit', visitVersion: undefined }); await f.settle(); assert.match(text(f.renderer.tree), /not its version/); await f.save(); assert.equal(visitWriteCount(f), 1); assert.equal(f.saves, 0);
    f.button('Review saved Visit').props.onClick(); await f.settle(); assert.equal(JSON.parse(latestReview(f).init.body).path, 'visits/created-visit');
  });
  for (const value of [undefined, -1, '1', 4]) await test('invalid edit version receipt preserves draft and blocks another save', async f => {
    await f.start(); await f.loaded([]); f.node('visit-notes').props.onChange({ target: { value: 'MY_UNSAVED_NOTES' } }); await f.settle(); await f.save();
    f.latestSave().deliver({ id: 'visit', visitVersion: value }); await f.settle();
    assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES'); assert.equal(f.button('Save changes').props.disabled, true);
    await f.save(); assert.equal(visitWriteCount(f), 1); assert.equal(f.closes, 0);
  });
  for (const extra of [{ visitVersion: 'broken' }, { branchId: 'unauthorized' }, { doctorId: 'another-doctor' }]) await test('confirmed reload cannot adopt invalid metadata or unauthorized saved context', async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle(); latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f) } }); await f.settle();
    f.button('Reload saved Visit').props.onClick(); await f.settle(); f.button('Discard draft and reload').props.onClick(); await f.settle();
    latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f, { ...extra, notes: 'DO_NOT_ADOPT' }) } }); await f.settle();
    assert.equal(f.node('visit-notes').props.value, 'MY_UNSAVED_NOTES'); assert.doesNotMatch(text(f.renderer.tree), /DO_NOT_ADOPT/);
    assert.equal(f.button('Save changes').props.disabled, true); assert.equal(f.closes, 0);
  });
  for (const status of [200, 401, 403]) for (const change of ['scope', 'logout', 'invalidate', 'unmount']) await test('late confirmed Visit reload ' + status + ' cannot replace a new ' + change + ' workspace', async f => {
    await triggerVisitConflict(f); f.button('Review saved Visit').props.onClick(); await f.settle(); latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f) } }); await f.settle();
    f.button('Reload saved Visit').props.onClick(); await f.settle(); f.button('Discard draft and reload').props.onClick(); await f.settle(); const old = latestReview(f);
    if (change === 'scope') f.scope(); if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); }
    if (change === 'invalidate') { for (const fn of globals.appointmentInvalidationListeners) fn(); f.render(); } if (change === 'unmount') f.stop();
    old.deliver(status === 200 ? { document: { id: 'visit', data: savedRecord(f, { notes: 'STALE_RELOAD_NOTES' }) } } : { error: 'STALE_RELOAD_DENIAL' }, status); await flush();
    assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    if (change !== 'unmount') { await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /STALE_RELOAD_NOTES|STALE_RELOAD_DENIAL/); }
  });
  await test('priced and Free selectable; unpriced excluded',async f=>{await f.start();await f.loaded();const options=text(f.node('visit-service'));assert.ok(options.includes('Synthetic priced')&&options.includes('Synthetic free'));assert.ok(!options.includes('Synthetic unpriced'));});
  await test('new selection sends only ID/version command; visit type preserved',async f=>{await f.start();await f.loaded();await f.select();await f.save();const body=JSON.parse(f.latestSave().init.body);assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});assert.equal(body.visitType,'Initial Consultation');assert.ok(!Object.hasOwn(body,'serviceNameSnapshot'));f.latestSave().deliver({id:'appointment'});await f.settle();assert.equal(f.saves,1);});
  await test('historical snapshot displayed and omitted on unrelated edit',async f=>{f.props.visit={...f.props.visit,serviceId:'historical',serviceNameSnapshot:'Recorded inactive name',serviceDurationMinutesSnapshot:20,serviceCatalogueVersion:7};await f.start();await f.loaded([]);f.node('visit-type').props.onChange({target:{value:'Follow-up'}});await f.settle();assert.ok(text(f.renderer.tree).includes('Recorded inactive name'));assert.equal(f.node('visit-service').props.value,'__recorded');await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('read-only snapshot uses no live catalogue lookup',async f=>{f.props.visit={...f.props.visit,signedAt:'2029-01-01'};f.props.visit={...f.props.visit,serviceId:'historical',serviceNameSnapshot:'Historic snapshot',serviceDurationMinutesSnapshot:25};await f.start();assert.equal(f.requests.length,0);assert.ok(text(f.renderer.tree).includes('Historic snapshot'));});
  await test('legacy booking has no Service command',async f=>{await f.start();await f.loaded();await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('explicit clear sends null',async f=>{await f.start();await f.loaded();await f.select();await f.select('__none');await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection,null);});
  await test('branch change clears selection and provider behavior remains',async f=>{await f.start();await f.loaded();await f.select();await f.branch();assert.equal(f.node('visit-service').props.value,'__none');assert.equal(f.node('visit-doctor').props.value,'doctor');await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('search pagination and retry use bounded branch-filtered request',async f=>{await f.start();assert.ok(f.latestGet().url.includes('branchId=A')&&f.latestGet().url.includes('pageSize=25'));await f.loaded([service()],60);f.button('Next').props.onClick();await f.settle();assert.ok(f.latestGet().url.includes('page=2'));f.latestGet().deliver({error:'Synthetic temporary failure'},503);await f.settle();assert.ok(text(f.renderer.tree).includes('Synthetic temporary failure'));f.button('Retry').props.onClick();await f.settle();await f.loaded();assert.ok(!text(f.renderer.tree).includes('Synthetic temporary failure'));});
  for(const status of [200,401,403])for(const change of ['branch','scope','logout','invalidate','unmount'])await test(`late catalogue ${status} discarded after ${change}`,async f=>{
    await f.start();const old=f.latestGet();
    if(change==='branch'){f.node('visit-branch').props.onChange({target:{value:'B'}});f.render();}
    if(change==='scope')f.scope();
    if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}
    if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}
    if(change==='unmount')f.stop();
    old.deliver(status===200?{services:[service('OLD_SCOPE_RESPONSE')],total:1}:{error:'OLD_SCOPE_DENIAL'},status);await flush();
    assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.renderer.lateSetters,0);if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_SCOPE_RESPONSE')&&!text(f.renderer.tree).includes('OLD_SCOPE_DENIAL'));}
  });
  for(const status of [200,401,403,409])for(const change of ['branch','scope','logout','invalidate','unmount'])await test(`late save ${status} cannot affect ${change} scope`,async f=>{
    await f.start();await f.loaded();await f.select();await f.save();const old=f.latestSave();
    if(change==='branch'){f.node('visit-branch').props.onChange({target:{value:'B'}});f.render();}if(change==='scope')f.scope();if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}if(change==='unmount')f.stop();
    old.deliver(status===200?{id:'appointment'}:{error:'OLD_SAVE_ERROR'},status);await flush();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.saves,0);assert.equal(f.closes,0);assert.equal(f.renderer.lateSetters,0);
    if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_SAVE_ERROR'));}
  });
  await test('current save version conflict stays visible and selection preserved',async f=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Service changed. Reload Services.',code:'SERVICE_VERSION_CHANGED'},409);await f.settle();assert.ok(text(f.renderer.tree).includes('Service changed'));assert.equal(f.node('visit-service').props.value,'priced');assert.equal(globals.servicesTestInvalidations,0);});
  for(const status of [401,403])await test(`current save denial ${status} invalidates protected scope`,async f=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Current denial'},status);await f.settle();assert.equal(globals.servicesTestInvalidations,1);assert.ok(!find(f.renderer.tree,(n:any)=>n.props?.id==='visit-service'));assert.ok(text(f.renderer.tree).includes('Visit access changed'));});
  await test('current catalogue denial blocks reopening loop and clears protected form',async f=>{await f.start();f.latestGet().deliver({error:'Denied current branch'},403);await f.settle();assert.equal(globals.servicesTestInvalidations,1);assert.equal(f.requests.length,1);assert.ok(text(f.renderer.tree).includes('Visit access changed'));});
  await test('narrowing access removes historical Service from unauthorized branch',async f=>{f.props.visit={...f.props.visit,branchId:'B',serviceId:'historic',serviceNameSnapshot:'REMOVED_BRANCH_SNAPSHOT'};await f.start();f.scope();assert.ok(!text(f.renderer.tree).includes('REMOVED_BRANCH_SNAPSHOT'));await f.settle();assert.ok(text(f.renderer.tree).includes('Visit access changed'));});
  await test('scope change during request-token acquisition prevents old save fetch',async f=>{await f.start();await f.loaded();await f.select();let deliver!:any;globals.servicesTestAuth.currentUser.getRequestToken=()=>new Promise(resolve=>deliver=resolve);await f.save();f.scope();deliver('synthetic');await f.settle();assert.ok(!f.latestSave());});

  const historical=(f:Fixture)=>{f.props.visit={...f.props.visit,serviceId:'historical',serviceNameSnapshot:'Recorded inactive name',serviceDurationMinutesSnapshot:20,serviceCatalogueVersion:7};};
  const hasButton=(f:Fixture,label:string)=>Boolean(find(f.renderer.tree,(n:any)=>n.type==='button'&&text(n).trim()===label));
  const reload=async(f:Fixture)=>{f.button('Reload Services to review changes').props.onClick();await f.settle();assert.ok(f.latestGet().url.includes('/api/services/priced?branchId=A'));};
  const conflict=async(f:Fixture)=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Service changed',code:'SERVICE_VERSION_CHANGED'},409);await f.settle();};
  const changePendingIntent = async (f: Fixture, change: 'different' | 'newer') => {
    if (change === 'different') await f.select('free');
    else {
      await reload(f);
      f.latestGet().deliver(service('priced', 'priced', 2));
      await f.settle();
      f.button('Use reviewed Service').props.onClick();
      await f.settle();
    }
  };
  // Same production handlers/transport as the original suite. The old candidate
  // remains available as target argv[2] for negative-control execution.
  for (const change of ['different', 'newer'] as const) {
    for (const response of [409, 503, 422, 'network', 200] as const) {
      await test(`old save ${response} preserves ${change} performed-Service intent`, async f => {
        await f.start(); await f.loaded([service(), service('free', 'free', 3)]);
        await f.select(); await f.save(); const old = f.latestSave();
        assert.deepEqual(JSON.parse(old.init.body).serviceSelection, { serviceId: 'priced', expectedVersion: 1 });
        await changePendingIntent(f, change);
        if (response === 'network') old.fail();
        else old.deliver(response === 200 ? { id: 'visit' } : { error: 'OBSOLETE_SAVE_ERROR', code: response === 409 ? 'SERVICE_VERSION_CHANGED' : undefined }, response);
        await f.settle();
        assert.equal(f.node('visit-service').props.value, change === 'different' ? 'free' : 'priced');
        assert.ok(!text(f.renderer.tree).includes('(needs review)') && !text(f.renderer.tree).includes('OBSOLETE_SAVE_ERROR') && !text(f.renderer.tree).includes('Synthetic network failure'));
        assert.equal(f.button('Save changes').props.disabled, false);
        assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(globals.servicesTestInvalidations, 0);
        assert.equal(f.requests.filter(r => r.init.method === 'PATCH' || r.init.method === 'POST').length, 1);
        await f.save();
        assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, change === 'different' ? { serviceId: 'free', expectedVersion: 3 } : { serviceId: 'priced', expectedVersion: 2 });
        f.latestSave().deliver({ id: 'visit' }); await f.settle();
        assert.equal(f.saves, 1); assert.equal(f.closes, 1);
      });
    }
  }
  await test('old 409 after Service A-B-A does not overwrite the new intent revision', async f => {
    await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave();
    await f.select('free'); await f.select('priced');
    old.deliver({ error: 'OBSOLETE_SAVE_ERROR', code: 'SERVICE_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.button('Save changes').props.disabled, false);
    assert.ok(!text(f.renderer.tree).includes('(needs review)') && !text(f.renderer.tree).includes('OBSOLETE_SAVE_ERROR'));
    await f.save(); assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'priced', expectedVersion: 1 });
  });
  for (const response of [409, 200]) await test(`explicit removal survives old save ${response}`, async f => {
    await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave();
    f.button('Remove Service').props.onClick(); await f.settle();
    old.deliver(response === 200 ? { id: 'visit' } : { error: 'OBSOLETE_SAVE_ERROR', code: 'SERVICE_VERSION_CHANGED' }, response); await f.settle();
    assert.equal(f.node('visit-service').props.value, '__none'); assert.equal(f.saves, 0); assert.equal(f.closes, 0);
    assert.ok(!text(f.renderer.tree).includes('OBSOLETE_SAVE_ERROR')); assert.equal(f.button('Save changes').props.disabled, false);
    await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection, null);
  });
  for (const direction of ['unchanged-to-removed', 'selected-to-unchanged']) await test(`old 409 distinguishes ${direction} intent`, async f => {
    historical(f); await f.start(); await f.loaded();
    if (direction === 'selected-to-unchanged') await f.select();
    await f.save(); const old = f.latestSave();
    await f.select(direction === 'unchanged-to-removed' ? '__none' : '__recorded');
    old.deliver({ error: 'OBSOLETE_SAVE_ERROR', code: 'SERVICE_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.button('Save changes').props.disabled, false); assert.ok(!text(f.renderer.tree).includes('OBSOLETE_SAVE_ERROR'));
    await f.save(); const body = JSON.parse(f.latestSave().init.body);
    if (direction === 'unchanged-to-removed') assert.equal(body.serviceSelection, null);
    else assert.ok(!Object.hasOwn(body, 'serviceSelection'));
  });
  for (const response of [503, 422, 'network'] as const) await test(`current save ${response} remains visible and retryable`, async f => {
    await f.start(); await f.loaded(); await f.select(); await f.save();
    if (response === 'network') f.latestSave().fail(); else f.latestSave().deliver({ error: 'CURRENT_SAVE_ERROR' }, response);
    await f.settle(); assert.ok(text(f.renderer.tree).includes(response === 'network' ? 'Synthetic network failure' : 'CURRENT_SAVE_ERROR'));
    assert.equal(f.button('Save changes').props.disabled, false); assert.ok(!text(f.renderer.tree).includes('(needs review)'));
    assert.equal(globals.servicesTestInvalidations, 0); await f.save();
    assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'priced', expectedVersion: 1 });
  });
  for (const status of [401, 403]) await test(`same-scope denial ${status} still invalidates after Service intent changes`, async f => {
    await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave(); await f.select('free');
    old.deliver({ error: 'Current protected-scope denial' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.ok(text(f.renderer.tree).includes('Visit access changed'));
    assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-service'));
  });
  for (const linked of [false, true]) await test(`old successful ${linked ? 'linked' : 'walk-in'} create retains draft and next save updates the created Visit`, async f => {
    const original = f.props.visit; f.props.visit = undefined; f.props.defaultBranchId = 'A';
    if (linked) f.props.appointment = { ...original, id: 'booking', appointmentDate: original.visitDate };
    await f.start(); await f.loaded();
    assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-legacy-service'));
    if (!linked) {
      f.node('visit-patient').props.onChange({ target: { value: 'Synthetic patient' } }); await f.settle();
      find(f.renderer.tree, (n: any) => n.type === 'button' && text(n).includes('Synthetic patient')).props.onClick();
      f.node('visit-doctor').props.onChange({ target: { value: 'doctor' } }); await f.settle();
      f.button('10:00 AM').props.onClick(); await f.settle();
    }
    await f.select(); await f.save(); const old = f.latestSave(); assert.equal(old.init.method, 'POST');
    await f.select('free'); old.deliver({ id: 'created-visit' }); await f.settle();
    assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(f.node('visit-service').props.value, 'free');
    assert.ok(text(f.renderer.tree).includes('Your newer Service choice is still unsaved'));
    f.props.visits = [{ ...JSON.parse(old.init.body), id: 'created-visit', status: 'Completed' }];
    if (linked) f.props.appointment = { ...f.props.appointment, visitHistoryCreated: true };
    f.render(); await f.settle();
    assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-legacy-service'));
    await f.save();
    assert.equal(f.latestSave().url, '/api/records/visits/created-visit'); assert.equal(f.latestSave().init.method, 'PATCH');
    assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'free', expectedVersion: 1 });
    f.latestSave().deliver({ id: 'created-visit' }); await f.settle(); assert.equal(f.saves, 1); assert.equal(f.closes, 1);
  });
  await test('old success with newer Service skips follow-up side effects and keeps draft', async f => {
    f.props.visit = { ...f.props.visit, followUpRequired: true }; let prompts = 0;
    const previous = globals.confirm; globals.confirm = () => { prompts++; return true; };
    try {
      await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave(); await f.select('free');
      old.deliver({ id: 'visit' }); await f.settle(); assert.equal(prompts, 0); assert.equal(f.saves, 0); assert.equal(f.closes, 0);
      assert.equal(f.requests.filter(r => r.url.endsWith('/appointments')).length, 0);
    } finally { globals.confirm = previous; }
  });
  for (const status of [200, 503]) await test(`pending follow-up ${status} cannot close or alert over a newer Service draft`, async f => {
    f.props.visit = { ...f.props.visit, followUpRequired: true }; let alerts = 0;
    const previousConfirm = globals.confirm, previousAlert = globals.alert;
    globals.confirm = () => true; globals.alert = () => { alerts++; };
    try {
      await f.start(); await f.loaded(); await f.select(); await f.save(); f.latestSave().deliver({ id: 'visit' }); await f.settle();
      const followUp = f.latestSave(); assert.ok(followUp.url.endsWith('/appointments')); await f.select('free');
      followUp.deliver(status === 200 ? { id: 'follow-up' } : { error: 'OBSOLETE_FOLLOWUP_ERROR' }, status); await f.settle();
      assert.equal(alerts, 0); assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(f.node('visit-service').props.value, 'free');
      assert.equal(f.button('Save changes').props.disabled, false); assert.equal(globals.servicesTestInvalidations, 0);
      assert.ok(!text(f.renderer.tree).includes('OBSOLETE_FOLLOWUP_ERROR'));
    } finally { globals.confirm = previousConfirm; globals.alert = previousAlert; }
  });
  await test('unmount aborts a save whose Service intent changed; no late draft setters', async f => {
    await f.start(); await f.loaded(); await f.select(); await f.save(); const old = f.latestSave(); await f.select('free'); f.stop();
    assert.equal(old.init.signal.aborted, true); old.deliver({ error: 'OBSOLETE_SAVE_ERROR', code: 'SERVICE_VERSION_CHANGED' }, 409); await flush();
    assert.equal(f.renderer.lateSetters, 0); assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(globals.servicesTestInvalidations, 0);
  });
  await test('historical A-B-A preserves snapshot without Service interaction',async f=>{historical(f);await f.start();await f.loaded([]);await f.branch('B');await f.branch('A');await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));assert.ok(text(f.renderer.tree).includes('Recorded inactive name'));});
  await test('historical permanent branch change blocks unresolved save',async f=>{historical(f);await f.start();await f.loaded([]);await f.branch();await f.save();assert.ok(!f.latestSave());assert.ok(text(f.renderer.tree).includes('explicitly remove'));assert.equal(f.button('Save changes').props.disabled,true);});
  await test('historical new branch replacement sends authoritative command',async f=>{historical(f);await f.start();await f.loaded();await f.branch();await f.loaded([service('replacement')]);await f.select('replacement');await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'replacement',expectedVersion:1});});
  await test('historical explicit removal is visible and survives branch roundtrip',async f=>{historical(f);await f.start();await f.loaded([]);await f.branch();f.button('Remove Service').props.onClick();await f.settle();await f.branch('A');assert.ok(text(f.renderer.tree).includes('will be removed'));await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection,null);});
  await test('catalogue failure and retry never remove historical Service',async f=>{historical(f);await f.start();f.latestGet().deliver({error:'Unavailable catalogue'},503);await f.settle();f.button('Retry').props.onClick();await f.settle();await f.loaded([]);await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('new unsaved Visit branch change resets draft without removal',async f=>{f.props.visit=undefined;f.props.defaultBranchId='A';await f.start();await f.loaded();await f.select();await f.branch('B');assert.equal(f.node('visit-service').props.value,'__none');assert.ok(!text(f.renderer.tree).includes('will be removed'));});
  await test('price context uses only API resolved branch price and never writes amount',async f=>{await f.start();const row=service();row.branches[1].effectivePrice.amount='987.65';await f.loaded([row,service('free','free')]);const options=text(f.node('visit-service'));assert.ok(options.includes('123.45')&&options.includes('Free')&&options.includes('current catalogue price'));assert.ok(!text(f.renderer.tree).includes('987.65'));await f.select();await f.save();const body=JSON.parse(f.latestSave().init.body);assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});assert.ok(!JSON.stringify(body).includes('123.45'));});
  await test('409 targeted review confirms renamed duration price and version together',async f=>{await conflict(f);assert.equal(f.button('Save changes').props.disabled,true);await reload(f);const latest={...service('priced','priced',2),name:'Renamed catalogue',default_duration_minutes:75};latest.branches[0].effectivePrice.amount='321.45';f.latestGet().deliver(latest);await f.settle();assert.ok(text(f.renderer.tree).includes('Renamed catalogue')&&/75\s+min/.test(text(f.renderer.tree))&&text(f.renderer.tree).includes('321.45'));const count=f.requests.length;await f.save();assert.equal(f.requests.length,count);f.button('Use reviewed Service').props.onClick();await f.settle();assert.equal(f.button('Save changes').props.disabled,false);assert.ok(text(f.node('visit-service')).includes('Renamed catalogue · 75 min')&&text(f.node('visit-service')).includes('v2'));await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'priced',expectedVersion:2});f.latestSave().deliver({id:'appointment'});await f.settle();assert.equal(f.saves,1);});
  for(const eligibility of ['inactive','unavailable','unpriced','free'])await test(`review latest ${eligibility} requires valid explicit resolution`,async f=>{await conflict(f);await reload(f);const latest=service('priced',eligibility==='unpriced'?'unpriced':eligibility==='free'?'free':'priced',2);if(eligibility==='inactive')latest.active=false;if(eligibility==='unavailable')latest.branches[0].operationallyAvailable=false;f.latestGet().deliver(latest);await f.settle();if(eligibility==='free'){assert.ok(text(f.renderer.tree).includes('Free current catalogue price'));f.button('Use reviewed Service').props.onClick();await f.settle();await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection.expectedVersion,2);}else{assert.ok(!hasButton(f,'Use reviewed Service'));const count=f.requests.length;await f.save();assert.equal(f.requests.length,count);assert.ok(text(f.renderer.tree).includes('no longer eligible'));f.button('Remove Service').props.onClick();await f.settle();await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection,null);}});
  await test('review failure stays blocked until successful retry confirmation',async f=>{await conflict(f);await reload(f);f.latestGet().deliver({error:'Review temporarily unavailable'},503);await f.settle();assert.equal(f.button('Save changes').props.disabled,true);assert.ok(!hasButton(f,'Use reviewed Service'));await reload(f);f.latestGet().deliver(service('priced','priced',2));await f.settle();f.button('Use reviewed Service').props.onClick();await f.settle();await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection.expectedVersion,2);});
  await test('generic appointment conflict does not flag Service version',async f=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Provider conflict'},409);await f.settle();assert.equal(f.button('Save changes').props.disabled,false);assert.ok(!text(f.renderer.tree).includes('(needs review)'));});
  for(const status of [200,401,403])await test(`historical list ${status} after branch ABA cannot remove snapshot`,async f=>{historical(f);await f.start();const old=f.latestGet();await f.branch('B');await f.branch('A');old.deliver(status===200?{services:[service('OLD_SCOPE_RESPONSE')],total:1}:{error:'OLD_SCOPE_DENIAL'},status);await f.settle();assert.equal(globals.servicesTestInvalidations,0);assert.ok(!text(f.renderer.tree).includes('OLD_SCOPE_RESPONSE')&&!text(f.renderer.tree).includes('OLD_SCOPE_DENIAL'));await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  for(const status of [200,401,403])for(const change of ['branch','ABA','scope','logout','invalidate','unmount','selection','superseded'])await test(`late targeted review ${status} discarded after ${change}`,async f=>{
    await f.start();await f.loaded();await f.select();await reload(f);const old=f.latestGet();
    if(change==='branch'||change==='ABA'){await f.branch('B');if(change==='ABA'){await f.branch('A');await f.loaded();await f.select();}}
    if(change==='scope')f.scope();if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}if(change==='unmount')f.stop();if(change==='selection')await f.select('free');if(change==='superseded')await reload(f);
    old.deliver(status===200?{...service('priced','priced',99),name:'OLD_REVIEW_RESPONSE'}:{error:'OLD_REVIEW_DENIAL'},status);await flush();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.renderer.lateSetters,0);if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_REVIEW_RESPONSE')&&!text(f.renderer.tree).includes('OLD_REVIEW_DENIAL'));}
  });
  for(const status of [401,403])await test(`current targeted review denial ${status} invalidates normally`,async f=>{await f.start();await f.loaded();await f.select();await reload(f);f.latestGet().deliver({error:'Current review denial'},status);await f.settle();assert.equal(globals.servicesTestInvalidations,1);assert.ok(text(f.renderer.tree).includes('Visit access changed'));});
  await test('legacy arbitrary text stays visible and submitted exactly',async f=>{await f.start();await f.loaded([]);assert.equal(f.node('visit-legacy-service').props.value,'  Legacy custom care  ');await f.save();assert.equal(JSON.parse(f.latestSave().init.body).treatmentService,'  Legacy custom care  ');});
  for (const saved of ['', '   ']) await test('empty recorded treatment field is hidden while its exact saved value survives an unrelated edit', async f => {
    f.props.visit = { ...f.props.visit, treatmentService: saved };
    await f.start(); await f.loaded([]);
    assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-legacy-service'));
    f.node('visit-notes').props.onChange({ target: { value: 'Updated synthetic note' } }); await f.settle(); await f.save();
    assert.equal(JSON.parse(f.latestSave().init.body).treatmentService, saved);
    assert.equal(JSON.parse(f.latestSave().init.body).notes, 'Updated synthetic note');
  });
  await test('a duplicate recorded Service name is hidden without rewriting its stored whitespace or snapshot', async f => {
    f.props.visit = { ...f.props.visit, serviceId: 'historical', serviceNameSnapshot: 'Recorded care', serviceCatalogueVersion: 7,
      treatmentService: '  Recorded care  ' };
    await f.start(); await f.loaded([]);
    assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-legacy-service'));
    await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.treatmentService, '  Recorded care  '); assert.ok(!('serviceSelection' in body));
    assert.equal(f.props.visit.serviceNameSnapshot, 'Recorded care'); assert.equal(f.props.visit.serviceCatalogueVersion, 7);
  });
  await test('distinct recorded treatment beside a canonical Service stays visible and read-only', async f => {
    f.props.visit = { ...f.props.visit, serviceId: 'historical', serviceNameSnapshot: 'Recorded care', treatmentService: '  Earlier custom treatment  ' };
    await f.start(); await f.loaded([]);
    assert.equal(f.node('visit-legacy-service').props.value, '  Earlier custom treatment  ');
    assert.equal(f.node('visit-legacy-service').props.readOnly, true);
    assert.ok(text(f.renderer.tree).includes('Previously recorded treatment'));
    await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).treatmentService, '  Earlier custom treatment  ');
  });
  await test('clearing an editable historical treatment keeps the field available until explicit save', async f => {
    await f.start(); await f.loaded([]);
    f.node('visit-legacy-service').props.onChange({ target: { value: '' } }); await f.settle();
    assert.ok(f.node('visit-legacy-service')); assert.equal(f.node('visit-legacy-service').props.value, '');
    await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).treatmentService, '');
  });
  await test('Completed remains editable; explicit finalization blocks even forced submit',async f=>{f.props.visit={...f.props.visit,isFinalized:true,serviceId:'sealed',serviceNameSnapshot:'Signed historical fact'};await f.start();assert.equal(f.requests.length,0);assert.equal(f.button('Save changes').props.disabled,true);assert.ok(text(f.renderer.tree).includes('Signed historical fact'));await f.save();assert.equal(f.requests.length,0);});
  const booked = (f: Fixture, id = 'priced') => {
    const v = f.props.visit; f.props.visit = undefined;
    f.props.appointment = { ...v, id: 'booking', appointmentDate: v.visitDate, serviceId: id,
      serviceNameSnapshot: 'Booked old name', serviceDurationMinutesSnapshot: 30, serviceCatalogueVersion: 1 };
  };
  for (const mode of ['priced', 'free']) await test(`unchanged booked ${mode} Service is checked and carried automatically`, async f => {
    booked(f, mode); await f.start(); await f.loaded();
    assert.equal(f.node('visit-service').props.value, mode);
    assert.ok(text(f.renderer.tree).includes('Checking booked Service') && !text(f.renderer.tree).includes('This selection needs review'));
    assert.equal(f.button('Save visit').props.disabled, true); await f.save(); assert.ok(!f.latestSave());
    assert.equal(f.latestGet().url, `/api/services/${mode}?branchId=A`);
    f.latestGet().deliver(service(mode, mode)); await f.settle();
    assert.equal(f.node('visit-service').props.value, mode); assert.equal(f.button('Save visit').props.disabled, false);
    assert.ok(!text(f.renderer.tree).includes('(needs review)') && !hasButton(f, 'Use reviewed Service'));
    await f.save(); const payload = JSON.parse(f.latestSave().init.body);
    assert.deepEqual(payload.serviceSelection, { serviceId: mode, expectedVersion: 1 });
    for (const field of ['serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion', 'chargedPrice']) assert.ok(!Object.hasOwn(payload, field));
    assert.equal(f.props.appointment.serviceNameSnapshot, 'Booked old name');
    f.latestSave().deliver({ id: 'created-visit' }); await f.settle(); assert.equal(f.saves, 1); assert.equal(f.closes, 1);
  });
  await test('off-page booked Service verifies through detail rather than list membership', async f => {
    booked(f, 'off-page'); await f.start(); await f.loaded([]); f.latestGet().deliver(service('off-page')); await f.settle();
    assert.equal(f.node('visit-service').props.value, 'off-page'); await f.save();
    assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'off-page', expectedVersion: 1 });
  });
  await test('changed booked version still requires confirmation and leaves booking snapshot intact', async f => {
    booked(f); await f.start(); await f.loaded(); f.latestGet().deliver({ ...service('priced', 'priced', 2), name: 'Current performed name' }); await f.settle();
    assert.equal(f.button('Save visit').props.disabled, true); assert.ok(text(f.renderer.tree).includes('(needs review)'));
    await f.save(); assert.ok(!f.latestSave()); f.button('Use reviewed Service').props.onClick(); await f.settle(); await f.save();
    assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'priced', expectedVersion: 2 });
    assert.equal(f.props.appointment.serviceNameSnapshot, 'Booked old name');
  });
  for (const eligibility of ['inactive', 'unavailable', 'unpriced']) await test(`booked ${eligibility} Service is never auto-confirmed`, async f => {
    booked(f); await f.start(); await f.loaded(); const latest = service('priced', eligibility === 'unpriced' ? 'unpriced' : 'priced');
    if (eligibility === 'inactive') latest.active = false; if (eligibility === 'unavailable') latest.branches[0].operationallyAvailable = false;
    f.latestGet().deliver(latest); await f.settle(); assert.equal(f.button('Save visit').props.disabled, true);
    assert.ok(text(f.renderer.tree).includes('no longer eligible') && !hasButton(f, 'Use reviewed Service')); await f.save(); assert.ok(!f.latestSave());
    f.button('Remove Service').props.onClick(); await f.settle(); await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection, null);
  });
  for (const failure of [404, 503, 'network'] as const) await test(`booked verification ${failure} preserves choice and allows explicit retry`, async f => {
    booked(f); await f.start(); await f.loaded();
    if (failure === 'network') f.latestGet().fail(); else f.latestGet().deliver({ error: 'Verification unavailable' }, failure);
    await f.settle(); assert.equal(f.node('visit-service').props.value, 'priced'); assert.equal(f.button('Save visit').props.disabled, true);
    await reload(f); f.latestGet().deliver(service()); await f.settle();
    assert.equal(f.button('Save visit').props.disabled, true); f.button('Use reviewed Service').props.onClick(); await f.settle();
    await f.save(); assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'priced', expectedVersion: 1 });
  });
  for (const response of [200, 401, 403]) for (const change of ['remove', 'different', 'same', 'manual-review']) await test(`booked verification ${response} discarded after ${change} intent`, async f => {
    booked(f); await f.start(); const old = f.latestGet(); await f.loaded();
    if (change === 'remove') { f.button('Remove Service').props.onClick(); await f.settle(); }
    if (change === 'different') await f.select('free');
    if (change === 'same') await f.select('priced');
    if (change === 'manual-review') await reload(f);
    old.deliver(response === 200 ? { ...service(), name: 'OBSOLETE_BOOKED_DETAIL' } : { error: 'OBSOLETE_BOOKED_DENIAL' }, response); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 0); assert.ok(!text(f.renderer.tree).includes('OBSOLETE_BOOKED_DETAIL') && !text(f.renderer.tree).includes('OBSOLETE_BOOKED_DENIAL'));
    if (change === 'manual-review') {
      assert.equal(f.latestGet().init.signal.aborted, false); assert.equal(f.button('Save visit').props.disabled, true);
      f.latestGet().deliver(service('priced', 'priced', 2)); await f.settle(); f.button('Use reviewed Service').props.onClick(); await f.settle();
    }
    await f.save(); const payload = JSON.parse(f.latestSave().init.body);
    assert.deepEqual(payload.serviceSelection, change === 'remove' ? null : { serviceId: change === 'different' ? 'free' : 'priced', expectedVersion: change === 'manual-review' ? 2 : 1 });
  });
  for (const response of [200, 401, 403]) for (const change of ['branch', 'ABA', 'scope', 'logout', 'invalidate', 'unmount']) await test(`booked verification ${response} discarded after ${change}`, async f => {
    booked(f); await f.start(); const old = f.latestGet();
    if (change === 'branch' || change === 'ABA') { await f.branch('B'); if (change === 'ABA') await f.branch('A'); }
    if (change === 'scope') f.scope();
    if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); }
    if (change === 'invalidate') { for (const listener of globals.appointmentInvalidationListeners) listener(); f.render(); }
    if (change === 'unmount') f.stop();
    old.deliver(response === 200 ? { ...service(), name: 'OBSOLETE_BOOKED_DETAIL' } : { error: 'OBSOLETE_BOOKED_DENIAL' }, response); await flush();
    assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    if (change !== 'unmount') { await f.settle(); assert.ok(!text(f.renderer.tree).includes('OBSOLETE_BOOKED_DETAIL') && !text(f.renderer.tree).includes('OBSOLETE_BOOKED_DENIAL')); }
  });
  for (const response of [200, 401, 403]) for (const change of ['same', 'remove']) await test(`booked verification ${response} discarded before passive cleanup after ${change}`, async f => {
    booked(f); await f.start(); const old = f.latestGet(); await f.loaded();
    f.node('visit-service').props.onChange({ target: { value: change === 'same' ? 'priced' : '__none' } }); f.render();
    // Same ID/version leaves the detail transport alive until passive cleanup;
    // the layout-updated choice identity must reject it in that interval.
    if (change === 'same') assert.equal(old.init.signal.aborted, false);
    old.deliver(response === 200 ? { ...service(), name: 'OBSOLETE_BOOKED_DETAIL' } : { error: 'OBSOLETE_BOOKED_DENIAL' }, response); await flush();
    assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0); await f.settle();
    assert.ok(!text(f.renderer.tree).includes('OBSOLETE_BOOKED_DETAIL') && !text(f.renderer.tree).includes('OBSOLETE_BOOKED_DENIAL'));
    await f.save(); assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, change === 'remove' ? null : { serviceId: 'priced', expectedVersion: 1 });
  });
  for (const status of [401, 403]) await test(`current booked verification ${status} still invalidates normally`, async f => {
    booked(f); await f.start(); f.latestGet().deliver({ error: 'Current verification denial' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.ok(text(f.renderer.tree).includes('Visit access changed'));
  });
  await test('server version conflict after automatic carryover still requires manual review', async f => {
    booked(f); await f.start(); await f.loaded(); f.latestGet().deliver(service()); await f.settle(); await f.save();
    f.latestSave().deliver({ error: 'Service changed', code: 'SERVICE_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.button('Save visit').props.disabled, true); assert.ok(text(f.renderer.tree).includes('(needs review)'));
    const count = f.requests.length; await f.save(); assert.equal(f.requests.length, count);
    await reload(f); f.latestGet().deliver(service('priced', 'priced', 2)); await f.settle(); f.button('Use reviewed Service').props.onClick(); await f.settle();
    await f.save(); assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection, { serviceId: 'priced', expectedVersion: 2 });
  });
  await test('booked Service can differ from performed; booking display stays historical',async f=>{const v=f.props.visit;f.props.visit=undefined;f.props.appointment={...v,id:'booking',appointmentDate:v.visitDate,serviceId:'old',serviceNameSnapshot:'Historical booked',serviceCatalogueVersion:1};await f.start();await f.loaded();await f.select('free');await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'free',expectedVersion:1});assert.ok(text(f.renderer.tree).includes('Historical booked'));});
  await test('legacy linked Visit does not adopt canonical booked Service on edit',async f=>{f.props.visit={...f.props.visit,appointmentId:'booking'};f.props.appointments=[{id:'booking',branchId:'A',serviceId:'priced',serviceNameSnapshot:'Booked only'}];await f.start();await f.loaded();assert.ok(text(f.renderer.tree).includes('Booked only'));await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('follow-up response after access loss cannot invalidate new scope or close',async f=>{f.props.visit={...f.props.visit,followUpRequired:true};globals.confirm=()=>true;await f.start();await f.loaded();await f.save();f.latestSave().deliver({id:'visit'});await f.settle();const followUp=f.latestSave();assert.ok(followUp.url.endsWith('/appointments'));f.scope();followUp.deliver({error:'OLD_FOLLOWUP_DENIAL'},403);await f.settle();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.saves,0);assert.equal(f.renderer.lateSetters,0);});


  // Appointment-to-Visit sync and quote regressions exercise the actual protected
  // document adapter and form. Every linked creation opens from a fresh read;
  // transport races deliberately deliver after abort without browser evidence.
  const price = (f: Fixture) => f.node('visit-special-price');
  const enterPrice = async (f: Fixture, value: string) => { price(f).props.onChange({ target: { value } }); await f.settle(); };
  const summary = (f: Fixture) => {
    const node = find(f.renderer.tree, (n: any) => [true, 'true'].includes(n.props?.['data-visit-price-summary']));
    assert.ok(node, 'missing Visit Price Summary'); assert.equal(node.props['aria-label'], 'Visit Price Summary'); return node;
  };
  const summaryRow = (f: Fixture, row: string) => {
    const node = find(summary(f), (n: any) => n.props?.['data-visit-price-row'] === row);
    assert.ok(node, 'missing Visit Price Summary row ' + row); return text(node);
  };
  const noQuoteCommand = (body: any) => {
    for (const key of ['visitQuote', 'bookingQuote', 'servicePrice', 'total', 'chargedPrice', 'quotedAt', 'quotedByUid', 'quotedByName'])
      assert.ok(!Object.hasOwn(body, key), 'client must not author ' + key);
  };
  const quoteRecord = (record: any, overrides: any = {}) => {
    const quote = { version: 1, currency: 'PHP', branchId: record.branchId,
      serviceId: record.serviceId ?? null, serviceCatalogueVersion: record.serviceCatalogueVersion ?? null,
      servicePrice: '111.25', specialPrice: '95.50', total: '95.50', source: 'special',
      quotedAt: '2026-10-23T01:00:00.000Z', quotedByUid: 'staff', quotedByName: 'Synthetic staff', ...overrides };
    return quote;
  };
  const savedQuote = (f: Fixture, overrides: any = {}) => {
    f.props.visit = { ...f.props.visit, visitVersion: 5, serviceId: 'priced', serviceNameSnapshot: 'Saved performed Service',
      serviceDurationMinutesSnapshot: 45, serviceCatalogueVersion: 1 };
    f.props.visit.visitQuote = quoteRecord(f.props.visit, overrides);
  };
  const linked = (f: Fixture, overrides: any = {}) => {
    const v = f.props.visit; f.props.visit = undefined;
    f.props.appointment = { ...v, id: 'booking', status: 'Scheduled', appointmentDate: v.visitDate,
      serviceId: null, serviceNameSnapshot: null, serviceDurationMinutesSnapshot: null, serviceCatalogueVersion: null,
      bookingPricingRevision: 7, ...overrides };
  };
  const linkedQuoted = (f: Fixture, overrides: any = {}) => {
    linked(f, { serviceId: 'priced', serviceNameSnapshot: 'Saved booked Service', serviceDurationMinutesSnapshot: 45,
      serviceCatalogueVersion: 1, specialPrice: '95.50' });
    f.props.appointment.bookingQuote = quoteRecord(f.props.appointment, overrides);
  };
  const verifyBooked = async (f: Fixture, row = service()) => { await f.loaded([row, service('free', 'free')]); f.latestGet().deliver(row); await f.settle(); };
  const draftValues = ['visit-notes', 'visit-diagnosis', 'visit-plan', 'visit-concern', 'visit-assisting-staff'];
  const fillDraft = async (f: Fixture) => { for (const id of draftValues) f.node(id).props.onChange({ target: { value: 'UNSAVED_' + id } }); await f.settle(); };
  const assertDraft = (f: Fixture) => { for (const id of draftValues) assert.equal(f.node(id).props.value, 'UNSAVED_' + id); };
  const bookingRecord = (f: Fixture, extra: any = {}) => ({ ...f.props.appointment, bookingPricingRevision: 8, ...extra });
  const bookingConflict = async (f: Fixture, code = 'APPOINTMENT_BOOKING_CHANGED') => {
    await f.save(); f.latestSave().deliver({ error: 'The appointment booking changed. Your draft has been kept.', code }, 409); await f.settle();
  };
  await test('fresh appointment read precedes any inherited Service, quote or clinical draft', async f => {
    linkedQuoted(f); f.autoBookingRead = false; await f.start();
    assert.deepEqual(JSON.parse(f.latestBookingRead().init.body), { path: 'appointments/booking', kind: 'document' });
    assert.match(text(f.renderer.tree), /Loading latest booking/); assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-service'));
    assert.doesNotMatch(text(f.renderer.tree), /Saved booked Service|95\.50|Legacy custom care/);
    assert.equal(f.requests.length, 1); assert.ok(!f.latestSave());
    f.latestBookingRead().deliver({ document: { id: 'booking', data: f.props.appointment } }); await f.settle();
    assert.equal(f.node('visit-service').props.value, 'priced'); assert.equal(price(f).props.value, '95.50');
  });
  await test('fresh appointment with no Service replaces a removed stale booked Service before rendering', async f => {
    linkedQuoted(f); f.freshBooking = { ...f.props.appointment, serviceId: null, serviceNameSnapshot: null, serviceCatalogueVersion: null,
      serviceDurationMinutesSnapshot: null, specialPrice: null, bookingQuote: undefined, bookingPricingRevision: 8 };
    await f.start(); await f.loaded([]); assert.equal(f.node('visit-service').props.value, '__none');
    assert.doesNotMatch(text(f.renderer.tree), /Saved booked Service/); assert.equal(price(f).props.value, '');
    assert.ok(summaryRow(f, 'total').includes('Price not set')); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.deepEqual(body.expectedBookingContext, { pricingRevision: 8, serviceId: null, serviceCatalogueVersion: null });
    assert.ok(!Object.hasOwn(body, 'serviceSelection')); assert.ok(!Object.hasOwn(body, 'specialPrice')); noQuoteCommand(body);
    assert.ok(!f.requests.some(r => r.url.startsWith('/api/services/') && !r.url.startsWith('/api/services?')));
  });
  await test('fresh no-Service booking carries its saved Special Price without selecting a Service', async f => {
    linked(f, { specialPrice: '650.25' }); f.props.appointment.bookingQuote = quoteRecord(f.props.appointment,
      { servicePrice: null, specialPrice: '650.25', total: '650.25', source: 'special' });
    await f.start(); await f.loaded([]); assert.equal(f.node('visit-service').props.value, '__none');
    assert.equal(price(f).props.value, '650.25'); assert.ok(summaryRow(f, 'servicePrice').includes('Price not set'));
    assert.ok(summaryRow(f, 'total').includes('650.25')); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.deepEqual(body.expectedBookingContext, { pricingRevision: 7, serviceId: null, serviceCatalogueVersion: null });
    assert.ok(!Object.hasOwn(body, 'specialPrice')); noQuoteCommand(body);
  });
  await test('linked Visit uses the saved booking quote after Service verification instead of current catalogue amount', async f => {
    linkedQuoted(f); await f.start(); const current = service(); current.branches[0].effectivePrice.amount = '9876.54';
    await verifyBooked(f, current); assert.equal(price(f).props.value, '95.50');
    assert.ok(summaryRow(f, 'servicePrice').includes('111.25')); assert.ok(summaryRow(f, 'total').includes('95.50'));
    assert.ok(!text(summary(f)).includes('9,876.54')); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.deepEqual(body.expectedBookingContext, { pricingRevision: 7, serviceId: 'priced', serviceCatalogueVersion: 1 });
    assert.deepEqual(body.serviceSelection, { serviceId: 'priced', expectedVersion: 1 }); assert.ok(!Object.hasOwn(body, 'specialPrice')); noQuoteCommand(body);
    assert.equal(f.props.appointment.specialPrice, '95.50'); assert.equal(f.props.appointment.bookingQuote.total, '95.50');
  });
  for (const mode of ['service', 'free', 'unset']) await test('linked ' + mode + ' quote is preserved independently of POS', async f => {
    if (mode === 'unset') linked(f);
    else linkedQuoted(f, { servicePrice: mode === 'free' ? '0.00' : '111.25', specialPrice: null,
      total: mode === 'free' ? '0.00' : '111.25', source: 'service' });
    if (mode !== 'unset') f.props.appointment.specialPrice = null;
    await f.start(); if (mode === 'unset') await f.loaded([]); else await verifyBooked(f);
    assert.ok(summaryRow(f, 'total').includes(mode === 'free' ? 'Free' : mode === 'unset' ? 'Price not set' : '111.25'));
    await f.save(); assert.ok(f.latestSave()); assert.ok(!f.requests.some(r => /\/pos|\/payments|\/invoices/i.test(r.url))); noQuoteCommand(JSON.parse(f.latestSave().init.body));
  });
  for (const failure of [503, 'network', 'missing', 'wrong-id'] as const) await test('initial booking read ' + failure + ' renders no stale draft and supports retry', async f => {
    linkedQuoted(f); f.autoBookingRead = false; await f.start(); const read = f.latestBookingRead();
    if (failure === 'network') read.fail(); else read.deliver(failure === 'missing' ? { document: { id: 'booking', data: null } }
      : failure === 'wrong-id' ? { document: { id: 'other-booking', data: f.props.appointment } } : { error: 'Booking unavailable' }, failure === 503 ? 503 : 200);
    await f.settle(); assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-service')); assert.doesNotMatch(text(f.renderer.tree), /Saved booked Service|95\.50/);
    f.button('Retry booking load').props.onClick(); await f.settle(); const retry = f.latestBookingRead(); assert.notEqual(retry, read);
    retry.deliver({ document: { id: 'booking', data: f.props.appointment } }); await f.settle(); assert.equal(f.node('visit-service').props.value, 'priced');
  });
  for (const status of [200, 401, 403]) for (const change of ['scope', 'logout', 'invalidate', 'unmount', 'different-booking']) await test('old initial booking read ' + status + ' cannot restore ' + change + ' scope', async f => {
    linkedQuoted(f); f.autoBookingRead = false; await f.start(); const old = f.latestBookingRead();
    if (change === 'scope') f.scope();
    if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); }
    if (change === 'invalidate') { for (const listener of globals.appointmentInvalidationListeners) listener(); f.render(); }
    if (change === 'unmount') f.stop();
    if (change === 'different-booking') { f.props.appointment = { ...f.props.appointment, id: 'replacement-booking' }; f.render(); await f.settle(); }
    old.deliver(status === 200 ? { document: { id: 'booking', data: { ...f.props.appointment, serviceNameSnapshot: 'STALE_BOOKING_PRIVATE_NAME', specialPrice: '9876.54' } } }
      : { error: 'STALE_BOOKING_PRIVATE_DENIAL' }, status); await flush(); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    if (change !== 'unmount') { await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /STALE_BOOKING_PRIVATE_NAME|STALE_BOOKING_PRIVATE_DENIAL|9,876\.54/); }
  });
  for (const status of [401, 403]) await test('current initial booking denial ' + status + ' invalidates normally', async f => {
    linked(f); f.autoBookingRead = false; await f.start(); f.latestBookingRead().deliver({ error: 'Current booking denied' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.match(text(f.renderer.tree), /Visit access changed/); assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-service'));
  });
  await test('fresh unauthorized booking branch is never mounted or rendered', async f => {
    linkedQuoted(f); f.freshBooking = { ...f.props.appointment, branchId: 'unauthorized', serviceNameSnapshot: 'UNAUTHORIZED_BOOKING_NAME' };
    await f.start(); assert.ok(!find(f.renderer.tree, (n: any) => n.props?.id === 'visit-service')); assert.doesNotMatch(text(f.renderer.tree), /UNAUTHORIZED_BOOKING_NAME|95\.50/); assert.ok(!f.latestSave());
  });
  for (const [entered, expected] of [['100', '100.00'], ['12.5', '12.50'], ['0', '0.00'], ['9999999999.99', '9999999999.99']]) await test('Visit Special Price ' + entered + ' normalizes and overrides without POS', async f => {
    await f.start(); await f.loaded(); await f.select(); await enterPrice(f, entered); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice, expected); noQuoteCommand(body); assert.deepEqual(body.serviceSelection, { serviceId: 'priced', expectedVersion: 1 });
    assert.ok(summaryRow(f, 'servicePrice').includes('123.45')); assert.ok(summaryRow(f, 'total').includes(entered === '0' ? 'Free' : Number(expected).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
    assert.ok(!f.requests.some(r => /\/pos|\/payments|\/invoices/i.test(r.url)));
  });
  await test('Visit Special Price is optional, labelled exactly and blank edits omit quote commands', async f => {
    await f.start(); await f.loaded([]); const label = find(f.renderer.tree, (n: any) => n.type === 'label' && n.props?.htmlFor === 'visit-special-price');
    assert.equal(text(label).trim(), 'Special Price:'); assert.equal(price(f).props.inputMode, 'decimal');
    assert.equal(price(f).props.value, ''); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.ok(!Object.hasOwn(body, 'specialPrice')); noQuoteCommand(body); assert.ok(summaryRow(f, 'total').includes('Price not set'));
  });
  await test('no-Service Visit can quote Special Price independently', async f => {
    await f.start(); await f.loaded([]); await enterPrice(f, '750'); assert.ok(summaryRow(f, 'servicePrice').includes('Price not set'));
    assert.ok(summaryRow(f, 'total').includes('750.00')); await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).specialPrice, '750.00');
    assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body), 'serviceSelection'));
  });
  for (const invalid of ['-1', 'abc', '12.345', '1e3', '₱100', '10000000000']) await test('invalid Visit Special Price ' + invalid + ' blocks saving without losing drafts', async f => {
    await f.start(); await f.loaded(); await f.select(); await fillDraft(f); await enterPrice(f, invalid); await f.save(); assert.ok(!f.latestSave());
    assert.equal(price(f).props.value, invalid); assertDraft(f); assert.match(summaryRow(f, 'total'), /Enter a valid Special Price/);
  });
  await test('saved Visit quote stays fixed across catalogue loading and unrelated clinical edits', async f => {
    savedQuote(f); await f.start(); const row = service(); row.branches[0].effectivePrice.amount = '9876.54'; await f.loaded([row]);
    assert.equal(price(f).props.value, '95.50'); assert.ok(summaryRow(f, 'servicePrice').includes('111.25')); assert.ok(summaryRow(f, 'total').includes('95.50'));
    assert.ok(!text(summary(f)).includes('9,876.54')); await fillDraft(f); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.expectedVisitVersion, 5); assert.ok(!Object.hasOwn(body, 'specialPrice') && !Object.hasOwn(body, 'serviceSelection')); noQuoteCommand(body);
    for (const [field, id] of [['notes', 'visit-notes'], ['diagnosis', 'visit-diagnosis'], ['treatmentPlan', 'visit-plan'], ['mainConcern', 'visit-concern'], ['assistingStaffText', 'visit-assisting-staff']]) assert.equal(body[field], 'UNSAVED_' + id);
  });
  for (const total of ['111.25', '0.00']) await test('saved Service-only Visit quote ' + total + ' survives current catalogue changes', async f => {
    savedQuote(f, { servicePrice: total, specialPrice: null, total, source: 'service' }); await f.start(); await f.loaded();
    assert.equal(price(f).props.value, ''); assert.ok(summaryRow(f, 'total').includes(total === '0.00' ? 'Free' : total));
    await f.save(); assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body), 'specialPrice'));
  });
  await test('clearing saved Visit Special Price returns to saved Service price, retaining clinical drafts', async f => {
    savedQuote(f); await f.start(); await f.loaded(); await fillDraft(f); await enterPrice(f, '');
    assert.ok(summaryRow(f, 'total').includes('111.25')); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice, null); assert.equal(body.expectedVisitVersion, 5); noQuoteCommand(body); assertDraft(f);
  });
  await test('historical Visit with no quote remains unpriced despite a priced Service in catalogue', async f => {
    f.props.visit = { ...f.props.visit, serviceId: 'priced', serviceNameSnapshot: 'Historical recorded Service', serviceCatalogueVersion: 1 };
    await f.start(); await f.loaded(); assert.ok(summaryRow(f, 'servicePrice').includes('Price not set')); assert.ok(summaryRow(f, 'total').includes('Price not set'));
    await f.save(); const body = JSON.parse(f.latestSave().init.body); assert.ok(!Object.hasOwn(body, 'specialPrice') && !Object.hasOwn(body, 'serviceSelection')); noQuoteCommand(body);
  });
  await test('saved linked Visit never refreshes or inherits its appointment quote on unrelated edit', async f => {
    savedQuote(f); f.props.visit.appointmentId = 'booking'; f.props.appointments = [{ id: 'booking', branchId: 'A', serviceId: 'free', serviceCatalogueVersion: 8,
      specialPrice: '9876.54', bookingQuote: { total: '9876.54' } }]; await f.start(); await f.loaded();
    assert.equal(price(f).props.value, '95.50'); assert.ok(summaryRow(f, 'total').includes('95.50')); assert.ok(!text(summary(f)).includes('9,876.54'));
    assert.ok(!f.latestBookingRead()); await f.save(); assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body), 'expectedBookingContext'));
  });
  await test('performed Service change clears inherited Special Price and requires a new explicit amount', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await fillDraft(f); await f.select('free');
    assert.equal(price(f).props.value, ''); assert.match(text(f.renderer.tree), /Special Price cleared/); assert.ok(summaryRow(f, 'total').includes('Free'));
    await enterPrice(f, '75'); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice, '75.00'); assert.deepEqual(body.serviceSelection, { serviceId: 'free', expectedVersion: 1 }); assertDraft(f);
    assert.equal(f.props.appointment.bookingQuote.total, '95.50');
  });
  await test('performed Service removal clears the quote and retains explicit null through Service A-B-A', async f => {
    savedQuote(f); await f.start(); await f.loaded(); await f.select('free'); await f.select('priced');
    assert.equal(price(f).props.value, ''); await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).specialPrice, null);
    assert.ok(!text(summary(f)).includes('95.50'));
  });
  await test('branch change clears protected saved pricing and cannot restore it through branch ABA', async f => {
    savedQuote(f); await f.start(); await f.loaded(); await f.branch('B'); assert.equal(price(f).props.value, '');
    assert.ok(!text(summary(f)).includes('111.25') && !text(summary(f)).includes('95.50')); await f.branch('A');
    assert.equal(price(f).props.value, ''); assert.ok(!text(summary(f)).includes('95.50')); await f.save(); assert.equal(JSON.parse(f.latestSave().init.body).specialPrice, null);
  });
  await test('sealed Visit shows historical quote but Special Price forced handlers cannot mutate or save', async f => {
    savedQuote(f); f.props.visit.isFinalized = true; await f.start(); assert.equal(f.requests.length, 0);
    assert.equal(price(f).props.disabled, true); await enterPrice(f, '999'); assert.equal(price(f).props.value, '95.50');
    assert.ok(summaryRow(f, 'total').includes('95.50')); await f.save(); assert.ok(!f.latestSave());
  });
  await test('pending save freezes Special Price input and a temporary failure retains it and the clinical draft', async f => {
    await f.start(); await f.loaded(); await f.select(); await enterPrice(f, '85'); await fillDraft(f); await f.save();
    assert.equal(price(f).props.disabled, true); await enterPrice(f, '999'); assert.equal(price(f).props.value, '85');
    f.latestSave().deliver({ error: 'Synthetic pricing retry' }, 503); await f.settle(); assert.equal(price(f).props.disabled, false);
    assert.equal(price(f).props.value, '85'); assertDraft(f); assert.match(text(f.renderer.tree), /Synthetic pricing retry/);
  });
  for (const code of ['APPOINTMENT_BOOKING_CHANGED', 'APPOINTMENT_BOOKING_REVIEW_REQUIRED']) for (const action of ['set', 'clear']) await test(code + ' retains Special Price ' + action + ' and all drafts until explicit booking review', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await fillDraft(f); await enterPrice(f, action === 'set' ? '80' : '');
    await bookingConflict(f, code); assert.equal(price(f).props.value, action === 'set' ? '80' : ''); assertDraft(f);
    assert.equal(f.button('Save visit').props.disabled, true); const count = visitWriteCount(f); await f.save(); assert.equal(visitWriteCount(f), count);
    f.autoBookingRead = false; f.button('Review latest booking').props.onClick(); await f.settle();
    f.latestBookingRead().deliver({ document: { id: 'booking', data: bookingRecord(f, { specialPrice: '230.00',
      bookingQuote: quoteRecord(f.props.appointment, { specialPrice: '230.00', total: '230.00' }) }) } }); await f.settle();
    assertDraft(f); assert.equal(price(f).props.value, action === 'set' ? '80' : ''); assert.equal(f.button('Save visit').props.disabled, true);
    f.button('Use reviewed booking').props.onClick(); await f.settle(); assertDraft(f); assert.equal(price(f).props.value, action === 'set' ? '80' : '');
    assert.equal(f.button('Save visit').props.disabled, false); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice, action === 'set' ? '80.00' : null); assert.deepEqual(body.expectedBookingContext, { pricingRevision: 8, serviceId: 'priced', serviceCatalogueVersion: 1 });
  });
  for (const code of ['APPOINTMENT_BOOKING_CHANGED', 'APPOINTMENT_BOOKING_REVIEW_REQUIRED']) await test('same-scope ' + code + ' still blocks save after a newer performed-Service intent', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await fillDraft(f); await f.save(); const old = f.latestSave();
    await f.select('free'); old.deliver({ error: 'Current booking changed', code }, 409); await f.settle();
    assert.equal(f.node('visit-service').props.value, 'free'); assertDraft(f); assert.equal(f.button('Save visit').props.disabled, true);
    const count = visitWriteCount(f); await f.save(); assert.equal(visitWriteCount(f), count); assert.ok(f.button('Review latest booking'));
  });
  await test('reviewed booking removal resets untouched inherited Service without discarding clinical notes', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await fillDraft(f); await bookingConflict(f); f.autoBookingRead = false;
    f.button('Review latest booking').props.onClick(); await f.settle(); f.latestBookingRead().deliver({ document: { id: 'booking', data: bookingRecord(f,
      { serviceId: null, serviceNameSnapshot: null, serviceDurationMinutesSnapshot: null, serviceCatalogueVersion: null, specialPrice: null, bookingQuote: undefined }) } }); await f.settle();
    assert.equal(f.node('visit-service').props.value, 'priced'); assertDraft(f); f.button('Use reviewed booking').props.onClick(); await f.settle();
    assert.equal(f.node('visit-service').props.value, '__none'); assert.equal(price(f).props.value, ''); assertDraft(f); await f.save(); const body = JSON.parse(f.latestSave().init.body);
    assert.deepEqual(body.expectedBookingContext, { pricingRevision: 8, serviceId: null, serviceCatalogueVersion: null }); assert.equal(body.serviceSelection, null);
  });
  await test('reviewed booking removal retains deliberately selected performed Service and its explicit quote', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await f.select('free'); await enterPrice(f, '35'); await fillDraft(f); await bookingConflict(f); f.autoBookingRead = false;
    f.button('Review latest booking').props.onClick(); await f.settle(); f.latestBookingRead().deliver({ document: { id: 'booking', data: bookingRecord(f,
      { serviceId: null, serviceNameSnapshot: null, serviceDurationMinutesSnapshot: null, serviceCatalogueVersion: null, specialPrice: null, bookingQuote: undefined }) } }); await f.settle();
    f.button('Use reviewed booking').props.onClick(); await f.settle(); assert.equal(f.node('visit-service').props.value, 'free'); assert.equal(price(f).props.value, '35'); assertDraft(f);
    await f.save(); const body = JSON.parse(f.latestSave().init.body); assert.deepEqual(body.serviceSelection, { serviceId: 'free', expectedVersion: 1 });
    assert.equal(body.specialPrice, '35.00'); assert.deepEqual(body.expectedBookingContext, { pricingRevision: 8, serviceId: null, serviceCatalogueVersion: null });
  });
  for (const response of [503, 'network', 'missing'] as const) await test('booking review ' + response + ' never discards Special Price or notes and remains blocked', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await enterPrice(f, '80'); await fillDraft(f); await bookingConflict(f); f.autoBookingRead = false;
    f.button('Review latest booking').props.onClick(); await f.settle(); const read = f.latestBookingRead();
    if (response === 'network') read.fail(); else read.deliver(response === 'missing' ? { document: { id: 'booking', data: null } } : { error: 'Review unavailable' }, response === 503 ? 503 : 200);
    await f.settle(); assert.equal(price(f).props.value, '80'); assertDraft(f); assert.equal(f.button('Save visit').props.disabled, true);
    assert.ok(!hasButton(f, 'Use reviewed booking')); assert.equal(globals.servicesTestInvalidations, 0);
  });
  for (const response of [200, 401, 403]) for (const change of ['scope', 'logout', 'invalidate', 'unmount']) await test('late booking review ' + response + ' cannot expose or invalidate a new ' + change + ' scope', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await enterPrice(f, '80'); await bookingConflict(f); f.autoBookingRead = false;
    f.button('Review latest booking').props.onClick(); await f.settle(); const old = f.latestBookingRead();
    if (change === 'scope') f.scope(); if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); }
    if (change === 'invalidate') { for (const listener of globals.appointmentInvalidationListeners) listener(); f.render(); }
    if (change === 'unmount') f.stop(); old.deliver(response === 200 ? { document: { id: 'booking', data: bookingRecord(f, { serviceNameSnapshot: 'STALE_PRIVATE_BOOKING_REVIEW' }) } }
      : { error: 'STALE_BOOKING_REVIEW_DENIAL' }, response); await flush(); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    if (change !== 'unmount') { await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /STALE_PRIVATE_BOOKING_REVIEW|STALE_BOOKING_REVIEW_DENIAL/); }
  });
  for (const status of [401, 403]) await test('current booking review denial ' + status + ' invalidates normally', async f => {
    linkedQuoted(f); await f.start(); await verifyBooked(f); await bookingConflict(f); f.autoBookingRead = false;
    f.button('Review latest booking').props.onClick(); await f.settle(); f.latestBookingRead().deliver({ error: 'Current review denial' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.match(text(f.renderer.tree), /Visit access changed/);
  });
  for (const action of ['set', 'clear']) await test('Visit version conflict preserves Special Price ' + action + ' and unsaved notes through review and Cancel', async f => {
    savedQuote(f); await f.start(); await f.loaded(); await fillDraft(f); await enterPrice(f, action === 'set' ? '80' : ''); await f.save();
    f.latestSave().deliver({ error: 'Visit changed. Your draft has been kept.', code: 'VISIT_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(price(f).props.value, action === 'set' ? '80' : ''); assertDraft(f); assert.equal(f.button('Save changes').props.disabled, true);
    f.button('Review saved Visit').props.onClick(); await f.settle(); latestReview(f).deliver({ document: { id: 'visit', data: savedRecord(f,
      { visitVersion: 6, visitQuote: quoteRecord(f.props.visit, { specialPrice: '230.00', total: '230.00' }) }) } }); await f.settle();
    assert.equal(price(f).props.value, action === 'set' ? '80' : ''); assertDraft(f);
    f.button('Reload saved Visit').props.onClick(); await f.settle(); f.button('Keep my draft').props.onClick(); await f.settle();
    assert.equal(price(f).props.value, action === 'set' ? '80' : ''); assertDraft(f); assert.equal(f.button('Save changes').props.disabled, true);
  });
  await test('permission loss removes saved Visit quote and Special Price before protected cleanup', async f => {
    savedQuote(f); f.props.visit.branchId = 'B'; f.props.visit.visitQuote.branchId = 'B'; await f.start(); await f.loaded(); assert.ok(summaryRow(f, 'total').includes('95.50'));
    f.scope(); assert.ok(!find(f.renderer.tree, (n: any) => n.props?.['data-visit-price-summary'])); assert.doesNotMatch(text(f.renderer.tree), /95\.50|111\.25/);
    await f.settle(); assert.match(text(f.renderer.tree), /Visit access changed/);
  });
  for (const status of [200, 401, 403, 409, 503]) await test('late Special Price save ' + status + ' cannot restore quote or clear a newer branch draft', async f => {
    await f.start(); await f.loaded(); await enterPrice(f, '85'); await f.save(); const old = f.latestSave(); await f.branch('B'); await f.loaded(); await enterPrice(f, '45');
    old.deliver(status === 200 ? { id: 'visit', visitVersion: 1, visitQuote: { total: '85.00' } }
      : { error: 'STALE_SPECIAL_PRICE_SAVE', code: status === 409 ? 'VISIT_VERSION_CHANGED' : undefined }, status); await f.settle();
    assert.equal(price(f).props.value, '45'); assert.ok(summaryRow(f, 'total').includes('45.00')); assert.ok(!text(f.renderer.tree).includes('STALE_SPECIAL_PRICE_SAVE'));
    assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.saves, 0); assert.equal(f.closes, 0);
  });

  await test('actual patient timeline cards/details prefer historical snapshot then legacy fallbacks',async f=>{
    const r=new Renderer(Timeline);const props={patientId:'patient',users:[],branches:[],visits:[
      {...f.props.visit,id:'canonical',serviceId:'gone',serviceNameSnapshot:'Historical canonical',treatmentService:'Outdated mirror'},
      {...f.props.visit,id:'text',treatmentService:'  Unchanged legacy label  '},
      {...f.props.visit,id:'performed',treatmentService:'',servicePerformed:'Imported performed label'},
      {...f.props.visit,id:'empty',treatmentService:''}]};
    try{r.render(props);assert.ok(text(r.tree).includes('Historical canonical')&&!text(r.tree).includes('Outdated mirror'));assert.ok(text(r.tree).includes('  Unchanged legacy label  ')&&text(r.tree).includes('Imported performed label')&&text(r.tree).includes('Consultation'));find(r.tree,(n:any)=>n.props?.onClick&&text(n).includes('Historical canonical')).props.onClick();r.render(props);assert.ok(text(r.tree).split('Historical canonical').length>=3);assert.equal(f.requests.length,0);}finally{r.unmount();}
  });
  await test('actual Visit history searches snapshot names and hides sealed edit actions',async f=>{
    const r=new Renderer(History);globals.historyRows={visits:[{...f.props.visit,patientName:'Synthetic patient',serviceId:'gone',serviceNameSnapshot:'Historical canonical',treatmentService:'Outdated mirror',isSigned:true},{...f.props.visit,id:'legacy-text',patientName:'Synthetic patient',treatmentService:'  Historical free-text care  ',isSigned:true}],patients:f.props.patients,users:f.props.users,branches:f.props.branches};const props={db:{},role:'doctor',userProfile:f.props.users[0]};
    try{r.render(props);for(let i=0;i<6;i++){r.passives.splice(0).forEach(run=>run());await flush();if(r.dirty)r.render(props);}assert.ok(text(r.tree).includes('Historical canonical')&&!text(r.tree).includes('Outdated mirror'));assert.ok(text(r.tree).includes('  Historical free-text care  '));assert.ok(!find(r.tree,(n:any)=>n.props?.['aria-label']==='Edit visit for Synthetic patient'));assert.equal(f.requests.length,0);}finally{r.unmount();globals.historyRows=undefined;}
  });

} finally {
  globals.fetch=saved.fetch;globals.window=saved.window;globals.document=saved.document;globals.confirm=saved.confirm;globals.alert=saved.alert;
  await rm(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify(results,null,2));
const failed=results.filter(result=>!result.passed);console.log(`Visit Services component/scope: ${results.length-failed.length}/${results.length} scenarios passed`);
if(failed.length)process.exitCode=1;
