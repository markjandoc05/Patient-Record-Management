import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
let url;
try { url = new URL(process.env.DATABASE_URL); }
catch { throw Error('A valid isolated development DATABASE_URL is required'); }
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_development' || url.username !== 'vine_dev') throw Error('Tunnel requires the isolated development database configuration');
if (!url.port) throw Error('Development database tunnel requires an explicit local port');
const service = process.env.DEV_DATABASE_SERVICE;
if (!/^vine-development-postgres-[a-z0-9]+$/.test(service || '')) throw Error('Invalid development service');
const args = ['-i', process.env.DEV_SSH_KEY, '-o', `UserKnownHostsFile=${process.env.DEV_SSH_KNOWN_HOSTS}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'IPQoS=none', '-o', 'ConnectTimeout=12'];
const lock = path.join(tmpdir(), `vine-development-db-tunnel-${url.port}.lock`);
const ownerFile = path.join(lock, 'owner');
function acquireLock() {
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = Number(readFileSync(ownerFile, 'utf8')); }
    catch { throw Error('Development tunnel lock is incomplete; check for another startup before retrying'); }
    if (!Number.isInteger(owner) || owner <= 0) throw Error('Invalid development tunnel lock; inspect it before retrying');
    try { process.kill(owner, 0); }
    catch (check) {
      if (check.code !== 'ESRCH') throw Error('Cannot verify development tunnel owner');
      // Only a confirmed dead owner may be replaced. Port ownership is checked separately.
      unlinkSync(ownerFile); rmdirSync(lock); mkdirSync(lock, { mode: 0o700 });
      writeFileSync(ownerFile, String(process.pid), { mode: 0o600 });
      return;
    }
    throw Error('A development tunnel supervisor is already running; reuse it');
  }
  writeFileSync(ownerFile, String(process.pid), { mode: 0o600 });
}
function releaseLock() {
  if (readFileSync(ownerFile, 'utf8') === String(process.pid)) {
    unlinkSync(ownerFile); rmdirSync(lock);
  }
}
function requireFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(Error(`Local port ${url.port} is unavailable; check the existing listener before retrying`)));
    server.listen({ host: '127.0.0.1', port: Number(url.port), exclusive: true }, () => server.close(resolve));
  });
}
let stopping = false;
let child;
let wakeRetry;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  stopping = true;
  wakeRetry?.();
  child?.kill(signal);
});
let ownsLock = false;
try {
  acquireLock(); ownsLock = true;
  let backoff = 2;
  while (!stopping) {
    await requireFreePort();
    if (stopping) break;
    console.log(`Starting development database tunnel at 127.0.0.1:${url.port}. Verify /api/health; a listener alone does not prove PostgreSQL readiness.`);
    const started = Date.now();
    const result = await new Promise(resolve => {
      let spawnError;
      child = spawn('ssh', [...args, '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-N', '-L', `127.0.0.1:${url.port}:127.0.0.1:15439`, process.env.DEV_SSH_HOST], {stdio:'inherit'});
      child.once('error', error => { spawnError = error.code || 'spawn error'; });
      child.once('close', (code, signal) => { child = undefined; resolve({ code, signal, spawnError }); });
    });
    if (stopping) break;
    if (result.spawnError) throw Error(`Development SSH tunnel could not start (${result.spawnError})`);
    if (Date.now() - started >= 60_000) backoff = 2;
    console.error(`Development SSH tunnel exited (${result.signal || `code ${result.code ?? 'unknown'}`}). Database access stopped; retrying in ${backoff}s.`);
    await new Promise(resolve => {
      const timer = setTimeout(done, backoff * 1000);
      function done() { clearTimeout(timer); wakeRetry = undefined; resolve(); }
      wakeRetry = done;
    });
    backoff = Math.min(backoff * 2, 30);
  }
  console.log('Development database tunnel stopped.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (ownsLock) releaseLock();
}
