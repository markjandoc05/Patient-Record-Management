import assert from 'node:assert/strict';
import { formatLedgerTreatmentTime } from '../src/utils/treatmentLedgerPresentation';
import { setActiveTimezoneSettings } from '../src/utils/timezone';

const savedTZ = process.env.TZ;
try {
  process.env.TZ = 'UTC';
  assert.match(formatLedgerTreatmentTime('2026-10-14T10:00', 'Asia/Manila'), /10:00\s*(?:AM|am).*Asia\/Manila/);
  setActiveTimezoneSettings({ timezone: 'America/New_York' });
  assert.match(formatLedgerTreatmentTime('2026-10-14T10:00', 'Asia/Manila'), /10:00\s*(?:AM|am).*Asia\/Manila/);
  process.env.TZ = 'Pacific/Honolulu';
  assert.match(formatLedgerTreatmentTime('2026-10-14T10:00', 'Asia/Manila'), /10:00\s*(?:AM|am).*Asia\/Manila/);
  assert.match(formatLedgerTreatmentTime('2026-10-14T02:00:00Z', 'Asia/Manila'), /10:00\s*(?:AM|am).*Asia\/Manila/);
  assert.match(formatLedgerTreatmentTime('2026-10-14T10:00', 'America/New_York'), /10:00\s*(?:AM|am).*America\/New_York/);
  assert.equal(formatLedgerTreatmentTime(null, 'Asia/Manila'), '');
  console.log('6/6 treatment ledger presentation checks passed.');
} finally { process.env.TZ = savedTZ; setActiveTimezoneSettings(null); }
