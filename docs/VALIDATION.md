# Validation — 0.2.0

## Automated coverage

58 Node tests pass. The suite covers player-data preservation, native Response/XHR semantics, settings persistence/races/rollback, per-site enable/disable, exact HTTPS host recognition, ruleset integration, representative request matches, dynamic DOM changes, false-positive cases, restoration and popup behavior.

DOM tests use linkedom rather than mocked selectors. They include normal posts containing ad-related words, untrusted lookalike links, nested posts, recycled feed elements and removed disclosures. Network tests model the packaged DNR conditions; they are not an execution of Chrome's native rules engine.

## Native browser fixture

On October 14, 2026, the simulated fixture passed **50 checks across all five new site profiles** in Chrome. It runs production filters with native DOM, CSS, computed styles and MutationObserver, but substitutes representative page markup, site identity and extension APIs. Checks cover initial and inserted ads, normal content, recycled posts, counters and restoration after disabling a site or the master switch. This is not live-site coverage or native DNR validation.

To repeat it from a source checkout, run `node tests/browser/server.cjs`, open the printed loopback URL and wait for all five profiles to complete. Stop the server with Ctrl-C.

## Earlier live YouTube checks

The 0.1.1 YouTube-only build had installed-Chrome checks over five sampled videos and one complete 8:55 video at normal speed. The full video reached its natural end with no detected ad or Skip state in 948 sampled observations. There were gaps between observation batches. No scheduled ad was independently established, so these checks support normal playback and observed filtering, not guaranteed ad coverage.

The new multi-site version retains the YouTube filtering logic, adding site controls and expanding the request-rule inventory. Those earlier observations are not a live acceptance test of this new package.

## Release limits

Live logged-in Reddit/Facebook/Instagram/X feeds, Twitch display ads and Chrome's native DNR behavior with the new package still need installation tests. Twitch stream ads are unsupported. Facebook and Instagram matching is conservative and experimental. Mobile layouts, alternate languages, embeds, obfuscation, Reels/Stories and server-inserted video ads have not been comprehensively validated.

A clean playback is not evidence that an ad was offered. Report observable results separately from inferences about blocking.
