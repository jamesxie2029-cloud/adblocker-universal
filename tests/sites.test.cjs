const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const marker = 'data-local-ad-blocker-hidden';

function matcher(html) {
  const { document } = parseHTML(`<html><head></head><body>${html}</body></html>`);
  const context = vm.createContext({ URL });
  vm.runInContext(source('sites.js'), context);
  return { document, rules: context.YAB_SITES,
    ids: (site, root = document) => Array.from(context.YAB_SITES.scan(root, site), element => element.id) };
}

test('Reddit recognizes ad components and explicit promotion, not normal text or false attributes', () => {
  const h = matcher(`<shreddit-ad-post id="ad1"></shreddit-ad-post>
    <shreddit-comments-page-ad id="ad2"></shreddit-comments-page-ad>
    <shreddit-post promoted id="ad3"></shreddit-post><div class="thing promotedlink" id="ad4"></div>
    <shreddit-post promoted="false" id="regular1">Sponsored</shreddit-post>
    <shreddit-post id="regular2">A promoted post is annoying.</shreddit-post>
    <div class="promotedlink" id="unrelated"></div>`);
  assert.deepEqual(h.ids('reddit'), ['ad1', 'ad2', 'ad3', 'ad4']);
});

test('Twitch only marks separate display-ad containers and leaves the stream player alone', () => {
  const h = matcher(`<main><video id="stream" src="https://example.test/live.m3u8"></video>
    <div class="stream-display-ad__wrapper" id="ad1"></div>
    <div data-test-selector="sda-wrapper" id="ad2"></div><div>Advertisement in progress</div></main>`);
  assert.deepEqual(h.ids('twitch'), ['ad1', 'ad2']);
  assert.equal(h.document.querySelector('video').getAttribute('src'), 'https://example.test/live.m3u8');
});

test('X requires an ad impression marker, excludes generic tracked content and user text', () => {
  const h = matcher(`<div data-testid="cellInnerDiv"><div data-testid="placementTracking" id="ad">
    <article data-testid="tweet"><div data-testid="tweetText">Normal looking ad text</div></article>
    <div data-testid="abc-impression-pixel"></div></div></div>
    <div data-testid="placementTracking" id="recommendation"><span>Promoted</span></div>
    <div data-testid="placementTracking" id="user"><div data-testid="tweetText"><span data-testid="fake-impression-pixel">Sponsored</span></div></div>`);
  assert.deepEqual(h.ids('x'), ['ad']);
});

test('Facebook requires a real ad-disclosure URL and exact label outside user-written content', () => {
  const h = matcher(`<div role="article" id="ad"><a href="/ads/about/?id=7">Sponsored</a><div data-ad-preview="message">Sale</div></div>
    <div role="article" id="text"><div data-ad-preview="message">Sponsored</div></div>
    <div role="article" id="quoted"><div data-ad-preview="message"><a href="/ads/about/">Sponsored</a></div></div>
    <div role="article" id="comment"><div role="comment"><a href="/ads/about/">Sponsored</a></div></div>
    <div role="article" id="lookalike"><a href="https://facebook.com.evil.test/ads/about/">Sponsored</a></div>
    <div role="article" id="ordinary-link"><a href="/ads/about/">Read about sponsored posts</a></div>
    <div role="article" id="outer"><div role="article" id="inner"><a href="/ads/about/" aria-label="广告">...</a></div></div>`);
  assert.deepEqual(h.ids('facebook'), ['ad', 'inner']);
});

test('Instagram only accepts ad-disclosure links in post headers, not captions/comments', () => {
  const h = matcher(`<article id="ad"><header><a href="https://www.facebook.com/ads/about/?id=1">Sponsored</a></header></article>
    <article id="caption"><section><a href="https://www.facebook.com/ads/about/">Sponsored</a></section></article>
    <article id="text"><header><span>Sponsored</span></header></article>
    <article id="unrelated"><header><a href="https://example.test/ads/about/">Sponsored</a></header></article>`);
  assert.deepEqual(h.ids('instagram'), ['ad']);
});

test('scanning an inserted marker finds its enclosing placement, deduplicates nested components', () => {
  const h = matcher(`<div data-testid="placementTracking" id="ad"><div id="new" data-testid="ad-impression-pixel"></div></div>
    <shreddit-ad-post id="outer"><shreddit-comments-page-ad id="inner"></shreddit-comments-page-ad></shreddit-ad-post>`);
  assert.deepEqual(h.ids('x', h.document.getElementById('new')), ['ad']);
  assert.deepEqual(h.ids('reddit'), ['outer']);
  assert.deepEqual(h.ids('unknown'), []);
});

function lifecycle({ html = '', url = 'https://www.reddit.com/', saved = {} } = {}) {
  const { window } = parseHTML(`<html><head></head><body>${html}</body></html>`);
  const timers = new Map();
  let nextTimer = 1, resolveSettings, rejectSettings, storageListener, runtimeListener;
  const chrome = {
    runtime: { id: 'fixture-extension', onMessage: { addListener: fn => { runtimeListener = fn; } } },
    storage: {
      local: { get: () => new Promise((resolve, reject) => { resolveSettings = resolve; rejectSettings = reject; }) },
      onChanged: { addListener: fn => { storageListener = fn; } }
    }
  };
  const context = vm.createContext({ window, document: window.document, location: { href: url }, URL,
    MutationObserver: window.MutationObserver, chrome,
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id) });
  vm.runInContext(source('shared.js') + source('sites.js') + source('site-content.js'), context);
  async function settle() {
    // Let real DOM mutation records run, then execute the extension's batch timer.
    for (let i = 0; i < 12; i++) {
      await Promise.resolve(); await Promise.resolve();
      const jobs = [...timers.values()]; timers.clear();
      for (const run of jobs) run();
      if (!jobs.length && i > 2) return;
    }
    assert.fail('Mutation batching did not settle');
  }
  return { window, document: window.document, settle,
    load: async () => { resolveSettings(saved); await settle(); },
    fail: async () => { rejectSettings(new Error('storage unavailable')); await settle(); },
    change: async (patch, area = 'local') => {
      storageListener(Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])), area);
      await settle();
    },
    status(sender = { id: 'fixture-extension' }) {
      let response;
      runtimeListener({ type: 'page-status' }, sender, value => { response = value; });
      return response;
    }
  };
}

