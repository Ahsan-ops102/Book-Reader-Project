import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
const local = process.env.STORAGE_DRIVER === 'local';
const root = path.resolve(process.env.LOCAL_STORAGE_PATH || './data/objects');
if (local) await fsp.mkdir(root, {
  recursive: true
});
if (!local && !['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].every(k => process.env[k])) throw new Error('Configure all R2 settings, or explicitly set STORAGE_DRIVER=local.');
const s3 = local ? null : new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});
const Bucket = process.env.R2_BUCKET_NAME;
function localPath(key) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.split('/').includes('..')) throw new Error('Invalid storage key');
  return path.join(root, key);
}
export async function uploadToR2(key, body, contentType = 'application/pdf') {
  if (!local) return s3.send(new PutObjectCommand({
    Bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
  const dest = localPath(key);
  await fsp.mkdir(path.dirname(dest), {
    recursive: true
  });
  await fsp.writeFile(dest, body);
  await fsp.writeFile(dest + '.meta', JSON.stringify({
    contentType
  }));
}
export async function getFromR2(key, range) {
  if (!local) return s3.send(new GetObjectCommand({
    Bucket,
    Key: key,
    ...(range ? {
      Range: range
    } : {})
  }));
  const dest = localPath(key),
    stat = await fsp.stat(dest),
    meta = JSON.parse(await fsp.readFile(dest + '.meta', 'utf8').catch(() => '{}'));
  let start = 0,
    end = stat.size - 1,
    ContentRange;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || !m[1] && !m[2]) throw Object.assign(new Error('Invalid range'), {
      status: 416
    });
    if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= stat.size) throw Object.assign(new Error('Range not satisfiable'), {
      status: 416
    });
    ContentRange = `bytes ${start}-${end}/${stat.size}`;
  }
  return {
    Body: fs.createReadStream(dest, {
      start,
      end
    }),
    ContentLength: end - start + 1,
    ContentType: meta.contentType,
    ContentRange
  };
}
export async function readObject(key) {
  const obj = await getFromR2(key),
    chunks = [];
  for await (const chunk of obj.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
export async function deleteFromR2(key) {
  if (!local) return s3.send(new DeleteObjectCommand({
    Bucket,
    Key: key
  }));
  await fsp.rm(localPath(key), {
    force: true
  });
  await fsp.rm(localPath(key) + '.meta', {
    force: true
  });
}
export async function storageHealth() {
  if (local) {
    await fsp.access(root);
    return;
  }
  await s3.send(new HeadBucketCommand({
    Bucket
  }));
}
