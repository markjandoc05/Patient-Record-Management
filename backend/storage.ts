import path from 'node:path';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
const root = path.resolve(process.env.STORAGE_DIR || './data/files');
export function storageFile(name: string) {
  if (!/^(branding|uploads)\/[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(part => part === '..' || !part)) throw new Error('Invalid storage path');
  const location = path.resolve(root, name);
  if (!location.startsWith(root + path.sep)) throw new Error('Invalid storage path');
  return {
    name,
    async save(buffer: Buffer, options: any) {
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, buffer, { mode: 0o600, flag: 'wx' });
      try { await writeFile(location + '.metadata.json', JSON.stringify({ contentType: options.contentType, ...options.metadata, size: buffer.length }), { mode: 0o600 }); }
      catch (error) { await unlink(location); throw error; }
    },
    async getMetadata(): Promise<[any]> {
      try {
        const metadata = JSON.parse(await readFile(location + '.metadata.json', 'utf8'));
        await stat(location); return [metadata];
      } catch (error: any) { if (error.code === 'ENOENT') error.code = 404; throw error; }
    },
    createReadStream: () => createReadStream(location),
    async delete(options?: { ignoreNotFound?: boolean }) {
      for (const file of [location, location + '.metadata.json']) {
        try { await unlink(file); } catch (error: any) { if (!(options?.ignoreNotFound && error.code === 'ENOENT')) throw error; }
      }
    },
  };
}
export const storageBucket = { file: storageFile };
