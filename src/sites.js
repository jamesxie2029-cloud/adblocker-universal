(() => {
  "use strict";

  // Site DOM vocabulary checked against published EasyList/uAssets references.
  // The matcher and lifecycle are original; no third-party filter engine/list is bundled.
  const selectors = Object.freeze({
    reddit: "shreddit-ad-post, shreddit-comments-page-ad, shreddit-post[promoted], .thing.promotedlink",
    twitch: '.stream-display-ad__wrapper, [data-test-selector="sda-wrapper"]',
    facebook: '[role="article"]',
    instagram: "article",
    x: '[data-testid="placementTracking"]'
  });
  const labels = new Set(["sponsored", "赞助内容", "贊助內容", "广告", "廣告"]);
  const userContent = '[data-ad-preview="message"], [data-ad-comet-preview="message"], [role="comment"], blockquote';

  function disclosureLabel(link) {
    const normalize = value => String(value || "").replace(/[\u200b-\u200f\u2066-\u2069]/g, "").trim().toLowerCase();
    return labels.has(normalize(link.textContent)) || labels.has(normalize(link.getAttribute("aria-label")));
  }

  function isAdDisclosure(link) {
    if (!disclosureLabel(link) || link.closest(userContent)) return false;
    try {
      const url = new URL(link.getAttribute("href"), "https://www.facebook.com/");
      return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"].includes(url.hostname) &&
        /^\/ads\/about\/?$/.test(url.pathname);
    } catch { return false; }
  }

  function matchesAd(element, site) {
    if (!element || element.nodeType !== 1 || !selectors[site] || !element.matches(selectors[site])) return false;
    if (site === "reddit") {
      // A boolean promoted attribute is also seen with explicit true/false values.
      if (element.localName === "shreddit-post") {
        return ["", "true"].includes(element.getAttribute("promoted"));
      }
      return true;
    }
    if (site === "twitch") return true;
    if (site === "x") {
      // placementTracking can also wrap recommendations. An ad impression marker
      // is required, and must not occur inside quoted/user-written tweet content.
      return [...element.querySelectorAll('[data-testid$="-impression-pixel"]')].some(marker =>
        !marker.closest('[data-testid="tweetText"], blockquote') &&
        marker.closest('[data-testid="placementTracking"]') === element);
    }
    return [...element.querySelectorAll("a[href]")].some(link => {
      if (!isAdDisclosure(link) || link.closest(selectors[site]) !== element) return false;
      // Instagram comments/captions may contain links: only the post header counts.
      return site !== "instagram" || !!link.closest("header");
    });
  }

  function nearestCandidate(node, site) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return selectors[site] && element?.closest ? element.closest(selectors[site]) : null;
  }

  function scan(root, site) {
    if (!root || !selectors[site]) return [];
    const candidates = new Set();
    const nearest = nearestCandidate(root, site);
    if (nearest) candidates.add(nearest);
    for (const element of root.querySelectorAll?.(selectors[site]) || []) candidates.add(element);
    const ads = [...candidates].filter(element => matchesAd(element, site));
    return ads.filter(element => !ads.some(other => other !== element && other.contains(element)));
  }

  globalThis.YAB_SITES = Object.freeze({ selectors, matchesAd, nearestCandidate, scan });
})();
