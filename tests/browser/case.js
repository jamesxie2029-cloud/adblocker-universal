'use strict';
const selected = new URLSearchParams(location.search).get('site');
const profile = YAB.sites.find(site => site.id === selected && site.id !== 'youtube');
const sampleRoot = document.getElementById('samples');
const checks = [];
let storageListener, runtimeListener;
let options = { ...YAB.defaults };
const runtimeId = 'simulated-extension-fixture';

// Only extension APIs and site identity are simulated. The production scanner,
// DOM nodes, selectors, stylesheet, computed styles and observer all run natively.
globalThis.chrome = {
  runtime: { id: runtimeId, onMessage: { addListener(fn) { runtimeListener = fn; } } },
  storage: {
    local: { get: async () => ({ ...options }) },
    onChanged: { addListener(fn) { storageListener = fn; } }
  }
};
const samples = {
  reddit: {
    ad: '<shreddit-post promoted="true"><p>Simulated promoted Reddit post</p></shreddit-post>',
    ordinary: '<shreddit-post promoted="false"><p>My ordinary post mentions sponsored content.</p></shreddit-post>',
    convert: node => node.setAttribute('promoted', 'false')
  },
  twitch: {
    ad: '<div class="stream-display-ad__wrapper">Simulated Twitch display ad</div>',
    ordinary: '<div class="stream-content">Ordinary stream content — discussion of ads</div>',
    convert: node => node.removeAttribute('class')
  },
  facebook: {
    ad: '<div role="article"><header><a href="https://www.facebook.com/ads/about/">Sponsored</a></header><p>Simulated Facebook promotion</p></div>',
    ordinary: '<div role="article"><p data-ad-preview="message">An ordinary post quotes <a href="https://www.facebook.com/ads/about/">Sponsored</a>.</p></div>',
    convert: node => { node.querySelector('a').textContent = 'Ordinary update'; }
  },
  instagram: {
    ad: '<article><header><a href="https://www.facebook.com/ads/about/">Sponsored</a></header><p>Simulated Instagram promotion</p></article>',
    ordinary: '<article><header>Ordinary post</header><p>A caption with <a href="https://www.facebook.com/ads/about/">Sponsored</a> does not qualify.</p></article>',
    convert: node => { node.querySelector('a').textContent = 'Ordinary update'; }
  },
  x: {
    ad: '<div data-testid="placementTracking"><div data-testid="fixture-impression-pixel"></div><p>Simulated X promotion</p></div>',
    ordinary: '<div data-testid="placementTracking"><p data-testid="tweetText">Ordinary recommendation mentions ads.</p></div>',
    convert: node => node.querySelector('[data-testid$="-impression-pixel"]').remove()
  }
};
function nodeFrom(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.firstElementChild;
}
function hidden(node) { return getComputedStyle(node).display === 'none'; }
function check(label, passed) {
  checks.push({ label, passed });
  const line = document.createElement('li');
  line.dataset.result = passed ? 'pass' : 'fail';
  line.textContent = label;
  document.getElementById('checks').append(line);
}
function status() {
  let response;
  runtimeListener({ type: 'page-status' }, { id: runtimeId }, result => { response = result; });
  return response;
}
function change(patch) {
  const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: options[key], newValue: value }]));
  options = { ...options, ...patch };
  storageListener(changes, 'local');
}
async function waitFor(predicate) {
  const start = performance.now();
  while (!predicate() && performance.now() - start < 2000) await new Promise(resolve => setTimeout(resolve, 25));
}
function finish() {
  const pass = checks.filter(check => check.passed).length;
  const fail = checks.length - pass;
  document.getElementById('result').textContent = `${pass} passed · ${fail} failed`;
  parent.postMessage({ kind: 'fixture-result', site: selected, pass, fail, checks }, location.origin);
}
async function run() {
  if (!profile || !samples[selected]) throw Error('Unsupported fixture profile');
  document.getElementById('name').textContent = profile.name;
  const sample = samples[selected];
  const initialAd = nodeFrom(sample.ad), ordinary = nodeFrom(sample.ordinary);
  sampleRoot.append(initialAd, ordinary);
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `/fixture-content.js?site=${encodeURIComponent(selected)}`;
    script.onload = resolve;
    script.onerror = () => reject(Error('Production content script did not load'));
    document.head.append(script);
  });
  await waitFor(() => hidden(initialAd));
  check('Initial ad is hidden by native CSS', hidden(initialAd));
  check('Ordinary content remains visible', !hidden(ordinary));
  const dynamicAd = nodeFrom(sample.ad), dynamicOrdinary = nodeFrom(sample.ordinary);
  sampleRoot.append(dynamicAd, dynamicOrdinary);
  await waitFor(() => hidden(dynamicAd));
  check('New ad is caught by MutationObserver', hidden(dynamicAd));
  check('New ordinary content stays visible', !hidden(dynamicOrdinary));
  change({ [profile.setting]: false });
  check('Site switch restores both ad elements', !hidden(initialAd) && !hidden(dynamicAd));
  change({ [profile.setting]: true });
  check('Site switch re-enables ad hiding', hidden(initialAd) && hidden(dynamicAd));
  sample.convert(initialAd);
  await waitFor(() => !hidden(initialAd));
  check('Reused ordinary element is restored', !hidden(initialAd) && hidden(dynamicAd));
  const diagnostic = status();
  check('Counter reports one remaining hidden item', diagnostic.hiddenCount === 1 && diagnostic.cosmeticEnabled && !diagnostic.issue);
  change({ enabled: false });
  check('Master switch removes hiding and stylesheet', !hidden(dynamicAd) && !document.getElementById('browser-ad-blocker-site-style'));
  change({ enabled: true });
  check('Master switch restores the correct filter', hidden(dynamicAd) && !hidden(initialAd) && !hidden(ordinary));
  finish();
}
run().catch(error => { check(error.message, false); finish(); });
