const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'src/shared.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    checked: false, disabled: true, textContent: '', hidden: id === 'error', events: {},
    addEventListener(type, fn) { this.events[type] = fn; }
  }]));
  const state = { saved: null, fail: false, loadFail: false, url: 'https://www.youtube.com/watch?v=example', reloads: [], messages: [], pageReads: 0, ...options };
  const intervals = [], windowEvents = {};
  const context = vm.createContext({
    URL, document: { hidden: false, getElementById: id => elements[id] },
    window: { addEventListener: (type, fn) => { windowEvents[type] = fn; } },
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval(id) { intervals[id - 1] = null; },
    chrome: {
      runtime: { sendMessage: async message => {
        state.messages.push(message);
        if (message.type === 'get-options' && state.loadFail) return { ok: false, error: 'Could not connect' };
        if (message.type === 'set-options') {
          if (state.fail) return { ok: false, error: 'Could not save' };
          state.saved = { ...message.options };
        }
        return { ok: true, options: { ...state.saved } };
      } },
      tabs: {
        query: async () => [{ id: 10, url: state.url }],
        sendMessage: async () => {
          state.pageReads++;
          if (state.readPage) return state.readPage();
          if (state.pageError) throw new Error('No content script');
          if (Object.hasOwn(state, 'pageStatus')) return state.pageStatus;
          const site = context.YAB.siteForUrl(state.url);
          return { version: context.YAB.version, site: site.id, enabled: context.YAB.isSiteEnabled(state.saved, site),
            filterStatus: { enabled: state.saved.filterVideoAds, removedFields: 7 }, hiddenCount: 3 };
        },
        reload: async id => state.reloads.push(id)
      }
    }
  });
  vm.runInContext(shared, context);
  state.saved = { ...context.YAB.defaults, ...options.saved };
  vm.runInContext(popup, context);
  return { elements, state, context, intervals, windowEvents, run: code => vm.runInContext(code, context) };
}

test('every feature and site control saves independently; a failed save restores the last choice', async () => {
  const h = harness(); await flush();
  assert.equal(h.context.YAB.version, '0.2.0');
  for (const key of Object.keys(h.state.saved)) {
    const input = h.elements[key];
    assert.ok(input, `${key} has a visible control`);
    assert.equal(input.disabled, false);
    input.checked = false;
    await input.events.change();
    assert.equal(h.state.saved[key], false);
    for (const other of Object.keys(h.state.saved).filter(other => other !== key)) assert.equal(h.state.saved[other], true);
    input.checked = true;
    await input.events.change();
    assert.equal(h.state.saved[key], true);
  }
  h.state.fail = true;
  h.elements.siteReddit.checked = false;
  await h.elements.siteReddit.events.change();
  assert.equal(h.elements.siteReddit.checked, true);
  assert.equal(h.elements.error.hidden, false);
  assert.equal(h.elements.siteReddit.disabled, false);
});

test('YouTube reports ad fields, while other sites report hidden elements', async () => {
  const h = harness(); await flush();
  assert.equal(h.elements['count-label'].textContent, 'Ad fields removed');
  assert.equal(h.elements['removed-fields'].textContent, '7');
  assert.match(h.elements['status-detail'].textContent, /Video ad filter connected/);
  h.state.url = 'https://www.reddit.com/r/videos/';
  await h.run('updateStatus()');
  assert.equal(h.elements['status-title'].textContent, 'On for Reddit');
  assert.equal(h.elements['count-label'].textContent, 'Ad elements hidden');
  assert.equal(h.elements['removed-fields'].textContent, '3');
  assert.doesNotMatch(h.elements['status-detail'].textContent, /Video ad filter/);
});

test('disabled sites and master switch do not imply protection or query page diagnostics', async () => {
  const h = harness({ saved: { siteYouTube: false } }); await flush();
  assert.equal(h.elements['status-title'].textContent, 'Off for YouTube');
  assert.equal(h.elements['removed-fields'].textContent, '—');
  assert.equal(h.state.pageReads, 0);
  h.elements.enabled.checked = false;
  await h.elements.enabled.events.change();
  assert.equal(h.elements['status-title'].textContent, 'Ad blocking is off');
  assert.equal(h.state.pageReads, 0);
});

