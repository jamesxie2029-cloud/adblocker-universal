# Simulated browser fixture

Run `node tests/browser/server.cjs` from the extension directory and open the loopback URL it prints. Stop it with Ctrl+C. `FIXTURE_PORT` can specify a port; the default chooses a free one. No dependencies are required.

The dashboard runs ten checks per profile for Reddit, Twitch, Facebook, Instagram and X. It exercises the actual `src/shared.js`, `src/sites.js` and `src/site-content.js` files with browser-native DOM nodes, CSS, computed display and MutationObserver. It checks initial and dynamically added ads, ordinary-content preservation, site switches, master switches, DOM reuse and the hidden-element count.

Chrome storage and message APIs are simulated. The server wraps the unchanged content script in a function whose `location` parameter provides the selected site identity. Sample markup is deliberately synthetic. This does **not** validate current live-site markup, logged-in feeds, Chrome extension loading or declarative network request rules. It makes no requests to external sites and uses no screenshots or private account data.
