import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {selectWordAtPoint,selectionPopoverStyle} from '../src/selection.js';
test('double-click word selection narrows a paragraph without selecting unrelated text',()=>{
 const dom=new JSDOM('<article>Focus grows with practice. Café naïve.</article><p>Outside</p>');const d=dom.window.document,container=d.querySelector('article'),node=container.firstChild;
 const caret=d.createRange();caret.setStart(node,8);caret.collapse(true);d.caretRangeFromPoint=()=>caret;
 const whole=d.createRange();whole.selectNodeContents(container);dom.window.getSelection().addRange(whole);
 assert.ok(selectWordAtPoint(d,50,50,container));assert.equal(dom.window.getSelection().toString(),'grows');
 caret.setStart(node,29);assert.ok(selectWordAtPoint(d,50,50,container));assert.equal(dom.window.getSelection().toString(),'Café');
 caret.setStart(d.querySelector('p').firstChild,1);assert.equal(selectWordAtPoint(d,50,50,container),false);dom.window.close();
});
test('selection popovers stay above selected text and inside narrow screens',()=>{
 for(const viewport of [320,390,1280])for(const left of [0,viewport-20]){
  const style=selectionPopoverStyle({top:220,left,width:20},viewport);
  assert.ok(style.top<220);assert.ok(style.maxHeight<=style.top-8);
  assert.ok(style.left-style.width/2>=12);assert.ok(style.left+style.width/2<=viewport-12);
 }
});
