const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'..');
const shared=fs.readFileSync(path.join(dir,'src/shared.js'),'utf8');
const content=fs.readFileSync(path.join(dir,'src/content.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function contentHarness(saved={}) {
  let resolveSettings;
  const context=vm.createContext({URL,setTimeout});
  vm.runInContext(`
    var window=globalThis,listeners={},storedListener,runtimeListener,styles=[],messages=[];
    window.addEventListener=(event,fn)=>(listeners[event]||=[]).push(fn);
    window.postMessage=data=>messages.push(data);
    var document={addEventListener:window.addEventListener,documentElement:{append(s){s.isConnected=true;styles.push(s);}},
      createElement(){return {isConnected:false,remove(){this.isConnected=false;styles=styles.filter(x=>x!==this);}};}};
    var chrome={runtime:{id:'fixture',onMessage:{addListener:fn=>runtimeListener=fn}},storage:{local:{},onChanged:{addListener:fn=>storedListener=fn}}};
    function emit(name,event={}){for(const fn of listeners[name]||[])fn(event);}
  `,context);
  context.chrome.storage.local.get=()=>new Promise(resolve=>resolveSettings=resolve);
  vm.runInContext(shared+content,context);
  return {run:code=>vm.runInContext(code,context),context,resolve:()=>resolveSettings(saved)};
}
test('cosmetic bridge waits for saved settings before enabling anything',async()=>{
  const h=contentHarness({enabled:false});h.run('emit("DOMContentLoaded");');
  assert.equal(h.run('styles.length'),0);assert.equal(h.run('messages.length'),0);
  h.resolve();await flush();
  assert.equal(h.run('styles.length'),0);assert.equal(h.run('messages.at(-1).enabled'),false);
});
test('live toggles remove and restore styles without duplicates',async()=>{
  const h=contentHarness();h.resolve();await flush();
  assert.equal(h.run('styles.length'),1);
  h.run('emit("DOMContentLoaded");emit("pageshow");');assert.equal(h.run('styles.length'),1);
  h.run('storedListener({enabled:{newValue:false}},"local");');assert.equal(h.run('styles.length'),0);
  assert.equal(h.run('messages.at(-1).enabled'),false);
  h.run('storedListener({enabled:{newValue:true}},"local");');assert.equal(h.run('styles.length'),1);
});
test('a slow initial settings read cannot override a newer disable action',async()=>{
  const h=contentHarness();h.run('storedListener({enabled:{newValue:false}},"local");');h.resolve();await flush();
  assert.equal(h.run('styles.length'),0);assert.equal(h.run('messages.at(-1).enabled'),false);
});
test('an early partial settings change preserves other saved options without briefly enabling filters',async()=>{
  const h=contentHarness({enabled:true,filterVideoAds:false,hideSponsored:false});
  h.run('storedListener({hideSponsored:{newValue:true}},"local");');
  assert.equal(h.run('messages.length'),0);
  assert.equal(h.run('styles.length'),0);
  h.resolve();await flush();
  assert.equal(h.run('styles.length'),1);
  assert.equal(h.run('messages.at(-1).enabled'),false);
});
test('page diagnostics only accept local messages and sanitize counters',async()=>{
  const h=contentHarness();h.resolve();await flush();
  h.run('emit("message",{source:{},data:{channel:"adblocker-universal-youtube-v1",type:"filter-status",status:{enabled:true,removedFields:99}}});');
  let result=await new Promise(resolve=>h.context.runtimeListener({type:'page-status'},{id:'fixture'},resolve));
  assert.equal(result.filterStatus,null);
  h.run('emit("message",{source:window,data:{channel:"adblocker-universal-youtube-v1",type:"filter-status",status:{enabled:true,removedFields:-1,issue:"x".repeat(500)}}});');
  result=await new Promise(resolve=>h.context.runtimeListener({type:'page-status'},{id:'fixture'},resolve));
  assert.equal(result.filterStatus.removedFields,0);assert.equal(result.filterStatus.issue.length,180);
});
test('Universal bridge publishes its own settings channel and ignores legacy YouTube diagnostics',async()=>{
  const h=contentHarness();h.resolve();await flush();
  assert.equal(h.run('messages.at(-1).channel'),'adblocker-universal-youtube-v1');
  h.run('emit("message",{source:window,data:{channel:"youtube-ad-blocker-v1",type:"filter-status",status:{enabled:true,removedFields:99}}});');
  const result=await new Promise(resolve=>h.context.runtimeListener({type:'page-status'},{id:'fixture'},resolve));
  assert.equal(result.filterStatus,null);
});
test('YouTube site toggle disables its cosmetic and video bridge without changing other site preferences',async()=>{
  const h=contentHarness({siteYouTube:false});h.resolve();await flush();
  assert.equal(h.run('styles.length'),0);assert.equal(h.run('messages.at(-1).enabled'),false);
  h.run('storedListener({siteYouTube:{newValue:true}},"local");');
  assert.equal(h.run('styles.length'),1);assert.equal(h.run('messages.at(-1).enabled'),true);
  const status=await new Promise(resolve=>h.context.runtimeListener({type:'page-status'},{id:'fixture'},resolve));
  assert.equal(status.version,'0.2.0');assert.equal(status.site,'youtube');assert.equal(status.enabled,true);
});
