import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
if (!new URL(process.env.DATABASE_URL || 'postgresql://localhost/missing').pathname.endsWith('/vine_import_test') || process.env.ALLOW_TEST_DATABASE !== 'yes') throw new Error('Use isolated vine_import_test and ALLOW_TEST_DATABASE=yes');
await migrateDatabase(); await pool.query('TRUNCATE service_branch_settings, services, service_categories, app_records, auth_identities, auth_sessions, oauth_attempts');
const temporary = await mkdtemp(path.join(tmpdir(), 'vine-import-fixture-'));
const source = path.join(temporary, 'source'); const target = path.join(temporary, 'target');
const filePath = 'uploads/patient-one/general/patient-one/test.pdf'; const contents = Buffer.from('%PDF-1.4\nSynthetic fixture');
try {
  await mkdir(path.join(source, 'files', path.dirname(filePath)), { recursive: true });
  await writeFile(path.join(source, 'files', filePath), contents);
  await writeFile(path.join(source, 'files', filePath + '.metadata.json'), JSON.stringify({ contentType: 'application/pdf', size: contents.length }));
  const snapshot = { formatVersion: 1, exportedAt: new Date().toISOString(), records: [
    { collectionPath: 'users', id: 'legacy-uid', data: { email: 'fixture@test.invalid', role: 'admin', active: true } },
    { collectionPath: 'patients', id: 'patient-one', data: { name: 'Synthetic Fixture', attachments: [{ storagePath: filePath }], createdAt: { __timestamp: '2026-01-01T00:00:00.000Z' } } },
    { collectionPath: 'patients/patient-one/privateNotes', id: 'note-one', data: { authorId: 'legacy-uid', note: 'Synthetic private note' } },
    { collectionPath: 'settings', id: 'branding', data: { appLogoUrl: 'https://firebasestorage.googleapis.com/v0/b/test/o/branding%2Flogo%2Ftest.png?alt=media' } },
  ], identities: [{ googleSubject: 'verified-google-subject', userId: 'legacy-uid', email: 'fixture@test.invalid' }], files: [{ path: filePath, size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }] };
  await writeFile(path.join(source, 'snapshot.json'), JSON.stringify(snapshot));
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/import-postgres.ts', source], { cwd: process.cwd(), env: { ...process.env, STORAGE_DIR: target }, encoding: 'utf8' });
  const imported = run(); assert.equal(imported.status, 0, imported.stderr);
  assert.equal((await pool.query('SELECT count(*)::integer AS count FROM app_records')).rows[0].count, 4);
  assert.equal((await pool.query('SELECT user_id FROM auth_identities WHERE google_subject = $1', ['verified-google-subject'])).rows[0].user_id, 'legacy-uid');
  const patient = (await pool.query("SELECT data FROM app_records WHERE collection_path = 'patients'")).rows[0].data;
  assert.equal((await pool.query("SELECT data FROM app_records WHERE collection_path = 'patients/patient-one/privateNotes'")).rows[0].data.authorId, 'legacy-uid');
  assert.equal(patient.createdAt.__timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal((await pool.query("SELECT data FROM app_records WHERE collection_path = 'settings'")).rows[0].data.appLogoUrl, '/api/branding/content?path=branding%2Flogo%2Ftest.png');
  assert.deepEqual(await readFile(path.join(target, filePath)), contents);
  assert.notEqual(run().status, 0, 'Import must reject nonempty destination');
  assert.equal((await pool.query('SELECT count(*)::integer AS count FROM app_records')).rows[0].count, 4);
  console.log('Passed 8 migration import checks: IDs, identities, private notes, timestamps, branding, files and overwrite rejection.');
} finally { await pool.end(); await rm(temporary, { recursive: true, force: true }); }
