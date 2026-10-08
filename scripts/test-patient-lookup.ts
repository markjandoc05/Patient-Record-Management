import assert from 'node:assert/strict';
import { matchesPatientLookup } from '../src/utils/patientLookup';
import { readFileSync } from 'node:fs';
const base={id:'internal-123',patientID:'ID-26-0042',name:'Ana   Santos',contactNumber:'+63 917 123 4567',email:'ana@example.invalid'};
let checks=0;
function check(value:boolean,label:string){assert.ok(value,label);checks++;}
for(const q of ['Ana Santos','ana','SANTOS',' ANA  SANTOS ','09171234567','+63 917 123 4567','9171234567','0917','+63 917','0063917','00639171234567','(917) 123-4567','ana@EXAMPLE.invalid','ID-26-0042','26-0042','internal-123','']) check(matchesPatientLookup(base,q),q);
for(const q of ['Nonexistent','09179999999','other@example.invalid','ID-26-9999','Ana 999']) check(!matchesPatientLookup(base,q),q);
for(const number of ['09171234567','+639171234567','9171234567','+63 (917) 123-4567']) for(const q of ['09171234567','+63 917 123 4567','9171234567']) check(matchesPatientLookup({...base,contactNumber:number},q),'Formatting compatibility');
for(const p of [{name:'Ana Santos'},{...base,birthday:'2001-01-01'},{...base,name:'Other Person'},{...base,name:'Ana Santosa'}]) check(matchesPatientLookup(p,p.name),'Separate identities remain searchable');
check(!matchesPatientLookup({name:'Legacy Patient'},'09171234567'),'Missing phone does not match');
check(!matchesPatientLookup({name:'Legacy Patient'},'ana@example.invalid'),'Missing email does not match');
assert.equal(base.contactNumber,'+63 917 123 4567'); checks++;
for(const component of ['PatientDashboard','AppointmentForm','VisitForm']) check(readFileSync(`src/components/${component}.tsx`,'utf8').includes('matchesPatientLookup('),'Shared matching wired into '+component);
const dashboard=readFileSync('src/components/PatientDashboard.tsx','utf8');
for(const text of ['Retry loading','This is not an empty search result','setAccessDenied(true)','setEditingPatient(null)','hasLoadedPatients','Previously loaded records']) check(dashboard.includes(text),text);
console.log(`${checks} patient lookup checks passed (pure matching and static component guards, not browser/API evidence).`);
