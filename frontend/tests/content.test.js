import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import JSZip from 'jszip';
import {safeHtml,escapeHtml,plainToHtml} from '../src/sanitize.js';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser=dom.window.DOMParser;
test('import sanitizer removes active markup, remote images, and dangerous URLs',()=>{
 const html=safeHtml('<p onclick="alert(1)">Hello<script>alert(1)</script><img src="https://tracker.invalid/pixel"><a href="javascript:alert(1)">bad</a><iframe src="https://tracker.invalid"></iframe><svg onload="alert(1)"></svg></p>');
 assert.ok(html.includes('Hello'));assert.ok(!/script|onclick|iframe|svg|tracker|javascript/i.test(html));
});
test('sanitizer preserves supported formatting and safe links',()=>{const html=safeHtml('<h2>A heading</h2><p><strong>bold</strong> &amp; <em>italic</em><a href="https://example.com">link</a></p><table><tr><td><p>Cell</p></td></tr></table>');assert.ok(html.includes('<h2>A heading</h2>'));assert.ok(html.includes('<strong>bold</strong>'));assert.ok(html.includes('noopener noreferrer'));assert.ok(html.includes('<table>'));});
test('PDF and AI text are escaped without interpreting HTML or regex syntax',()=>{assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');assert.equal(escapeHtml('['),'[');assert.equal(plainToHtml('A < B\nNext\n\nNew'),'<p>A &lt; B<br>Next</p><p>New</p>');});
test('sanitizer permits embedded raster images only',()=>{assert.ok(safeHtml('<img alt="test" src="data:image/png;base64,aGVsbG8=">').includes('data:image/png'));assert.equal(safeHtml('<img src="data:image/svg+xml;base64,YQ==">'),'');});
