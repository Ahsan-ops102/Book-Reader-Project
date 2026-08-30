import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=(await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8')).replace('__ASSETS__',JSON.stringify(['/assets/new.js'])).replace('__VERSION__','new');
function worker({wrongHtml=false,failedDownload=false}={}){
 let offline=false;
 const handlers={},events=[],stores=new Map([['reading-room-shell-old',new Map([['/assets/old.js','old-bundle']])]]);
 const caches={keys:async()=>[...stores.keys()],delete:async key=>{events.push('delete');return stores.delete(key)},open:async key=>{
  if(!stores.has(key))stores.set(key,new Map());const m=stores.get(key);return {addAll:async()=>{events.push('assets');if(failedDownload)throw Error('offline')},put:async(k,v)=>{events.push('html');m.set(k,v)},match:async key=>m.get(typeof key==='string'?key:new URL(key.url).pathname)};
 }};
 const self={location:{origin:'https://reader.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>events.push('activate-ready'),clients:{claim:async()=>events.push('claim'),matchAll:async()=>[{id:'existing-writer'}]}};
 vm.runInNewContext(source,{self,caches,URL,AbortSignal,Request:class{constructor(url){this.url=url}},fetch:async()=>{if(offline)throw Error("offline");return {ok:true,clone(){return this},text:async()=>`<script src="/assets/${wrongHtml?'wrong':'new'}.js"></script>`}}});
 return {handlers,events,stores,setOffline:value=>offline=value};
}
test('offline update activates after a complete shell and retains bundles for open tabs',async()=>{
 const w=worker();let ready;w.handlers.install({waitUntil:p=>ready=p});await ready;
 assert.deepEqual(w.events,['assets','html','activate-ready']);w.handlers.activate({waitUntil:p=>ready=p});await ready;assert.ok(w.stores.has('reading-room-shell-old'));
 let response;w.handlers.fetch({request:{method:'GET',mode:'cors',url:'https://reader.test/assets/old.js'},respondWith:p=>response=p});assert.equal(await response,'old-bundle');
 w.handlers.fetch({request:{method:'GET',mode:'cors',url:'https://reader.test/api/books'},respondWith:()=>assert.fail('Private API was cached')});
});
test('incomplete or mismatched offline shells never activate',async()=>{
 for(const options of [{wrongHtml:true},{failedDownload:true}]){const w=worker(options);let ready;w.handlers.install({waitUntil:p=>ready=p});await assert.rejects(ready);assert.ok(!w.events.includes('activate-ready'));}
});

test('online navigation loads the latest release and offline navigation keeps a complete shell',async()=>{
 const w=worker();let ready;w.handlers.install({waitUntil:p=>ready=p});await ready;
 w.stores.get('reading-room-shell-new').set('/index.html','cached-shell');
 let response;const event={request:{method:'GET',mode:'navigate',url:'https://reader.test/book/1'},respondWith:p=>response=p};
 w.handlers.fetch(event);assert.notEqual(await response,'cached-shell');
 w.setOffline(true);w.handlers.fetch(event);assert.equal(await response,'cached-shell');
});
