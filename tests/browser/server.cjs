'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const sites = { reddit: 'https://www.reddit.com/', twitch: 'https://www.twitch.tv/', facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', x: 'https://x.com/' };
const files = {
  '/': ['tests/browser/index.html', 'text/html'],
  '/dashboard.js': ['tests/browser/dashboard.js', 'text/javascript'],
  '/fixture.css': ['tests/browser/fixture.css', 'text/css'],
  '/case.html': ['tests/browser/case.html', 'text/html'],
  '/case.js': ['tests/browser/case.js', 'text/javascript'],
  '/src/shared.js': ['src/shared.js', 'text/javascript'],
  '/src/sites.js': ['src/sites.js', 'text/javascript']
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/fixture-content.js' && Object.hasOwn(sites, url.searchParams.get('site'))) {
    // Keep production source unchanged. Only the location parameter is simulated;
    // all DOM, CSS, computed style and MutationObserver behavior is browser native.
    const production = fs.readFileSync(path.join(root, 'src/site-content.js'), 'utf8');
    const body = `((location) => {\n${production}\n})({href:${JSON.stringify(sites[url.searchParams.get('site')])}});\n`;
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body); return;
  }
  const entry = files[url.pathname];
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(path.join(root, entry[0])));
});
server.listen(Number(process.env.FIXTURE_PORT || 0), '127.0.0.1', () => {
  console.log(`Simulated browser fixture: http://127.0.0.1:${server.address().port}/`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
