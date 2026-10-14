"use strict";
const fields = Object.fromEntries(Object.keys(YAB.defaults).map(key => [key, document.getElementById(key)]));
const title = document.getElementById("status-title"), detail = document.getElementById("status-detail");
const error = document.getElementById("error"), refresh = document.getElementById("refresh");
const count = document.getElementById("removed-fields"), countLabel = document.getElementById("count-label");
let saved = { ...YAB.defaults }, busy = true, loaded = false, statusRevision = 0;
document.getElementById("version").textContent = YAB.version;
function showError(text) { error.hidden = false; error.textContent = text || "Something went wrong. Please reopen the popup."; }
function render(options) {
  saved = YAB.normalize(options);
  for (const [key, input] of Object.entries(fields)) input.checked = saved[key];
}
function setBusy(value) {
  busy = value;
  for (const input of Object.values(fields)) input.disabled = value || !loaded;
  if (value) refresh.disabled = true;
}
async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
function safeCount(value) { return Number.isSafeInteger(value) && value >= 0 ? String(value) : "0"; }
async function updateStatus() {
  const revision = ++statusRevision;
  const tab = await activeTab();
  if (revision !== statusRevision || busy) return;
  const site = YAB.siteForUrl(tab?.url);
  refresh.disabled = !site;
  refresh.textContent = site ? `Refresh ${site.name}` : "Refresh this tab";
  count.textContent = "—";
  countLabel.textContent = site?.id === "youtube" ? "Ad fields removed" : "Ad elements hidden";
  if (!saved.enabled) {
    title.textContent = "Ad blocking is off";
    detail.textContent = "Turn it on to block ads on your enabled sites.";
    return;
  }
  if (!site) {
    title.textContent = "Choose a supported site";
    detail.textContent = "Open one of the sites below to check this page.";
    return;
  }
  if (!YAB.isSiteEnabled(saved, site)) {
    title.textContent = `Off for ${site.name}`;
    detail.textContent = "Enable this site below to apply its filters.";
    return;
  }
  let status;
  try { status = await chrome.tabs.sendMessage(tab.id, { type: "page-status" }, { frameId: 0 }); } catch {}
  if (revision !== statusRevision || busy) return;
  if (!status || status.version !== YAB.version || status.site !== site.id) {
    title.textContent = "Refresh to connect";
    detail.textContent = `Refresh this ${site.name} tab after installing or updating.`;
    return;
  }
  if (!status.enabled) {
    title.textContent = "Refresh to apply settings";
    detail.textContent = "This page has not connected with the current settings yet.";
    return;
  }
  const youtube = site.id === "youtube";
  count.textContent = safeCount(youtube ? status.filterStatus?.removedFields : status.hiddenCount);
  if (!saved.hideSponsored && !saved.blockRequests && (!youtube || !saved.filterVideoAds)) {
    title.textContent = `No filters selected for ${site.name}`;
    detail.textContent = "Choose what to block below.";
    return;
  }
  if (youtube && saved.filterVideoAds && !status.filterStatus?.enabled) {
    title.textContent = "Refresh to activate video filtering";
    detail.textContent = status.filterStatus?.issue || "Refresh this tab so filtering starts before the player.";
    return;
  }
  title.textContent = `On for ${site.name}`;
  const issue = youtube ? status.filterStatus?.issue : status.issue;
  const summary = [];
  if (youtube && saved.filterVideoAds) summary.push("Video ad filter connected.");
  if (saved.hideSponsored) summary.push("Sponsored content hiding is enabled.");
  if (saved.blockRequests) summary.push("Known ad request blocking is enabled.");
  if (site.id === "twitch") summary.push("Twitch stream ads are not covered.");
  detail.textContent = typeof issue === "string" && issue ? issue.slice(0, 180) : summary.join(" ");
}
async function save() {
  if (busy || !loaded) return;
  ++statusRevision;
  setBusy(true);
  try {
    const options = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.checked]));
    const result = await chrome.runtime.sendMessage({ type: "set-options", options });
    if (!result?.ok) throw Error(result?.error || "Could not save settings.");
    render(result.options); error.hidden = true;
  } catch (value) { render(saved); showError(value.message); }
  finally { setBusy(false); }
  await updateStatus().catch(value => showError(value.message));
}
for (const input of Object.values(fields)) input.addEventListener("change", save);
refresh.addEventListener("click", async () => {
  if (busy || !loaded) return;
  try {
    const tab = await activeTab();
    const site = YAB.siteForUrl(tab?.url);
    if (!site) throw Error("Open a supported site first.");
    await chrome.tabs.reload(tab.id);
    detail.textContent = `Refreshed. Let ${site.name} load.`;
  } catch (value) { showError(value.message); }
});
chrome.runtime.sendMessage({ type: "get-options" }).then(async result => {
  if (!result?.ok) throw Error(result?.error || "Could not load settings.");
  render(result.options);
  loaded = true; setBusy(false);
  await updateStatus();
}).catch(value => showError(value.message));
const polling = setInterval(() => {
  if (loaded && !busy && !document.hidden) updateStatus().catch(value => showError(value.message));
}, 1500);
window.addEventListener("pagehide", () => { ++statusRevision; clearInterval(polling); }, { once: true });
