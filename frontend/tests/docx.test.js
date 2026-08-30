import { test } from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { buildDocx } from '../src/docxExport.js';
const text = (value,marks) => ({type:'text',text:value,marks});
test('DOCX round trip retains headings, emphasis, links, lists, tables and embedded PNG', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9S8AAAAASUVORK5CYII=';
  const data = await buildDocx({type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[text('A & B')]},
    {type:'paragraph',content:[text('Bold',[{type:'bold'}]),text(' link',[{type:'link',attrs:{href:'https://example.com/?a=1&b=2'}}])]},
    {type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[text('One')]}]}]},
    {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[text('Cell')]}]}]}]},
    {type:'image',attrs:{src:'data:image/png;base64,'+png,alt:'Tiny test image'}}
  ]});
  const result = await mammoth.convertToHtml({buffer:Buffer.from(data)});
  assert.match(result.value,/<h2>A &amp; B<\/h2>/);
  assert.match(result.value,/<strong>Bold<\/strong>/);
  assert.match(result.value,/<a href="https:\/\/example.com\//);
  assert.match(result.value,/<ul>/); assert.match(result.value,/<table>/);
  assert.match(result.value,/data:image\/png;base64,/);
  const zip = await JSZip.loadAsync(data);
  assert.equal(await zip.file('word/media/image1.png').async('base64'),png);
});
test('DOCX export escapes text and never creates unsafe link relationships', async () => {
  const zip=await JSZip.loadAsync(await buildDocx({content:[{type:'paragraph',content:[text('<script> & words',[{type:'link',attrs:{href:'javascript:alert(1)'}}])]}]}));
  const xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/&lt;script&gt; &amp; words/);
  assert.ok(!(await zip.file('word/_rels/document.xml.rels').async('string')).includes('javascript:'));
});
