const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/filter.js'), 'utf8');
const legacySource = fs.readFileSync(path.join(__dirname, 'fixtures/youtube-filter-0.1.1.js'), 'utf8');
const payload = {playabilityStatus:{status:'OK'},videoDetails:{videoId:'example'},streamingData:{formats:[{url:'https://video.example/main'}]},captions:{keep:true},playerAds:[{id:'ad'}],adPlacements:[{id:'preroll'}],adSlots:[{id:'midroll'}]};
const expected = {playabilityStatus:payload.playabilityStatus,videoDetails:payload.videoDetails,streamingData:payload.streamingData,captions:payload.captions};
function harness(before='') {
  const context=vm.createContext({URL,NativeResponse:Response,fixture:structuredClone(payload)});
  const run = code=>vm.runInContext(code,context);
  run(`
    var window=globalThis, location={href:'https://www.youtube.com/watch?v=example'},listeners={};
    var Response=class extends NativeResponse {
      json(...args){return super.json(...args);} text(...args){return super.text(...args);}
    };
    var XMLHttpRequest=class {
      constructor(raw,url='https://www.youtube.com/youtubei/v1/player'){this.raw=raw;this.responseURL=url;this.responseType='';}
      get responseText(){if(this.responseType==='json')throw Error('InvalidStateError');return this.raw;}
      get response(){return this.raw;}
    };
    var originalParse=JSON.parse,originalJson=Response.prototype.json,originalText=Response.prototype.text;
    var originalXHR=Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype,'responseText');
    var messages=[]; window.addEventListener=(type,fn)=>(listeners[type]||=[]).push(fn);
    window.postMessage=data=>messages.push(data);
    function enable(value){for(const fn of listeners.message||[])fn({source:window,data:{channel:'adblocker-universal-youtube-v1',type:'filter-settings',enabled:value}});}
    function nativeResponse(raw,url='https://www.youtube.com/youtubei/v1/player'){
      const r=new Response(raw);Object.defineProperty(r,'url',{value:url});return r;
    }
    ${before}
  `);
  run(source);
  return {run,context,read:code=>JSON.parse(run(`JSON.stringify(${code})`)),status:()=>JSON.parse(run('JSON.stringify(window.__UAB_YOUTUBE_PLAYER_FILTER_V1__.status())')),reinject:()=>run(source)};
}

