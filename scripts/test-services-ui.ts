import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Execute the actual component tree and handlers with controlled hooks/requests.
// The keyed-frame reconciler models state lifetime, layout/passive cleanup and
// commits; it deliberately lets aborted transports deliver late responses.
// This is deterministic component evidence, not authenticated browser evidence.
const target = path.resolve(process.argv[2] || process.cwd());
const require = createRequire(path.join(target, 'package.json'));
const temporary = await mkdtemp(path.join(tmpdir(), 'vine-services-ui-'));
await symlink(path.join(target, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
const savedTimers = { timeout: globalThis.setTimeout, clear: globalThis.clearTimeout, fetch: globalThis.fetch };
const globals = globalThis as any;
globals.servicesTestAuth = { currentUser: { uid: 'synthetic-user', getRequestToken: async () => 'synthetic' } };
globals.servicesTestInvalidations = 0;
await writeFile(path.join(temporary, 'react.mjs'), `import actual from ${JSON.stringify(require.resolve('react'))};\nexport default actual;\n${['useState','useRef','useEffect','useLayoutEffect'].map(name => `export const ${name}=(...args)=>globalThis.servicesTestHooks.${name}(...args);`).join('\n')}`);
await writeFile(path.join(temporary, 'api.mjs'), 'export const servicesRequest=(...args)=>globalThis.servicesTestRequest(...args);');
await writeFile(path.join(temporary, 'platform.mjs'), 'export const auth=globalThis.servicesTestAuth;');
await writeFile(path.join(temporary, 'data.mjs'), 'export {captureProtectedRequestScope,protectedFetch} from "./foundation.mjs"; import {invalidateProtectedData as clear} from "./foundation.mjs"; export const invalidateProtectedData=(reason)=>{globalThis.servicesTestInvalidations++;clear(reason);};');
const plugins = [{ name: 'controlled-services', setup(b: any) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(temporary, 'react.mjs') }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: require.resolve('lucide-react'), external: true }));
  b.onResolve({ filter: /servicesApi$/ }, () => ({ path: path.join(temporary, 'api.mjs') }));
  b.onResolve({ filter: /platform$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
  b.onResolve({ filter: /dataClient$/ }, () => ({ path: path.join(temporary, 'data.mjs') }));
  b.onResolve({ filter: /foundation\.mjs$/ }, () => ({ path: path.join(temporary, 'foundation.mjs'), external: true }));
  b.onResolve({ filter: /session$/ }, () => ({ path: path.join(temporary, 'platform.mjs') }));
} }];
for (const [entry, name] of [['src/dataClient.ts','foundation'], ['src/components/ServicesDashboard.tsx','dashboard'], ['src/utils/servicesApi.ts','adapter']]) {
  await build({ entryPoints: [path.join(target, entry)], outfile: path.join(temporary, name+'.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'transform', packages: 'external', plugins });
}
const { default: Dashboard } = await import(pathToFileURL(path.join(temporary, 'dashboard.mjs')).href);
const { servicesRequest: adapter } = await import(pathToFileURL(path.join(temporary, 'adapter.mjs')).href);
const foundation = await import(pathToFileURL(path.join(temporary, 'foundation.mjs')).href);
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
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
    this.tree=this.expand({type:Dashboard,props},'root');
    for(const [key,frame] of this.frames)if(!this.visited.has(key)){frame.mounted=false;frame.hooks.forEach(h=>{if(h?.cleanup)h.layout?h.cleanup():this.passives.push(h.cleanup);});this.frames.delete(key);}
    this.layouts.splice(0).forEach(run=>run());return this.tree;
  }
  unmount(){for(const frame of this.frames.values()){frame.mounted=false;frame.hooks.forEach(h=>h?.cleanup?.());}this.frames.clear();this.passives=[];}
}
function find(node:any, predicate:(node:any)=>boolean):any {
  if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}}
  else if(node&&typeof node==='object'){if(predicate(node))return node;return find(node.props?.children,predicate);}
}
function text(node:any):string {return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):String(node??'');}
const branch=(id:string)=>({id,name:'Synthetic '+id,status:'Active',available:true,operationallyAvailable:true,effectivePrice:{amount:id==='B'?'987.65':'100.00'}});
const serviceId='550e8400-e29b-41d4-a716-446655440000';
const detail=(ids=['A','B'],id=serviceId,version=1)=>({id,name:'Synthetic service',version,category_id:null,description:'',standard_price:'100.00',default_duration_minutes:30,active:true,branches:ids.map(branch),branchSettings:ids.map(id=>({branch_id:id,available:true,price_override:id==='B'?'987.65':null}))});
type Request = {path:string;method:string;body:any;signal?:AbortSignal;resolve:(value:any)=>void;reject:(error:any)=>void};
class Fixture {
  renderer=new Renderer(); requests:Request[]=[];holdLists=false;
  cleanups:(()=>void)[]=[];
  props:any={userProfile:{role:'staff',active:true,assignedBranches:['A','B']},activeBranchId:'All'};
  constructor(){globals.servicesTestAuth.currentUser={uid:'synthetic-user',getRequestToken:async()=>'synthetic'};globals.servicesTestRequest=(url:string,method='GET',body?:any,signal?:AbortSignal)=>{
    let resolve!:Request['resolve'],reject!:Request['reject'];const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    this.requests.push({path:url,method,body,signal,resolve,reject});
    if(!this.holdLists && method==='GET' && (url.startsWith('/api/services?')||url==='/api/service-categories'))resolve(this.response(url));
    return promise;
  };}
  response(url:string){const p=this.props.userProfile;const ids=['admin','support_developer','SUPPORT_DEVELOPER'].includes(p.role)?['A','B']:p.assignedBranches;return url==='/api/service-categories'?{categories:[{id:'category',name:'Synthetic category',active:true,version:1}]}:{services:[detail(ids)],branches:ids.map(branch),total:1};}
  render(){return this.renderer.render(this.props);}
  async settle(){for(let i=0;i<8;i++){this.renderer.passives.splice(0).forEach(run=>run());await flush();if(this.renderer.dirty)this.render();}}
  async start(){this.render();await this.settle();}
  control(label:string){const node=find(this.renderer.tree,n=>n.type==='button'&&n.props['aria-label']===label);assert.ok(node,'missing '+label);return node;}
  button(label:string){const node=find(this.renderer.tree,n=>n.type==='button'&&text(n).replace(/\s+/g,' ').trim()===label);assert.ok(node,'missing '+label);return node;}
  open(){const role=this.props.userProfile.role;this.control((['admin','support_developer','SUPPORT_DEVELOPER'].includes(role)?'Edit':'View')+' service Synthetic service').props.onClick();return this.requests.at(-1)!;}
  scope(ids:string[],role=this.props.userProfile.role){this.props={...this.props,userProfile:{...this.props.userProfile,role,assignedBranches:ids}};this.render();}
  editor(){return !!find(this.renderer.tree,n=>n.type==='input'&&n.props.id==='service-name');}
  noRemoved(){assert.ok(!text(this.renderer.tree).includes('987.65'),'removed override rendered');assert.ok(!find(this.renderer.tree,n=>n.type==='select'&&n.props.id==='branch-price-B'),'removed branch editor rendered');}
  stop(){this.renderer.unmount();this.cleanups.splice(0).forEach(cleanup=>cleanup());}
}
// Mutations use the real Services adapter and real foundation subscriptions.
// Only auth, React reconciliation and transport/timers are controlled seams.
async function mutation(f:Fixture,kind:'service'|'category',method='PATCH') {
  f.props.userProfile.role='admin';await f.start();
  if(kind==='service') {
    if(method==='PATCH')f.open().resolve(detail());else f.button('Create service').props.onClick();
  } else f.button('Manage categories').props.onClick();
  await f.settle();
  if(kind==='category' && method==='PATCH'){f.control('Edit category Synthetic category').props.onClick();await f.settle();}
  const inputId=kind==='service'?'service-name':'category-name';
  find(f.renderer.tree,n=>n.type==='input'&&n.props.id===inputId).props.onChange({target:{value:'Synthetic mutation draft'}});await f.settle();
  const controlled=globals.servicesTestRequest;
  globals.servicesTestRequest=(url:string,verb='GET',body?:any,signal?:AbortSignal,current?:()=>boolean)=>verb==='GET'?controlled(url,verb,body,signal):adapter(url,verb,body,signal,current);
  const requests:{signal?:AbortSignal;body:any;deliver:(response:Response)=>void}[]=[];
  globalThis.fetch=((url:any,init:any)=>{
    if(url==='/api/data/query')return Promise.resolve(new Response(JSON.stringify({documents:[{id:'current',data:{marker:'CURRENT_SCOPE_CACHE'}}]})));
    return new Promise<Response>(deliver=>requests.push({signal:init.signal,body:JSON.parse(init.body),deliver}));
  }) as any;
  globals.servicesTestInvalidations=0;
  const submit=()=>find(f.renderer.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  const send=async()=>{submit();await flush();assert.ok(requests.length,'actual mutation HTTP request started');return requests.at(-1)!;};
  const response=(request:typeof requests[number],status:number)=>request.deliver(new Response(JSON.stringify(status===200?{...detail(),name:'COMMITTED_OLD_SAVE',version:2}:{error:'MUTATION_'+status,code:status===409?'STALE_VERSION':undefined}),{status}));
  const cache=async()=>{
    const values:any[]=[];
    f.cleanups.push(foundation.onSnapshot(foundation.collection(foundation.db,'appointments'),(value:any)=>values.push(value)));
    await flush();assert.equal(values.at(-1)?.docs[0]?.data().marker,'CURRENT_SCOPE_CACHE');
    return {intact:()=>{assert.equal(values.at(-1)?.docs[0]?.data().marker,'CURRENT_SCOPE_CACHE');assert.ok(!values.some(v=>v.invalidated));},cleared:()=>{assert.equal(values.at(-1)?.size,0);assert.equal(values.at(-1)?.invalidated,true);}};
  };
  return {send,response,cache,submit,requests,inputId};
}
const results:{name:string;passed:boolean;error?:string}[]=[];
let fixture:Fixture|undefined;
async function test(name:string,run:(f:Fixture)=>Promise<void>){fixture=new Fixture();try{await run(fixture);results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:String(error)});}finally{fixture.stop();fixture=undefined;}}
globalThis.setTimeout=((_callback:any)=>0) as any;globalThis.clearTimeout=(()=>{}) as any;
try {
  await test('old detail success after narrowing is discarded',async f=>{await f.start();const old=f.open();f.scope(['A']);f.noRemoved();await f.settle();old.resolve(detail());await f.settle();assert.ok(!f.editor(),'old success reopened editor');f.noRemoved();});
  await test('old detail error after narrowing is discarded',async f=>{await f.start();const old=f.open();f.scope(['A']);await f.settle();old.reject(Error('OLD_SCOPE_ERROR'));await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_SCOPE_ERROR'));});
  await test('rapid scope A to B to A does not accept first A generation',async f=>{f.props.userProfile.assignedBranches=['A'];await f.start();const old=f.open();f.scope(['B']);await f.settle();f.scope(['A']);await f.settle();old.resolve(detail(['A']));await f.settle();assert.ok(!f.editor(),'first A response reopened editor');});
  await test('fresh request after narrowing opens only authorized detail',async f=>{await f.start();const old=f.open();f.scope(['A']);await f.settle();const fresh=f.open();fresh.resolve(detail(['A']));await f.settle();assert.ok(f.editor());f.noRemoved();old.resolve(detail());await f.settle();assert.ok(f.editor());f.noRemoved();});
  for(const outcome of ['success','error'])await test('unmount ignores late detail '+outcome,async f=>{await f.start();const old=f.open();f.stop();outcome==='success'?old.resolve(detail()):old.reject(Error('OLD_UNMOUNT_ERROR'));await flush();assert.equal(f.renderer.lateSetters,0);});
  await test('already-open editor disappears in the scope-change render',async f=>{await f.start();f.open().resolve(detail());await f.settle();assert.ok(f.editor());f.scope(['A']);assert.ok(!f.editor(),'stale editor visible before passive cleanup');f.noRemoved();});
  await test('previous catalogue is hidden before passive cleanup',async f=>{await f.start();assert.ok(text(f.renderer.tree).includes('987.65'));f.scope(['A']);f.noRemoved();});
  await test('late list and category success cannot populate new scope',async f=>{f.holdLists=true;f.render();await f.settle();const old=f.requests.slice();f.scope(['A']);await f.settle();old.forEach(r=>r.resolve(r.path==='/api/service-categories'?{categories:[{id:'old',name:'OLD_CATEGORY',active:true}]}:{services:[detail()],branches:['A','B'].map(branch),total:1}));await f.settle();f.noRemoved();assert.ok(!text(f.renderer.tree).includes('OLD_CATEGORY'));const fresh=f.requests.slice(old.length);fresh.forEach(r=>r.resolve(f.response(r.path)));await f.settle();f.noRemoved();assert.ok(text(f.renderer.tree).includes('Synthetic service'));});
  await test('late list error cannot replace new scope state',async f=>{f.holdLists=true;f.render();await f.settle();const old=f.requests.slice();f.scope(['A']);await f.settle();old[0].reject(Error('OLD_LIST_ERROR'));old[1].resolve({categories:[]});await f.settle();assert.ok(!text(f.renderer.tree).includes('OLD_LIST_ERROR'));});
  await test('administrative unchanged access preserves editor across profile refresh',async f=>{f.props.userProfile.role='admin';await f.start();f.open().resolve(detail());await f.settle();f.scope(['B','A']);assert.ok(f.editor());await f.settle();assert.ok(f.editor());});
  await test('ordinary branch set order and duplicates preserve unchanged scope',async f=>{await f.start();f.open().resolve(detail());await f.settle();f.scope(['B','A','A']);await f.settle();assert.ok(f.editor());});
  await test('role demotion rejects global delayed detail',async f=>{f.props.userProfile.role='admin';await f.start();const old=f.open();f.scope(['A'],'staff');await f.settle();old.resolve(detail());await f.settle();assert.ok(!f.editor());f.noRemoved();});
  await test('identity switch invalidates delayed detail',async f=>{await f.start();const old=f.open();globals.servicesTestAuth.currentUser.uid='different-user';f.render();await f.settle();old.resolve(detail());await f.settle();assert.ok(!f.editor());});
  await test('active-account change removes already loaded editor immediately',async f=>{await f.start();f.open().resolve(detail());await f.settle();f.props.userProfile={...f.props.userProfile,active:false};f.render();assert.ok(!f.editor());});
  await test('selected branch change discards pending detail',async f=>{await f.start();const old=f.open();f.props.activeBranchId='A';f.render();await f.settle();old.resolve(detail());await f.settle();assert.ok(!f.editor());});
  await test('latest detail request wins over a superseded response',async f=>{await f.start();const first=f.open(),second=f.open();second.resolve({...detail(),name:'Latest detail'});await f.settle();first.resolve({...detail(),name:'Obsolete detail'});await f.settle();assert.equal(find(f.renderer.tree,n=>n.type==='input'&&n.props.id==='service-name').props.value,'Latest detail');});
  await test('back closes editor and cancels pending reload',async f=>{
    f.props.userProfile.role='admin';await f.start();f.open().resolve(detail());await f.settle();
    find(f.renderer.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();
    f.requests.at(-1)!.reject(Object.assign(Error('STALE'),{code:'STALE_VERSION'}));await f.settle();
    f.button('Reload and review').props.onClick();const reload=f.requests.at(-1)!;
    f.button('Back to services').props.onClick();await f.settle();reload.resolve(detail());await f.settle();assert.ok(!f.editor());
  });
  await test('create cancels pending edit and keeps stable create UUID on retry',async f=>{f.props.userProfile.role='admin';await f.start();const old=f.open();f.button('Create service').props.onClick();await f.settle();old.resolve(detail());await f.settle();assert.equal(find(f.renderer.tree,n=>n.type==='input'&&n.props.id==='service-name').props.value,'');find(f.renderer.tree,n=>n.type==='input'&&n.props.id==='service-name').props.onChange({target:{value:'New service'}});await f.settle();const form=find(f.renderer.tree,n=>n.type==='form');form.props.onSubmit({preventDefault(){}});await flush();const first=f.requests.at(-1)!;first.reject(Error('NETWORK'));await f.settle();find(f.renderer.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();const retry=f.requests.at(-1)!;assert.equal(first.body.id,retry.body.id);assert.equal(retry.method,'POST');retry.resolve(detail());await f.settle();assert.ok(!f.editor());});
  await test('current stale-version error locks editor and reload restores latest version',async f=>{f.props.userProfile.role='admin';await f.start();f.open().resolve(detail());await f.settle();find(f.renderer.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();const save=f.requests.at(-1)!;assert.equal(save.method,'PATCH');assert.equal(save.body.expectedVersion,1);save.reject(Object.assign(Error('STALE'),{code:'STALE_VERSION'}));await f.settle();assert.ok(f.button('Save service').props.disabled);f.button('Reload and review').props.onClick();f.requests.at(-1)!.resolve(detail(['A','B'],serviceId,2));await f.settle();assert.ok(!f.button('Save service').props.disabled);});
  await test('normal service edit saves explicit Free and closes editor',async f=>{
    f.props.userProfile.role='admin';await f.start();f.open().resolve(detail());await f.settle();
    find(f.renderer.tree,n=>n.type==='select'&&n.props.id==='service-price').props.onChange({target:{value:'free'}});await f.settle();
    find(f.renderer.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();const save=f.requests.at(-1)!;
    assert.equal(save.method,'PATCH');assert.deepEqual(save.body.standardPrice,{mode:'free'});assert.equal(save.body.branchSettings[1].price.amount,'987.65');
    save.resolve({...detail(),standard_price:'0.00',version:2});await f.settle();assert.ok(!f.editor());
  });
  await test('current catalogue error and retry recover normally',async f=>{f.holdLists=true;f.render();await f.settle();f.requests[0].reject(Error('TEMPORARY'));f.requests[1].resolve({categories:[]});await f.settle();assert.ok(text(f.renderer.tree).includes('TEMPORARY'));f.holdLists=false;f.button('Reload and review').props.onClick();await f.settle();assert.ok(text(f.renderer.tree).includes('Synthetic service'));});
  await test('category management create remains functional',async f=>{f.props.userProfile.role='admin';await f.start();f.button('Manage categories').props.onClick();await f.settle();find(f.renderer.tree,n=>n.type==='input'&&n.props.id==='category-name').props.onChange({target:{value:'New category'}});await f.settle();find(f.renderer.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();const save=f.requests.at(-1)!;assert.equal(save.path,'/api/service-categories');assert.equal(save.body.name,'New category');save.resolve({id:save.body.id,name:'New category',active:true,version:1});await f.settle();assert.equal(find(f.renderer.tree,n=>n.type==='input'&&n.props.id==='category-name').props.value,'');});
  for(const role of ['admin','support_developer','SUPPORT_DEVELOPER'])await test(role+' retains writable all-branch editor',async f=>{f.props.userProfile.role=role;await f.start();f.open().resolve(detail());await f.settle();assert.equal(find(f.renderer.tree,n=>n.type==='fieldset').props.disabled,false);assert.ok(find(f.renderer.tree,n=>n.type==='select'&&n.props.id==='branch-price-B'));});
  await test('ordinary authorized editor is read-only and retains pricing controls',async f=>{f.props.userProfile.assignedBranches=['A'];await f.start();f.open().resolve(detail(['A']));await f.settle();assert.equal(find(f.renderer.tree,n=>n.type==='fieldset').props.disabled,true);assert.ok(!find(f.renderer.tree,n=>n.type==='button'&&text(n)==='Save service'));assert.equal(find(f.renderer.tree,n=>n.type==='select'&&n.props.id==='service-price').props.value,'priced');f.noRemoved();});
  for(const kind of ['service','category'] as const) {
    for(const method of ['POST','PATCH']) {
      for(const status of [401,403]) {
        await test(kind+' '+method+' old-scope '+status+' preserves current protected cache',async f=>{
          const m=await mutation(f,kind,method),old=await m.send();
          f.scope(['A'],'staff');await f.settle();const cache=await m.cache();
          m.response(old,status);await f.settle();cache.intact();assert.equal(globals.servicesTestInvalidations,0);
          assert.ok(!text(f.renderer.tree).includes('MUTATION_'+status));assert.ok(!f.editor());f.noRemoved();assert.equal(f.renderer.lateSetters,0);
        });
        await test(kind+' '+method+' current-scope '+status+' invalidates exactly once',async f=>{
          const m=await mutation(f,kind,method),save=await m.send(),cache=await m.cache();
          m.response(save,status);await f.settle();cache.cleared();assert.equal(globals.servicesTestInvalidations,1);
          assert.ok(text(f.renderer.tree).includes('MUTATION_'+status));
        });
      }
      await test(kind+' '+method+' old-scope success does not change fresh draft or refresh scope',async f=>{
        const m=await mutation(f,kind,method),old=await m.send();
        f.props.activeBranchId='A';f.render();await f.settle();
        if(kind==='service'){f.button('Create service').props.onClick();await f.settle();}
        else {f.button('Manage categories').props.onClick();await f.settle();}
        find(f.renderer.tree,n=>n.type==='input'&&n.props.id===m.inputId).props.onChange({target:{value:'CURRENT_DRAFT'}});await f.settle();
        const count=f.requests.length,cache=await m.cache();m.response(old,200);await f.settle();
        assert.equal(find(f.renderer.tree,n=>n.type==='input'&&n.props.id===m.inputId).props.value,'CURRENT_DRAFT');
        assert.equal(f.requests.length,count,'stale success refreshed current scope');assert.equal(f.renderer.lateSetters,0);cache.intact();
      });
    }
    for(const status of [200,403]) {
      await test(kind+' A to B to A ignores original mutation '+status,async f=>{
        const m=await mutation(f,kind),old=await m.send();
        f.scope(['A'],'staff');await f.settle();f.scope(['A','B'],'admin');await f.settle();const count=f.requests.length,cache=await m.cache();
        m.response(old,status);await f.settle();assert.equal(globals.servicesTestInvalidations,0);cache.intact();assert.equal(f.requests.length,count);
        assert.ok(!text(f.renderer.tree).includes('MUTATION_'));assert.ok(!f.editor());assert.equal(f.renderer.lateSetters,0);
      });
      await test(kind+' unmount aborts mutation and ignores late '+status,async f=>{
        const m=await mutation(f,kind),old=await m.send();f.stop();
        assert.equal(old.signal?.aborted,true);m.response(old,status);await flush();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.renderer.lateSetters,0);
      });
    }
    await test(kind+' old-scope 409 cannot overwrite new scope',async f=>{
      const m=await mutation(f,kind),old=await m.send();f.scope(['A'],'staff');await f.settle();const cache=await m.cache();
      m.response(old,409);await f.settle();cache.intact();assert.ok(!text(f.renderer.tree).includes('MUTATION_409'));assert.equal(f.renderer.lateSetters,0);
    });
    await test(kind+' current-scope 409 locks save and allows reload/review',async f=>{
      const m=await mutation(f,kind),save=await m.send(),cache=await m.cache();m.response(save,409);await f.settle();
      assert.ok(text(f.renderer.tree).includes('MUTATION_409'));assert.equal(f.button(kind==='service'?'Save service':'Save category').props.disabled,true);
      cache.intact();assert.equal(globals.servicesTestInvalidations,0);f.button('Reload and review').props.onClick();await f.settle();
      if(kind==='service'){f.requests.at(-1)!.resolve(detail(['A','B'],serviceId,2));await f.settle();assert.equal(f.button('Save service').props.disabled,false);}
      else {assert.equal(f.button('Create category').props.disabled,false);assert.equal(find(f.renderer.tree,n=>n.type==='input'&&n.props.id===m.inputId).props.value,'');}
    });
    await test(kind+' create retains UUID and only retries on user resubmission',async f=>{
      const m=await mutation(f,kind,'POST'),first=await m.send();m.response(first,500);await f.settle();
      assert.equal(m.requests.length,1,'response failure triggered blind automatic retry');const retry=await m.send();assert.equal(retry.body.id,first.body.id);
      m.response(retry,200);await f.settle();assert.equal(globals.servicesTestInvalidations,0);
    });
    await test(kind+' scope change during token acquisition prevents sending obsolete save',async f=>{
      const m=await mutation(f,kind);let release!:any;globals.servicesTestAuth.currentUser.getRequestToken=()=>new Promise(resolve=>{release=resolve;});
      m.submit();await flush();f.scope(['A'],'staff');await f.settle();release('synthetic');await f.settle();
      assert.equal(m.requests.length,0);assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.renderer.lateSetters,0);
    });
    await test(kind+' superseded mutation cannot overwrite newer current conflict',async f=>{
      const m=await mutation(f,kind),handler=find(f.renderer.tree,n=>n.type==='form').props.onSubmit;
      handler({preventDefault(){}});await flush();const first=m.requests.at(-1)!;
      // Exercise request replacement before the controlled render commits busy state.
      handler({preventDefault(){}});await flush();const second=m.requests.at(-1)!;assert.notEqual(first,second);
      m.response(second,409);await f.settle();m.response(first,403);await f.settle();assert.equal(globals.servicesTestInvalidations,0);
      assert.ok(text(f.renderer.tree).includes('MUTATION_409'));assert.ok(!text(f.renderer.tree).includes('MUTATION_403'));
    });
  }
  for(const status of [200,403])await test('closing category manager during save ignores late '+status,async f=>{
    const m=await mutation(f,'category'),old=await m.send();f.button('Close categories').props.onClick();await f.settle();const cache=await m.cache(),count=f.requests.length;
    assert.equal(old.signal?.aborted,true);m.response(old,status);await f.settle();cache.intact();assert.equal(globals.servicesTestInvalidations,0);assert.equal(f.requests.length,count);assert.equal(f.renderer.lateSetters,0);
  });
  for(const status of [200,401,403])await test('adapter discards obsolete generation before side effects '+status,async()=>{
    globals.servicesTestInvalidations=0;let deliver!:any,current=true;globalThis.fetch=(()=>new Promise(resolve=>{deliver=resolve;})) as any;
    const c=new AbortController(),pending=adapter('/api/services/example','PATCH',{},c.signal,()=>current);await flush();current=false;
    assert.equal(c.signal.aborted,false);deliver(new Response(JSON.stringify({error:'OLD_GENERATION'}),{status}));
    await assert.rejects(pending,(e:any)=>e.name==='AbortError');assert.equal(globals.servicesTestInvalidations,0);
  });
  for(const route of ['/api/services?','/api/service-categories'])await test('read denial before passive abort cannot invalidate new scope: '+route,async f=>{
    let deliver!:any;const controlled=globals.servicesTestRequest;globals.servicesTestInvalidations=0;
    globalThis.fetch=(()=>new Promise(resolve=>{deliver=resolve;})) as any;
    globals.servicesTestRequest=(url:string,verb='GET',body?:any,signal?:AbortSignal,current?:()=>boolean)=>url.startsWith(route)?adapter(url,verb,body,signal,current):controlled(url,verb,body,signal);
    f.render();f.renderer.passives.splice(0).forEach(run=>run());await flush();
    f.scope(['A']); // New layout generation is committed; old passive cleanup has not run yet.
    deliver(new Response(JSON.stringify({error:'OLD_READ_DENIAL'}),{status:403}));await flush();assert.equal(globals.servicesTestInvalidations,0);
    assert.ok(!text(f.renderer.tree).includes('OLD_READ_DENIAL'));
  });
  for(const status of [200,403])await test('adapter ignores aborted response '+status+' without invalidating new scope',async()=>{globals.servicesTestInvalidations=0;let deliver!:any;globalThis.fetch=(()=>new Promise(resolve=>{deliver=resolve;})) as any;const c=new AbortController();const pending=adapter('/api/services/example','GET',undefined,c.signal);await flush();c.abort();deliver(new Response(JSON.stringify(status===200?detail():{error:'OLD_DENIAL'}),{status}));await assert.rejects(pending,(e:any)=>e.name==='AbortError');assert.equal(globals.servicesTestInvalidations,0);});
  await test('adapter current denial still invokes foundation invalidation',async()=>{globals.servicesTestInvalidations=0;globalThis.fetch=(async()=>new Response(JSON.stringify({error:'CURRENT_DENIAL'}),{status:403})) as any;await assert.rejects(adapter('/api/services'),(e:any)=>e.status===403);assert.equal(globals.servicesTestInvalidations,1);});
  await test('adapter abort during token acquisition prevents fetch',async()=>{let deliver!:any,calls=0;globals.servicesTestAuth.currentUser.getRequestToken=()=>new Promise(resolve=>{deliver=resolve;});globalThis.fetch=(async()=>{calls++;return new Response('{}');}) as any;const c=new AbortController();const pending=adapter('/api/services','GET',undefined,c.signal);c.abort();deliver('synthetic');await assert.rejects(pending,(e:any)=>e.name==='AbortError');assert.equal(calls,0);});
} finally {
  if(fixture)fixture.stop();globalThis.setTimeout=savedTimers.timeout;globalThis.clearTimeout=savedTimers.clear;globalThis.fetch=savedTimers.fetch;
  await rm(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify(results,null,2));
const failed=results.filter(r=>!r.passed);console.log(`Services component/scope: ${results.length-failed.length}/${results.length} scenarios passed`);
if(failed.length)process.exitCode=1;
