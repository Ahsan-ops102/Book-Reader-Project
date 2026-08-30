import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {needsPdfCover} from '../src/coverQueue.js';
const dom = new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
for(const k of ['window','document','localStorage','sessionStorage','HTMLElement','Event','MouseEvent','DOMParser']) globalThis[k]=dom.window[k];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.ResizeObserver=class{observe(){} disconnect(){}};
HTMLElement.prototype.scrollIntoView=function(){};
HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:100,right:800,bottom:1100,width:800,height:1000});
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');
const calls=[], saves=[];let pendingMeaning;
globalThis.readerMocks={
 state:{bookmarks:[],highlights:[],flashcards:[],tags:[],notes:'',chat:[{role:'user',text:'  '},{role:'ai',text:'x'.repeat(9000)}]},
 api: async (...args)=>{calls.push(args);if(args[2]?.mode==='meaning' && pendingMeaning)return pendingMeaning;return {answer:args[2]?.mode==='meaning'?'A short meaning.':'A full explanation.',sources:[]};},
 save:async(...args)=>{saves.push(args);return {version:1};}
};
const source=`import React from 'react';export {default} from './src/components/Reader.jsx';export {default as Library} from './src/components/Library.jsx';`;
let apiMock=`
const m=globalThis.readerMocks;
export const queryAI=(...a)=>m.api(...a),summarizeBook=async()=>({answer:'Summary.'});
export const uploadCover=async()=>{},updateBook=async()=>{},getBook=async()=>({id:'fixture',title:'Fixture',format:'pdf',current_page:1}),bookFileSource=()=>({url:'fixture'}),updateProgress=async()=>{},updatePageCount=async()=>{},accountKey=k=>'test:'+k,getBookText=async()=>[],saveBookText=m.save,ocrPage=async()=>{},fetchBookBlob=async()=>new Blob(),createDocument=async()=>({id:'doc'}),getBookState=async()=>({data:m.state,version:0}),saveBookState=m.save;
`;
apiMock += 'export const coverBlob=async()=>"",listBooks=async()=>globalThis.readerMocks.books.map(b=>({...b})),getConfig=async()=>({maxUploadMB:64});';
const apiSource=await fs.readFile(new URL('../src/api.js',import.meta.url),'utf8');
for(const match of apiSource.matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)){if(!new RegExp('\\b'+match[1]+'\\s*=').test(apiMock))apiMock+='export const '+match[1]+'=async()=>({});';}
const file=new URL('./.reader-test-bundle.mjs',import.meta.url);
await build({stdin:{contents:source,resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},outfile:file.pathname,bundle:true,format:'esm',platform:'node',jsx:'automatic',packages:'external',plugins:[{name:'reader-fixtures',setup(b){
 b.onResolve({filter:/\/bookTools\.js$/},()=>({path:'bookTools',namespace:'fixture'}));
 b.onResolve({filter:/\/api\.js$/},()=>({path:'api',namespace:'fixture'}));
 b.onResolve({filter:/\/offline\.js$/},()=>({path:'offline',namespace:'fixture'}));
 b.onResolve({filter:/\/offlineShell\.js$/},()=>({path:'shell',namespace:'fixture'}));
 b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'fixture'}));
 b.onResolve({filter:/^react-pdf$/},()=>({path:'pdf',namespace:'fixture'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx',contents:path==='bookTools'?`export const extractBook=async(file,book)=>{const m=globalThis.readerMocks;m.coverCalls.push(book.id);if(book.id==='broken')throw new Error('Sample extraction failed');m.books=m.books.map(b=>b.id===book.id?{...b,cover_kind:'extracted',cover_ref:'saved'}:b);};export const openPdf=async()=>{},pageImage=async()=>{},indexPdf=async()=>{},composeCover=async()=>{};`:path==='api'?apiMock:path==='offline'?'export const cacheGet=async()=>null,cacheSet=async()=>{},cacheRemove=async()=>{},clearOffline=async()=>{},enqueueSession=async()=>{};':path==='shell'?'export const offlineShellStatus=async()=>({}),prepareOfflineShell=async()=>"Ready";':path==='router'?'export const useNavigate=()=>()=>{},useParams=()=>({id:"fixture"}),useSearchParams=()=>[new URLSearchParams()];':path==='pdf'?`import React,{useEffect} from 'react';export const pdfjs={GlobalWorkerOptions:{}};const pdf={numPages:1,getOutline:async()=>[],getPage:async()=>({getTextContent:async()=>({items:[{str:'Focus grows with practice.'}]})})};export function Document({onLoadSuccess,children}){useEffect(()=>{onLoadSuccess?.(pdf)},[]);return <div>{children}</div>};export const Page=()=> <span data-testid="passage">Focus grows with practice.</span>;`:''}));
}}]});
const {default:Reader,Library}=await import(file.href);
const root=createRoot(document.getElementById('root'));
after(async()=>{try{await act(async()=>root.unmount());}finally{await fs.rm(file,{force:true});dom.window.close();delete globalThis.readerMocks;}});
async function tick(){await act(async()=>{await new Promise(r=>setTimeout(r,15))});}
function button(name){return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===name)}
async function click(node){assert.ok(node,'Button exists');await act(async()=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));await tick();}
async function select(){const span=document.querySelector('[data-testid="passage"]');const range=document.createRange();range.selectNodeContents(span);range.getClientRects=()=>[{left:20,top:200,right:260,bottom:220,width:240,height:20}];range.getBoundingClientRect=()=>({left:20,top:200,right:260,bottom:220,width:240,height:20});const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);await act(async()=>span.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));}
test('selection bubbles send once, quick meaning stays inline, and outside clicks dismiss the sidebar',async()=>{
 await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Reader))));await tick();await tick();
 await select();assert.ok(button('Quick meaning'));assert.ok(button('Explain'));
 await click(button('Quick meaning'));assert.equal(calls.length,1);assert.equal(calls[0][0],'Focus grows with practice.');assert.equal(calls[0][2].mode,'meaning');assert.ok(document.querySelector('.quick-meaning'));assert.equal(document.querySelector('.ai-chat'),null);
 await click(button('Explain'));assert.equal(calls.length,2);assert.equal(calls[1][2].mode,'explain');assert.deepEqual(calls[1][2].history,[],'a fresh selection explanation does not reuse unrelated chat');assert.ok(document.querySelector('.ai-chat').textContent.includes('A full explanation.'));
 await act(async()=>document.querySelector('.ai-chat textarea').dispatchEvent(new Event('pointerdown',{bubbles:true})));assert.ok(document.querySelector('.ai-chat'));
 await act(async()=>document.querySelector('.reading-canvas').dispatchEvent(new Event('pointerdown',{bubbles:true})));assert.equal(document.querySelector('.ai-chat'),null);
});
test('selection settling does not erase a pending or completed quick answer',async()=>{
 let resolve;pendingMeaning=new Promise(r=>resolve=r);await select();await click(button('Quick meaning'));
 await act(async()=>{document.dispatchEvent(new Event('selectionchange'));await new Promise(r=>setTimeout(r,220));});
 assert.ok(document.querySelector('.quick-meaning'),'loading bubble survives the same selection settling');
 await act(async()=>{window.getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));await new Promise(r=>setTimeout(r,220));});
 assert.ok(document.querySelector('.quick-meaning'),'collapsing the native range does not lose the pending answer');
 await act(async()=>resolve({answer:'The meaning remains visible.'}));pendingMeaning=null;
 assert.match(document.querySelector('.quick-meaning')?.textContent||'',/meaning remains visible/);
 await act(async()=>{document.dispatchEvent(new Event('selectionchange'));await new Promise(r=>setTimeout(r,220));});
 assert.match(document.querySelector('.quick-meaning')?.textContent||'',/meaning remains visible/);
});
test('asking without a selection uses readable page text without manual indexing',async()=>{
 window.getSelection().removeAllRanges();await act(async()=>document.querySelector('.reading-canvas').dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));
 await click(button('Ask AI'));await click(button('Explain'));assert.equal(calls.at(-1)[0].trim(),'Focus grows with practice.');assert.ok(calls.at(-1)[2].history.every(m=>m.text.trim()));assert.equal(calls.at(-1)[2].history.find(m=>m.text.startsWith('xxxx')).text.length,6000);
 await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('.ai-chat'),null);
});
test('dismissing a pending quick meaning prevents a late popup',async()=>{
 let resolve;pendingMeaning=new Promise(r=>resolve=r);await select();await click(button('Quick meaning'));
 await act(async()=>document.querySelector('.reader-top').dispatchEvent(new Event('pointerdown',{bubbles:true})));
 await act(async()=>resolve({answer:'Late result.'}));assert.equal(document.querySelector('.quick-meaning'),null);pendingMeaning=null;
});
test('automatic cover eligibility keeps existing covers and excludes EPUB/trash',()=>{
 assert.ok(needsPdfCover({format:'pdf',cover_kind:'placeholder'}));
 assert.ok(needsPdfCover({format:'pdf',cover_kind:'extracted',cover_ref:null}));
 for(const kind of ['published','uploaded','extracted','generated'])assert.equal(needsPdfCover({format:'pdf',cover_kind:kind,cover_ref:'saved'}),false);
 assert.equal(needsPdfCover({format:'epub'}),false);assert.equal(needsPdfCover({format:'pdf',deleted_at:'today'}),false);
});

test('opening the library automatically fills missing covers once and preserves saved covers',async()=>{
 const m=globalThis.readerMocks;m.coverCalls=[];m.books=[
 {id:'missing',title:'Missing cover',format:'pdf',uploaded_at:'2026',status:'unread'},
 {id:'chosen',title:'Chosen cover',format:'pdf',cover_kind:'published',cover_ref:'saved',uploaded_at:'2026',status:'unread'},
 {id:'broken',title:'Unreadable PDF',format:'pdf',uploaded_at:'2026',status:'unread'}];
 await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Library))));
 await tick();await tick();await tick();
 assert.deepEqual(m.coverCalls,['missing','broken']);assert.equal(m.books[1].cover_ref,'saved');
 assert.ok(document.body.textContent.includes('Cover saved'));assert.ok(document.body.textContent.includes('Sample extraction failed'));
 await tick();assert.equal(m.coverCalls.length,2,'failed covers do not retry in a render loop');
});