test('initial assignment removes placements before the player can consume them, preserving video metadata',()=>{
  const h=harness();h.run('ytInitialPlayerResponse=fixture;');
  assert.deepEqual(h.read('ytInitialPlayerResponse'),expected);
  assert.equal(h.run('ytInitialPlayerResponse===fixture'),true);
  assert.equal(h.status().removedFields,3);
});
test('new fields written into the initial response are removed on its next read',()=>{
  const h=harness();h.run('ytInitialPlayerResponse=fixture;fixture.adPlacements=[{}];var again=ytInitialPlayerResponse;');
  assert.equal(h.run('"adPlacements" in again'),false);
  assert.equal(h.status().removedFields,4);
});
test('JSON parsing filters nested player responses but preserves unrelated fields with the same names',()=>{
  const h=harness();h.run('var data=JSON.parse(JSON.stringify({response:{playerResponse:fixture},settings:{adSlots:42},text:"adPlacements"}));');
  assert.deepEqual(h.read('data.response.playerResponse'),expected);
  assert.deepEqual(h.read('data.settings'),{adSlots:42});
  assert.equal(h.run('data.text'),'adPlacements');
});
test('native parse errors and the caller’s reviver behavior are preserved',()=>{
  const h=harness();assert.throws(()=>h.run('JSON.parse("broken")'),/Unexpected token/);
  h.run('var result=JSON.parse(JSON.stringify(fixture),(key,value)=>key==="videoId"?"changed":value);');
  assert.equal(h.run('result.videoDetails.videoId'),'changed');
  assert.equal(h.run('JSON.parse("null")'),null);
  assert.deepEqual(h.read('JSON.parse("[1,2,3]")'),[1,2,3]);
});
test('disabled filtering leaves future data intact and can be reenabled',()=>{
  const h=harness();h.run('enable(false);ytInitialPlayerResponse=fixture;var unchanged=JSON.parse(JSON.stringify(fixture));');
  assert.deepEqual(h.read('unchanged'),payload);
  assert.equal(h.status().removedFields,0);
  h.run('enable(true);var filtered=ytInitialPlayerResponse;');
  assert.deepEqual(h.read('filtered'),expected);
});
test('existing accessor properties are not overwritten and unrelated getters are not executed',()=>{
  const h=harness('var getterRuns=0;Object.defineProperty(window,"playerResponse",{configurable:true,get(){getterRuns++;return {}}});');
  h.run('Object.defineProperty(fixture,"other",{enumerable:true,get(){throw Error("must not run")}});fixture.self=fixture;ytInitialPlayerResponse=fixture;');
  assert.equal(h.run('getterRuns'),0);
  assert.equal(h.run('"adSlots" in fixture'),false);
  assert.equal(h.status().issue,null);
});
test('locked response fields do not crash the page',()=>{
  const h=harness();h.run('Object.freeze(fixture);ytInitialPlayerResponse=fixture;');
  assert.equal(h.run('ytInitialPlayerResponse===fixture'),true);
  assert.match(h.status().issue,/locked/);
});
test('native Response.json and text filter only player endpoints and preserve metadata/body semantics',async()=>{
  const h=harness();
  h.run('var response=nativeResponse(JSON.stringify(fixture));var meta={url:response.url,status:response.status};');
  assert.deepEqual(await h.run('response.json()'),expected);
  assert.equal(h.run('response.bodyUsed'),true);
  await assert.rejects(()=>h.run('response.json()'));
  assert.equal(h.run('meta.status'),200);
  const text=await h.run('nativeResponse(JSON.stringify(fixture)).text()');
  assert.deepEqual(JSON.parse(text),expected);
  const untouched=await h.run('nativeResponse(JSON.stringify(fixture),"https://other.example/youtubei/v1/player").text()');
  assert.deepEqual(JSON.parse(untouched),payload);
});
test('response filtering tolerates anti-XSSI prefixes and malformed/non-JSON content',async()=>{
  const h=harness();h.context.prefixed=")]}'\n"+JSON.stringify(payload);
  const text=await h.run('nativeResponse(prefixed).text()');
  assert.equal(text.slice(0,5),")]}'\n");
  assert.deepEqual(JSON.parse(text.slice(5)),expected);
  h.context.bad='{"adPlacements": invalid';
  assert.equal(await h.run('nativeResponse(bad).text()'),h.context.bad);
});
test('XHR reads support text and JSON without changing native getter errors or unrelated URLs',()=>{
  const h=harness();
  h.run('var xhr=new XMLHttpRequest(JSON.stringify(fixture));var first=xhr.responseText;var second=xhr.responseText;');
  assert.deepEqual(JSON.parse(h.run('first')),expected);
  assert.equal(h.run('first===second'),true);
  assert.equal(h.status().removedFields,3);
  h.run('var jsonXHR=new XMLHttpRequest(fixture);jsonXHR.responseType="json";var result=jsonXHR.response;');
  assert.deepEqual(h.read('result'),expected);
  assert.throws(()=>h.run('jsonXHR.responseText'),/InvalidStateError/);
  h.run('enable(false);');
  assert.deepEqual(JSON.parse(h.run('xhr.responseText')),payload);
});
test('reinjection is idempotent and cleanup preserves the latest assigned value',()=>{
  const h=harness();h.run('ytInitialPlayerResponse=fixture;');h.reinject();
  assert.equal(h.status().removedFields,3);
  h.run('window.__UAB_YOUTUBE_PLAYER_FILTER_V1__.dispose();');
  assert.equal(h.run('JSON.parse===originalParse && Response.prototype.json===originalJson && Response.prototype.text===originalText'),true);
  assert.equal(h.run('Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype,"responseText").get===originalXHR.get'),true);
  assert.equal(h.run('Object.getOwnPropertyDescriptor(window,"ytInitialPlayerResponse").value===fixture'),true);
  assert.equal(h.run('Object.hasOwn(window,"playerResponse")'),false);
});
for (const legacyFirst of [true,false]) test(`legacy and Universal filters keep independent settings (${legacyFirst?'legacy':'Universal'} injects first)`,()=>{
  const h=harness(legacyFirst?legacySource:'');
  if(!legacyFirst)h.run(legacySource);
  h.run(`function enableLegacy(value){for(const fn of listeners.message||[])fn({source:window,data:{channel:'youtube-ad-blocker-v1',type:'filter-settings',enabled:value}});}`);
  assert.equal(h.run('window.__YAB_PLAYER_FILTER_V1__.version'),'0.1.1');
  assert.equal(h.run('window.__UAB_YOUTUBE_PLAYER_FILTER_V1__.version'),'0.2.0');
  assert.equal(h.run('window.__YAB_PLAYER_FILTER_V1__===window.__UAB_YOUTUBE_PLAYER_FILTER_V1__'),false);

  h.run('enableLegacy(false);');
  assert.equal(h.status().enabled,true);
  assert.deepEqual(h.read('JSON.parse(JSON.stringify(fixture))'),expected);
  assert.equal(h.status().removedFields,3);
  assert.equal(h.run('window.__YAB_PLAYER_FILTER_V1__.status().removedFields'),0);

  h.run('enable(false);enableLegacy(true);');
  assert.equal(h.status().enabled,false);
  assert.equal(h.run('window.__YAB_PLAYER_FILTER_V1__.status().enabled'),true);
  assert.deepEqual(h.read('JSON.parse(JSON.stringify(fixture))'),expected);
  assert.equal(h.status().removedFields,3);
  assert.equal(h.run('window.__YAB_PLAYER_FILTER_V1__.status().removedFields'),3);

  h.run('enableLegacy(false);');
  assert.deepEqual(h.read('JSON.parse(JSON.stringify(fixture))'),payload);
});
test('production scripts contain no player-clicking, seeking, muting or speed-changing code',()=>{
  const all=source+fs.readFileSync(path.join(__dirname,'../src/content.js'),'utf8');
  for(const expression of [/\.click\s*\(/,/\.currentTime\s*=/,/\.playbackRate\s*=/,/\.muted\s*=/,/\.play\s*\(/,/ytp-skip-ad-button/])assert.doesNotMatch(all,expression);
});
