import assert from 'node:assert/strict';
import { assertClinicalQuery, protectClinicalWrite, sameClinicalRepresentation } from '../backend/clinicalRedaction';
import { protectedAccessPolicyFields } from '../src/accessPolicyFields';
const denied={role:'staff',active:true,permissionOverrides:{'clinical.view':'deny'}};
const readOnly={role:'doctor',active:true,permissionOverrides:{'clinical.edit_draft':'deny'}};
let count=0;
for(const field of ['details','changes','notes','diagnosis','attachments']) for(const type of ['where','orderBy']) {
 assert.throws(()=>assertClinicalQuery(denied,'audit_logs',[{type,field,value:'secret'}]));count++;
 assertClinicalQuery({role:'admin',active:true},'audit_logs',[{type,field,value:'secret'}]);count++;
}
assertClinicalQuery(denied,'audit_logs',[{type:'where',field:'resource'},{type:'orderBy',field:'timestamp'},{type:'limit',value:1}]);count++;
for(const text of [' Penicillin','Penicillin ','\tPenicillin\n']) {
 const submitted={allergies:text.trim(),name:'Operational'};protectClinicalWrite(readOnly,submitted,{allergies:text});assert.deepEqual(submitted,{name:'Operational'});count++;
}
assert.throws(()=>protectClinicalWrite(readOnly,{allergies:'different'},{allergies:' Penicillin '}));count++;
assert.equal(sameClinicalRepresentation('', 'Penicillin'),false);count++;
assert.equal(sameClinicalRepresentation({note:' x '},{note:'x'}),false);count++;
const meaningful={allergies:''};protectClinicalWrite(readOnly,meaningful,{allergies:'Penicillin'});assert.deepEqual(meaningful,{});count++;
const authorized={allergies:'changed'};protectClinicalWrite({role:'doctor',active:true},authorized,{allergies:'old'});assert.equal(authorized.allergies,'changed');count++;
for(const field of ['role','assignedBranches','defaultBranchId','permissionOverrides','active','accountStatus','isArchived']) {assert.ok(protectedAccessPolicyFields.has(field));count++;}
assert.equal(protectedAccessPolicyFields.has('contactNumber'),false);count++;
console.log(count+' repair query/whitespace/security-field checks passed');
