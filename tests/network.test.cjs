const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const families={
  youtube:['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'],
  reddit:['reddit.com','www.reddit.com','old.reddit.com','sh.reddit.com'],
  twitch:['twitch.tv','www.twitch.tv','m.twitch.tv','player.twitch.tv','clips.twitch.tv'],
  facebook:['facebook.com','www.facebook.com','m.facebook.com'],
  instagram:['instagram.com','www.instagram.com'],
  x:['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'],
};
const rulesBySite=Object.fromEntries(Object.keys(families).map(site=>[site,
  JSON.parse(fs.readFileSync(path.join(root,'rules',site+'.json'),'utf8'))]));
const allRules=Object.values(rulesBySite).flat();
const adRequests=[
  'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
  'https://www.googleadservices.com/pagead/conversion/123/',
  'https://c.amazon-adsystem.com/aax2/apstag.js',
  'https://ib.adnxs.com/ut/v3/prebid',
  'https://ads.pubmatic.com/AdServer/js/pwt/1/1/pwt.js',
  'https://fastlane.rubiconproject.com/a/api/fastlane.json',
  'https://u.openx.net/w/1.0/jstag',
  'https://match.adsrvr.org/track/cmf/generic',
];

function domainMatches(host,domain){return host===domain||host.endsWith('.'+domain);}
// A deliberately small model of the conditions shipped here, not a Chrome DNR
// integration test. The fixture domains all have one-label public suffixes.
function matches(rule,{url,initiator,type='xmlhttprequest'}){
  const c=rule.condition,target=new URL(url).hostname;
  let source;
  try{source=new URL(initiator).hostname;}catch{return false;}
  if(!c.initiatorDomains.some(d=>domainMatches(source,d)))return false;
  if(c.excludedInitiatorDomains?.some(d=>domainMatches(source,d)))return false;
  if(c.excludedResourceTypes?.includes(type))return false;
  if(c.requestDomains&&!c.requestDomains.some(d=>domainMatches(target,d)))return false;
  if(c.domainType==='thirdParty'&&target.split('.').slice(-2).join('.')===source.split('.').slice(-2).join('.'))return false;
  if(c.urlFilter){
    assert.equal(c.urlFilter,'||youtube.com/pagead/','Extend this model explicitly before shipping another URL pattern');
    if(!domainMatches(target,'youtube.com')||!new URL(url).pathname.toLowerCase().startsWith('/pagead/'))return false;
  }
  return true;
}
function blocked(rules,request){return rules.some(rule=>matches(rule,request));}

test('six packaged network rulesets have disjoint IDs and only bounded blocking conditions',()=>{
  assert.equal(new Set(allRules.map(r=>r.id)).size,allRules.length);
  for(const [site,rules] of Object.entries(rulesBySite)){
    assert.ok(rules.length>0);
    for(const rule of rules){
      assert.ok(Number.isSafeInteger(rule.id)&&rule.id>0);
      assert.equal(rule.priority,1);
      assert.deepEqual(rule.action,{type:'block'});
      assert.deepEqual(rule.condition.initiatorDomains,families[site]);
      assert.deepEqual(rule.condition.excludedResourceTypes,['main_frame']);
      for(const key of Object.keys(rule.condition))assert.ok([
        'initiatorDomains','excludedInitiatorDomains','excludedResourceTypes','domainType','requestDomains','urlFilter',
      ].includes(key),'Unreviewed condition '+key);
      assert.ok(Boolean(rule.condition.requestDomains)!==Boolean(rule.condition.urlFilter));
      if(rule.condition.requestDomains){
        assert.equal(rule.condition.domainType,'thirdParty');
        assert.ok(rule.condition.requestDomains.length<=12,'Keep the authored inventory bounded');
        assert.equal(new Set(rule.condition.requestDomains).size,rule.condition.requestDomains.length);
        for(const domain of rule.condition.requestDomains)assert.match(domain,/^[a-z0-9.-]+\.[a-z]+$/);
      }
    }
  }
});

test('manifest registers each site-specific network ruleset exactly once',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const resources=manifest.declarative_net_request.rule_resources;
  assert.equal(resources.length,Object.keys(families).length);
  for(const site of Object.keys(families)){
    const found=resources.filter(r=>r.id===site+'_ads');
    assert.equal(found.length,1);
    assert.equal(found[0].path,'rules/'+site+'.json');
  }
});

