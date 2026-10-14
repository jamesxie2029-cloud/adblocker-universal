(() => {
  "use strict";
  const site = YAB.siteForUrl(location.href);
  if (!site || site.id === "youtube" || !YAB_SITES.selectors[site.id]) return;

  const marker = "data-local-ad-blocker-hidden";
  const markerValue = "v1";
  const hidden = new Map();
  const pending = new Set();
  let options = YAB.normalize();
  let ready = false;
  let enabled = false;
  let issue = null;
  let style = null;
  let timer = null;
  let observer = null;
  let suspended = false;
  const earlyChanges = {};

  function restore(element) {
    const previous = hidden.get(element);
    // Do not overwrite a change made by the site or another extension.
    if (element.getAttribute(marker) === markerValue) {
      if (previous === null) element.removeAttribute(marker);
      else element.setAttribute(marker, previous);
    }
    hidden.delete(element);
  }

  function ensureStyle() {
    if (style?.isConnected || !document.documentElement) return;
    style = document.createElement("style");
    style.id = "browser-ad-blocker-site-style";
    style.textContent = `[${marker}="${markerValue}"] { display: none !important; }`;
    document.documentElement.append(style);
  }

  function flush() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!enabled || suspended) return;
    ensureStyle();
    for (const element of hidden.keys()) {
      if (!element.isConnected || !YAB_SITES.matchesAd(element, site.id)) restore(element);
    }
    const roots = [...pending];
    pending.clear();
    for (const root of roots) {
      if (root !== document && !root.isConnected) continue;
      for (const element of YAB_SITES.scan(root, site.id)) {
        // Avoid counting a nested ad component as a separate hidden placement.
        if ([...hidden.keys()].some(parent => parent !== element && parent.contains(element))) continue;
        for (const child of hidden.keys()) if (child !== element && element.contains(child)) restore(child);
        if (!hidden.has(element)) hidden.set(element, element.getAttribute(marker));
        if (element.getAttribute(marker) !== markerValue) element.setAttribute(marker, markerValue);
      }
    }
  }

  function queue(root) {
    if (!enabled || suspended || !root) return;
    if (root.nodeType === 3) root = root.parentElement;
    if (!root || !root.querySelectorAll) return;
    // Bound retained nodes and collapse overlapping mutation subtrees.
    if (![...pending].some(parent => parent === root || parent.contains(root))) {
      for (const child of pending) if (root.contains(child)) pending.delete(child);
      pending.add(root);
      if (pending.size > 100) { pending.clear(); pending.add(document); }
    }
    if (timer === null) timer = setTimeout(flush, 120);
  }

  function stop() {
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending.clear();
    for (const element of hidden.keys()) restore(element);
    style?.remove();
    style = null;
  }

  function apply() {
    if (!ready) return;
    enabled = YAB.isSiteEnabled(options, site) && options.hideSponsored;
    if (!enabled || suspended) { stop(); return; }
    ensureStyle();
    if (!observer) observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) queue(node);
          queue(YAB_SITES.nearestCandidate(record.target, site.id));
          // A removal can invalidate a tracked ad or disconnect it entirely.
          if (record.removedNodes.length && timer === null) timer = setTimeout(flush, 120);
        } else queue(record.target);
      }
    });
    observer.observe(document, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["class", "promoted", "data-testid", "data-test-selector", "href", "aria-label", "role", "data-ad-preview", "data-ad-comet-preview"]
    });
    queue(document);
    flush();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const patch = {};
    for (const key of Object.keys(YAB.defaults)) if (key in changes) patch[key] = changes[key].newValue;
    if (!Object.keys(patch).length) return;
    if (!ready) { Object.assign(earlyChanges, patch); return; }
    options = YAB.normalize({ ...options, ...patch });
    apply();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || message?.type !== "page-status") return;
    flush();
    sendResponse({ version: YAB.version, site: site.id,
      enabled: ready && YAB.isSiteEnabled(options, site) && !suspended,
      cosmeticEnabled: enabled && !suspended,
      hiddenCount: [...hidden.keys()].filter(element => element.isConnected).length, issue });
  });

  document.addEventListener("DOMContentLoaded", apply, { once: true });
  window.addEventListener("pagehide", () => { suspended = true; stop(); });
  window.addEventListener("pageshow", () => { suspended = false; apply(); });
  chrome.storage.local.get(YAB.defaults).then(saved => {
    options = YAB.normalize({ ...saved, ...earlyChanges });
    ready = true;
    apply();
  }).catch(() => {
    issue = "Could not read extension settings. Refresh this page to retry.";
    options = YAB.normalize({ enabled: false });
    ready = true;
    apply();
  });
})();
