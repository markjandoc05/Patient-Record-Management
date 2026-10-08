// One-time read-only exporter. Firebase SDK is a development dependency only.
import 'dotenv/config';
import admin from 'firebase-admin';
import { initializeFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import config from '../firebase-applet-config.json';
const output = process.argv[2];
if (!output) throw new Error('Usage: npm run migration:export -- /absolute/private/export-directory');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: config.projectId, storageBucket: config.storageBucket });
const source = initializeFirestore(admin.app(), { preferRest: true }, config.firestoreDatabaseId);
function encode(value: any): any {
  if (value && typeof value.toDate === 'function') return { __timestamp: value.toDate().toISOString() };
  if (value instanceof Date) return { __timestamp: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  return value;
}
const records: any[] = [];
async function exportCollection(collection: admin.firestore.CollectionReference) {
  const references = await collection.listDocuments();
  for (let offset = 0; offset < references.length; offset += 8) {
    await Promise.all(references.slice(offset, offset + 8).map(async reference => {
      const document = await reference.get();
      if (document.exists) records.push({ collectionPath: collection.path, id: document.id, data: encode(document.data()) });
      for (const child of await reference.listCollections()) await exportCollection(child);
    }));
  }
}
await mkdir(output, { recursive: true, mode: 0o700 });
for (const collection of await source.listCollections()) {
  await exportCollection(collection);
  console.log(`Exported collection ${collection.id}; ${records.length} records so far.`);
}
const profileIds = new Set(records.filter(record => record.collectionPath === 'users').map(record => record.id));
const identities: any[] = []; let pageToken: string | undefined;
do {
  const page = await admin.auth().listUsers(1000, pageToken);
  for (const user of page.users) {
    const google = user.providerData.find(provider => provider.providerId === 'google.com');
    if (google && user.email && profileIds.has(user.uid)) identities.push({ googleSubject: google.uid, userId: user.uid, email: user.email });
  }
  pageToken = page.pageToken;
} while (pageToken);
const files: any[] = [];
const bucket = admin.storage().bucket(config.storageBucket);
for (const prefix of ['uploads/', 'branding/']) {
  const [objects] = await bucket.getFiles({ prefix });
  for (const object of objects) {
    if (!/^(branding|uploads)\/[A-Za-z0-9_./-]+$/.test(object.name) || object.name.split('/').some(part => part === '..' || !part)) throw new Error('Unsupported source file path');
    const [metadata] = await object.getMetadata(); const [buffer] = await object.download();
    const target = path.join(output, 'files', object.name); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, buffer, { mode: 0o600 });
    await writeFile(target + '.metadata.json', JSON.stringify({ contentType: metadata.contentType, contentDisposition: metadata.contentDisposition, metadata: metadata.metadata, size: buffer.length }), { mode: 0o600 });
    files.push({ path: object.name, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
  }
}
await writeFile(path.join(output, 'snapshot.json'), JSON.stringify({ formatVersion: 1, exportedAt: new Date().toISOString(), records, identities, files }, null, 2), { mode: 0o600 });
console.log(`Exported ${records.length} records, ${identities.length} identities, ${files.length} files. Source was not changed.`);
