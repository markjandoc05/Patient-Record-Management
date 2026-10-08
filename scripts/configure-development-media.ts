import assert from 'node:assert/strict';
import { db, pool } from '../backend/database';
import { developmentAccessEnabled } from '../backend/developmentAccess';
import { normalizeMediaSettings } from '../src/mediaSettings';

// One-time development fixture, verified against production's saved policy on
// 2026-10-01. No production connection and no ongoing settings/data sync.
const policy = { allowedExtensions: ['.png', '.jpg', '.pdf'], maxFileSizeMB: 1, maxFilesPerRecord: 5 };
const verify = process.argv.slice(2).includes('--verify');
if (process.argv.slice(2).some(arg => arg !== '--verify')) throw new Error('Use --verify or no arguments');
function assertPolicy(data: any) {
  const effective = normalizeMediaSettings(data);
  assert.deepEqual([...effective.allowedExtensions].sort(), [...policy.allowedExtensions].sort());
  assert.equal(effective.maxFileSizeMB, policy.maxFileSizeMB);
  assert.equal(effective.maxFilesPerRecord, policy.maxFilesPerRecord);
}
try {
  if (!developmentAccessEnabled()) throw new Error('Isolated localhost development database required');
  await db.runTransaction(async tx => {
    const ref = db.collection('settings').doc('media');
    const existing = await tx.get(ref);
    if (existing.exists) assertPolicy(existing.data()); // Never overwrite a changed policy.
    else if (verify) throw new Error('Development media settings are missing');
    else tx.create(ref, policy);
  });
  console.log(`Development media policy ${verify ? 'verified' : 'configured'}; existing settings preserved. Production unchanged.`);
} finally { await pool.end(); }
