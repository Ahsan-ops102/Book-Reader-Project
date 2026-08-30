// Local backups only. Cloud snapshots are managed with Turso and R2 (see migration guide).
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
const target = process.argv[2];
if (!target || !process.env.TURSO_DATABASE_URL?.startsWith('file:') || process.env.STORAGE_DRIVER !== 'local') throw new Error('Usage: npm run backup:local -- /absolute/new-backup-folder (local storage only). Stop the API first.');
if (!path.isAbsolute(target)) throw new Error('Use an absolute backup folder outside the project.');
const database = path.resolve(process.env.TURSO_DATABASE_URL.slice(5));
const objects = path.resolve(process.env.LOCAL_STORAGE_PATH || './data/objects');
if (target.startsWith(objects + path.sep) || target === objects) throw new Error('Backup must be outside the object storage folder.');
await fs.mkdir(target, {mode:0o700}); // Refuse an existing directory; never overwrite a backup.
const db = new DatabaseSync(database, {readOnly:true});
try {
  await backup(db,path.join(target,'library.db'));
  await fs.cp(objects,path.join(target,'objects'),{recursive:true,errorOnExist:true});
  await fs.chmod(path.join(target,'library.db'),0o600);
  await fs.writeFile(path.join(target,'backup.json'),JSON.stringify({createdAt:new Date().toISOString(),format:1,kind:'local',note:'Contains private books, notes and password hashes. Keep encrypted and access restricted.'},null,2),{mode:0o600});
  console.log('Local database and objects backed up. Test restoration in an isolated environment.');
} finally {db.close();}