test('known ad-network requests match every supported host without crossing site rulesets',()=>{
  for(const [site,hosts] of Object.entries(families))for(const host of hosts)for(const url of adRequests){
    const request={url,initiator:'https://'+host+'/'};
    assert.ok(blocked(rulesBySite[site],request),site+' should block '+url);
    for(const [other,rules] of Object.entries(rulesBySite))if(other!==site){
      assert.equal(blocked(rules,request),false,other+' must not apply to '+host);
    }
  }
});

test('ordinary navigation and requests from unrelated, opaque or lookalike origins remain untouched',()=>{
  for(const hosts of Object.values(families))for(const host of hosts)for(const url of adRequests){
    assert.equal(blocked(allRules,{url,initiator:'https://'+host+'/',type:'main_frame'}),false);
    assert.equal(blocked(allRules,{url,initiator:'https://'+host+'.example/'}),false);
  }
  for(const initiator of [undefined,'null','https://example.org/','chrome-extension://example/popup.html']){
    for(const url of adRequests)assert.equal(blocked(allRules,{url,initiator}),false);
  }
  for(const [site,hosts] of Object.entries(families)){
    for(const url of ['https://doubleclick.net.example/ad.js','https://notdoubleclick.net/ad.js','https://example.org/?next=https://doubleclick.net/']){
      assert.equal(blocked(rulesBySite[site],{url,initiator:'https://'+hosts[0]+'/'}),false);
    }
  }
});

test('video delivery, chat, authentication, GraphQL and ordinary feed APIs are not blocked',()=>{
  const normalRequests=[
    'https://rr1---sn.example.googlevideo.com/videoplayback?itag=22',
    'https://i.ytimg.com/vi/example/hqdefault.jpg',
    'https://www.youtube.com/youtubei/v1/player',
    'https://www.youtube.com/youtubei/v1/next',
    'https://accounts.google.com/o/oauth2/auth',
    'https://www.reddit.com/svc/shreddit/graphql',
    'https://oauth.reddit.com/api/v1/me',
    'https://v.redd.it/example/DASH_720.mp4',
    'https://i.redd.it/example.jpg',
    'https://gql.twitch.tv/gql',
    'https://id.twitch.tv/oauth2/authorize',
    'https://usher.ttvnw.net/api/channel/hls/example.m3u8',
    'https://video-weaver.example.hls.ttvnw.net/v1/segment/example.ts',
    'wss://irc-ws.chat.twitch.tv/',
    'https://static.twitchcdn.net/assets/example.js',
    'https://www.facebook.com/api/graphql/',
    'https://www.facebook.com/login/',
    'https://video.example.fbcdn.net/v/example.mp4',
    'https://static.xx.fbcdn.net/rsrc.php/example.js',
    'https://www.instagram.com/graphql/query/',
    'https://i.instagram.com/api/v1/feed/timeline/',
    'https://scontent.example.cdninstagram.com/v/example.mp4',
    'https://x.com/i/api/graphql/example/HomeTimeline',
    'https://api.twitter.com/1.1/account/settings.json',
    'https://video.twimg.com/ext_tw_video/example/pu/vid/720x720/example.mp4',
    'https://pbs.twimg.com/media/example.jpg',
  ];
  for(const hosts of Object.values(families))for(const url of normalRequests){
    for(const type of ['xmlhttprequest','media','image','script','websocket']){
      assert.equal(blocked(allRules,{url,initiator:'https://'+hosts[0]+'/',type}),false,url);
    }
  }
});

test('YouTube pagead filtering preserves Music, Studio and Kids and does not match lookalike paths',()=>{
  for(const initiator of ['https://www.youtube.com/','https://m.youtube.com/','https://www.youtube-nocookie.com/embed/example']){
    assert.ok(blocked(rulesBySite.youtube,{url:'https://www.youtube.com/pagead/interaction/',initiator}));
    for(const url of ['https://www.youtube.com/pageadministrator/','https://youtube.com.example/pagead/','https://example.org/?path=youtube.com/pagead/']){
      assert.equal(blocked(rulesBySite.youtube,{url,initiator}),false);
    }
    assert.equal(blocked(rulesBySite.youtube,{url:'https://www.youtube.com/pagead/interaction/',initiator,type:'main_frame'}),false);
  }
  for(const host of ['music.youtube.com','mobile.music.youtube.com','studio.youtube.com','kids.youtube.com']){
    for(const url of [...adRequests,'https://www.youtube.com/pagead/interaction/']){
      assert.equal(blocked(allRules,{url,initiator:'https://'+host+'/'}),false,host);
    }
  }
});
