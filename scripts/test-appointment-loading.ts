import assert from 'node:assert/strict';
import { appointmentSources, subscribeAppointmentData, type AppointmentLoadState, type AppointmentSource } from '../src/utils/appointmentSubscriptions';
let checks = 0;
function harness(previous?: AppointmentLoadState) {
  const callbacks = new Map<AppointmentSource, {ok: (rows: any[]) => void; fail: (error: any) => void}>();
  const states: AppointmentLoadState[] = [];
  let cleaned = 0;
  const stop = subscribeAppointmentData((source, ok, fail) => { callbacks.set(source, {ok, fail}); return () => cleaned++; }, value => states.push(value), previous);
  return { callbacks, states, stop, get state() {return states.at(-1)!;}, get cleaned() {return cleaned;}, finish() {for (const source of appointmentSources) callbacks.get(source)!.ok(source === 'appointments' ? [{id:'demo-A',branchId:'A'}] : []);} };
}
const delayed = harness();
for (const source of appointmentSources.slice(0,4)) delayed.callbacks.get(source)!.ok([]);
assert.equal(delayed.state.ready,false); delayed.callbacks.get('branches')!.ok([]);assert.equal(delayed.state.ready,true);assert.deepEqual(delayed.state.data.appointments,[]);checks+=2;
const failure=harness();failure.callbacks.get('appointments')!.fail(new Error('offline'));assert.equal(failure.state.ready,false);assert.ok(failure.state.errors.appointments);failure.finish();assert.equal(failure.state.ready,true);assert.deepEqual(failure.state.errors,{});checks+=2;
const cached=harness();cached.finish();cached.callbacks.get('appointments')!.fail(new Error('offline'));assert.equal(cached.state.ready,true);assert.equal(cached.state.data.appointments[0].id,'demo-A');assert.ok(cached.state.errors.appointments);checks++;
const retry=harness(cached.state);assert.equal(retry.state.data.appointments[0].id,'demo-A');retry.finish();assert.deepEqual(retry.state.errors,{});checks++;
cached.callbacks.get('appointments')!.fail({code:'permission-denied'});assert.equal(cached.state.ready,false);assert.deepEqual(cached.state.data.appointments,[]);checks++;
const old=harness();old.stop();const current=harness();current.finish();const count=old.states.length;old.callbacks.get('appointments')!.ok([{id:'late-A'}]);old.callbacks.get('branches')!.fail(new Error('late'));assert.equal(old.states.length,count);assert.equal(old.cleaned,5);assert.equal(current.state.data.appointments[0].id,'demo-A');current.callbacks.get('appointments')!.ok([{id:'demo-B',branchId:'B'}]);old.callbacks.get('appointments')!.ok([{id:'late-A'}]);assert.equal(current.state.data.appointments[0].branchId,'B');checks++;
for(const h of [delayed,failure,cached,retry,current])h.stop();

// Exercise real polling + branch merge with synthetic HTTP responses, no database.
const originalFetch=globalThis.fetch, originalTimeout=globalThis.setTimeout, originalInterval=globalThis.setInterval;
const timers: (()=>void)[]=[];
const pending: {body:any; resolve:(r:Response)=>void; reject:(e:Error)=>void}[]=[];
globalThis.setTimeout=((fn:any)=>{timers.push(fn);return 0;}) as any;
globalThis.setInterval=(()=>0) as any;
globalThis.fetch=(async (url:any, options:any)=> {
  if(url==='/api/auth/session')return new Response(JSON.stringify({user:null}),{status:401});
  return new Promise<Response>((resolve,reject)=>pending.push({body:JSON.parse(options.body),resolve,reject}));
}) as any;
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const response=(id:string)=>new Response(JSON.stringify({documents:[{id,data:{branchId:id}}]}));
try {
 const {subscribeToBranchScopedCollection}=await import('../src/utils/branchAccess');
 const {db,onSnapshot,collection}=await import('../src/dataClient');
 const received:any[]=[];const errors:any[]=[];
 const stop=subscribeToBranchScopedCollection(db,'appointments','branchId',{role:'staff',assignedBranches:Array.from({length:31},(_,i)=>'b'+i)},r=>received.push(r),e=>errors.push(e),[],true,true);
 await flush();assert.equal(pending.length,2);
 pending.shift()!.resolve(response('A'));await flush();assert.equal(received.length,0);
 pending.shift()!.reject(new Error('offline'));await flush();assert.equal(errors.length,1);assert.equal(received.length,0);checks++;
 // First chunk polling success must not clear another chunk's failure.
 timers.shift()!();await flush();pending.shift()!.resolve(response('A2'));await flush();assert.equal(received.length,0);checks++;
 timers.shift()!();await flush();pending.shift()!.resolve(response('B'));await flush();assert.deepEqual(received[0].map((r:any)=>r.id),['A2','B']);checks++;
 timers.shift()!();await flush();stop();pending.shift()!.reject(new Error('late error'));await flush();assert.equal(errors.length,1);assert.equal(received.length,1);checks++;
 // Real subscription A resolves only after B; A must not publish after cleanup.
 const branchResults:any[]=[];
 const stopA=subscribeToBranchScopedCollection(db,'appointments','branchId',{role:'staff',assignedBranches:['A']},r=>branchResults.push(r),e=>errors.push(e),[],true,true);
 await flush();const requestA=pending.shift()!;stopA();
 const stopB=subscribeToBranchScopedCollection(db,'appointments','branchId',{role:'staff',assignedBranches:['B']},r=>branchResults.push(r),e=>errors.push(e),[],true,true);
 await flush();pending.shift()!.resolve(response('B'));await flush();requestA.resolve(response('A'));await flush();
 assert.equal(branchResults.length,1);assert.equal(branchResults[0][0].branchId,'B');stopB();checks++;

 // A transient error must not suppress a later authorization denial.
 timers.length=0;
 const transitions:any[]=[];const recovered:any[]=[];
 const stopTransition=onSnapshot(collection(db,'appointments'),s=>recovered.push(s),e=>transitions.push(e));
 await flush();pending.shift()!.resolve(response('A'));await flush();
 timers.shift()!();await flush();pending.shift()!.reject(new Error('offline'));await flush();
 assert.equal(transitions.length,1);
 timers.shift()!();await flush();pending.shift()!.resolve(new Response(JSON.stringify({error:'denied'}),{status:403}));await flush();
 assert.equal(transitions.length,2);assert.equal(transitions[1].status,403);checks++;
 timers.shift()!();await flush();pending.shift()!.resolve(new Response(JSON.stringify({error:'denied'}),{status:403}));await flush();
 assert.equal(transitions.length,2);checks++;
 timers.shift()!();await flush();pending.shift()!.resolve(response('A'));await flush();
 assert.equal(recovered.filter(snapshot=>!snapshot.invalidated).length,2);
 assert.ok(recovered.some(snapshot=>snapshot.invalidated && snapshot.empty),'denial clears protected data before recovery');stopTransition();checks++;

} finally {globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;globalThis.setInterval=originalInterval;}
console.log(`${checks} appointment loading scenarios passed (synthetic records and controlled responses).`);
