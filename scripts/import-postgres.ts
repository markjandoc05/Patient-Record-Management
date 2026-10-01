import { readFile, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db, pool } from '../backend/database';
import { parseRecordPath } from '../backend/dataApi';
import { migrateDatabase } from './migrate-database';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run migration:import -- /absolute/private/export-directory');
try {
  const snapshot = JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8'));
  if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.identities) || !Array.isArray(snapshot.files)) throw new Error('Invalid snapshot');
  await migrateDatabase();
  const root = path.resolve(process.env.STORAGE_DIR || './data/files');
  // Verify every file before any database mutation.
  for (const file of snapshot.files) {
    if (!/^(branding|uploads)\/[A-Za-z0-9_./-]+$/.test(file.path) || file.path.split('/').some((part: string) => part === '..' || !part)) throw new Error('Invalid file path');
    const source = path.join(directory, 'files', file.path);
    if ((await stat(source)).size !== file.size) throw new Error('File size mismatch');
    if (typeof file.sha256 !== 'string' || createHash('sha256').update(await readFile(source)).digest('hex') !== file.sha256) throw new Error('File checksum mismatch');
    JSON.parse(await readFile(source + '.metadata.json', 'utf8'));
  }
  await db.runTransaction(async tx => {
    if ((await tx.sql('SELECT 1 FROM app_records LIMIT 1', [])).rowCount || (await tx.sql('SELECT 1 FROM auth_identities LIMIT 1', [])).rowCount) throw new Error('Import requires an empty destination');
    const recordIds = new Set<string>();
    for (const record of snapshot.records) {
      parseRecordPath(`${record.collectionPath}/${record.id}`, true);
      const key = `${record.collectionPath}/${record.id}`; if (recordIds.has(key)) throw new Error('Duplicate source record'); recordIds.add(key);
      if (!record.data || Array.isArray(record.data) || typeof record.data !== 'object') throw new Error('Invalid record data');
      if (record.collectionPath === 'settings' && ['branding', 'footer'].includes(record.id)) {
        for (const [key, value] of Object.entries(record.data)) {
          if (typeof value === 'string' && value.includes('firebasestorage.googleapis.com')) {
            const encoded = /\/o\/([^?]+)/.exec(value)?.[1];
            if (encoded) { const filePath = decodeURIComponent(encoded); if (filePath.startsWith('branding/')) record.data[key] = `/api/branding/content?path=${encodeURIComponent(filePath)}`; }
          }
        }
      }
      tx.create(db.collection(record.collectionPath).doc(record.id), record.data);
    }
    for (const identity of snapshot.identities) {
      if (!recordIds.has(`users/${identity.userId}`) || typeof identity.googleSubject !== 'string' || typeof identity.email !== 'string') throw new Error('Identity has no profile or is invalid');
      await tx.sql('INSERT INTO auth_identities (google_subject, user_id, email) VALUES ($1, $2, $3)', [identity.googleSubject, identity.userId, identity.email]);
    }
    // Copy without overwriting existing files. Failed imports leave only orphaned
    // files in staging; discard the staging volume before retrying.
    for (const file of snapshot.files) {
      const target = path.join(root, file.path); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(path.join(directory, 'files', file.path), target, 1);
      await copyFile(path.join(directory, 'files', file.path + '.metadata.json'), target + '.metadata.json', 1);
    }
  });
  console.log(`Imported ${snapshot.records.length} records, ${snapshot.identities.length} identities, ${snapshot.files.length} files. Verify in staging before cutover.`);
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
