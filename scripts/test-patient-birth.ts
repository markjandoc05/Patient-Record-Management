import assert from 'node:assert/strict';
import { parsePatientBirth, patientBirthLabel } from '../src/utils/patientBirth';
const today = '2026-10-02';
let checks = 0;
const check = (f: () => void) => { f(); checks++; };
check(() => assert.equal(parsePatientBirth({birthday:'1990-10-03'},today).age,35));
check(() => assert.equal(parsePatientBirth({birthday:'1990-10-02'},today).age,36));
check(() => assert.equal(parsePatientBirth({birthday:'2026-10-02'},today).age,0));
check(() => assert.equal(parsePatientBirth({},today).birthDateStatus,'unknown'));
for (const input of [{birthDateStatus:'unknown',birthday:'1990-01-01',age:36}, {birthDateStatus:'estimated_age',estimatedAge:'30',estimatedAgeAsOf:'2026-01-01',birthday:'1990-01-01'}, {birthDateStatus:'estimated_year',estimatedBirthYear:'1990',birthday:'1990-01-01'}]) {
 const parsed=parsePatientBirth(input,today);
 check(()=>assert.equal(parsed.birthday,'')); check(()=>assert.equal(parsed.age,null));
 check(()=>assert.match(patientBirthLabel(parsed),/unknown|Estimated/));
}
for (const input of [{birthDateStatus:'invalid'}, {birthDateStatus:'exact'}, {birthday:'2026-02-30'}, {birthday:'2027-01-01'}, {birthDateStatus:'estimated_age',estimatedAge:'',estimatedAgeAsOf:today}, {birthDateStatus:'estimated_age',estimatedAge:-1,estimatedAgeAsOf:today}, {birthDateStatus:'estimated_age',estimatedAge:131,estimatedAgeAsOf:today}, {birthDateStatus:'estimated_age',estimatedAge:30,estimatedAgeAsOf:'2026-02-30'}, {birthDateStatus:'estimated_age',estimatedAge:30,estimatedAgeAsOf:'2027-01-01'}, {birthDateStatus:'estimated_year',estimatedBirthYear:2027}, {birthDateStatus:'estimated_year',estimatedBirthYear:1890}, {birthDateStatus:'estimated_year',estimatedBirthYear:''}]) check(()=>assert.throws(()=>parsePatientBirth(input,today)));
check(()=>assert.equal(parsePatientBirth({birthDateStatus:'estimated_age',estimatedAge:0,estimatedAgeAsOf:today},today).estimatedAge,0));
console.log(`${checks} patient birth validation checks passed.`);
