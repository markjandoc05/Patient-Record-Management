import { servicesRetryRegressions } from './services-retry-regressions';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { app } from '../server';
import { db,pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/vine_services_test'||process.env.ALLOW_TEST_DATABASE!=='yes'||!process.env.STORAGE_DIR)throw Error('Disposable loopback vine_services_test and temporary storage required');
const origin=new URL(process.env.APP_URL!).origin;
let checks=0, server:ReturnType<typeof app.listen>;
const credentials=new Map<string,{cookie:string,csrf:string}>();
function check(v:any,m:string){assert.ok(v,m);checks++}
async function request(path:string,method='GET',body?:any,role='admin',headers:any={}){const c=credentials.get(role);const r=await fetch(`http://127.0.0.1:${(server.address() as any).port}${path}`,{method,headers:{Origin:origin,...(c?{Cookie:c.cookie,Authorization:`Bearer ${c.csrf}`}:{ }),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json().catch(()=>null)}}
const sPayload=(name='Synthetic Service')=>({id:randomUUID(),name,defaultDurationMinutes:30,standardPrice:{mode:'priced',amount:'100.00'}});
async function sqlReject(sql:string,args:any[],code:string){await assert.rejects(pool.query(sql,args),(e:any)=>e.code===code);checks++}
try{
 // Rehearse additive migration with synthetic legacy records before 003 is applied.
 for(const name of ['001_platform.sql']){const text=await readFile(`migrations/${name}`,'utf8');await pool.query(text)}
 await pool.query("INSERT INTO app_records(collection_path,id,data) VALUES('visits','legacy',$1),('appointments','legacy',$2)",[JSON.stringify({treatmentService:'  ORIGINAL free text  ',servicePerformed:'Legacy value'}),JSON.stringify({visitType:'Initial Consultation'})]);
 const legacyBefore=JSON.stringify((await pool.query("SELECT * FROM app_records ORDER BY collection_path,id")).rows);
 // Let the checksummed runner register the existing idempotent foundation migrations.
 await migrateDatabase();check(legacyBefore===JSON.stringify((await pool.query('SELECT * FROM app_records ORDER BY collection_path,id')).rows),'migration preserves legacy byte values and timestamps');
 await migrateDatabase();check((await pool.query('SELECT * FROM schema_migrations')).rows.length===4,'migration rerun safe');
 for(const role of ['admin','SUPPORT_DEVELOPER','support_developer','manager','doctor','staff','inactive','pending']){
 const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await db.collection('users').doc(role).set({role:['inactive','pending'].includes(role)?'staff':role,active:!['inactive','pending'].includes(role),assignedBranches:['A'],fullName:'Synthetic '+role});
 await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)',[role,role+'@example.invalid']);await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),role,csrf]);credentials.set(role,{cookie:`${origin.startsWith('https')?'__Host-':''}vine_session=${token}`,csrf});}
 for(const [id,status]of[['A','Active'],['B','Active'],['C','Inactive']])await db.collection('branches').doc(id).set({branchName:'Synthetic '+id,status});
 server=app.listen(0,'127.0.0.1');await once(server,'listening');
 await servicesRetryRegressions(request,pool,db,check);
 for(const role of ['admin','support_developer','manager','doctor','staff']){check((await request('/api/services','GET',undefined,role)).status===200,role+' read');check((await request('/api/services','POST',sPayload('Role '+role),role)).status===(['admin','support_developer'].includes(role)?201:403),role+' write')}
 for(const role of ['inactive','pending'])check((await request('/api/services','GET',undefined,role)).status===403,role+' denied');
 check((await request('/api/services','GET',undefined,'anonymous')).status===401,'anonymous denied');
 check((await request('/api/services','POST',sPayload(),'admin',{Origin:'https://wrong.invalid'})).status===403,'origin denied');check((await request('/api/services','POST',sPayload(),'admin',{Authorization:'Bearer wrong'})).status===403,'csrf denied');
 check((await request('/api/services','POST',sPayload(),'SUPPORT_DEVELOPER')).status===403,'uppercase developer denied outside isolated development');
 // Exercise supported uppercase developer guard by switching only the guard environment, not the connected test pool.
 const savedEnv={DATABASE_URL:process.env.DATABASE_URL,APP_URL:process.env.APP_URL,NODE_ENV:process.env.NODE_ENV};
 process.env.DATABASE_URL='postgresql://vine_dev@127.0.0.1/vine_development';process.env.APP_URL='http://localhost:3000';process.env.NODE_ENV='development';
 check((await request('/api/services','POST',sPayload('Developer fixture'),'SUPPORT_DEVELOPER')).status===201,'uppercase supported development write');Object.assign(process.env,savedEnv);
 const catId=randomUUID();let cat=await request('/api/service-categories','POST',{id:catId,name:' Synthetic  Category '});check(cat.status===201,'category create');check((await request('/api/service-categories','POST',{id:catId,name:'Synthetic Category'})).status===200,'category replay');
 const catRace=await Promise.all([request(`/api/service-categories/${catId}`,'PATCH',{expectedVersion:1,name:'Renamed Category'}),request(`/api/service-categories/${catId}`,'PATCH',{expectedVersion:1,active:false})]);check(catRace.map(r=>r.status).sort().join()==='200,409','category stale protection');
 const payload={...sPayload(),categoryId:catId,branchSettings:[{branchId:'A',available:true,price:{mode:'inherit'}},{branchId:'B',available:true,price:{mode:'priced',amount:'150'}}]};
 let created=await request('/api/services','POST',payload);check(created.status===201,'service create');const id=created.body.id;check(created.body.branches.find((b:any)=>b.id==='B').effectivePrice.amount==='150.00','override');check(created.body.branches.find((b:any)=>b.id==='A').effectivePrice.amount==='100.00','inherit');
 const auditCount=Number((await pool.query("SELECT count(*) FROM app_records WHERE collection_path='audit_logs'")).rows[0].count);
 check((await request('/api/services','POST',{...payload,name:'  Synthetic   Service ',branchSettings:[...payload.branchSettings].reverse()})).status===200,'equivalent create replay');check(Number((await pool.query("SELECT count(*) FROM app_records WHERE collection_path='audit_logs'")).rows[0].count)===auditCount,'replay no duplicate audit');check((await request('/api/services','POST',{...payload,description:'different'})).status===409,'create different content rejected');
 for(const role of ['staff','doctor','manager']){const read=await request('/api/services/'+id,'GET',undefined,role);check(read.status===200&&read.body.branchSettings.length===1&&!JSON.stringify(read.body).includes('150.00'),role+' override scoped');check((await request('/api/services?branchId=B','GET',undefined,role)).status===403,role+' other branch denied');check((await request('/api/services','GET',undefined,role)).body.services.every((s:any)=>s.branches.every((b:any)=>b.id==='A')),role+' list scoped')}
 const race=await Promise.all([request('/api/services/'+id,'PATCH',{expectedVersion:1,description:'Canonical edit'}),request('/api/services/'+id,'PATCH',{expectedVersion:1,branchSettings:[{branchId:'A',available:true,price:{mode:'free'}}]})]);check(race.map(r=>r.status).sort().join()==='200,409','branch vs canonical race');
 let current=(await request('/api/services/'+id)).body;
 check((await request('/api/services/'+id,'PATCH',{name:'No version'})).status===400,'version required');
 const before=JSON.stringify(current);
 check((await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,name:'Partial must fail',branchSettings:[{branchId:'A',available:false,price:{mode:'inherit'}},{branchId:'missing',available:true,price:{mode:'free'}}]})).status===400,'invalid branch fails');check(JSON.stringify((await request('/api/services/'+id)).body)===before,'invalid branch no partial config');
 check((await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,categoryId:randomUUID()})).status===400,'invalid category fails');
 check((await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,branchSettings:[{branchId:'C',available:true,price:{mode:'inherit'}}]})).status===400,'inactive branch enable denied');
 for(const amount of ['0','-1','1.001','NaN','Infinity',12])check((await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,standardPrice:{mode:'priced',amount}})).status===400,'invalid price '+amount);
 for(const mode of ['free','unpriced','priced']){const r=await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,standardPrice:mode==='priced'?{mode,amount:'200.01'}:{mode}});check(r.status===200,'standard '+mode);current=r.body;check(current.standard_price===(mode==='free'?'0.00':mode==='unpriced'?null:'200.01'),'stored '+mode)}
 for(const mode of ['free','priced','inherit']){const r=await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,branchSettings:[{branchId:'A',available:true,price:mode==='priced'?{mode,amount:'300.00'}:{mode}}]});check(r.status===200,'branch '+mode);current=r.body;check(current.branches.find((b:any)=>b.id==='A').effectivePrice.amount===(mode==='free'?'0.00':mode==='priced'?'300.00':'200.01'),'branch effective '+mode)}
 current=(await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,active:false})).body;check(!current.active,'inactive preserved');check((await request('/api/services?availableOnly=true')).body.services.every((s:any)=>s.id!==id),'inactive excluded availability');check((await request('/api/services?status=inactive')).body.services.some((s:any)=>s.id===id),'inactive filter');
 check((await request('/api/services','POST',sPayload(' synthetic  SERVICE '))).status===409,'inactive name reserved');current=(await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,active:true})).body;check(current.active,'reactivate');
 // A lost PATCH response is resolved by refetch; replaying its old version cannot overwrite.
 const lostVersion=current.version;
 const lostResponse=await request('/api/services/'+id,'PATCH',{expectedVersion:lostVersion,description:'Synthetic committed response lost'});
 check(lostResponse.status===200,'lost response write committed');
 check((await request('/api/services/'+id,'PATCH',{expectedVersion:lostVersion,description:'Synthetic committed response lost'})).status===409,'lost response stale retry rejected');
 current=(await request('/api/services/'+id)).body;
 check(current.description==='Synthetic committed response lost'&&current.version===lostVersion+1,'lost response refetch resolves result');
 // An enabled branch can become inactive without clearing its retained settings.
 await db.collection('branches').doc('A').update({status:'Inactive'});
 const retained=await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,description:'Retained inactive branch',branchSettings:[{branchId:'A',available:true,price:{mode:'inherit'}}]});
 check(retained.status===200&&retained.body.branchSettings.find((b:any)=>b.branch_id==='A').available&&!retained.body.branches.find((b:any)=>b.id==='A').operationallyAvailable,'inactive branch stored setting retained but unavailable');
 current=retained.body;await db.collection('branches').doc('A').update({status:'Active'});
 const noSettings=await request('/api/services','POST',{...sPayload('Unpriced'),standardPrice:{mode:'unpriced'}});check(noSettings.status===201&&noSettings.body.branchSettings.length===0&&noSettings.body.branches.every((b:any)=>!b.operationallyAvailable),'missing settings unavailable');
 check((await request('/api/services?q=Synthetic%20Service&pageSize=1')).body.services.length===1,'search pagination');check((await request('/api/services?categoryId='+catId)).body.services.every((s:any)=>s.category_id===catId),'category filter');check((await request('/api/services?pageSize=101')).status===400,'bounded pagination');
 const nameRace=await Promise.all([request('/api/services','POST',sPayload('Race Name')),request('/api/services','POST',sPayload(' race   name '))]);check(nameRace.map(r=>r.status).sort().join()==='201,409','duplicate name race');
 const audits=(await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1",[id])).rows.map(r=>r.data);check(audits.some(a=>a.eventType==='service_deactivated')&&audits.some(a=>a.eventType==='service_standard_price_changed')&&audits.some(a=>a.eventType==='service_branch_price_changed'),'meaningful audit types');check(audits.every(a=>a.userId==='admin'&&a.source==='trusted_server'&&a.changes.some((c:any)=>'before'in c&&'after'in c)),'trusted before after audit');
 // Force an audit insert failure inside the transaction, then prove SQL changes rolled back.
 const original=db.runTransaction;
 db.runTransaction=async cb=>original(async tx=>{const create=tx.create.bind(tx);tx.create=((ref:any,data:any)=>{if(ref.collectionPath==='audit_logs')throw Error('Synthetic audit failure');return create(ref,data)}) as any;return cb(tx)});
 const failed=await request('/api/services/'+id,'PATCH',{expectedVersion:current.version,description:'Must rollback'});db.runTransaction=original;check(failed.status===500,'audit failure surfaced');check((await request('/api/services/'+id)).body.description===current.description,'audit failure rolls back');
 await sqlReject('UPDATE services SET default_duration_minutes=0 WHERE id=$1',[id],'23514');await sqlReject('UPDATE services SET standard_price=$2 WHERE id=$1',[id,'NaN'],'23514');await sqlReject('UPDATE services SET standard_price=-1 WHERE id=$1',[id],'23514');await sqlReject('UPDATE services SET category_id=$2 WHERE id=$1',[id,randomUUID()],'23503');await sqlReject("DELETE FROM app_records WHERE collection_path='branches' AND id='A'",[],'23503');await sqlReject('INSERT INTO service_branch_settings(id,service_id,branch_id,available,created_by,updated_by) VALUES($1,$2,$3,true,$4,$4)',[randomUUID(),id,'A','admin'],'23505');await sqlReject('INSERT INTO service_branch_settings(id,service_id,branch_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4)',[randomUUID(),id,'missing','admin'],'23503');
 check((await request('/api/services/'+id,'DELETE')).status===404,'no hard delete endpoint');
 check((await pool.query("SELECT data->>'treatmentService' text FROM app_records WHERE collection_path='visits' AND id='legacy'")).rows[0].text==='  ORIGINAL free text  ','historical text unchanged');
 // Category deactivation does not remove existing association; new association is refused.
 let category=(await request('/api/service-categories')).body.categories.find((c:any)=>c.id===catId);category=(await request('/api/service-categories/'+catId,'PATCH',{expectedVersion:category.version,active:false})).body;check(!category.active&&(await request('/api/services/'+id)).body.category_id===catId,'inactive category readable');check((await request('/api/services','POST',{...sPayload('Inactive category assignment'),categoryId:catId})).status===400,'new inactive category rejected');check((await request('/api/service-categories/'+catId,'PATCH',{expectedVersion:category.version,active:true})).status===200,'category reactivate');
 const timings:number[]=[];
 for(let i=0;i<10;i++){const started=performance.now();check((await request('/api/services?pageSize=25')).status===200,'timed bounded catalogue request');timings.push(performance.now()-started)}
 timings.sort((a,b)=>a-b);console.log('Synthetic HTTP list timing (10 requests, small disposable catalogue): median '+timings[5].toFixed(1)+' ms, max '+timings[9].toFixed(1)+' ms');
 console.log(`Services API/database: ${checks} checks passed`);
}finally{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end()}
