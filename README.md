# adblocker-universal

A Chrome extension with separate controls for **YouTube, Reddit, Twitch, Facebook, Instagram and X**. It blocks a small set of known advertising requests and hides recognized ad placements. YouTube also gets a player-data filter that removes recognized video-ad placements before the player reads them.

**Version 0.2.0 — experimental multi-site release.** Coverage varies by site. This is not a promise of zero ads.

## What each site filter does

| Site | What it does | What it may miss |
| --- | --- | --- |
| **YouTube** | Removes recognized video-ad placement data; blocks known ad requests; hides sponsored cards beside videos and in feeds. | New player formats and ads inserted into the ordinary video stream. |
| **Reddit** | Hides marked promoted posts and dedicated ad components, including newly loaded feed items; blocks known ad requests. | Unmarked or changed ad components and promotions written into ordinary posts. |
| **Twitch** | Hides separate display-ad containers and blocks requests to the listed advertising networks. | **Pre-roll and mid-roll ads delivered within Twitch streams are not covered.** It does not rewrite playlists or stop the stream player. |
| **Facebook** | Hides recognized Sponsored feed posts identified by an ad-disclosure link; blocks known ad requests. | Experimental: obfuscated labels, unfamiliar layouts, some languages, Reels and in-video ads. |
| **Instagram** | Hides recognized Sponsored posts with an ad-disclosure link in the post header; blocks known ad requests. | Experimental: Reels, Stories, obfuscated labels, unfamiliar layouts and some languages. |
| **X / Twitter** | Hides promoted placements carrying an ad-impression marker; blocks known ad requests. | Promotions without the recognized marker and ads embedded in ordinary video/content. |

Social feed hiding removes recognized placements from the page; it does not guarantee their first-party feed data was never downloaded. The network layer blocks only its explicit advertising domains. It leaves ordinary media, chat, sign-in and GraphQL/player APIs available.

There are **no automatic Skip clicks, seeking, muting, playback-speed changes, proxy servers, or claims that an ad was watched**. Creator sponsorship segments inside an ordinary video are not removed.

## Install in Chrome

1. Download this repository with **Code → Download ZIP**, then extract it into a permanent folder. Alternatively, extract the packaged extension ZIP.
2. If using the earlier **YouTube Ad Blocker** prototype, disable it before enabling this version so the two do not compete over the same player.
3. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
4. Select the folder containing `manifest.json`. No build or dependency installation is needed to use the extension.
5. Review Chrome's site-access prompt and refresh your supported-site tabs.
6. Open the extension's toolbar popup to choose which sites and protections you want.

The new version requests access to the six listed site families; the exact page hosts are in `manifest.json`. It does not request access to all websites. Disabling a site stops its filters; it does not revoke Chrome's granted site permission. Manage those permissions through Chrome if desired.

## Controls and counters

- **Main switch:** stops filtering on all supported sites.
- **Site switches:** stop a site's request rules and page filters independently.
- **Block known ad requests:** enables the packaged network rules for selected sites.
- **Hide sponsored content:** hides recognized ad elements. Turning it off restores elements hidden by this extension.
- **YouTube video ad filtering:** controls YouTube's player-data filter. Refresh after changing it so YouTube rebuilds its player state.
- **Refresh:** refreshes the current supported-site tab, never an unrelated site.

**Ad fields removed** on YouTube counts metadata fields removed, not distinct ads or blocked requests. **Ad elements hidden** on other sites counts recognized elements currently hidden on the page, not an all-time ad count. Zero can mean no matching ad was offered, no supported marker was found, or that a filter is disabled. Diagnostic messages are visible to the webpage and are not a trusted audit.

## If something breaks

Turn off the affected site's switch and refresh. To isolate a playback problem, first turn off **Block known ad requests**, then refresh. Turning off the master switch and refreshing fully reloads the page without this extension's active filters.

For a useful bug report, include the extension version, site, browser version, what you expected, and whether switching that site's filter off fixes the issue. Remove personal information from screenshots and logs.

## Validation

- **58 automated checks** cover YouTube data parsing and native interface semantics; independent settings and rollback; ruleset scope; supported-host matching; dynamic ad insertion/removal; false-positive cases; reversible hiding; and popup behavior.
- The previous YouTube-only 0.1.1 build was tested in Chrome on five sampled videos and one complete 8:55 playback. No ad interruption was detected in that full playback. The reported YouTube counter rose from 7 to 13 removed fields. These observations do not prove an ad was scheduled or that every ad format is covered.
- **50 native-browser fixture checks passed** across the five new sites in Chrome, using simulated page markup and extension APIs. The new multi-site filters are tested against representative DOM fixtures. **Live logged-in feeds and native Chrome request matching for this new multi-site build have not yet been verified.** See [validation notes](docs/VALIDATION.md).

## Development

Use Node.js 24 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
python3 scripts/package.py
```

The packager produces `dist/adblocker-universal-0.2.0.zip` using an explicit runtime-file list. Tests, dependencies, Git data and Chromium-generated metadata are excluded. `linkedom` is a development dependency only; no third-party runtime code or remote filter download runs in the extension.

A local browser fixture is available with `node tests/browser/server.cjs`; follow its printed address. It simulates Chrome APIs and site identity and does not prove live-site coverage or native request-rule behavior.

## Privacy and references

All filtering runs locally. No analytics, screenshot collection, remote code or filter-list downloads, telemetry uploads, browsing-history collection or server is included. Read [PRIVACY.md](PRIVACY.md) for the permission details and [REFERENCES.md](REFERENCES.md) for implementation references.

This project is independent of the sites it supports and is not affiliated with them. No external filter engine or filter list is bundled.
