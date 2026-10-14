(() => {
  "use strict";
  const SITE = YAB.sites.find(site => site.id === "youtube");
  const CHANNEL = "adblocker-universal-youtube-v1";
  const CSS = `
    ytd-ad-slot-renderer, ytd-companion-slot-renderer,
    ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer,
    ytd-banner-promo-renderer, ytd-video-masthead-ad-v3-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer),
    .ytp-ad-overlay-container { display: none !important; }
  `;
  let options = null, style = null, filterStatus = null;
  const pendingChanges = {};
  function publish() {
    if (options) window.postMessage({ channel: CHANNEL, type: "filter-settings", enabled: YAB.isSiteEnabled(options, SITE) && options.filterVideoAds }, "*");
  }
  function apply(value) {
    options = YAB.normalize(value);
    if (YAB.isSiteEnabled(options, SITE) && options.hideSponsored) {
      if (!style) { style = document.createElement("style"); style.id = "youtube-ad-blocker-style"; style.textContent = CSS; }
      if (!style.isConnected && document.documentElement) document.documentElement.append(style);
    } else { style?.remove(); style = null; }
    publish();
  }
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.channel !== CHANNEL) return;
    if (event.data.type === "filter-ready") publish();
    if (event.data.type === "filter-status") {
      const value = event.data.status;
      if (!value || typeof value !== "object") return;
      filterStatus = {
        enabled: value.enabled === true,
        removedFields: Number.isSafeInteger(value.removedFields) && value.removedFields >= 0 ? value.removedFields : 0,
        issue: typeof value.issue === "string" ? value.issue.slice(0, 180) : null,
      };
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = options ? { ...options } : pendingChanges;
    for (const key of Object.keys(YAB.defaults)) if (changes[key]) next[key] = changes[key].newValue ?? YAB.defaults[key];
    // Until the initial read completes, retain only changed keys so the saved
    // values of other options are neither lost nor temporarily replaced.
    if (options) apply(next);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "page-status") return false;
    publish();
    setTimeout(() => respond({ version: YAB.version, site: "youtube", enabled: YAB.isSiteEnabled(options, SITE), filterStatus }), 60);
    return true;
  });
  document.addEventListener("DOMContentLoaded", () => { if (options) apply(options); }, { once: true });
  window.addEventListener("pageshow", () => { if (options) apply(options); });
  chrome.storage.local.get(YAB.defaults)
    .then(value => apply({ ...value, ...pendingChanges }))
    .catch(() => apply({ ...YAB.defaults, ...pendingChanges }));
})();