test('refresh rechecks the active tab and only accepts exact supported origins', async () => {
  const h = harness(); await flush();
  for (const site of h.context.YAB.sites) {
    h.state.url = `https://${site.hosts[0]}/`;
    await h.run('updateStatus()');
    assert.equal(h.elements.refresh.disabled, false);
    assert.equal(h.elements.refresh.textContent, `Refresh ${site.name}`);
    await h.elements.refresh.events.click();
  }
  const permitted = h.state.reloads.length;
  for (const url of ['https://www.youtube.com.attacker.test/watch', 'https://example.com', 'chrome://extensions/', 'http://www.youtube.com/watch']) {
    h.state.url = url;
    await h.elements.refresh.events.click();
    assert.equal(h.state.reloads.length, permitted);
    assert.equal(h.elements.error.hidden, false);
    await h.run('updateStatus()');
    assert.equal(h.elements.refresh.disabled, true);
    assert.equal(h.elements['status-title'].textContent, 'Choose a supported site');
  }
});

test('Twitch states its stream-ad limitation and never presents video filtering as active', async () => {
  const h = harness({ url: 'https://www.twitch.tv/example' }); await flush();
  assert.equal(h.elements['status-title'].textContent, 'On for Twitch');
  assert.match(h.elements['status-detail'].textContent, /Twitch stream ads are not covered/);
  assert.doesNotMatch(h.elements['status-detail'].textContent, /Video ad filter/);
  h.elements.blockRequests.checked = false;
  await h.elements.blockRequests.events.change();
  h.elements.hideSponsored.checked = false;
  await h.elements.hideSponsored.events.change();
  assert.equal(h.elements['status-title'].textContent, 'No filters selected for Twitch');
});

test('connection status requires the current extension version and matching site', async () => {
  const h = harness({ pageError: true }); await flush();
  assert.equal(h.elements['status-title'].textContent, 'Refresh to connect');
  h.state.pageError = false;
  for (const status of [null, { version: '0.1.1', site: 'youtube', enabled: true }, { version: '0.2.0', site: 'reddit', enabled: true }]) {
    h.state.pageStatus = status;
    await h.run('updateStatus()');
    assert.equal(h.elements['status-title'].textContent, 'Refresh to connect');
  }
  h.state.pageStatus = { version: '0.2.0', site: 'youtube', enabled: false };
  await h.run('updateStatus()');
  assert.equal(h.elements['status-title'].textContent, 'Refresh to apply settings');
  h.state.pageStatus.enabled = true;
  h.state.pageStatus.filterStatus = { enabled: false, removedFields: 0 };
  await h.run('updateStatus()');
  assert.equal(h.elements['status-title'].textContent, 'Refresh to activate video filtering');
});

test('displayed counters are non-negative integers and diagnostic text remains plain text', async () => {
  const h = harness({ url: 'https://www.reddit.com/' }); await flush();
  for (const value of [-1, NaN, Infinity, 2.5, '9']) {
    h.state.pageStatus = { version: '0.2.0', site: 'reddit', enabled: true, hiddenCount: value, issue: '<img onerror="oops">' };
    await h.run('updateStatus()');
    assert.equal(h.elements['removed-fields'].textContent, '0');
    assert.equal(h.elements['status-detail'].textContent, '<img onerror="oops">');
  }
});

test('a slow reply from the old tab cannot overwrite the current site status', async () => {
  const h = harness(); await flush();
  let resolveOld;
  h.state.readPage = () => new Promise(resolve => { resolveOld = resolve; });
  const pending = h.run('updateStatus()'); await flush();
  h.state.readPage = null;
  h.state.url = 'https://www.reddit.com/';
  await h.run('updateStatus()');
  resolveOld({ version: '0.2.0', site: 'youtube', enabled: true, filterStatus: { enabled: true, removedFields: 99 } });
  await pending;
  assert.equal(h.elements['status-title'].textContent, 'On for Reddit');
  assert.equal(h.elements['removed-fields'].textContent, '3');
});

test('load failures keep settings disabled, and closing the popup ends polling', async () => {
  const h = harness({ loadFail: true }); await flush();
  for (const key of Object.keys(h.context.YAB.defaults)) assert.equal(h.elements[key].disabled, true);
  assert.equal(h.elements.refresh.disabled, true);
  assert.equal(h.elements.error.hidden, false);
  assert.equal(h.state.pageReads, 0);
  h.windowEvents.pagehide();
  assert.equal(h.intervals[0], null);
});
