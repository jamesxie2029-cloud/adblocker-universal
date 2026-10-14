'use strict';
const cases = ['reddit', 'twitch', 'facebook', 'instagram', 'x'];
const results = new Map();
const frames = new Map();
for (const site of cases) {
  const frame = document.createElement('iframe');
  frame.src = `case.html?site=${site}`;
  frame.title = `${site} simulated checks`;
  frames.set(site, frame);
  document.getElementById('cases').append(frame);
}
window.addEventListener('message', event => {
  const result = event.data;
  if (event.origin !== location.origin || result?.kind !== 'fixture-result' || !cases.includes(result.site)) return;
  if (event.source !== frames.get(result.site).contentWindow) return;
  results.set(result.site, result);
  const totals = [...results.values()].reduce((total, row) => ({ pass: total.pass + row.pass, fail: total.fail + row.fail }), { pass: 0, fail: 0 });
  const finished = results.size === cases.length;
  document.getElementById('overall').textContent = `${totals.pass} passed · ${totals.fail} failed · ${results.size}/5 profiles complete`;
  document.body.dataset.result = finished ? (totals.fail ? 'failed' : 'passed') : 'running';
});
document.getElementById('rerun').addEventListener('click', () => location.reload());
