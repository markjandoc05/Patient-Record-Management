import 'dotenv/config';
import { spawn } from 'node:child_process';
let url;
try { url = new URL(process.env.DATABASE_URL); }
catch { throw Error('A valid isolated development DATABASE_URL is required'); }
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_development' || url.username !== 'vine_dev') throw Error('Tunnel requires the isolated development database configuration');
if (!url.port) throw Error('Development database tunnel requires an explicit local port');
const service = process.env.DEV_DATABASE_SERVICE;
if (!/^vine-development-postgres-[a-z0-9]+$/.test(service || '')) throw Error('Invalid development service');
const args = ['-i', process.env.DEV_SSH_KEY, '-o', `UserKnownHostsFile=${process.env.DEV_SSH_KNOWN_HOSTS}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'IPQoS=none', '-o', 'ConnectTimeout=12'];
console.log(`Starting development database tunnel at 127.0.0.1:${url.port}. Keep this terminal open; verify /api/health after starting Vine.`);
const child = spawn('ssh', [...args, '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-N', '-L', `127.0.0.1:${url.port}:127.0.0.1:15439`, process.env.DEV_SSH_HOST], {stdio:'inherit'});
let stopping = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  stopping = true;
  child.kill(signal);
});
child.on('error', error => {
  console.error(`Development SSH tunnel could not start (${error.code || 'spawn error'}).`);
  process.exit(1);
});
child.on('close', (code, signal) => {
  if (stopping) {
    console.log('Development database tunnel stopped.');
    process.exit(0);
  }
  console.error(`Development SSH tunnel exited (${signal || `code ${code ?? 'unknown'}`}). Database access stopped; retry npm run dev:db:tunnel.`);
  process.exit(code && code > 0 ? code : 1);
});
