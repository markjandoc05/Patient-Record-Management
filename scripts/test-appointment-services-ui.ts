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
const temporary = await mkdtemp(path.join(tmpdir(), 'vine-appointment-services-ui-'));
await symlink(path.join(target, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
const globals = globalThis as any;
const saved = { fetch: globals.fetch, window: globals.window, document: globals.document };
globals.servicesTestAuth = { currentUser: { uid: 'staff', email: 'staff@example.invalid', getRequestToken: async () => 'synthetic' } };
globals.servicesTestInvalidations = 0; globals.appointmentInvalidationListeners = new Set();
globals.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: any) { callback(); } };
globals.document = { querySelector() { return null; } };
await writeFile(path.join(temporary, 'react.mjs'), `import actual from ${JSON.stringify(require.resolve('react'))};\nexport default actual;\n${['useState','useRef','useEffect','useLayoutEffect','useMemo'].map(name => `export const ${name}=(...args)=>globalThis.servicesTestHooks.${name}(...args);`).join('\n')}`);
await writeFile(path.join(temporary, 'platform.mjs'), 'export const auth=globalThis.servicesTestAuth; export const db={};');
await writeFile(path.join(temporary, 'data.mjs'), `export {captureProtectedRequestScope,protectedFetch} from "./foundation.mjs"; export function invalidateProtectedData(){globalThis.servicesTestInvalidations++;for(const f of globalThis.appointmentInvalidationListeners)f();}
export function subscribeProtectedDataInvalidation(f){globalThis.appointmentInvalidationListeners.add(f);return()=>globalThis.appointmentInvalidationListeners.delete(f);}
export const collection=()=>({}),query=()=>({}),limit=()=>({}),orderBy=()=>({}),where=()=>({}),getDocs=async()=>({docs:[]});`);
await writeFile(path.join(temporary, 'time.mjs'), "export const getActiveDatePrefix=()=> '2028-01-01';export const getActiveDateTimeInput=()=> '2028-01-01T09:00';");
await writeFile(path.join(temporary, 'utils.mjs'), 'export const formatDateTime=value=>value;');
// Keep the date widget synthetic while exercising the real form's date handler.
await writeFile(path.join(temporary, 'date.mjs'), 'export const CustomDatePicker=props=>({type:"input",props:{id:"appointment-test-date",value:props.value,disabled:props.disabled,onChange:event=>props.onChange(event.target.value)}});');
const plugins = [{ name: 'controlled-appointments', setup(b: any) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(temporary, 'react.mjs') }));
  b.onResolve({ filter: /session$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /foundation\.mjs$/ }, () => ({ path: path.join(temporary, 'foundation.mjs'), external: true }));
  b.onResolve({ filter: /platform$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /dataClient$/ }, () => ({ path: path.join(temporary, 'data.mjs') }));
  b.onResolve({ filter: /utils\/timezone$/ }, () => ({ path: path.join(temporary, 'time.mjs') }));
  b.onResolve({ filter: /^\.\.\/utils$/ }, () => ({ path: path.join(temporary, 'utils.mjs') }));
  b.onResolve({ filter: /CustomDatePicker$/ }, () => ({ path: path.join(temporary, 'date.mjs') }));
} }];
await build({ entryPoints: [path.join(target, 'src/dataClient.ts')], outfile: path.join(temporary, 'foundation.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins });
await build({ entryPoints: [path.join(target, 'src/components/AppointmentForm.tsx')], outfile: path.join(temporary, 'form.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'transform', packages: 'external', plugins });
const { default: Form } = await import(pathToFileURL(path.join(temporary, 'form.mjs')).href);
const flush = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
type Frame = { hooks: any[]; cursor: number; mounted: boolean };
class Renderer {
  frames = new Map<string, Frame>(); visited = new Set<string>(); frame!: Frame;
  layouts: (() => void)[] = []; passives: (() => void)[] = []; dirty = false; lateSetters = 0; tree: any;
  constructor() {
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
    this.tree=this.expand({type:Form,props},'root');
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
  renderer = new Renderer(); requests: { url: string; init: any; deliver: (body: any, status?: number) => void }[] = [];
  saves = 0; closes = 0;
  props: any = { patients:[{id:'patient',name:'Synthetic patient'}],branches:[{id:'A',branchName:'A',status:'Active'},{id:'B',branchName:'B',status:'Active'}],
    users:[{id:'staff',email:'staff@example.invalid',role:'staff',active:true,assignedBranches:['A','B']},{id:'provider',role:'doctor',active:true,assignedBranches:['A','B']}],
    appointment:{id:'appointment',patientId:'patient',doctorId:'provider',branchId:'A',appointmentDate:'2029-01-01T10:00',visitType:'Initial Consultation',status:'Scheduled'},
    appointments:[],onSave:()=>{this.saves++;},onClose:()=>{this.closes++;} };
  constructor(){globals.servicesTestInvalidations=0;globals.servicesTestAuth.currentUser={uid:'staff',email:'staff@example.invalid',getRequestToken:async()=> 'synthetic'};
    globals.fetch=(url:string,init:any)=>new Promise(resolve=>this.requests.push({url,init,deliver:(body,status=200)=>resolve(new Response(JSON.stringify(body),{status}))}));}
  render(){this.renderer.render(this.props);}
  async settle(){for(let i=0;i<8;i++){this.renderer.passives.splice(0).forEach(run=>run());await flush();if(this.renderer.dirty)this.render();}}
  async start(){this.render();await this.settle();}
  node(id:string){const node=find(this.renderer.tree,(n:any)=>n.props?.id===id);assert.ok(node,'missing '+id);return node;}
  button(label:string){const node=find(this.renderer.tree,(n:any)=>n.type==='button'&&text(n).trim()===label);assert.ok(node,'missing '+label);return node;}
  latestGet(){return this.requests.filter(r=>r.init.method==='GET').at(-1)!;}
  latestSave(){return this.requests.filter(r=>r.url.startsWith('/api/records/')&&(r.init.method==='PATCH'||r.init.method==='POST')).at(-1)!;}
  async loaded(rows=[service(),service('free','free'),service('unpriced','unpriced')],total=rows.length){this.latestGet().deliver({services:rows,total});await this.settle();}
  async select(id='priced'){this.node('appointment-service').props.onChange({target:{value:id}});await this.settle();}
  async branch(id='B'){this.node('appointment-branch').props.onChange({target:{value:id}});this.render();await this.settle();}
  async save(){find(this.renderer.tree,(n:any)=>n.type==='form').props.onSubmit({preventDefault(){}});await this.settle();}
  scope(){this.props={...this.props,users:this.props.users.map((u:any)=>u.id==='staff'?{...u,assignedBranches:['A']}:u),branches:this.props.branches.filter((b:any)=>b.id==='A')};this.render();}
  stop(){this.renderer.unmount();}
}
// A minimal hook runner executes production handlers; effects and keyed lifetime
// are modeled explicitly, including the interval before passive cleanup.
const results: { name: string; passed: boolean; error?: string }[]=[];
async function test(name:string,run:(f:Fixture)=>Promise<void>){const f=new Fixture();try{await run(f);results.push({name,passed:true});}catch(error:any){results.push({name,passed:false,error:error.message});}finally{f.stop();}}
try {
  await test('priced and Free selectable; unpriced excluded',async f=>{await f.start();await f.loaded();const options=text(f.node('appointment-service'));assert.ok(options.includes('Synthetic priced')&&options.includes('Synthetic free'));assert.ok(!options.includes('Synthetic unpriced'));});
  await test('new selection sends only ID/version command; visit type preserved',async f=>{await f.start();await f.loaded();await f.select();await f.save();const body=JSON.parse(f.latestSave().init.body);assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});assert.equal(body.visitType,'Initial Consultation');assert.ok(!Object.hasOwn(body,'serviceNameSnapshot'));f.latestSave().deliver({id:'appointment'});await f.settle();assert.equal(f.saves,1);});
  await test('historical snapshot displayed and omitted on unrelated edit',async f=>{f.props.appointment={...f.props.appointment,serviceId:'historical',serviceNameSnapshot:'Recorded inactive name',serviceDurationMinutesSnapshot:20,serviceCatalogueVersion:7};await f.start();await f.loaded([]);f.node('appointment-visit-type').props.onChange({target:{value:'Follow-up'}});await f.settle();assert.ok(text(f.renderer.tree).includes('Recorded inactive name'));assert.equal(f.node('appointment-service').props.value,'__recorded');await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('read-only snapshot uses no live catalogue lookup',async f=>{f.props.mode='view';f.props.appointment={...f.props.appointment,serviceId:'historical',serviceNameSnapshot:'Historic snapshot',serviceDurationMinutesSnapshot:25};await f.start();assert.equal(f.requests.length,0);assert.ok(text(f.renderer.tree).includes('Historic snapshot'));});
  await test('legacy booking has no Service command',async f=>{await f.start();await f.loaded();await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('explicit clear sends null',async f=>{await f.start();await f.loaded();await f.select();await f.select('__none');await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection,null);});
  await test('branch change clears selection and provider behavior remains',async f=>{await f.start();await f.loaded();await f.select();await f.branch();assert.equal(f.node('appointment-service').props.value,'__none');assert.equal(f.node('appointment-doctor').props.value,'provider');assert.ok(text(f.renderer.tree).includes('Clinic changed'));await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('search pagination and retry use bounded branch-filtered request',async f=>{await f.start();assert.ok(f.latestGet().url.includes('branchId=A')&&f.latestGet().url.includes('pageSize=25'));await f.loaded([service()],60);f.button('Next').props.onClick();await f.settle();assert.ok(f.latestGet().url.includes('page=2'));f.latestGet().deliver({error:'Synthetic temporary failure'},503);await f.settle();assert.ok(text(f.renderer.tree).includes('Synthetic temporary failure'));f.button('Retry').props.onClick();await f.settle();await f.loaded();assert.ok(!text(f.renderer.tree).includes('Synthetic temporary failure'));});
  for(const status of [200,401,403])for(const change of ['branch','scope','logout','invalidate','unmount'])await test(`late catalogue ${status} discarded after ${change}`,async f=>{
    await f.start();const old=f.latestGet();
    if(change==='branch'){f.node('appointment-branch').props.onChange({target:{value:'B'}});f.render();}
    if(change==='scope')f.scope();
    if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}
    if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}
    if(change==='unmount')f.stop();
    old.deliver(status===200?{services:[service('OLD_SCOPE_RESPONSE')],total:1}:{error:'OLD_SCOPE_DENIAL'},status);await flush();
    assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.renderer.lateSetters,0);if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_SCOPE_RESPONSE')&&!text(f.renderer.tree).includes('OLD_SCOPE_DENIAL'));}
  });
  for(const status of [200,401,403,409])for(const change of ['branch','scope','logout','invalidate','unmount'])await test(`late save ${status} cannot affect ${change} scope`,async f=>{
    await f.start();await f.loaded();await f.select();await f.save();const old=f.latestSave();
    if(change==='branch'){f.node('appointment-branch').props.onChange({target:{value:'B'}});f.render();}if(change==='scope')f.scope();if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}if(change==='unmount')f.stop();
    old.deliver(status===200?{id:'appointment'}:{error:'OLD_SAVE_ERROR'},status);await flush();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.saves,0);assert.equal(f.closes,0);assert.equal(f.renderer.lateSetters,0);
    if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_SAVE_ERROR'));}
  });
  await test('current save version conflict stays visible and selection preserved',async f=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Service changed. Reload Services.',code:'SERVICE_VERSION_CHANGED'},409);await f.settle();assert.ok(text(f.renderer.tree).includes('Service changed'));assert.equal(f.node('appointment-service').props.value,'priced');assert.equal(globals.servicesTestInvalidations,0);});
  for(const status of [401,403])await test(`current save denial ${status} invalidates protected scope`,async f=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Current denial'},status);await f.settle();assert.equal(globals.servicesTestInvalidations,1);assert.ok(!find(f.renderer.tree,(n:any)=>n.props?.id==='appointment-service'));assert.ok(text(f.renderer.tree).includes('Appointment access changed'));});
  await test('current catalogue denial blocks reopening loop and clears protected form',async f=>{await f.start();f.latestGet().deliver({error:'Denied current branch'},403);await f.settle();assert.equal(globals.servicesTestInvalidations,1);assert.equal(f.requests.length,1);assert.ok(text(f.renderer.tree).includes('Appointment access changed'));});
  await test('narrowing access removes historical Service from unauthorized branch',async f=>{f.props.appointment={...f.props.appointment,branchId:'B',serviceId:'historic',serviceNameSnapshot:'REMOVED_BRANCH_SNAPSHOT'};await f.start();f.scope();assert.ok(!text(f.renderer.tree).includes('REMOVED_BRANCH_SNAPSHOT'));await f.settle();assert.ok(text(f.renderer.tree).includes('Appointment access changed'));});
  await test('scope change during request-token acquisition prevents old save fetch',async f=>{await f.start();await f.loaded();await f.select();let deliver!:any;globals.servicesTestAuth.currentUser.getRequestToken=()=>new Promise(resolve=>deliver=resolve);await f.save();f.scope();deliver('synthetic');await f.settle();assert.ok(!f.latestSave());});

  const historical=(f:Fixture)=>{f.props.appointment={...f.props.appointment,serviceId:'historical',serviceNameSnapshot:'Recorded inactive name',serviceDurationMinutesSnapshot:20,serviceCatalogueVersion:7};};
  const hasButton=(f:Fixture,label:string)=>Boolean(find(f.renderer.tree,(n:any)=>n.type==='button'&&text(n).trim()===label));
  const reload=async(f:Fixture)=>{f.button('Reload Services to review changes').props.onClick();await f.settle();assert.ok(f.latestGet().url.includes('/api/services/priced?branchId=A'));};
  const conflict=async(f:Fixture)=>{await f.start();await f.loaded();await f.select();await f.save();f.latestSave().deliver({error:'Service changed',code:'SERVICE_VERSION_CHANGED'},409);await f.settle();};
  await test('historical A-B-A preserves snapshot without Service interaction',async f=>{historical(f);await f.start();await f.loaded([]);await f.branch('B');await f.branch('A');await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));assert.ok(text(f.renderer.tree).includes('Recorded inactive name'));});
  await test('historical permanent branch change blocks unresolved save',async f=>{historical(f);await f.start();await f.loaded([]);await f.branch();await f.save();assert.ok(!f.latestSave());assert.ok(text(f.renderer.tree).includes('explicitly remove'));assert.equal(f.button('Save changes').props.disabled,true);});
  await test('historical new branch replacement sends authoritative command',async f=>{historical(f);await f.start();await f.loaded();await f.branch();await f.loaded([service('replacement')]);await f.select('replacement');await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'replacement',expectedVersion:1});});
  await test('historical explicit removal is visible and survives branch roundtrip',async f=>{historical(f);await f.start();await f.loaded([]);await f.branch();f.button('Remove Service').props.onClick();await f.settle();await f.branch('A');assert.ok(text(f.renderer.tree).includes('will be removed'));await f.save();assert.equal(JSON.parse(f.latestSave().init.body).serviceSelection,null);});
  await test('catalogue failure and retry never remove historical Service',async f=>{historical(f);await f.start();f.latestGet().deliver({error:'Unavailable catalogue'},503);await f.settle();f.button('Retry').props.onClick();await f.settle();await f.loaded([]);await f.save();assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('new unsaved appointment branch change resets draft without removal',async f=>{f.props.appointment=undefined;await f.start();await f.branch('A');await f.loaded();await f.select();await f.branch('B');assert.equal(f.node('appointment-service').props.value,'__none');assert.ok(!text(f.renderer.tree).includes('will be removed'));await f.loaded([]);assert.equal(f.node('appointment-service').props.value,'__none');f.node('appointment-patient').props.onChange({target:{value:'Synthetic'}});await f.settle();find(f.renderer.tree,(n:any)=>n.type==='button'&&text(n).includes('Synthetic patient')).props.onClick();f.node('appointment-doctor').props.onChange({target:{value:'provider'}});await f.settle();f.button('10:00 AM').props.onClick();await f.settle();await f.save();assert.equal(f.latestSave().init.method,'POST');assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'serviceSelection'));});
  await test('price context uses only API resolved branch price and never writes amount',async f=>{await f.start();const row=service();row.branches[1].effectivePrice.amount='987.65';await f.loaded([row,service('free','free')]);const options=text(f.node('appointment-service'));assert.ok(options.includes('123.45')&&options.includes('Free')&&options.includes('current catalogue price'));assert.ok(!text(f.renderer.tree).includes('987.65'));await f.select();await f.save();const body=JSON.parse(f.latestSave().init.body);assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});assert.ok(!JSON.stringify(body).includes('123.45'));});
  await test('409 targeted review confirms renamed duration price and version together',async f=>{await conflict(f);assert.equal(f.button('Save changes').props.disabled,true);await reload(f);const latest={...service('priced','priced',2),name:'Renamed catalogue',default_duration_minutes:75};latest.branches[0].effectivePrice.amount='321.45';f.latestGet().deliver(latest);await f.settle();assert.ok(text(f.renderer.tree).includes('Renamed catalogue')&&/75\s+min/.test(text(f.renderer.tree))&&text(f.renderer.tree).includes('321.45'));const count=f.requests.length;await f.save();assert.equal(f.requests.length,count);f.button('Use reviewed Service').props.onClick();await f.settle();assert.equal(f.button('Save changes').props.disabled,false);assert.ok(text(f.node('appointment-service')).includes('Renamed catalogue · 75 min')&&text(f.node('appointment-service')).includes('v2'));await f.save();assert.deepEqual(JSON.parse(f.latestSave().init.body).serviceSelection,{serviceId:'priced',expectedVersion:2});f.latestSave().deliver({id:'appointment'});await f.settle();assert.equal(f.saves,1);});
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
  for(const status of [401,403])await test(`current targeted review denial ${status} invalidates normally`,async f=>{await f.start();await f.loaded();await f.select();await reload(f);f.latestGet().deliver({error:'Current review denial'},status);await f.settle();assert.equal(globals.servicesTestInvalidations,1);assert.ok(text(f.renderer.tree).includes('Appointment access changed'));});

  const price=(f:Fixture)=>f.node('appointment-special-price');
  const enterPrice=async(f:Fixture,value:string)=>{price(f).props.onChange({target:{value}});await f.settle();};
  const quoted=(f:Fixture,value='6000.00')=>{f.props.appointment={...f.props.appointment,specialPrice:value,notes:'Preserved scheduling notes'};};
  const startNew=async(f:Fixture)=>{
    f.props.appointment=undefined;f.props.defaultBranchId='A';await f.start();await f.loaded();
    f.node('appointment-patient').props.onChange({target:{value:'Synthetic'}});await f.settle();
    find(f.renderer.tree,(n:any)=>n.type==='button'&&text(n).includes('Synthetic patient')).props.onClick();await f.settle();
    f.button('10:00 AM').props.onClick();await f.settle();
  };
  await test('Special Price label is associated with an optional independent booking field',async f=>{
    await f.start();await f.loaded();
    const label=find(f.renderer.tree,(n:any)=>n.type==='label'&&n.props?.htmlFor==='appointment-special-price');
    assert.equal(text(label).trim(),'Special Price:');assert.equal(price(f).props['data-appointment-field'],'specialPrice');
    assert.ok(!price(f).props.required);assert.equal(price(f).props.disabled,false);assert.equal(price(f).props.value,'');
    assert.ok(text(f.renderer.tree).includes('quote'));assert.ok(!find(f.node('appointment-service'),(n:any)=>n.props?.id==='appointment-special-price'));
  });
  await test('Special Price formatting on blur preserves raw editing and the normalized save command',async f=>{
    await f.start();await f.loaded();await enterPrice(f,'10000.5');assert.equal(price(f).props.value,'10000.5');
    price(f).props.onBlur();await f.settle();assert.equal(price(f).props.value,'10,000.50');
    price(f).props.onFocus();await f.settle();assert.equal(price(f).props.value,'10000.5');
    price(f).props.onBlur();await f.settle();await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,'10000.50');assert.equal(body.expectedPricingRevision,0);assert.ok(!body.specialPrice.includes(','));
  });
  await test('saved Special Price focus and blur preserve its quote and omit an unchanged price command',async f=>{
    quoted(f);await f.start();await f.loaded();assert.equal(price(f).props.value,'6,000.00');
    price(f).props.onFocus();await f.settle();assert.equal(price(f).props.value,'6000.00');
    price(f).props.onBlur();await f.settle();assert.equal(price(f).props.value,'6,000.00');
    await f.save();const body=JSON.parse(f.latestSave().init.body);assert.ok(!Object.hasOwn(body,'specialPrice'));
    assert.equal(body.notes,'Preserved scheduling notes');
  });
  await test('blur preserves blank and invalid Special Price drafts without fabricating an amount',async f=>{
    await f.start();await f.loaded();price(f).props.onFocus();await f.settle();price(f).props.onBlur();await f.settle();
    assert.equal(price(f).props.value,'');
    for(const invalid of ['-1','12.345','1e3','10,000.50']){
      await enterPrice(f,invalid);price(f).props.onBlur();await f.settle();assert.equal(price(f).props.value,invalid);
      await f.save();assert.ok(!f.latestSave());assert.equal(price(f).props['aria-invalid'],true);
    }
  });
  await test('blank Special Price remains optional for a new appointment and creates no quote command',async f=>{
    await startNew(f);await f.save();assert.equal(f.latestSave().init.method,'POST');
    assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'specialPrice'));
  });
  for(const [entered,expected]of [['6000','6000.00'],['6000.5','6000.50'],['0','0.00'],['0.01','0.01']])await test(`Special Price ${entered} is normalized without changing the catalogue command`,async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,entered);await f.save();
    const body=JSON.parse(f.latestSave().init.body);assert.equal(body.specialPrice,expected);
    assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});assert.ok(!Object.hasOwn(body,'serviceNameSnapshot'));
    assert.ok(text(f.node('appointment-service')).includes('123.45'));assert.ok(!JSON.stringify(body).includes('123.45'));
  });
  await test('new appointment can quote a Special Price without selecting a canonical Service',async f=>{
    await startNew(f);await enterPrice(f,'750');await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,'750.00');assert.ok(!Object.hasOwn(body,'serviceSelection'));
  });
  await test('saved Special Price loads and stays omitted on an unrelated edit',async f=>{
    quoted(f);await f.start();await f.loaded();assert.equal(price(f).props.value,'6,000.00');
    f.node('appointment-visit-type').props.onChange({target:{value:'Follow-up'}});await f.settle();await f.save();
    const body=JSON.parse(f.latestSave().init.body);assert.ok(!Object.hasOwn(body,'specialPrice'));
    assert.equal(body.notes,'Preserved scheduling notes');assert.equal(body.visitType,'Follow-up');
  });
  await test('saved Special Price can be explicitly cleared without erasing notes',async f=>{
    quoted(f);await f.start();await f.loaded();await enterPrice(f,'');await f.save();
    const body=JSON.parse(f.latestSave().init.body);assert.equal(body.specialPrice,null);assert.equal(body.notes,'Preserved scheduling notes');
  });
  await test('saved zero quote is displayed and omitted when unchanged',async f=>{
    quoted(f,'0.00');await f.start();await f.loaded();assert.equal(price(f).props.value,'0.00');await f.save();
    assert.ok(!Object.hasOwn(JSON.parse(f.latestSave().init.body),'specialPrice'));
  });
  for(const invalid of ['-0.01','12.345','abc'])await test(`invalid Special Price ${invalid} blocks saving and preserves Service and notes`,async f=>{
    quoted(f);await f.start();await f.loaded();await f.select();await enterPrice(f,invalid);await f.save();
    assert.ok(!f.latestSave());assert.equal(price(f).props.value,invalid);assert.equal(price(f).props['aria-invalid'],true);
    assert.equal(f.node('appointment-service').props.value,'priced');assert.equal(f.node('appointment-notes').props.value,'Preserved scheduling notes');
  });
  await test('branch change clears a saved quote with an explicit removal and preserves other fields',async f=>{
    quoted(f);await f.start();await f.loaded();await f.branch('B');assert.equal(price(f).props.value,'');
    assert.ok(text(f.renderer.tree).includes('Special Price cleared'));assert.equal(f.node('appointment-notes').props.value,'Preserved scheduling notes');
    assert.equal(f.node('appointment-doctor').props.value,'provider');await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,null);assert.equal(body.branchId,'B');assert.equal(body.notes,'Preserved scheduling notes');
  });
  await test('branch A-B-A never silently restores the previous Special Price',async f=>{
    quoted(f);await f.start();await f.loaded();await f.branch('B');await f.branch('A');assert.equal(price(f).props.value,'');await f.save();
    assert.equal(JSON.parse(f.latestSave().init.body).specialPrice,null);
  });
  await test('changing the selected Service clears an entered quote, and staff can quote the replacement',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'6000');await f.select('free');
    assert.equal(price(f).props.value,'');assert.ok(text(f.renderer.tree).includes('Special Price cleared'));
    await enterPrice(f,'500');await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,'500.00');assert.deepEqual(body.serviceSelection,{serviceId:'free',expectedVersion:1});
  });
  await test('removing a Service explicitly clears its saved Special Price',async f=>{
    quoted(f);f.props.appointment={...f.props.appointment,serviceId:'priced',serviceNameSnapshot:'Synthetic priced',serviceCatalogueVersion:1};
    await f.start();await f.loaded();f.button('Remove Service').props.onClick();await f.settle();assert.equal(price(f).props.value,'');await f.save();
    const body=JSON.parse(f.latestSave().init.body);assert.equal(body.specialPrice,null);assert.equal(body.serviceSelection,null);
  });
  await test('confirming a new catalogue version clears the previous quote until staff enters it again',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'6000');await reload(f);
    f.latestGet().deliver(service('priced','priced',2));await f.settle();f.button('Use reviewed Service').props.onClick();await f.settle();
    assert.equal(price(f).props.value,'');assert.ok(text(f.renderer.tree).includes('Special Price cleared'));await f.save();
    const body=JSON.parse(f.latestSave().init.body);assert.equal(body.specialPrice,null);assert.equal(body.serviceSelection.expectedVersion,2);
  });
  await test('catalogue search and reload without changed Service context preserve a quote',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'6000');await reload(f);
    f.latestGet().deliver(service());await f.settle();f.button('Use reviewed Service').props.onClick();await f.settle();
    assert.equal(price(f).props.value,'6000');await f.save();assert.equal(JSON.parse(f.latestSave().init.body).specialPrice,'6000.00');
  });
  for(const lock of ['view','archived','visit-linked','no-appointment-permission'])await test(`Special Price follows existing ${lock} read-only behavior`,async f=>{
    quoted(f);if(lock==='view')f.props.mode='view';if(lock==='archived')f.props.appointment.isArchived=true;if(lock==='visit-linked')f.props.appointment.visitHistoryCreated=true;
    if(lock==='no-appointment-permission')f.props.users[0].role='unknown';
    await f.start();assert.equal(price(f).props.value,'6,000.00');assert.equal(price(f).props.disabled,true);
    await f.save();assert.ok(!f.latestSave());
  });
  await test('Special Price is disabled during saving and retained when the current save fails',async f=>{
    quoted(f);await f.start();await f.loaded();await enterPrice(f,'6200');await f.save();assert.equal(price(f).props.disabled,true);
    assert.ok(find(f.renderer.tree,(n:any)=>n.type==='fieldset'&&n.props.disabled&&find(n.props.children,(child:any)=>child.props?.id==='appointment-special-price')));
    f.latestSave().deliver({error:'Synthetic temporary save failure'},503);await f.settle();assert.equal(price(f).props.disabled,false);
    assert.equal(price(f).props.value,'6200');assert.equal(f.node('appointment-notes').props.value,'Preserved scheduling notes');
    assert.ok(text(f.renderer.tree).includes('Synthetic temporary save failure'));assert.equal(f.closes,0);
  });
  await test('unsaved booking notes survive Special Price validation and a failed save before retry',async f=>{
    await startNew(f);assert.equal(f.node('appointment-notes').props.disabled,false);
    f.node('appointment-notes').props.onChange({target:{value:'Unsaved special arrangement'}});await f.settle();
    await enterPrice(f,'-1');await f.save();assert.ok(!f.latestSave());assert.equal(f.node('appointment-notes').props.value,'Unsaved special arrangement');
    await enterPrice(f,'6200');await f.save();f.latestSave().deliver({error:'Synthetic retry needed'},503);await f.settle();
    assert.equal(f.node('appointment-notes').props.value,'Unsaved special arrangement');assert.equal(price(f).props.value,'6200');
    await f.save();const body=JSON.parse(f.latestSave().init.body);assert.equal(body.notes,'Unsaved special arrangement');assert.equal(body.specialPrice,'6200.00');
  });
  await test('lost branch access removes a protected Special Price immediately',async f=>{
    quoted(f,'9876.54');f.props.appointment.branchId='B';await f.start();assert.equal(price(f).props.value,'9,876.54');f.scope();
    assert.ok(!find(f.renderer.tree,(n:any)=>n.props?.id==='appointment-special-price'));assert.ok(!text(f.renderer.tree).includes('9876.54')&&!text(f.renderer.tree).includes('9,876.54'));
    await f.settle();assert.ok(text(f.renderer.tree).includes('Appointment access changed'));
  });
  await test('pending save prevents programmatic price and Service edits from replacing submitted quote intent',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'6000');await f.save();
    await enterPrice(f,'9000');await f.select('free');assert.equal(price(f).props.value,'6000');assert.equal(f.node('appointment-service').props.value,'priced');
    f.latestSave().deliver({error:'Current Service changed',code:'SERVICE_VERSION_CHANGED'},409);await f.settle();
    assert.equal(price(f).props.value,'6000');assert.ok(text(f.renderer.tree).includes('Current Service changed'));assert.equal(f.closes,0);
  });
  for(const status of [200,401,403,409,503])await test(`old save ${status} cannot restore a cleared Special Price after branch change`,async f=>{
    quoted(f);await f.start();await f.loaded();await enterPrice(f,'6200');await f.save();const old=f.latestSave();
    await f.branch('B');assert.equal(price(f).props.value,'');old.deliver(status===200?{id:'appointment'}:{error:'OLD_QUOTE_SAVE_ERROR',code:'SERVICE_VERSION_CHANGED'},status);await f.settle();
    assert.equal(f.saves,0);assert.equal(f.closes,0);assert.equal(price(f).props.value,'');assert.equal(f.node('appointment-branch').props.value,'B');
    assert.ok(!text(f.renderer.tree).includes('OLD_QUOTE_SAVE_ERROR'));assert.equal(globals.servicesTestInvalidations,0);
  });
  for(const status of [401,403])await test(`current access denial ${status} invalidates protected Special Price normally`,async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'6000');await f.save();const old=f.latestSave();
    old.deliver({error:'Current scope denied'},status);await f.settle();assert.equal(globals.servicesTestInvalidations,1);
    assert.ok(!find(f.renderer.tree,(n:any)=>n.props?.id==='appointment-special-price'));assert.ok(text(f.renderer.tree).includes('Appointment access changed'));
  });

  // Exercise the actual pricing summary rather than the Service picker's current
  // catalogue labels. No POS route, module or configuration is provided here.
  const summary=(f:Fixture)=>{
    const node=find(f.renderer.tree,(n:any)=>[true,'true'].includes(n.props?.['data-booking-price-summary']));
    assert.ok(node,'missing Booking Price Summary');assert.equal(node.props['aria-label'],'Booking Price Summary');return node;
  };
  const hasSummaryRow=(f:Fixture,row:string)=>Boolean(find(summary(f),(n:any)=>n.props?.['data-booking-price-row']===row));
  const summaryRow=(f:Fixture,row:string)=>{
    const node=find(summary(f),(n:any)=>n.props?.['data-booking-price-row']===row);
    assert.ok(node,'missing Booking Price Summary row '+row);return text(node);
  };
  const savedBooking=(f:Fixture,overrides:Record<string,unknown>={})=>{
    f.props.appointment={...f.props.appointment,serviceId:'priced',serviceNameSnapshot:'Saved Service name',serviceDurationMinutesSnapshot:45,serviceCatalogueVersion:1,
      specialPrice:'95.50',notes:'Preserved scheduling notes',bookingQuote:{version:1,currency:'PHP',branchId:'A',serviceId:'priced',serviceCatalogueVersion:1,
        servicePrice:'111.25',specialPrice:'95.50',total:'95.50',source:'special',quotedAt:'2026-10-23T01:00:00.000Z',quotedByUid:'staff',quotedByName:'Synthetic staff',...overrides}};
  };
  const noQuoteCommand=(body:any)=>{
    for(const key of ['bookingQuote','bookingTotal','servicePrice','total','quote','quotedAt','quotedByUid','quotedByName'])assert.ok(!Object.hasOwn(body,key),'client must not author '+key);
  };
  await test('Booking Price Summary computes selected Service without POS and sends only authoritative selection intent',async f=>{
    await f.start();await f.loaded();await f.select();assert.ok(summaryRow(f,'servicePrice').includes('123.45'));
    assert.ok(!hasSummaryRow(f,'specialPrice'));assert.ok(summaryRow(f,'total').includes('123.45'));
    assert.ok(text(summary(f)).includes('Price summary'));assert.ok(text(summary(f)).includes('Quoted total'));assert.ok(text(summary(f)).includes('Quote only. Payment is recorded separately.'));await f.save();const body=JSON.parse(f.latestSave().init.body);
    noQuoteCommand(body);assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});
    assert.ok(!f.requests.some(request=>request.url.toLowerCase().includes('/pos')));
    f.latestSave().deliver({id:'appointment'});await f.settle();assert.equal(f.saves,1);
  });
  await test('new booking without a Service or Special Price displays Price not set instead of Free',async f=>{
    await startNew(f);assert.ok(!hasSummaryRow(f,'servicePrice'));assert.ok(!hasSummaryRow(f,'specialPrice'));assert.ok(summaryRow(f,'total').includes('Price not set'));
    assert.ok(!summaryRow(f,'total').includes('Free'));await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);
    assert.ok(!Object.hasOwn(body,'specialPrice'));assert.ok(!Object.hasOwn(body,'serviceSelection'));
  });
  await test('explicitly Free Service displays Free as its Service price and booking total',async f=>{
    await f.start();await f.loaded();await f.select('free');assert.ok(summaryRow(f,'servicePrice').includes('Free'));
    assert.ok(summaryRow(f,'total').includes('Free'));assert.ok(!summaryRow(f,'total').includes('Price not set'));
  });
  for(const [entered,amount]of [['100','100.00'],['12.5','12.50'],['0.01','0.01'],['9999999999.99','9,999,999,999.99']])await test(`Special Price ${entered} overrides the Service in the booking summary`,async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,entered);
    assert.ok(summaryRow(f,'servicePrice').includes('123.45'));assert.equal(summaryRow(f,'specialPrice'),'Special Price applied');
    assert.ok(summaryRow(f,'total').includes(amount));assert.ok(!summaryRow(f,'total').includes('123.45'));
  });
  await test('Special Price zero makes the booking total Free without changing its Service price',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'0');assert.ok(summaryRow(f,'servicePrice').includes('123.45'));
    assert.equal(summaryRow(f,'specialPrice'),'Special Price applied');assert.ok(summaryRow(f,'total').includes('Free'));
    await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);assert.equal(body.specialPrice,'0.00');
  });
  await test('clearing an entered Special Price restores the selected Service price',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'80');assert.ok(summaryRow(f,'total').includes('80.00'));
    await enterPrice(f,'');assert.ok(!hasSummaryRow(f,'specialPrice'));assert.ok(summaryRow(f,'total').includes('123.45'));
  });
  await test('new booking without a Service computes its independent Special Price',async f=>{
    await startNew(f);await enterPrice(f,'750');assert.ok(!hasSummaryRow(f,'servicePrice'));assert.ok(!text(summary(f)).includes('Price not set'));
    assert.equal(summaryRow(f,'specialPrice'),'Special Price applied');assert.ok(summaryRow(f,'total').includes('750.00'));
    await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);assert.equal(body.specialPrice,'750.00');
  });
  for(const invalid of ['-1','abc','12.345','1e3','₱100'])await test(`invalid Special Price ${invalid} never becomes a Free or catalogue-total summary`,async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,invalid);const total=summaryRow(f,'total');
    assert.ok(total.includes('Enter a valid Special Price'));assert.ok(!total.includes('Free')&&!total.includes('123.45'));
    await f.save();assert.ok(!f.latestSave());assert.equal(price(f).props.value,invalid);
  });
  await test('saved quote remains visible when the current catalogue price changes',async f=>{
    savedBooking(f);await f.start();const current=service();current.branches[0].effectivePrice.amount='9876.54';await f.loaded([current]);
    assert.ok(text(summary(f)).includes('Saved booking quote'));assert.ok(summaryRow(f,'servicePrice').includes('111.25'));
    assert.equal(summaryRow(f,'specialPrice'),'Special Price applied');assert.ok(summaryRow(f,'total').includes('95.50'));
    assert.ok(!text(summary(f)).includes('9876.54'));f.node('appointment-notes').props.onChange({target:{value:'Edited notes only'}});await f.settle();
    await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);assert.ok(!Object.hasOwn(body,'specialPrice'));
    assert.ok(!Object.hasOwn(body,'serviceSelection'));assert.equal(body.notes,'Edited notes only');
  });
  await test('read-only saved quote renders without a live catalogue request',async f=>{
    savedBooking(f);f.props.mode='view';await f.start();assert.equal(f.requests.length,0);assert.ok(text(summary(f)).includes('Saved booking quote'));
    assert.ok(summaryRow(f,'servicePrice').includes('111.25'));assert.ok(summaryRow(f,'total').includes('95.50'));assert.equal(price(f).props.disabled,true);
  });
  await test('saved Service-only quote keeps the original catalogue amount on unrelated edits',async f=>{
    savedBooking(f,{specialPrice:null,total:'111.25',source:'service'});f.props.appointment.specialPrice=null;
    await f.start();await f.loaded();assert.ok(summaryRow(f,'servicePrice').includes('111.25'));assert.ok(!hasSummaryRow(f,'specialPrice'));
    assert.ok(summaryRow(f,'total').includes('111.25'));await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);
    assert.ok(!Object.hasOwn(body,'specialPrice')&&!Object.hasOwn(body,'serviceSelection'));
  });
  await test('saved Free quote remains Free after the catalogue is no longer free',async f=>{
    savedBooking(f,{servicePrice:'0.00',specialPrice:null,total:'0.00',source:'service'});f.props.appointment.specialPrice=null;
    await f.start();await f.loaded();assert.ok(summaryRow(f,'servicePrice').includes('Free'));assert.ok(summaryRow(f,'total').includes('Free'));
    await f.save();noQuoteCommand(JSON.parse(f.latestSave().init.body));
  });
  await test('editing a saved Special Price calculates against the saved base, not the latest catalogue price',async f=>{
    savedBooking(f);await f.start();await f.loaded();await enterPrice(f,'90');assert.ok(summaryRow(f,'servicePrice').includes('111.25'));
    assert.ok(summaryRow(f,'total').includes('90.00'));await enterPrice(f,'');assert.ok(summaryRow(f,'total').includes('111.25'));
    await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);assert.equal(body.specialPrice,null);
  });
  await test('legacy Service with no saved quote is never silently repriced by catalogue loading',async f=>{
    historical(f);await f.start();await f.loaded();assert.ok(summaryRow(f,'servicePrice').includes('Price not set'));assert.ok(summaryRow(f,'total').includes('Price not set'));
    assert.ok(text(summary(f)).includes('To set a Service price for this booking, select and confirm the current Service.'));
    await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);assert.ok(!Object.hasOwn(body,'serviceSelection'));
  });
  await test('legacy raw Special Price remains visible without inventing a catalogue-price snapshot',async f=>{
    quoted(f,'650.25');historical(f);await f.start();await f.loaded();assert.ok(summaryRow(f,'servicePrice').includes('Price not set'));
    assert.equal(summaryRow(f,'specialPrice'),'Special Price applied');assert.ok(summaryRow(f,'total').includes('650.25'));
    await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);assert.ok(!Object.hasOwn(body,'specialPrice'));
  });
  await test('legacy booking explicitly selecting a current Service can preview and request a current quote',async f=>{
    historical(f);await f.start();await f.loaded();await f.select();assert.ok(summaryRow(f,'servicePrice').includes('123.45'));
    assert.ok(summaryRow(f,'total').includes('123.45'));await f.save();const body=JSON.parse(f.latestSave().init.body);noQuoteCommand(body);
    assert.deepEqual(body.serviceSelection,{serviceId:'priced',expectedVersion:1});
  });
  await test('saved quote with a mismatched branch is hidden rather than shown as authorized current pricing',async f=>{
    savedBooking(f,{branchId:'B',servicePrice:'9876.54',specialPrice:null,total:'9876.54',source:'service'});f.props.appointment.specialPrice=null;
    await f.start();await f.loaded();assert.ok(!text(summary(f)).includes('9876.54'));assert.ok(summaryRow(f,'total').includes('Price not set'));
  });
  await test('branch change removes the saved base and Special Price before a new branch selection',async f=>{
    savedBooking(f);await f.start();await f.loaded();await f.branch('B');assert.ok(!text(summary(f)).includes('111.25')&&!text(summary(f)).includes('95.50'));
    const row=service();row.branches[0].effectivePrice.amount='9876.54';row.branches[1].effectivePrice.amount='345.67';await f.loaded([row]);
    await f.select();assert.ok(summaryRow(f,'servicePrice').includes('345.67'));assert.ok(summaryRow(f,'total').includes('345.67'));
    assert.ok(!text(summary(f)).includes('9876.54'));assert.equal(price(f).props.value,'');await f.save();noQuoteCommand(JSON.parse(f.latestSave().init.body));
  });
  await test('Service replacement clears the prior Special Price and computes the replacement price only',async f=>{
    savedBooking(f);await f.start();await f.loaded();await f.select('free');assert.equal(price(f).props.value,'');
    assert.ok(summaryRow(f,'servicePrice').includes('Free'));assert.ok(!hasSummaryRow(f,'specialPrice'));assert.ok(summaryRow(f,'total').includes('Free'));
    assert.ok(!text(summary(f)).includes('111.25')&&!text(summary(f)).includes('95.50'));
  });
  await test('removing a saved Service and Special Price shows an unset total, preserving the booking notes',async f=>{
    savedBooking(f);await f.start();await f.loaded();f.button('Remove Service').props.onClick();await f.settle();
    assert.ok(summaryRow(f,'total').includes('Price not set'));assert.ok(!text(summary(f)).includes('111.25')&&!text(summary(f)).includes('95.50'));
    assert.equal(f.node('appointment-notes').props.value,'Preserved scheduling notes');await f.save();const body=JSON.parse(f.latestSave().init.body);
    noQuoteCommand(body);assert.equal(body.specialPrice,null);assert.equal(body.serviceSelection,null);
  });
  await test('pending save freezes the displayed submitted quote and a failure preserves that quote',async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'85');await f.save();assert.ok(summaryRow(f,'total').includes('85.00'));
    await enterPrice(f,'999');await f.select('free');assert.ok(summaryRow(f,'total').includes('85.00'));
    f.latestSave().deliver({error:'Synthetic quote retry'},503);await f.settle();assert.ok(summaryRow(f,'total').includes('85.00'));
    assert.equal(price(f).props.disabled,false);assert.ok(text(f.renderer.tree).includes('Synthetic quote retry'));
  });
  await test('losing branch access immediately removes the protected saved booking summary',async f=>{
    savedBooking(f,{branchId:'B',servicePrice:'9876.54',specialPrice:'8765.43',total:'8765.43'});f.props.appointment.branchId='B';f.props.appointment.specialPrice='8765.43';
    await f.start();assert.ok(summaryRow(f,'total').includes('8,765.43'));f.scope();
    assert.ok(!find(f.renderer.tree,(n:any)=>[true,'true'].includes(n.props?.['data-booking-price-summary'])));assert.ok(!text(f.renderer.tree).includes('8765.43')&&!text(f.renderer.tree).includes('8,765.43'));
    await f.settle();assert.ok(text(f.renderer.tree).includes('Appointment access changed'));
  });
  for(const status of [200,401,403])await test(`late branch catalogue ${status} cannot restore an old price summary`,async f=>{
    await f.start();const old=f.latestGet();await f.branch('B');const current=service();current.branches[1].effectivePrice.amount='345.67';await f.loaded([current]);await f.select();
    const stale=service();stale.branches[0].effectivePrice.amount='9876.54';old.deliver(status===200?{services:[stale],total:1}:{error:'OLD_PRICE_SCOPE_DENIAL'},status);await f.settle();
    assert.ok(summaryRow(f,'total').includes('345.67'));assert.ok(!text(summary(f)).includes('9876.54'));assert.equal(globals.servicesTestInvalidations,0);
  });
  for(const status of [200,401,403,409,503])await test(`old save ${status} cannot restore an earlier protected booking quote`,async f=>{
    await f.start();await f.loaded();await f.select();await enterPrice(f,'85');await f.save();const old=f.latestSave();
    await f.branch('B');await f.loaded([service('free','free')]);await f.select('free');assert.ok(summaryRow(f,'total').includes('Free'));
    old.deliver(status===200?{id:'appointment',bookingQuote:{total:'85.00'}}:{error:'OLD_SUMMARY_SAVE_ERROR'},status);await f.settle();
    assert.ok(summaryRow(f,'total').includes('Free'));assert.ok(!text(summary(f)).includes('85.00'));assert.equal(f.saves,0);assert.equal(f.closes,0);
    assert.equal(globals.servicesTestInvalidations,0);assert.ok(!text(f.renderer.tree).includes('OLD_SUMMARY_SAVE_ERROR'));
  });

  // Pricing revisions protect only explicit Special Price changes. Record polls
  // and conflict responses must never silently acknowledge a new saved quote.
  const pricingWrites=(f:Fixture)=>f.requests.filter(r=>r.url.startsWith('/api/records/appointments')&&['PATCH','POST'].includes(r.init.method));
  const latestPricingReview=(f:Fixture)=>f.requests.filter(r=>r.url==='/api/data/query').at(-1)!;
  const pricingRecord=(f:Fixture,extra:Record<string,unknown>={})=>({...f.props.appointment,
    bookingPricingRevision:5,serviceId:'replacement',serviceNameSnapshot:'LATEST_SAVED_SERVICE',serviceCatalogueVersion:2,
    serviceDurationMinutesSnapshot:60,specialPrice:'230.00',notes:'LATEST_SERVER_NOTES',mainConcern:'LATEST_SERVER_CONCERN',
    bookingQuote:{version:1,currency:'PHP',branchId:'A',serviceId:'replacement',serviceCatalogueVersion:2,
      servicePrice:'245.00',specialPrice:'230.00',total:'230.00',source:'special',quotedAt:'2026-10-23T02:00:00.000Z',
      quotedByUid:'other-staff',quotedByName:'Other synthetic staff'},...extra});
  const beginPricingConflict=async(f:Fixture,entered='80')=>{
    savedBooking(f);f.props.appointment.bookingPricingRevision=4;await f.start();await f.loaded();await enterPrice(f,entered);await f.save();
    f.latestSave().deliver({error:'Saved booking pricing changed. Your draft has been kept.',code:'SPECIAL_PRICE_CONTEXT_CHANGED'},409);await f.settle();
  };
  const requestPricingReview=async(f:Fixture)=>{f.button('Review latest pricing').props.onClick();await f.settle();
    assert.deepEqual(JSON.parse(latestPricingReview(f).init.body),{path:'appointments/appointment',kind:'document'});};
  const acknowledgePricingReview=async(f:Fixture)=>{f.button('Use reviewed pricing and keep my draft').props.onClick();await f.settle();};
  for(const [entered,expected]of [['80','80.00'],['',null]]as const)await test(`legacy explicit Special Price ${expected===null?'clear':'set'} sends revision zero`,async f=>{
    quoted(f);await f.start();await f.loaded();await enterPrice(f,entered);await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,expected);assert.equal(body.expectedPricingRevision,0);assert.ok(!Object.hasOwn(body,'bookingPricingRevision'));
  });
  for(const [entered,expected]of [['80','80.00'],['',null]]as const)await test(`saved explicit Special Price ${expected===null?'clear':'set'} sends the opened pricing revision`,async f=>{
    savedBooking(f);f.props.appointment.bookingPricingRevision=4;await f.start();await f.loaded();await enterPrice(f,entered);await f.save();
    const body=JSON.parse(f.latestSave().init.body);assert.equal(body.specialPrice,expected);assert.equal(body.expectedPricingRevision,4);
  });
  await test('unrelated appointment edits do not submit or rebase the pricing revision',async f=>{
    savedBooking(f);f.props.appointment.bookingPricingRevision=4;await f.start();await f.loaded();
    f.node('appointment-visit-type').props.onChange({target:{value:'Follow-up'}});await f.settle();await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.ok(!Object.hasOwn(body,'specialPrice'));assert.ok(!Object.hasOwn(body,'expectedPricingRevision'));assert.ok(!Object.hasOwn(body,'bookingPricingRevision'));
  });
  await test('new Special Price create does not invent an expected existing pricing revision',async f=>{
    await startNew(f);await enterPrice(f,'80');await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,'80.00');assert.ok(!Object.hasOwn(body,'expectedPricingRevision'));assert.ok(!Object.hasOwn(body,'bookingPricingRevision'));
  });
  await test('appointment polling cannot advance the opened pricing revision or replace an unsaved Special Price',async f=>{
    savedBooking(f);f.props.appointment.bookingPricingRevision=4;await f.start();await f.loaded();await enterPrice(f,'80');
    f.props.appointment=pricingRecord(f);f.render();await f.settle();assert.equal(price(f).props.value,'80');assert.ok(summaryRow(f,'servicePrice').includes('111.25'));
    await f.save();assert.equal(JSON.parse(f.latestSave().init.body).expectedPricingRevision,4);
  });
  for(const [entered,expected]of [['80','80.00'],['',null]]as const)await test(`stale Special Price ${expected===null?'clear':'set'} keeps the whole draft and requires explicit latest-pricing acknowledgement`,async f=>{
    savedBooking(f);f.props.appointment.bookingPricingRevision=4;f.props.users[0].role='doctor';await f.start();await f.loaded();
    for(const [id,value]of [['appointment-notes','MY_UNSAVED_NOTES'],['appointment-concern','MY_UNSAVED_CONCERN'],
      ['appointment-visit-type','Follow-up'],['appointment-status','Confirmed'],['appointment-doctor',''],['appointment-test-date','2029-02-02']])
      f.node(id).props.onChange({target:{value}});
    f.button('1:00 PM').props.onClick();await f.settle();await enterPrice(f,entered);await f.save();
    const submitted=JSON.parse(f.latestSave().init.body);assert.equal(submitted.expectedPricingRevision,4);
    f.latestSave().deliver({error:'Saved pricing changed. Review the latest pricing.',code:'SPECIAL_PRICE_CONTEXT_CHANGED'},409);await f.settle();
    const assertDraft=()=>{assert.equal(price(f).props.value,entered);assert.equal(f.node('appointment-notes').props.value,'MY_UNSAVED_NOTES');
      assert.equal(f.node('appointment-concern').props.value,'MY_UNSAVED_CONCERN');assert.equal(f.node('appointment-visit-type').props.value,'Follow-up');
      assert.equal(f.node('appointment-status').props.value,'Confirmed');assert.equal(f.node('appointment-doctor').props.value,'');
      assert.equal(f.node('appointment-test-date').props.value,'2029-02-02');};
    assertDraft();assert.equal(f.saves,0);assert.equal(f.closes,0);assert.equal(globals.servicesTestInvalidations,0);
    assert.equal(f.button('Save changes').props.disabled,true);await f.save();assert.equal(pricingWrites(f).length,1);
    await requestPricingReview(f);latestPricingReview(f).deliver({document:{id:'appointment',data:pricingRecord(f)}});await f.settle();
    assertDraft();assert.ok(text(f.renderer.tree).includes('LATEST_SAVED_SERVICE'));assert.ok(text(f.renderer.tree).includes('245.00'));
    assert.ok(text(f.renderer.tree).includes(expected===null?'245.00':'80.00'));
    assert.ok(text(f.renderer.tree).includes('230.00'));assert.ok(!text(f.renderer.tree).includes('LATEST_SERVER_NOTES'));
    assert.ok(summaryRow(f,'servicePrice').includes('111.25'));assert.equal(f.button('Save changes').props.disabled,true);
    await f.save();assert.equal(pricingWrites(f).length,1);
    await acknowledgePricingReview(f);assertDraft();assert.ok(summaryRow(f,'servicePrice').includes('245.00'));
    assert.ok(summaryRow(f,'total').includes(expected===null?'245.00':'80.00'));assert.equal(f.button('Save changes').props.disabled,false);
    assert.ok(text(f.node('appointment-service')).includes('LATEST_SAVED_SERVICE'));await f.save();const body=JSON.parse(f.latestSave().init.body);
    assert.equal(body.specialPrice,expected);assert.equal(body.expectedPricingRevision,5);assert.ok(!Object.hasOwn(body,'serviceSelection'));
    for(const key of ['notes','mainConcern','appointmentDate','doctorId','visitType','status','patientId','branchId'])assert.equal(body[key],submitted[key]);
    noQuoteCommand(body);assert.ok(!f.requests.some(request=>request.url.toLowerCase().includes('/pos')));
    f.latestSave().deliver({id:'appointment'});await f.settle();assert.equal(f.saves,1);assert.equal(f.closes,1);
  });
  await test('acknowledging saved pricing preserves an explicit new Service and its independent price intent',async f=>{
    await beginPricingConflict(f);await f.select('free');await enterPrice(f,'25');
    assert.equal(f.button('Save changes').props.disabled,true);await f.save();assert.equal(pricingWrites(f).length,1);
    await requestPricingReview(f);
    latestPricingReview(f).deliver({document:{id:'appointment',data:pricingRecord(f)}});await f.settle();await acknowledgePricingReview(f);
    assert.equal(price(f).props.value,'25');assert.equal(f.node('appointment-service').props.value,'free');assert.ok(summaryRow(f,'servicePrice').includes('Free'));
    await f.save();const body=JSON.parse(f.latestSave().init.body);assert.equal(body.expectedPricingRevision,5);assert.equal(body.specialPrice,'25.00');
    assert.deepEqual(body.serviceSelection,{serviceId:'free',expectedVersion:1});
  });
  await test('acknowledging saved pricing keeps an intentional authorized clinic change and explicit removal',async f=>{
    await beginPricingConflict(f);await f.branch('B');await f.select('__none');await enterPrice(f,'45');
    assert.equal(f.button('Save changes').props.disabled,true);await f.save();assert.equal(pricingWrites(f).length,1);
    await requestPricingReview(f);latestPricingReview(f).deliver({document:{id:'appointment',data:pricingRecord(f)}});await f.settle();
    await acknowledgePricingReview(f);assert.equal(f.node('appointment-branch').props.value,'B');assert.equal(price(f).props.value,'45');
    await f.save();const body=JSON.parse(f.latestSave().init.body);assert.equal(body.branchId,'B');assert.equal(body.serviceSelection,null);
    assert.equal(body.specialPrice,'45.00');assert.equal(body.expectedPricingRevision,5);assert.equal(body.notes,'Preserved scheduling notes');
  });
  for(const status of [503,404])await test(`pricing review ${status} preserves the draft and never enables a blind retry`,async f=>{
    await beginPricingConflict(f);await requestPricingReview(f);latestPricingReview(f).deliver({error:'Pricing review temporarily unavailable'},status);await f.settle();
    assert.equal(price(f).props.value,'80');assert.equal(f.node('appointment-notes').props.value,'Preserved scheduling notes');
    assert.equal(f.button('Save changes').props.disabled,true);assert.ok(!hasButton(f,'Use reviewed pricing and keep my draft'));
    await f.save();assert.equal(pricingWrites(f).length,1);assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.closes,0);
    await requestPricingReview(f);latestPricingReview(f).deliver({document:{id:'appointment',data:pricingRecord(f)}});await f.settle();
    await acknowledgePricingReview(f);await f.save();assert.equal(JSON.parse(f.latestSave().init.body).expectedPricingRevision,5);
  });
  for(const invalid of ['missing','wrong-id','invalid-revision','other-branch','other-patient','archived','visit-linked']as const)
    await test(`pricing review ${invalid} cannot adopt a different or invalid booking context`,async f=>{
      await beginPricingConflict(f);await requestPricingReview(f);let body:any={document:{id:'appointment',data:pricingRecord(f)}};
      if(invalid==='missing')body.document.data=null;if(invalid==='wrong-id')body.document.id='different-appointment';
      if(invalid==='invalid-revision')body.document.data.bookingPricingRevision='5';
      if(invalid==='other-branch')body.document.data=pricingRecord(f,{branchId:'B',serviceNameSnapshot:'CHANGED_AUTHORIZED_BRANCH'});
      if(invalid==='other-patient')body.document.data=pricingRecord(f,{patientId:'another-patient',serviceNameSnapshot:'CHANGED_AUTHORIZED_PATIENT'});
      if(invalid==='archived')body.document.data.isArchived=true;if(invalid==='visit-linked')body.document.data.visitHistoryCreated=true;
      latestPricingReview(f).deliver(body);await f.settle();assert.equal(price(f).props.value,'80');assert.equal(f.node('appointment-notes').props.value,'Preserved scheduling notes');
      assert.equal(f.button('Save changes').props.disabled,true);assert.ok(!hasButton(f,'Use reviewed pricing and keep my draft'));
      if(invalid==='other-branch'||invalid==='other-patient')assert.ok(text(f.renderer.tree).includes('reopen the latest booking'));
      await f.save();assert.equal(pricingWrites(f).length,1);assert.equal(f.closes,0);
    });
  for(const status of [200,401,403])for(const change of ['branch','ABA','patient','patient-ABA','scope','logout','invalidate','unmount','superseded'])
    await test(`late saved pricing review ${status} cannot affect ${change} scope`,async f=>{
      await beginPricingConflict(f);await requestPricingReview(f);const old=latestPricingReview(f);
      if(change==='branch'||change==='ABA'){await f.branch('B');if(change==='ABA')await f.branch('A');}
      if(change==='patient'||change==='patient-ABA'){
        f.node('appointment-patient').props.onChange({target:{value:'Synthetic'}});await f.settle();
        if(change==='patient-ABA'){find(f.renderer.tree,(n:any)=>n.type==='button'&&text(n).includes('Synthetic patient')).props.onClick();await f.settle();}
      }
      if(change==='scope')f.scope();if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}
      if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}
      if(change==='unmount')f.stop();if(change==='superseded'){
        // Deliberately invoke the still-rendered handler twice despite the native
        // disabled state, so an older transport that ignores abort is exercised.
        f.button('Loading latest pricing…').props.onClick();await f.settle();assert.notEqual(latestPricingReview(f),old);
      }
      old.deliver(status===200?{document:{id:'appointment',data:pricingRecord(f,{serviceNameSnapshot:'STALE_SAVED_PRICING_RESPONSE',specialPrice:'9876.54',
        bookingQuote:{...pricingRecord(f).bookingQuote,specialPrice:'9876.54',total:'9876.54'}})}}:{error:'STALE_SAVED_PRICING_DENIAL'},status);
      await flush();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.renderer.lateSetters,0);assert.equal(f.saves,0);assert.equal(f.closes,0);
      if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('STALE_SAVED_PRICING_RESPONSE')&&!text(f.renderer.tree).includes('STALE_SAVED_PRICING_DENIAL'));
        assert.ok(!text(f.renderer.tree).includes('9,876.54'));}
    });
  for(const status of [401,403])await test(`current saved pricing review denial ${status} clears protected form normally`,async f=>{
    await beginPricingConflict(f);await requestPricingReview(f);latestPricingReview(f).deliver({error:'Current pricing review denied'},status);await f.settle();
    assert.equal(globals.servicesTestInvalidations,1);assert.ok(text(f.renderer.tree).includes('Appointment access changed'));
    assert.ok(!find(f.renderer.tree,(n:any)=>n.props?.id==='appointment-special-price'));assert.ok(!text(f.renderer.tree).includes('111.25'));
  });
  await test('a pricing review blocked during token acquisition never sends an old authorized document request',async f=>{
    await beginPricingConflict(f);let deliver!:(token:string)=>void;
    globals.servicesTestAuth.currentUser.getRequestToken=()=>new Promise(resolve=>deliver=resolve);
    f.button('Review latest pricing').props.onClick();await f.settle();assert.ok(!latestPricingReview(f));
    f.scope();deliver('synthetic');await f.settle();assert.ok(!latestPricingReview(f));assert.equal(globals.servicesTestInvalidations,0);
  });
  await test('a second pricing conflict discards the previous review acknowledgement while preserving the draft',async f=>{
    await beginPricingConflict(f);await requestPricingReview(f);latestPricingReview(f).deliver({document:{id:'appointment',data:pricingRecord(f)}});await f.settle();
    await acknowledgePricingReview(f);await f.save();assert.equal(JSON.parse(f.latestSave().init.body).expectedPricingRevision,5);
    f.latestSave().deliver({error:'Saved pricing changed again',code:'SPECIAL_PRICE_CONTEXT_CHANGED'},409);await f.settle();
    assert.equal(price(f).props.value,'80');assert.equal(f.button('Save changes').props.disabled,true);assert.ok(!hasButton(f,'Use reviewed pricing and keep my draft'));
    await f.save();assert.equal(pricingWrites(f).length,2);await requestPricingReview(f);
    latestPricingReview(f).deliver({document:{id:'appointment',data:pricingRecord(f,{bookingPricingRevision:6})}});await f.settle();
    await acknowledgePricingReview(f);await f.save();assert.equal(JSON.parse(f.latestSave().init.body).expectedPricingRevision,6);
  });
  for(const change of ['branch','scope','logout','invalidate','unmount'])await test(`late Special Price context conflict cannot lock a new ${change} workspace`,async f=>{
    savedBooking(f);f.props.appointment.bookingPricingRevision=4;await f.start();await f.loaded();await enterPrice(f,'80');await f.save();const old=f.latestSave();
    if(change==='branch')await f.branch('B');if(change==='scope')f.scope();if(change==='logout'){globals.servicesTestAuth.currentUser=null;f.render();}
    if(change==='invalidate'){for(const listener of globals.appointmentInvalidationListeners)listener();f.render();}if(change==='unmount')f.stop();
    old.deliver({error:'STALE_PRICING_CONFLICT',code:'SPECIAL_PRICE_CONTEXT_CHANGED'},409);await flush();assert.equal(globals.servicesTestInvalidations,0);
    assert.equal(f.renderer.lateSetters,0);if(change!=='unmount'){await f.settle();assert.ok(!text(f.renderer.tree).includes('STALE_PRICING_CONFLICT'));
      assert.ok(!hasButton(f,'Review latest pricing'));}
  });
} finally {
  globals.fetch=saved.fetch;globals.window=saved.window;globals.document=saved.document;
  await rm(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify(results,null,2));
const failed=results.filter(result=>!result.passed);console.log(`Appointment Services component/scope: ${results.length-failed.length}/${results.length} scenarios passed`);
if(failed.length)process.exitCode=1;
