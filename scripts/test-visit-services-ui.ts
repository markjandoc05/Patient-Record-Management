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
await writeFile(path.join(temporary, 'data.mjs'), `export function invalidateProtectedData(){globalThis.servicesTestInvalidations++;for(const f of globalThis.appointmentInvalidationListeners)f();}
export function subscribeProtectedDataInvalidation(f){globalThis.appointmentInvalidationListeners.add(f);return()=>globalThis.appointmentInvalidationListeners.delete(f);}
export const collection=(_db,name)=>({path:name});export const onSnapshot=(ref,cb)=>{cb({docs:(globalThis.historyRows?.[ref.path]||[]).map(row=>({id:row.id,data:()=>row}))});return()=>{};};export const query=()=>({}),limit=()=>({}),orderBy=()=>({}),where=()=>({}),getDocs=async()=>({docs:[]});`);
await writeFile(path.join(temporary, 'time.mjs'), "export const getActiveDatePrefix=()=> '2028-01-01';export const getActiveDateTimeInput=()=> '2028-01-01T09:00';");
await writeFile(path.join(temporary, 'utils.mjs'), 'export const formatDateTime=value=>value;');
await writeFile(path.join(temporary, 'branches.mjs'), `export const getAccessibleBranches=b=>b;export function subscribeToSharedCollection(_db,name,cb){cb(globalThis.historyRows?.[name]||[]);return()=>{}};export function subscribeToBranchScopedCollection(_db,name,_field,_profile,cb){cb(globalThis.historyRows?.[name]||[]);return()=>{}}`);
await writeFile(path.join(temporary, 'attachments.mjs'), 'export default ()=>null;');
await writeFile(path.join(temporary, 'date.mjs'), 'export const CustomDatePicker=()=>null;');
const plugins = [{ name: 'controlled-appointments', setup(b: any) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(temporary, 'react.mjs') }));
  b.onResolve({ filter: /platform$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /dataClient$/ }, () => ({ path: path.join(temporary, 'data.mjs') }));
  b.onResolve({ filter: /utils\/timezone$/ }, () => ({ path: path.join(temporary, 'time.mjs') }));
  b.onResolve({ filter: /^\.\.\/utils$/ }, () => ({ path: path.join(temporary, 'utils.mjs') }));
  b.onResolve({ filter: /utils\/branchAccess$/ }, () => ({path:path.join(temporary,'branches.mjs')}));
  b.onResolve({ filter: /FileAttachmentSection$/ }, () => ({path:path.join(temporary,'attachments.mjs')}));
  b.onResolve({ filter: /CustomDatePicker$/ }, () => ({ path: path.join(temporary, 'date.mjs') }));
} }];
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
  props: any = { patients:[{id:'patient',name:'Synthetic patient'}],branches:[{id:'A',branchName:'A',status:'Active'},{id:'B',branchName:'B',status:'Active'}],
    users:[{id:'doctor',email:'doctor@example.invalid',role:'doctor',active:true,assignedBranches:['A','B']},{id:'provider',role:'doctor',active:true,assignedBranches:['A','B']}],
    visit:{id:'visit',patientId:'patient',doctorId:'doctor',branchId:'A',visitDate:'2029-01-01T10:00',visitType:'Initial Consultation',status:'Completed',treatmentService:'  Legacy custom care  '},userRole:'doctor',
    appointments:[],onSave:()=>{this.saves++;},onClose:()=>{this.closes++;} };
  constructor(){globals.servicesTestInvalidations=0;globals.servicesTestAuth.currentUser={uid:'doctor',email:'doctor@example.invalid',getRequestToken:async()=> 'synthetic'};
    globals.fetch=(url:string,init:any)=>new Promise((resolve,reject)=>this.requests.push({url,init,deliver:(body,status=200)=>resolve(new Response(JSON.stringify(body),{status})),fail:()=>reject(new TypeError('Synthetic network failure'))}));}
  render(){this.renderer.render(this.props);}
  async settle(){for(let i=0;i<8;i++){this.renderer.passives.splice(0).forEach(run=>run());await flush();if(this.renderer.dirty)this.render();}}
  async start(){this.render();await this.settle();}
  node(id:string){const node=find(this.renderer.tree,(n:any)=>n.props?.id===id);assert.ok(node,'missing '+id);return node;}
  button(label:string){const node=find(this.renderer.tree,(n:any)=>n.type==='button'&&text(n).trim()===label);assert.ok(node,'missing '+label);return node;}
  latestGet(){return this.requests.filter(r=>r.init.method==='GET').at(-1)!;}
  latestSave(){return this.requests.filter(r=>r.init.method==='PATCH'||r.init.method==='POST').at(-1)!;}
  async loaded(rows=[service(),service('free','free'),service('unpriced','unpriced')],total=rows.length){this.latestGet().deliver({services:rows,total});await this.settle();}
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
    f.render(); await f.settle(); await f.save();
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
  await test('Completed remains editable; explicit finalization blocks even forced submit',async f=>{f.props.visit={...f.props.visit,isFinalized:true,serviceId:'sealed',serviceNameSnapshot:'Signed historical fact'};await f.start();assert.equal(f.requests.length,0);assert.equal(f.button('Save changes').props.disabled,true);assert.ok(text(f.renderer.tree).includes('Signed historical fact'));await f.save();assert.equal(f.requests.length,0);});
  await test('booked snapshot proposes performed Service; confirmation is mandatory',async f=>{const v=f.props.visit;f.props.visit=undefined;f.props.appointment={...v,id:'booking',appointmentDate:v.visitDate,serviceId:'priced',serviceNameSnapshot:'Booked old name',serviceDurationMinutesSnapshot:30,serviceCatalogueVersion:1};await f.start();await f.loaded();assert.ok(text(f.renderer.tree).includes('Booked Service:')&&text(f.renderer.tree).includes('Booked old name'));assert.equal(f.button('Save visit').props.disabled,true);await f.save();assert.ok(!f.latestSave());await reload(f);f.latestGet().deliver({...service('priced','priced',2),name:'Current performed name'});await f.settle();f.button('Use reviewed Service').props.onClick();await f.settle();assert.equal(f.button('Save visit').props.disabled,false);await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'priced',expectedVersion:2});assert.equal(f.props.appointment.serviceNameSnapshot,'Booked old name');});
  await test('booked Service can differ from performed; booking display stays historical',async f=>{const v=f.props.visit;f.props.visit=undefined;f.props.appointment={...v,id:'booking',appointmentDate:v.visitDate,serviceId:'old',serviceNameSnapshot:'Historical booked',serviceCatalogueVersion:1};await f.start();await f.loaded();await f.select('free');await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'free',expectedVersion:1});assert.ok(text(f.renderer.tree).includes('Historical booked'));});
  await test('legacy linked Visit does not adopt canonical booked Service on edit',async f=>{f.props.visit={...f.props.visit,appointmentId:'booking'};f.props.appointments=[{id:'booking',branchId:'A',serviceId:'priced',serviceNameSnapshot:'Booked only'}];await f.start();await f.loaded();assert.ok(text(f.renderer.tree).includes('Booked only'));await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('follow-up response after access loss cannot invalidate new scope or close',async f=>{f.props.visit={...f.props.visit,followUpRequired:true};globals.confirm=()=>true;await f.start();await f.loaded();await f.save();f.latestSave().deliver({id:'visit'});await f.settle();const followUp=f.latestSave();assert.ok(followUp.url.endsWith('/appointments'));f.scope();followUp.deliver({error:'OLD_FOLLOWUP_DENIAL'},403);await f.settle();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.saves,0);assert.equal(f.renderer.lateSetters,0);});

  await test('actual patient timeline cards/details prefer historical snapshot then legacy fallbacks',async f=>{
    const r=new Renderer(Timeline);const props={patientId:'patient',users:[],branches:[],visits:[
      {...f.props.visit,id:'canonical',serviceId:'gone',serviceNameSnapshot:'Historical canonical',treatmentService:'Outdated mirror'},
      {...f.props.visit,id:'text',treatmentService:'  Unchanged legacy label  '},
      {...f.props.visit,id:'performed',treatmentService:'',servicePerformed:'Imported performed label'},
      {...f.props.visit,id:'empty',treatmentService:''}]};
    try{r.render(props);assert.ok(text(r.tree).includes('Historical canonical')&&!text(r.tree).includes('Outdated mirror'));assert.ok(text(r.tree).includes('  Unchanged legacy label  ')&&text(r.tree).includes('Imported performed label')&&text(r.tree).includes('Consultation'));find(r.tree,(n:any)=>n.props?.onClick&&text(n).includes('Historical canonical')).props.onClick();r.render(props);assert.ok(text(r.tree).split('Historical canonical').length>=3);assert.equal(f.requests.length,0);}finally{r.unmount();}
  });
  await test('actual Visit history searches snapshot names and hides sealed edit actions',async f=>{
    const r=new Renderer(History);globals.historyRows={visits:[{...f.props.visit,patientName:'Synthetic patient',serviceId:'gone',serviceNameSnapshot:'Historical canonical',treatmentService:'Outdated mirror',isSigned:true}],patients:f.props.patients,users:f.props.users,branches:f.props.branches};const props={db:{},role:'doctor',userProfile:f.props.users[0]};
    try{r.render(props);for(let i=0;i<6;i++){r.passives.splice(0).forEach(run=>run());await flush();if(r.dirty)r.render(props);}assert.ok(text(r.tree).includes('Historical canonical')&&!text(r.tree).includes('Outdated mirror'));assert.ok(!find(r.tree,(n:any)=>n.props?.['aria-label']==='Edit visit for Synthetic patient'));assert.equal(f.requests.length,0);}finally{r.unmount();globals.historyRows=undefined;}
  });

} finally {
  globals.fetch=saved.fetch;globals.window=saved.window;globals.document=saved.document;globals.confirm=saved.confirm;globals.alert=saved.alert;
  await rm(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify(results,null,2));
const failed=results.filter(result=>!result.passed);console.log(`Visit Services component/scope: ${results.length-failed.length}/${results.length} scenarios passed`);
if(failed.length)process.exitCode=1;
