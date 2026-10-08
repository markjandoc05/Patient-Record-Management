import assert from 'node:assert/strict';
import { findingFields, parseClinicalFindings, clinicalFindingLabel, reportedFindingEdit } from '../src/utils/clinicalFindings';
let checks=0;const check=(fn:()=>void)=>{fn();checks++;};
for(const field of findingFields){
 check(()=>assert.equal(parseClinicalFindings({})[`${field}Status`],'unknown'));
 check(()=>assert.equal(clinicalFindingLabel({},field),'Unknown'));
 check(()=>assert.match(clinicalFindingLabel({[field]:'No known issues'},field),/Unknown \/ unconfirmed/));
 check(()=>assert.equal(parseClinicalFindings({[`${field}Status`]:'none_known'})[`${field}Status`],'none_known'));
 check(()=>assert.throws(()=>parseClinicalFindings({[`${field}Status`]:'none_known',[field]:'Some detail'})));
 check(()=>assert.throws(()=>parseClinicalFindings({[`${field}Status`]:'present'})));
 check(()=>assert.throws(()=>parseClinicalFindings({[`${field}Status`]:'bad'})));
 check(()=>assert.equal(parseClinicalFindings({[`${field}Status`]:'present',[field]:'Reported detail'})[`${field}Status`],'present'));
 check(()=>assert.match(clinicalFindingLabel({[`${field}Status`]:'none_known'},field),/reported/));
 check(()=>assert.match(clinicalFindingLabel({[`${field}Status`]:'none_known',[field]:'Contradiction'},field),/Conflicting record/));
}
for (const field of findingFields) {
 check(()=>assert.equal(reportedFindingEdit({}, field, '')[`${field}Status`], 'unknown'));
 check(()=>assert.equal(reportedFindingEdit({[`${field}Status`]:'none_known'}, field, 'Reported detail')[`${field}Status`], 'unknown'));
 check(()=>assert.equal(reportedFindingEdit({[field]:'Reported detail',[`${field}Status`]:'present'}, field, '')[`${field}Status`], 'unknown'));
 check(()=>assert.equal(reportedFindingEdit({[field]:'Reported detail',[`${field}Status`]:'present'}, field, 'Reported detail')[`${field}Status`], 'present'));
 check(()=>assert.equal(reportedFindingEdit({[`${field}Status`]:'none_known'}, field, '')[`${field}Status`], 'none_known'));
 check(()=>assert.doesNotThrow(()=>parseClinicalFindings(reportedFindingEdit({[`${field}Status`]:'none_known'}, field, 'Reported detail'))));
}
console.log(`${checks} clinical finding state checks passed (no clinician-review evidence).`);
