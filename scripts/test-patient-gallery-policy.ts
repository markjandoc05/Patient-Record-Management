import assert from 'node:assert/strict';
import { GALLERY_PHOTO_LIMIT, galleryPhotoCount, isGalleryImage, parsePhotoInput } from '../src/patientGalleryPolicy';
import { hasCapability } from '../src/permissions';

let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const valid = { stage: 'before', takenAt: '2036-02-29T14:30', area: 'Face — front', note: 'Synthetic note' };
check(GALLERY_PHOTO_LIMIT === 4, 'Four photos per Visit');
for (const stage of ['before', 'after', 'progress']) check(parsePhotoInput({ ...valid, stage }).stage === stage, stage + ' stage retained');
for (const takenAt of ['0001-01-01T00:00', '2000-02-29T23:59', '2035-12-31T12:30']) {
  check(parsePhotoInput({ ...valid, takenAt }).takenAt === takenAt, 'Clinic minute retained without timezone conversion');
}
for (const takenAt of ['0000-01-01T00:00', '1900-02-29T10:00', '2035-02-29T10:00', '2036-04-31T10:00',
  '2036-00-01T10:00', '2036-13-01T10:00', '2036-01-00T10:00', '2036-01-01T24:00', '2036-01-01T12:60',
  '2036-1-01T10:00', '2036-01-01', '2036-01-01T10:00:00', '2036-01-01T10:00Z', null, 1, ['2036-01-01T10:00']]) {
  assert.throws(() => parsePhotoInput({ ...valid, takenAt }), 'Invalid clinic timestamp'); checks++;
}
for (const stage of ['', 'Before', 'unclassified', undefined, null, ['before'], { toString: () => 'before' }]) {
  assert.throws(() => parsePhotoInput({ ...valid, stage }), 'Reject non-enum stage'); checks++;
}
for (const input of [null, [], 'before', {}, { ...valid, area: 10 }, { ...valid, note: ['text'] },
  { ...valid, area: 'x'.repeat(121) }, { ...valid, note: 'x'.repeat(501) }]) {
  assert.throws(() => parsePhotoInput(input), 'Malformed or over-limit input rejected'); checks++;
}
const normalized = parsePhotoInput({ ...valid, area: '  Face\nfront\u0000  ', note: '  Synthetic\r\nnote  ' });
check(normalized.area === 'Face front' && normalized.note === 'Synthetic  note', 'Single-line metadata normalized');
check(parsePhotoInput({ ...valid, area: null, note: undefined }).area === '', 'Optional descriptors can be empty');
check(parsePhotoInput({ ...valid, area: 'x'.repeat(120), note: 'x'.repeat(500) }).note.length === 500, 'Boundary limits accepted');
for (const name of ['PHOTO.JPG', 'photo.jpeg', 'photo.png', 'photo.webp', 'photo.ico']) {
  check(isGalleryImage({ name }), 'Legacy image filename recognized');
}
check(isGalleryImage({ name: 'old-file', contentType: 'IMAGE/PNG' }), 'Stored image content type recognized');
for (const value of [null, undefined, {}, { name: 'old.pdf', contentType: 'application/pdf' }]) check(!isGalleryImage(value), 'Documents remain separate');
const legacy = [{ name: 'old.jpg', legacyMetadata: { keep: true } }, { name: 'old.png' }, { name: 'notes.pdf' }, null];
const before = JSON.stringify(legacy);
check(galleryPhotoCount(legacy) === 2 && galleryPhotoCount(null) === 0, 'Count includes legacy photos only');
check(JSON.stringify(legacy) === before, 'Counting never rewrites legacy attachments');
for (const actor of [{ role: 'doctor' }, { role: 'admin' }, { role: 'staff', staffDesignation: 'Nurse' }, { role: 'staff', staffDesignation: 'Medical Staff' }]) {
  const profile = { active: true, assignedBranches: ['A'], ...actor };
  check(hasCapability(profile, 'visits.attachments.manage', { branchId: 'A' }), 'Eligible clinical performer can manage Visit photos');
  check(hasCapability(profile, 'visits.attachments.manage', { branchId: 'B' }) === (actor.role === 'admin'), 'Assigned branches/global Admin scope retained');
  check(!hasCapability({ ...profile, permissionOverrides: { 'visits.attachments.manage': 'deny' } }, 'visits.attachments.manage'), 'Explicit attachment denial retained');
}
for (const role of ['staff', 'manager']) check(!hasCapability({ role, active: true, assignedBranches: ['A'] }, 'visits.attachments.manage'), 'Ordinary operational role remains read-only');
console.log(`${checks} patient Gallery policy/calendar/permission checks passed.`);
