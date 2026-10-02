import assert from 'node:assert/strict';
import { canManageServices, canViewServices, parseServicePrice, effectiveServicePrice, serviceName, priceInput } from '../src/servicesPolicy';
let checks=0;function check(v:any,m:string){assert.ok(v,m);checks++}
for(const role of ['admin','SUPPORT_DEVELOPER','support_developer','manager','staff','doctor']) {check(canViewServices(role),role+' read');check(canManageServices(role)===['admin','SUPPORT_DEVELOPER','support_developer'].includes(role),role+' write')}
check(!canViewServices('invented')&&!canManageServices('invented'),'unknown denied');
check(serviceName('  Alpha   Service ') === 'Alpha Service','normalize');
for(const v of ['',null,12,'x'.repeat(121)]){assert.throws(()=>serviceName(v));checks++}
for(const branch of [true,false]){
 check(parseServicePrice({mode:branch?'inherit':'unpriced'},branch)===null,'missing null');check(parseServicePrice({mode:'free'},branch)==='0.00','explicit free');
 for(const [v,result] of [['1','1.00'],['0.01','0.01'],['00001.2','1.20'],['9999999999.99','9999999999.99']])check(parseServicePrice({mode:'priced',amount:v},branch)===result,'exact price '+v);
 for(const amount of [1,'0','0.00','-1','1.001','1e2','NaN','Infinity','',' 1.00','10000000000','1.']){assert.throws(()=>parseServicePrice({mode:'priced',amount},branch));checks++}
 for(const v of [{mode:'free',amount:'0'},null,{mode:'bogus'},{mode:branch?'unpriced':'inherit'},{mode:'free',other:1}]){assert.throws(()=>parseServicePrice(v,branch));checks++}
}
for(const [s,b,a,source] of [['100.00',null,'100.00','standard'],['100.00','150.00','150.00','branch'],['100.00','0.00','0.00','branch'],[null,null,null,'unconfigured'],['0.00',null,'0.00','standard']] as const){const r=effectiveServicePrice(s,b);check(r.amount===a&&r.source===source,'fallback');check(parseServicePrice(priceInput(a))===a,'roundtrip')}
console.log(`Services policy: ${checks} checks passed`);
