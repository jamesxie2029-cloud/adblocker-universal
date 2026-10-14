const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function harness(initial={}) {
  const state={options:{...initial},rules:new Set(['youtube_ads','reddit_ads','twitch_ads','facebook_ads','instagram_ads','x_ads']),script:null,listener:null,failStorage:false,failRules:false};
  const chrome={runtime:{id:'local-test',getURL:p=>'chrome-extension://local-test/'+p,onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener:f=>state.listener=f}},
    storage:{local:{get:async defaults=>({...defaults,...state.options}),set:async value=>{if(state.failStorage)throw Error('Storage failed');state.options={...value};}}},
    action:{setBadgeText:async value=>{state.badge=value.text},setBadgeBackgroundColor:async()=>{}},
    scripting:{getRegisteredContentScripts:async()=>state.script?[state.script]:[],registerContentScripts:async values=>{state.script=values[0]},updateContentScripts:async values=>{state.script=values[0]},unregisterContentScripts:async()=>{state.script=null}},
    declarativeNetRequest:{getEnabledRulesets:async()=>[...state.rules],updateEnabledRulesets:async value=>{if(state.failRules){state.failRules=false;throw Error('Rule update failed');}for(const id of value.enableRulesetIds)state.rules.add(id);for(const id of value.disableRulesetIds)state.rules.delete(id);}}
  };
  const context=vm.createContext({chrome,URL,console,importScripts:()=>{}});
  vm.runInContext(fs.readFileSync(path.join(root,'src/shared.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'src/background.js'),'utf8'),context);
  function send(message,sender={id:'local-test',url:chrome.runtime.getURL('popup.html')}){
    return new Promise(resolve=>{const held=state.listener(message,sender,resolve);if(!held)resolve(undefined);});
  }
  return {state,send,api:context.YAB};
}
test('master switch removes every ruleset and future YouTube startup filter',async()=>{
  const h=harness();assert.equal((await h.send({type:'get-options'})).ok,true);
  assert.equal(h.state.script.runAt,'document_start');assert.equal(h.state.script.world,'MAIN');
  assert.deepEqual(Array.from(h.state.script.js),['src/filter.js']);
  assert.deepEqual(Array.from(h.state.script.matches),Array.from(h.api.sites[0].matches));
  await h.send({type:'set-options',options:{enabled:false}});
  assert.equal(h.state.rules.size,0);assert.equal(h.state.script,null);assert.equal(h.state.badge,'OFF');
});
test('saved master and site settings survive worker startup',async()=>{
  const off=harness({enabled:false});await off.send({type:'get-options'});
  assert.equal(off.state.rules.size,0);assert.equal(off.state.script,null);
  const h=harness({siteYouTube:false,siteReddit:false});await h.send({type:'get-options'});
  assert.equal(h.state.script,null);assert.equal(h.state.rules.has('reddit_ads'),false);
  assert.equal(h.state.rules.has('twitch_ads'),true);
});
test('each site toggle affects only its own requests and YouTube controls only its own filter',async()=>{
  for(const site of harness().api.sites){
    const h=harness();await h.send({type:'get-options'});
    await h.send({type:'set-options',options:{[site.setting]:false}});
    assert.equal(h.state.rules.has(site.ruleSet),false);assert.equal(h.state.rules.size,5);
    assert.equal(Boolean(h.state.script),site.id!=='youtube');
    await h.send({type:'set-options',options:{[site.setting]:true}});
    assert.equal(h.state.rules.size,6);assert.ok(h.state.script);
  }
});
test('network, video and cosmetic controls remain independent',async()=>{
  const h=harness();await h.send({type:'set-options',options:{blockRequests:false}});
  assert.equal(h.state.rules.size,0);assert.ok(h.state.script);
  await h.send({type:'set-options',options:{blockRequests:true,filterVideoAds:false}});
  assert.equal(h.state.rules.size,6);assert.equal(h.state.script,null);
  await h.send({type:'set-options',options:{hideSponsored:false}});
  assert.equal(h.state.rules.size,6);assert.equal(h.state.script,null);
});
test('failed saves and rule updates restore the previous rules and script',async()=>{
  const h=harness();await h.send({type:'get-options'});h.state.failStorage=true;
  assert.equal((await h.send({type:'set-options',options:{enabled:false}})).ok,false);
  assert.ok(h.state.script);assert.equal(h.state.rules.size,6);
  h.state.failStorage=false;h.state.failRules=true;
  assert.equal((await h.send({type:'set-options',options:{siteYouTube:false}})).ok,false);
  assert.ok(h.state.script);assert.equal(h.state.rules.size,6);
});
test('serialized changes retain both updates and reject untrusted senders/settings',async()=>{
  const h=harness();
  await Promise.all([h.send({type:'set-options',options:{siteReddit:false}}),h.send({type:'set-options',options:{siteTwitch:false}})]);
  assert.equal(h.state.rules.size,4);assert.equal(h.state.options.siteReddit,false);assert.equal(h.state.options.siteTwitch,false);
  assert.equal(await h.send({type:'set-options',options:{enabled:false}},{id:'local-test',url:'https://www.youtube.com/'}),undefined);
  for(const options of [{enabled:'false'},{constructor:true},{noSuchSite:true},[]])assert.equal((await h.send({type:'set-options',options})).ok,false);
  assert.equal(h.state.options.enabled,true);
});
test('catalog recognizes exact supported HTTPS hosts only and preserves migrated defaults',()=>{
  const {api}=harness();
  for(const site of api.sites)for(const host of site.hosts){
    assert.equal(api.siteForUrl(`https://${host}/example`).id,site.id);
    assert.equal(api.siteForUrl(`https://${host}.example.test/`),null);
    assert.equal(api.siteForUrl(`http://${host}/`),null);
  }
  assert.equal(api.siteForUrl('not-a-url'),null);
  assert.equal(api.siteForUrl('https://music.youtube.com/'),null);
  const migrated=api.normalize({enabled:false,blockRequests:false});
  assert.equal(migrated.enabled,false);assert.equal(migrated.siteReddit,true);
  assert.equal(api.normalize(null).enabled,true);
});
test('all registered scripts and permissions match the supported host catalog',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  const {api}=harness();
  assert.deepEqual([...manifest.host_permissions].sort(),Array.from(api.sites).flatMap(s=>Array.from(s.matches)).sort());
  assert.equal(manifest.version,api.version);
  assert.equal(manifest.content_scripts.length,2);
  assert.equal(manifest.content_scripts[1].all_frames,false);
  for(const script of manifest.content_scripts)for(const file of script.js)assert.ok(fs.existsSync(path.join(root,file)));
  assert.ok(!manifest.permissions.includes('tabs'));
});
