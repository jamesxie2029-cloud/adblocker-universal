# Implementation references

The filtering, controls and tests in this project are original. The following sources were consulted for browser API behavior and factual DOM/domain identifiers; their filter engines and lists are not bundled.

- [Chrome declarativeNetRequest documentation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) — static rules, initiator scoping and matching.
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) — document-start registration and MAIN/ISOLATED worlds.
- [EasyList ad-server inventory](https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_adservers.txt) — advertising-domain verification.
- [Google Publisher Tag documentation](https://developers.google.com/publisher-tag/guides/get-started) — Google advertising hosts.
- [EasyList site-specific DOM references](https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_specific_hide.txt) — Reddit ad components, Twitch display-ad wrappers and X ad-impression markers.
- [uAssets maintained filters](https://github.com/uBlockOrigin/uAssetsCDN/blob/main/filters/filters.txt) — recognized YouTube player-ad field names and Facebook ad-disclosure link structure.
- [uAssets Instagram structure report](https://github.com/uBlockOrigin/uAssets/issues/31586) — article/disclosure-link structure. Reported structures are not a guarantee of current account-specific layouts.

DOM identifiers change. Check a real affected page before adding broader matches; avoid matching arbitrary user-written text. Facebook/Instagram currently recognize narrowly located English and Chinese ad-disclosure labels, not every locale or obfuscation.

Development tests use [linkedom](https://github.com/WebReflection/linkedom), installed through pnpm with the checked-in lockfile. Its dependency licenses remain with those packages; it is excluded from the install ZIP.
