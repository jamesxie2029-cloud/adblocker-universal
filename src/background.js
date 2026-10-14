"use strict";
importScripts("shared.js");
const YOUTUBE = YAB.sites.find(site => site.id === "youtube");
const SCRIPT = {
  id: "youtube-player-ad-filter", matches: [...YOUTUBE.matches],
  js: ["src/filter.js"], runAt: "document_start", world: "MAIN", allFrames: true, persistAcrossSessions: true,
};
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function readOptions() { return YAB.normalize(await chrome.storage.local.get(YAB.defaults)); }
async function setRules(options) {
  const current = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
  const enableRulesetIds = [], disableRulesetIds = [];
  for (const site of YAB.sites) {
    const enabled = options.blockRequests && YAB.isSiteEnabled(options, site);
    if (enabled && !current.has(site.ruleSet)) enableRulesetIds.push(site.ruleSet);
    if (!enabled && current.has(site.ruleSet)) disableRulesetIds.push(site.ruleSet);
  }
  if (enableRulesetIds.length || disableRulesetIds.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  const anyEnabled = YAB.sites.some(site => YAB.isSiteEnabled(options, site));
  await chrome.action.setBadgeText({ text: anyEnabled ? "ON" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: anyEnabled ? "#d73930" : "#6b7280" });
}
async function reconcile(options) {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT.id] });
  if (YAB.isSiteEnabled(options, YOUTUBE) && options.filterVideoAds) {
    if (registered.length) await chrome.scripting.updateContentScripts([SCRIPT]);
    else await chrome.scripting.registerContentScripts([SCRIPT]);
  } else if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT.id] });
  await setRules(options);
}
async function handle(message) {
  const previous = await readOptions();
  if (message?.type === "get-options") {
    await reconcile(previous);
    return { ok: true, options: previous };
  }
  if (message?.type !== "set-options" || !message.options || typeof message.options !== "object" || Array.isArray(message.options) ||
      Object.entries(message.options).some(([key, value]) => !Object.hasOwn(YAB.defaults, key) || typeof value !== "boolean")) {
    throw Error("Invalid settings.");
  }
  const next = YAB.normalize({ ...previous, ...message.options });
  try { await reconcile(next); await chrome.storage.local.set(next); }
  catch (error) {
    try { await reconcile(previous); }
    catch { throw Error("Could not save or restore filters. Reopen the popup to retry."); }
    throw error;
  }
  return { ok: true, options: next };
}
function initialize() { enqueue(async () => reconcile(await readOptions())).catch(console.error); }
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  enqueue(() => handle(message)).then(respond, error => respond({ ok: false, error: error.message || "Could not save settings." }));
  return true;
});
