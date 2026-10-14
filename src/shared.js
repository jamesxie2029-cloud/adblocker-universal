(() => {
  "use strict";
  const version = "0.2.0";
  const definitions = [
    ["youtube", "YouTube", "siteYouTube", ["www.youtube.com", "youtube.com", "m.youtube.com", "www.youtube-nocookie.com"]],
    ["reddit", "Reddit", "siteReddit", ["reddit.com", "www.reddit.com", "old.reddit.com", "sh.reddit.com"]],
    ["twitch", "Twitch", "siteTwitch", ["twitch.tv", "www.twitch.tv", "m.twitch.tv", "player.twitch.tv", "clips.twitch.tv"]],
    ["facebook", "Facebook", "siteFacebook", ["facebook.com", "www.facebook.com", "m.facebook.com"]],
    ["instagram", "Instagram", "siteInstagram", ["instagram.com", "www.instagram.com"]],
    ["x", "X", "siteX", ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]],
  ];
  const sites = Object.freeze(definitions.map(([id, name, setting, names]) => {
    const hosts = Object.freeze(names);
    return Object.freeze({ id, name, setting, hosts, matches: Object.freeze(hosts.map(host => `https://${host}/*`)), ruleSet: `${id}_ads` });
  }));
  const defaults = Object.freeze({ enabled: true, blockRequests: true, hideSponsored: true, filterVideoAds: true,
    ...Object.fromEntries(sites.map(site => [site.setting, true])) });
  function normalize(value = {}) {
    if (!value || typeof value !== "object") value = {};
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key,
      typeof value[key] === "boolean" ? value[key] : fallback]));
  }
  function siteForUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? sites.find(site => site.hosts.includes(parsed.hostname)) || null : null;
    } catch { return null; }
  }
  function isYouTube(url) { return siteForUrl(url)?.id === "youtube"; }
  function isSiteEnabled(options, site) { return Boolean(site && options?.enabled === true && options[site.setting] === true); }
  globalThis.YAB = Object.freeze({ version, sites, defaults, normalize, siteForUrl, isYouTube, isSiteEnabled });
})();
