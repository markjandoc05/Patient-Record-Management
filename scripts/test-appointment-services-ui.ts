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
await writeFile(path.join(temporary, 'data.mjs'), `export function invalidateProtectedData(){globalThis.servicesTestInvalidations++;for(const f of globalThis.appointmentInvalidationListeners)f();}
export function subscribeProtectedDataInvalidation(f){globalThis.appointmentInvalidationListeners.add(f);return()=>globalThis.appointmentInvalidationListeners.delete(f);}
export const collection=()=>({}),query=()=>({}),limit=()=>({}),orderBy=()=>({}),where=()=>({}),getDocs=async()=>({docs:[]});`);
await writeFile(path.join(temporary, 'time.mjs'), "export const getActiveDatePrefix=()=> '2028-01-01';export const getActiveDateTimeInput=()=> '2028-01-01T09:00';");
await writeFile(path.join(temporary, 'utils.mjs'), 'export const formatDateTime=value=>value;');
await writeFile(path.join(temporary, 'date.mjs'), 'export const CustomDatePicker=()=>null;');
const plugins = [{ name: 'controlled-appointments', setup(b: any) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(temporary, 'react.mjs') }));
  b.onResolve({ filter: /platform$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /dataClient$/ }, () => ({ path: path.join(temporary, 'data.mjs') }));
  b.onResolve({ filter: /utils\/timezone$/ }, () => ({ path: path.join(temporary, 'time.mjs') }));
  b.onResolve({ filter: /^\.\.\/utils$/ }, () => ({ path: path.join(temporary, 'utils.mjs') }));
  b.onResolve({ filter: /CustomDatePicker$/ }, () => ({ path: path.join(temporary, 'date.mjs') }));
} }];
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
  latestSave(){return this.requests.filter(r=>r.init.method==='PATCH'||r.init.method==='POST').at(-1)!;}
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
} finally {
  globals.fetch=saved.fetch;globals.window=saved.window;globals.document=saved.document;
  await rm(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify(results,null,2));
const failed=results.filter(result=>!result.passed);console.log(`Appointment Services component/scope: ${results.length-failed.length}/${results.length} scenarios passed`);
if(failed.length)process.exitCode=1;
