import { readFile, writeFile, rename, chmod, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

// Explicit, opt-in setup. Never loads a remote database or prints credentials.
try {
  let contents;
  try { contents = await readFile('.env', 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    contents = '';
  }
  const previous = parse(contents);
  if (previous.NODE_ENV === 'production' || (previous.APP_URL && previous.APP_URL !== 'http://localhost:3000')) {
    throw Error('Local setup refuses production or non-local Vine configuration');
  }
  const tunnelNames = ['DEV_DATABASE_SERVICE', 'DEV_SSH_HOST', 'DEV_SSH_KEY', 'DEV_SSH_KNOWN_HOSTS'];
  const allowed = ['APP_URL', 'PORT', 'NODE_ENV', 'DATABASE_URL', 'STORAGE_DIR', 'LOCAL_POSTGRES_PASSWORD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', ...tunnelNames];
  const unknown = Object.keys(previous).filter(name => !allowed.includes(name));
  if (unknown.length) throw Error(`Review additional local configuration before setup: ${unknown.join(', ')}`);
  let oldDatabase;
  if (previous.DATABASE_URL) {
    try { oldDatabase = new URL(previous.DATABASE_URL); }
    catch { throw Error('Existing DATABASE_URL is invalid; local setup stopped'); }
    if (oldDatabase.hostname !== '127.0.0.1' || oldDatabase.pathname !== '/vine_development' || oldDatabase.username !== 'vine_dev') {
      throw Error('Local setup only replaces isolated vine_development / vine_dev loopback configuration');
    }
    if (!['55439', '56439'].includes(oldDatabase.port)) throw Error('Unexpected existing development port; local setup stopped');
  }
  const encode = value => JSON.stringify(value);
  if (oldDatabase?.port === '56439') {
    if (tunnelNames.some(name => !previous[name])) throw Error('Incomplete optional tunnel configuration; local setup stopped');
    const values = ['DATABASE_URL', ...tunnelNames];
    const tunnel = '# Optional remote development tunnel only. Never needed for normal local startup.\n'
      + values.map(name => `${name}=${encode(previous[name])}`).join('\n') + '\n';
    try { await writeFile('.env.tunnel', tunnel, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = parse(await readFile('.env.tunnel', 'utf8'));
      if (values.some(name => existing[name] !== previous[name])) throw Error('Existing optional tunnel configuration differs; refusing to overwrite either configuration');
    }
  }
  let password = previous.LOCAL_POSTGRES_PASSWORD;
  if (oldDatabase?.port === '55439') {
    if (!password || decodeURIComponent(oldDatabase.password) !== password) throw Error('Existing local database credentials do not match; refusing to rotate them');
  } else if (!password) password = randomBytes(32).toString('hex');
  const next = {
    NODE_ENV: 'development', APP_URL: 'http://localhost:3000', PORT: '3000',
    LOCAL_POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://vine_dev:${encodeURIComponent(password)}@127.0.0.1:55439/vine_development`,
    GOOGLE_CLIENT_ID: previous.GOOGLE_CLIENT_ID || '', GOOGLE_CLIENT_SECRET: previous.GOOGLE_CLIENT_SECRET || '',
    STORAGE_DIR: './data/local-development-files',
  };
  const groups = [
    ['App', ['NODE_ENV', 'APP_URL', 'PORT']],
    ['Database: dedicated local PostgreSQL container', ['LOCAL_POSTGRES_PASSWORD', 'DATABASE_URL']],
    ['OAuth: development Google credentials; configure locally only', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']],
    ['Private local files', ['STORAGE_DIR']],
  ];
  const output = groups.map(([label, names]) => `# ${label}\n${names.map(name => `${name}=${encode(next[name])}`).join('\n')}`).join('\n\n') + '\n';
  const checked = parse(output);
  if (Object.entries(next).some(([name, value]) => checked[name] !== value)) throw Error('Environment serialization verification failed');
  await writeFile('.env.local-setup.tmp', output, { mode: 0o600 });
  await rename('.env.local-setup.tmp', '.env');
  await chmod('.env', 0o600);
  await mkdir(next.STORAGE_DIR, { recursive: true, mode: 0o700 });
  console.log('Local Vine configuration ready. OAuth values preserved; credentials were not displayed.');
  console.log('Next: npm run dev:db:up, npm run db:migrate, then npm run dev.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