test('saved-off settings prevent all startup hiding; early partial changes preserve the saved site toggle', async () => {
  const h = lifecycle({ html: '<shreddit-ad-post id="ad"></shreddit-ad-post>', saved: { enabled: true, siteReddit: false } });
  assert.equal(h.document.querySelector(`[${marker}]`), null);
  await h.change({ hideSponsored: true });
  assert.equal(h.document.querySelector('style'), null);
  await h.load();
  assert.equal(h.status().enabled, false);
  assert.equal(h.status().hiddenCount, 0);
  await h.change({ siteReddit: true });
  assert.equal(h.status().hiddenCount, 1);
});

test('a newer disable action wins over a slow initial settings read', async () => {
  const h = lifecycle({ html: '<shreddit-ad-post></shreddit-ad-post>', saved: { enabled: true } });
  await h.change({ enabled: false });
  await h.load();
  assert.equal(h.status().enabled, false);
  assert.equal(h.document.querySelector(`[${marker}]`), null);
});

test('dynamic insertions hide ads, removals and recycled normal posts reduce the current count', async () => {
  const h = lifecycle({ html: '<main><shreddit-ad-post id="old"></shreddit-ad-post></main>' });
  await h.load();
  assert.equal(h.status().hiddenCount, 1);
  const fresh = h.document.createElement('shreddit-post');
  fresh.setAttribute('promoted', 'true');
  h.document.querySelector('main').append(fresh);
  await h.settle();
  assert.equal(fresh.getAttribute(marker), 'v1');
  assert.equal(h.status().hiddenCount, 2);
  h.document.getElementById('old').remove();
  await h.settle();
  assert.equal(h.status().hiddenCount, 1);
  fresh.setAttribute('promoted', 'false');
  await h.settle();
  assert.equal(fresh.hasAttribute(marker), false);
  assert.equal(h.status().hiddenCount, 0);
});

test('inserted Facebook disclosure labels are recognized and their removal restores the post', async () => {
  const h = lifecycle({ url: 'https://www.facebook.com/', html: '<div role="article" id="post"><a href="/ads/about/">Posted</a></div>' });
  await h.load();
  assert.equal(h.status().hiddenCount, 0);
  const link = h.document.querySelector('a');
  link.textContent = 'Sponsored';
  await h.settle();
  assert.equal(h.status().hiddenCount, 1);
  link.remove();
  await h.settle();
  assert.equal(h.status().hiddenCount, 0);
  assert.equal(h.document.getElementById('post').hasAttribute(marker), false);
});

test('toggles restore original attributes without touching site inline styles and do not duplicate styles', async () => {
  const h = lifecycle({ html: `<shreddit-ad-post id="ad" ${marker}="original" style="display:grid"></shreddit-ad-post>` });
  await h.load();
  const ad = h.document.getElementById('ad');
  assert.equal(ad.getAttribute(marker), 'v1');
  await h.change({ hideSponsored: false });
  assert.equal(ad.getAttribute(marker), 'original');
  assert.equal(ad.getAttribute('style'), 'display:grid');
  assert.equal(h.document.querySelector('style'), null);
  assert.equal(h.status().hiddenCount, 0);
  assert.equal(h.status().enabled, true);
  assert.equal(h.status().cosmeticEnabled, false);
  await h.change({ hideSponsored: true });
  await h.change({ blockRequests: false });
  assert.equal(h.document.querySelectorAll('#browser-ad-blocker-site-style').length, 1);
  assert.equal(h.status().hiddenCount, 1);
  ad.setAttribute(marker, 'site-owned-new-value');
  await h.change({ enabled: false });
  assert.equal(ad.getAttribute(marker), 'site-owned-new-value');
});

test('diagnostics require this extension sender and identify site/version with connected counts', async () => {
  const h = lifecycle({ url: 'https://www.twitch.tv/', html: '<div class="stream-display-ad__wrapper"></div>' });
  await h.load();
  assert.equal(h.status({ id: 'another-extension' }), undefined);
  assert.equal(h.status({}), undefined);
  const status = h.status();
  assert.equal(status.version, '0.2.0');
  assert.equal(status.site, 'twitch');
  assert.equal(status.hiddenCount, 1);
  assert.equal(status.issue, null);
});

test('pagehide restores the DOM and pageshow resumes cosmetic filtering', async () => {
  const h = lifecycle({ html: '<shreddit-ad-post></shreddit-ad-post>' });
  await h.load();
  h.window.dispatchEvent(new h.window.Event('pagehide'));
  assert.equal(h.status().enabled, false);
  assert.equal(h.document.querySelector(`[${marker}]`), null);
  h.window.dispatchEvent(new h.window.Event('pageshow'));
  await h.settle();
  assert.equal(h.status().hiddenCount, 1);
});

test('a settings failure leaves content visible and reports a useful issue', async () => {
  const h = lifecycle({ html: '<shreddit-ad-post></shreddit-ad-post>' });
  await h.fail();
  assert.equal(h.status().enabled, false);
  assert.equal(h.status().hiddenCount, 0);
  assert.match(h.status().issue, /settings/);
});
