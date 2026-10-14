# Privacy

adblocker-universal 0.2.0 performs local filtering only. The extension includes no analytics service, account system, screenshot capture, data upload, external proxy, remote script loader or remotely downloaded filter list.

## Permissions

- `storage`: saves boolean on/off settings on this device. Sync storage is not used.
- `declarativeNetRequest`: lets Chrome apply the packaged blocking rules without sending request data to us. Rules are restricted to requests initiated by the supported site families; main-frame navigation is excluded. Domain-based initiator matching also includes subdomains of a listed family. YouTube Music, Studio and Kids are excluded.
- `scripting`: installs the YouTube player-data filter at page start. This MAIN-world script is registered only on the exact YouTube hosts listed in the manifest.
- Site access: page scripts inspect recognized ad-related DOM elements on the exact HTTPS hosts in the manifest. YouTube's filter also processes recognized player metadata. The scripts do not read passwords, cookies or private messages for filtering.

There is no broad `tabs`, `history`, `cookies`, `webRequest` or `<all_urls>` permission. The popup reads the active supported tab's URL to select its status panel and refresh control. It does not save or transmit that URL.

Counters are kept in page memory and reset with the page. The YouTube diagnostic bridge is accessible to site scripts, so its reported count is informational, not a security boundary. Disabling a site's filter does not revoke its Chrome permission; Chrome's extension settings manage that access.

The test tools and development dependencies do not run inside the installed extension. Publishing a bug report on GitHub is a separate user action; omit personal information from reports.
