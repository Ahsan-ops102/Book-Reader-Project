import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import JSZip from 'jszip';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'reading-room-test-'));
Object.assign(process.env, {
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  TURSO_DATABASE_URL: `file:${path.join(temp, 'test.db')}`,
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_PATH: path.join(temp, 'objects'),
  REGISTRATION_MODE: 'open',
  NO_LISTEN: '1'
});
const {
  app
} = await import('../server.js');
let server, url, alice, bob, documentId, bookId;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(r => server.close(r));
  const {
    default: db
  } = await import('../db.js');
  db.close();
  await fs.rm(temp, {
    recursive: true,
    force: true
  });
});
async function api(route, method = 'GET', body, token) {
  const response = await fetch(url + route, {
    method,
    headers: {
      ...(token ? {
        Authorization: `Bearer ${token}`
      } : {}),
      ...(body ? {
        'Content-Type': 'application/json'
      } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null)
  };
}
async function upload(route, buffer, name, token) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  const response = await fetch(url + route, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });
  return {
    status: response.status,
    body: await response.json()
  };
}
test('registration rejects weak passwords and creates separate accounts', async () => {
  assert.equal((await api('/api/auth/register', 'POST', {
    username: 'weak',
    password: 'short'
  })).status, 400);
  alice = (await api('/api/auth/register', 'POST', {
    username: 'alice',
    password: 'test-only-password-123'
  })).body.token;
  bob = (await api('/api/auth/register', 'POST', {
    username: 'bob',
    password: 'test-only-password-456'
  })).body.token;
  assert.ok(alice);
  assert.ok(bob);
  assert.equal((await api('/api/books')).status, 401);
});
test('document ownership is checked before any writes', async () => {
  const created = await api('/api/documents/create', 'POST', {
    title: 'Private writing',
    html: '<h1>Original</h1>'
  }, alice);
  assert.equal(created.status, 201);
  documentId = created.body.id;
  const attempt = await api(`/api/documents/${documentId}/save`, 'PUT', {
    title: 'Wrong owner',
    html: '<p>Changed</p>',
    revision: 0
  }, bob);
  assert.equal(attempt.status, 404);
  const current = await api(`/api/documents/${documentId}/content`, 'GET', undefined, alice);
  assert.equal(current.body.html, '<h1>Original</h1>');
  assert.equal((await api(`/api/documents/${documentId}/content`, 'GET', undefined, bob)).status, 404);
});
test('empty documents save, versions survive, stale writes are rejected', async () => {
  let r = await api(`/api/documents/${documentId}/save`, 'PUT', {
    html: '<p></p>',
    title: 'Empty',
    revision: 0
  }, alice);
  assert.equal(r.status, 200);
  assert.equal(r.body.revision, 1);
  r = await api(`/api/documents/${documentId}/save`, 'PUT', {
    html: '<p>Stale</p>',
    title: 'Stale',
    revision: 0
  }, alice);
  assert.equal(r.status, 409);
  const versions = await api(`/api/documents/${documentId}/versions`, 'GET', undefined, alice);
  assert.equal(versions.body.length, 1);
  const previous = await api(`/api/documents/${documentId}/versions/${versions.body[0].id}`, 'GET', undefined, alice);
  assert.equal(previous.body.html, '<h1>Original</h1>');
});
test('trash is reversible and account isolated', async () => {
  assert.equal((await api(`/api/documents/${documentId}`, 'DELETE', undefined, alice)).status, 200);
  assert.equal((await api(`/api/documents/${documentId}/content`, 'GET', undefined, alice)).status, 404);
  assert.equal((await api(`/api/documents/${documentId}/restore`, 'POST', undefined, bob)).status, 404);
  assert.equal((await api(`/api/documents/${documentId}/restore`, 'POST', undefined, alice)).status, 200);
});
test('PDF signatures and duplicate uploads are handled', async () => {
  assert.equal((await upload('/api/books/upload', 'not pdf', 'fake.pdf', alice)).status, 400);
  const pdf = '%PDF-1.4\n% Test PDF header\n1234567890\n%%EOF';
  let r = await upload('/api/books/upload', pdf, 'test.pdf', alice);
  assert.equal(r.status, 201);
  bookId = r.body.id;
  r = await upload('/api/books/upload', pdf, 'renamed.pdf', alice);
  assert.equal(r.body.duplicate, true);
  assert.equal(r.body.id, bookId);
  assert.equal((await api(`/api/books/${bookId}`, 'GET', undefined, bob)).status, 404);
});
test('PDF byte ranges and invalid progress are checked', async () => {
  const r = await fetch(url + `/api/books/${bookId}/file`, {
    headers: {
      Authorization: `Bearer ${alice}`,
      Range: 'bytes=0-7'
    }
  });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 8);
  assert.match(r.headers.get('Content-Range'), /^bytes 0-7\//);
  assert.equal((await api(`/api/books/${bookId}/progress`, 'PUT', {
    currentPage: -1,
    zoom: 1
  }, alice)).status, 400);
  assert.equal((await api(`/api/books/${bookId}/progress`, 'PUT', {
    currentPage: 1,
    zoom: 9
  }, alice)).status, 400);
});
test('notes use optimistic concurrency and are private', async () => {
  let r = await api(`/api/books/${bookId}/state`, 'PUT', {
    data: {
      notes: 'My note',
      tags: ['Research']
    },
    version: 0
  }, alice);
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 1);
  assert.equal((await api(`/api/books/${bookId}/state`, 'PUT', {
    data: {
      notes: 'Stale'
    },
    version: 0
  }, alice)).status, 409);
  assert.equal((await api(`/api/books/${bookId}/state`, 'GET', undefined, bob)).status, 404);
  assert.equal((await api(`/api/books/${bookId}/state`, 'GET', undefined, alice)).body.data.notes, 'My note');
});
test('covers reject HTML and private URL references', async () => {
  assert.equal((await upload(`/api/books/${bookId}/cover`, '<svg/>', 'cover.svg', alice)).status, 400);
  assert.equal((await api(`/api/books/${bookId}/cover-reference`, 'PUT', {
    url: 'https://localhost/private'
  }, alice)).status, 400);
  assert.equal((await api(`/api/books/${bookId}/cover-reference`, 'PUT', {
    url: 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false'
  }, alice)).status, 200);
});
test('legacy DOC is rejected; valid DOCX original is retained after saves', async () => {
  assert.equal((await upload('/api/documents/upload', 'legacy binary', 'legacy.doc', alice)).status, 400);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<document/>');
  const created = await upload('/api/documents/upload', await zip.generateAsync({
    type: 'nodebuffer'
  }), 'original.docx', alice);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await api(`/api/documents/${id}/save`, 'PUT', {
    html: '<p>Converted</p>',
    title: 'Original',
    revision: 0
  }, alice)).status, 200);
  const versions = await api(`/api/documents/${id}/versions`, 'GET', undefined, alice);
  const original = await api(`/api/documents/${id}/versions/${versions.body[0].id}`, 'GET', undefined, alice);
  assert.equal(original.body.format, 'docx');
  assert.ok(original.body.base64);
});
test('session records are idempotent; shares expose only selected metadata', async () => {
  const session = {
    id: crypto.randomUUID(),
    bookId,
    seconds: 60,
    pages: 2,
    day: '2026-08-30'
  };
  await api('/api/account/sessions', 'POST', session, alice);
  await api('/api/account/sessions', 'POST', session, alice);
  const stats = await api('/api/account/stats', 'GET', undefined, alice);
  assert.equal(stats.body.totalSeconds, 60);
  const share = await api('/api/account/shares', 'POST', {
    bookIds: [bookId],
    days: 1
  }, alice);
  const publicData = await api(`/api/shared/${share.body.id}`);
  assert.equal(publicData.body.books.length, 1);
  assert.deepEqual(Object.keys(publicData.body.books[0]).sort(), ['author', 'status', 'title']);
  await api(`/api/account/shares/${share.body.id}`, 'DELETE', undefined, alice);
  assert.equal((await api(`/api/shared/${share.body.id}`)).status, 404);
});
test('concurrent saves keep exactly one winner and preserve the previous version', async () => {
  const created = await api('/api/documents/create','POST',{title:'Concurrent',html:'<p>Original</p>'},alice);
  const responses = await Promise.all(['First','Second'].map(value => api(`/api/documents/${created.body.id}/save`,'PUT',{title:value,html:`<p>${value}</p>`,revision:0},alice)));
  assert.deepEqual(responses.map(r => r.status).sort(),[200,409]);
  const versions=await api(`/api/documents/${created.body.id}/versions`,'GET',undefined,alice);
  assert.equal(versions.body.length,1);
  assert.equal((await api(`/api/documents/${created.body.id}/content`,'GET',undefined,alice)).body.revision,1);
});
test('malformed notes and goals are rejected without replacing valid state',async () => {
  for (const data of [{notes:{}},{chat:[{role:'ai',text:{}}]},{tags:[{}]},{highlights:[null]}]) assert.equal((await api(`/api/books/${bookId}/state`,'PUT',{version:1,data},alice)).status,400);
  assert.equal((await api(`/api/books/${bookId}/state`,'GET',undefined,alice)).body.data.notes,'My note');
  assert.equal((await api('/api/account/settings','PUT',{dailyMinutes:-5},alice)).status,400);
});
test('AI context stays account-scoped and page-range summaries use only requested pages', async () => {
  await api(`/api/books/${bookId}/text`,'PUT',{pages:[{page:1,text:'FIRST_PAGE_SOURCE'},{page:2,text:'SECOND_PAGE_SOURCE'}]},alice);
  const originalFetch=globalThis.fetch, originalKey=process.env.GEMINI_API_KEY, requests=[];
  process.env.GEMINI_API_KEY='synthetic-provider-test-key';
  globalThis.fetch=async (target,options) => {
    if (String(target).startsWith('https://generativelanguage.googleapis.com/')) {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden thought'},{text:'A grounded answer [p. 2]'}]}}]}),{status:200});
    }
    return originalFetch(target,options);
  };
  try {
    assert.equal((await api('/api/ai/summary','POST',{bookId},bob)).status,404);
    assert.equal(requests.length,0);
    const response=await api('/api/ai/summary','POST',{bookId,fromPage:2,toPage:2},alice);
    assert.equal(response.status,200); assert.equal(response.body.indexedPages,1);
    assert.ok(JSON.stringify(requests[0]).includes('SECOND_PAGE_SOURCE'));
    assert.ok(!JSON.stringify(requests[0]).includes('FIRST_PAGE_SOURCE'));
    assert.ok(!response.body.answer.includes('hidden thought'));
  } finally { globalThis.fetch=originalFetch; if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=originalKey; }
});
test('selection explanations and quick meanings work without a prebuilt index', async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.GEMINI_API_KEY, requests = [];
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  globalThis.fetch = async (target, options) => {
    if (String(target).startsWith('https://generativelanguage.googleapis.com/')) {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'To focus is to direct your attention.'}]}}]}));
    }
    return originalFetch(target, options);
  };
  try {
    await api(`/api/books/${bookId}/text`, 'PUT', {pages:[{page:1,text:''},{page:2,text:''}]}, alice);
    for (const mode of ['meaning','explain']) {
      const r = await api('/api/ai/query', 'POST', {bookId,selectedText:'focus',page:1,mode}, alice);
      assert.equal(r.status,200); assert.match(r.body.answer,/attention/);
      const sent = requests.at(-1);
      assert.ok(sent.contents[0].parts[0].text.includes('focus'));assert.ok(sent.generationConfig.maxOutputTokens<=512);
      assert.match(sent.systemInstruction.parts[0].text,mode==='meaning'?/one or two short sentences/:/entire selected/);
    }
    const followup = await api('/api/ai/query', 'POST', {bookId,selectedText:'focus',page:1,history:[{role:'user',text:'  '},{role:'ai',text:'Earlier answer.'}]}, alice);
    assert.equal(followup.status,200,'blank saved messages must not block new questions');
    assert.ok(requests.at(-1).contents[0].parts[0].text.includes('Earlier answer.'));
    const count = requests.length;
    assert.equal((await api('/api/ai/query','POST',{bookId,selectedText:'focus',mode:'meaning'},bob)).status,404);
    assert.equal(requests.length,count);
    assert.equal((await api('/api/ai/query','POST',{bookId,selectedText:'focus',mode:'invalid'},alice)).status,400);
  } finally {globalThis.fetch=originalFetch; if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;}
});
test('AI provider errors are actionable and do not lock out the next request',async () => {
  const originalFetch=globalThis.fetch, originalKey=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY='synthetic-test-key';
  let providerStatus=429;
  globalThis.fetch=async(target,options)=>{
    if (!String(target).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(target,options);
    if (providerStatus==='timeout') throw new DOMException('Timed out','TimeoutError');
    return new Response(JSON.stringify(providerStatus===200
      ? {candidates:[{finishReason:'STOP',content:{parts:[{text:'A recovered answer.'}]}}]}
      : {error:{message:'Private provider detail'}}),{status:providerStatus});
  };
  try {
    for (const [status,expected,message] of [[429,429,/quota/],[403,502,/credentials/],[404,502,/model is unavailable/],['timeout',504,/too long/]]) {
      providerStatus=status;
      const response=await api('/api/ai/query','POST',{selectedText:'focus',mode:'meaning'},alice);
      assert.equal(response.status,expected);assert.match(response.body.error,message);
      assert.ok(!response.body.error.includes('Private provider detail'));
      providerStatus=200;
      assert.equal((await api('/api/ai/query','POST',{selectedText:'focus',mode:'meaning'},alice)).body.answer,'A recovered answer.');
    }
  } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;}
});
test('a slow AI request retries once and readable length-limited answers are retained',async () => {
  const originalFetch=globalThis.fetch, originalKey=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY='synthetic-test-key';let attempts=0;
  globalThis.fetch=async(target,options)=>{
    if (!String(target).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(target,options);
    attempts++;
    if (attempts===1) throw new DOMException('Timed out','TimeoutError');
    return new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{thought:true,text:'hidden'},{text:'A useful explanation.'}]}}]}));
  };
  try {
    const response=await api('/api/ai/query','POST',{selectedText:'focus',mode:'explain'},alice);
    assert.equal(attempts,2);assert.equal(response.status,200);assert.equal(response.body.answer,'A useful explanation.');assert.equal(response.body.truncated,true);
    assert.equal(response.body.model,'gemini-3.5-flash-lite');
  } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;}
});
test('finished dates are recorded only after an explicit status update',async () => {
  assert.equal((await api(`/api/books/${bookId}`,'GET',undefined,alice)).body.finished_at,null);
  await api(`/api/books/${bookId}`,'PATCH',{status:'finished'},alice);
  assert.ok((await api(`/api/books/${bookId}`,'GET',undefined,alice)).body.finished_at);
});
test('logout revokes the server-side session', async () => {
  assert.equal((await api('/api/logout', 'POST', undefined, bob)).status, 204);
  assert.equal((await api('/api/books', 'GET', undefined, bob)).status, 401);
});
