import express from 'express';
import db from '../db.js';
import { uploadToR2, readObject, deleteFromR2 } from '../storage.js';
import { route, fail, text, integer, id, randomId } from '../security.js';
import { upload, uploadGate, fileBuffer, validateZip, quota } from '../files.js';
const router = express.Router();
async function owned(req, trash = false) {
  const row = (await db.execute({
    sql: `SELECT * FROM documents WHERE id=? AND user_id=? ${trash ? '' : 'AND deleted_at IS NULL'}`,
    args: [id(req.params.id), req.user.id]
  })).rows[0];
  if (!row) fail(404, 'Document not found');
  return row;
}
function content(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4 * 1024 * 1024) fail(400, 'Document must be text smaller than 4 MB.');
  return value || '<p></p>';
}
function words(html) {
  return html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}
router.get('/', route(async (req, res) => {
  res.json((await db.execute({
    sql: `SELECT id,title,word_count,revision,created_at,updated_at,deleted_at FROM documents WHERE user_id=? AND deleted_at IS ${req.query.trash === '1' ? 'NOT ' : ''}NULL ORDER BY updated_at DESC`,
    args: [req.user.id]
  })).rows);
}));
router.post('/create', route(async (req, res) => {
  const title = text(req.body.title || 'Untitled Document', 'Title'),
    html = content(req.body.html ?? '<p></p>'),
    docId = randomId(),
    filename = `docs/${req.user.id}/${docId}/${randomId()}.html`;
  await quota(req.user.id, Buffer.byteLength(html));
  await uploadToR2(filename, Buffer.from(html), 'text/html');
  try {
    await db.execute({
      sql: 'INSERT INTO documents(id,title,filename,word_count,user_id,size_bytes) VALUES(?,?,?,?,?,?)',
      args: [docId, title, filename, words(html), req.user.id, Buffer.byteLength(html)]
    });
  } catch (e) {
    await deleteFromR2(filename).catch(() => {});
    throw e;
  }
  res.status(201).json({
    id: docId,
    title,
    revision: 0
  });
}));
router.post('/upload', uploadGate, upload.single('file'), route(async (req, res) => {
  const buffer = await fileBuffer(req);
  await validateZip(buffer, 'docx');
  await quota(req.user.id, buffer.length);
  const title = text(req.body.title || req.file.originalname.replace(/\.docx$/i, ''), 'Title'),
    docId = randomId(),
    filename = `docs/${req.user.id}/${docId}/original.docx`;
  await uploadToR2(filename, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  try {
    await db.execute({
      sql: 'INSERT INTO documents(id,title,filename,original_filename,user_id,size_bytes) VALUES(?,?,?,?,?,?)',
      args: [docId, title, filename, filename, req.user.id, buffer.length]
    });
  } catch (e) {
    await deleteFromR2(filename).catch(() => {});
    throw e;
  }
  res.status(201).json({
    id: docId,
    title,
    revision: 0
  });
}));
router.get('/:id/content', route(async (req, res) => {
  const doc = await owned(req);
  const buffer = await readObject(doc.filename);
  res.json({
    html: doc.filename.endsWith('.html') ? buffer.toString('utf8') : undefined,
    base64: doc.filename.endsWith('.html') ? undefined : buffer.toString('base64'),
    format: doc.filename.endsWith('.html') ? 'html' : 'docx',
    revision: doc.revision,
    title: doc.title
  });
}));
router.get('/:id/versions', route(async (req, res) => {
  await owned(req);
  res.json((await db.execute({
    sql: 'SELECT id,title,word_count,revision,created_at FROM document_versions WHERE document_id=? ORDER BY revision DESC',
    args: [req.params.id]
  })).rows);
}));
router.get('/:id/versions/:version', route(async (req, res) => {
  await owned(req);
  const v = (await db.execute({
    sql: 'SELECT * FROM document_versions WHERE id=? AND document_id=?',
    args: [id(req.params.version), req.params.id]
  })).rows[0];
  if (!v) fail(404, 'Version not found');
  const b = await readObject(v.filename);
  res.json({
    html: v.filename.endsWith('.html') ? b.toString('utf8') : undefined,
    base64: v.filename.endsWith('.html') ? undefined : b.toString('base64'),
    format: v.filename.endsWith('.html') ? 'html' : 'docx',
    title: v.title
  });
}));
router.put('/:id/save', route(async (req, res) => {
  const doc = await owned(req);
  const expected = integer(req.body.revision, 'Revision'),
    html = content(req.body.html),
    title = text(req.body.title ?? doc.title, 'Title');
  if (expected !== doc.revision) fail(409, 'This document changed on another device. Reload or keep your draft as a new document.');
  const filename = `docs/${req.user.id}/${doc.id}/${randomId()}.html`,
    size = Buffer.byteLength(html);
  await quota(req.user.id, size);
  await uploadToR2(filename, Buffer.from(html), 'text/html');
  const tx = await db.transaction('write');
  try {
    const result = await tx.execute({
      sql: "UPDATE documents SET filename=?,title=?,word_count=?,revision=revision+1,size_bytes=size_bytes+?,updated_at=datetime('now') WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL",
      args: [filename, title, words(html), size, doc.id, req.user.id, expected]
    });
    if (result.rowsAffected !== 1) fail(409, 'This document changed while saving. Your draft has been retained.');
    await tx.execute({
      sql: 'INSERT INTO document_versions(id,document_id,filename,title,word_count,revision) VALUES(?,?,?,?,?,?)',
      args: [randomId(), doc.id, doc.filename, doc.title, doc.word_count || 0, expected]
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    await deleteFromR2(filename).catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
  res.json({
    ok: true,
    wordCount: words(html),
    revision: expected + 1
  });
}));
router.delete('/:id', route(async (req, res) => {
  await owned(req);
  await db.execute({
    sql: "UPDATE documents SET deleted_at=datetime('now') WHERE id=? AND user_id=?",
    args: [req.params.id, req.user.id]
  });
  res.json({
    ok: true
  });
}));
router.post('/:id/restore', route(async (req, res) => {
  await owned(req, true);
  await db.execute({
    sql: 'UPDATE documents SET deleted_at=NULL WHERE id=? AND user_id=?',
    args: [req.params.id, req.user.id]
  });
  res.json({
    ok: true
  });
}));
router.delete('/:id/permanent', route(async (req, res) => {
  const doc = await owned(req, true);
  if (!doc.deleted_at) fail(400, 'Move the document to trash first.');
  const versions = (await db.execute({
    sql: 'SELECT filename FROM document_versions WHERE document_id=?',
    args: [doc.id]
  })).rows;
  for (const filename of new Set([doc.filename, doc.original_filename, ...versions.map(v => v.filename)].filter(Boolean))) await deleteFromR2(filename);
  await db.batch([{
    sql: 'DELETE FROM document_versions WHERE document_id=?',
    args: [doc.id]
  }, {
    sql: 'DELETE FROM documents WHERE id=? AND user_id=?',
    args: [doc.id, req.user.id]
  }], 'write');
  res.json({
    ok: true
  });
}));
export default router;
