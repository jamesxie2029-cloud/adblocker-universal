(() => {
  "use strict";
  const KEY = "__UAB_YOUTUBE_PLAYER_FILTER_V1__", CHANNEL = "adblocker-universal-youtube-v1";
  if (window[KEY]) return;
  const parse = JSON.parse, stringify = JSON.stringify;
  const fields = ["playerAds", "adPlacements", "adSlots"];
  const hint = /"(?:playerAds|adPlacements|adSlots)"\s*:/;
  const restores = [];
  let enabled = true, removedFields = 0, filteredPayloads = 0, issue = null;

  function isPlayer(value) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      ["playabilityStatus", "videoDetails", "streamingData"].some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && "value" in descriptor && descriptor.value && typeof descriptor.value === "object";
      });
  }
  function clean(value, knownPlayer = false) {
    if (!enabled || !value || typeof value !== "object") return value;
    const seen = new WeakSet(), stack = [{ value, knownPlayer }];
    let visited = 0, removed = 0;
    while (stack.length && visited++ < 20000) {
      const current = stack.pop(), node = current.value;
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (current.knownPlayer || isPlayer(node)) {
        for (const key of fields) {
          const descriptor = Object.getOwnPropertyDescriptor(node, key);
          if (!descriptor) continue;
          if (descriptor.configurable) { delete node[key]; removed++; }
          else issue = "An ad field could not be removed from a locked player response.";
        }
      }
      for (const key of Object.keys(node)) {
        // Read only data properties; do not trigger unrelated site getters.
        const child = Object.getOwnPropertyDescriptor(node, key);
        if (child && "value" in child && child.value && typeof child.value === "object") {
          stack.push({ value: child.value, knownPlayer: key === "playerResponse" });
        }
      }
    }
    if (removed) { removedFields += removed; filteredPayloads++; }
    return value;
  }
  function safelyClean(value, knownPlayer = false) {
    try { return clean(value, knownPlayer); }
    catch { issue = "A player response could not be filtered."; return value; }
  }
  function cleanText(text) {
    if (!enabled || typeof text !== "string" || !hint.test(text)) return text;
    const prefix = text.match(/^\)\]\}'(?:\r?\n)?/)?.[0] || "";
    try {
      const before = removedFields;
      const result = safelyClean(parse(text.slice(prefix.length)));
      return removedFields === before ? text : prefix + stringify(result);
    } catch { return text; }
  }
  function playerEndpoint(url) {
    try {
      const u = new URL(url, location.href);
      return ["www.youtube.com", "youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(u.hostname) &&
        /^\/youtubei\/v1\/(?:player|next)\/?$/.test(u.pathname);
    } catch { return false; }
  }
  function wrapMethod(owner, key, apply) {
    if (!owner || typeof owner[key] !== "function") return;
    const original = owner[key];
    const wrapper = new Proxy(original, { apply });
    try {
      owner[key] = wrapper;
      restores.push(() => { if (owner[key] === wrapper) owner[key] = original; });
    } catch { issue = "A player data filter could not connect."; }
  }

  // The initial page assigns these before starting its player. Preserve normal
  // value storage while filtering only the three named ad fields.
  for (const key of ["ytInitialPlayerResponse", "playerResponse"]) {
    const original = Object.getOwnPropertyDescriptor(window, key);
    if (original && (!original.configurable || !("value" in original) || !original.writable)) {
      if ("value" in original) safelyClean(original.value, true);
      continue;
    }
    let value = original?.value, assigned = !!original;
    const get = () => safelyClean(value, true);
    const set = next => { assigned = true; value = safelyClean(next, true); };
    try {
      Object.defineProperty(window, key, { configurable: true, enumerable: original?.enumerable ?? true, get, set });
      restores.push(() => {
        if (Object.getOwnPropertyDescriptor(window, key)?.get !== get) return;
        if (assigned) Object.defineProperty(window, key, { configurable: true, enumerable: original?.enumerable ?? true, writable: true, value });
        else delete window[key];
      });
    } catch { issue = "Initial player data could not be filtered."; }
  }
  wrapMethod(JSON, "parse", (original, receiver, args) => {
    const result = Reflect.apply(original, receiver, args);
    return enabled && typeof args[0] === "string" && hint.test(args[0]) ? safelyClean(result) : result;
  });
  // Native Response.json is not required to call the JavaScript JSON.parse.
  for (const method of ["json", "text"]) wrapMethod(window.Response?.prototype, method, (original, receiver, args) => {
    const result = Reflect.apply(original, receiver, args);
    if (!enabled || !playerEndpoint(receiver.url)) return result;
    return result.then(value => method === "json" ? safelyClean(value) : cleanText(value));
  });
  // Retain native XHR sending/events and filter the response read by the site.
  const cache = new WeakMap();
  for (const property of ["responseText", "response"]) {
    const proto = window.XMLHttpRequest?.prototype;
    const original = proto && Object.getOwnPropertyDescriptor(proto, property);
    if (!original?.get || !original.configurable) continue;
    const get = function() {
      const raw = original.get.call(this); // Preserve native InvalidStateError.
      if (!enabled || !playerEndpoint(this.responseURL)) return raw;
      if (typeof raw !== "string") return this.responseType === "json" ? safelyClean(raw) : raw;
      const old = cache.get(this);
      if (old?.raw === raw) return old.result;
      const result = cleanText(raw);
      cache.set(this, { raw, result });
      return result;
    };
    try {
      Object.defineProperty(proto, property, { ...original, get });
      restores.push(() => { if (Object.getOwnPropertyDescriptor(proto, property)?.get === get) Object.defineProperty(proto, property, original); });
    } catch { issue = "One player response path could not be filtered."; }
  }
  function status() { return { enabled, removedFields, filteredPayloads, issue }; }
  function report() { window.postMessage({ channel: CHANNEL, type: "filter-status", status: status() }, "*"); }
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data.type !== "filter-settings") return;
    if (typeof event.data.enabled === "boolean") enabled = event.data.enabled;
    report();
  });
  window[KEY] = { version: "0.2.0", status, dispose() { enabled = false; for (const restore of restores.reverse()) restore(); } };
  window.postMessage({ channel: CHANNEL, type: "filter-ready" }, "*");
})();
