# Developing PulseDeck

[Home](../README.en.md) · [Русский](development.ru.md)

This page covers working with the source code. To install the finished app, use the download link on the home page.

## Local development and checks

Development requires Windows x64, Node.js 22 or later, and .NET Framework 4.8.

```sh
npm ci
node scripts/prepare.mjs
npm test
npm run test:ui
npm start
```

`prepare.mjs` generates icons, alert sounds and the Ping helper. Run unit checks with `npm test` and interface checks with `npm run test:ui`.

## Architecture

PulseDeck uses Electron for its desktop window and system integration. The interface uses HTML, CSS and JavaScript. Network checks run in the main process and are accessed through a restricted preload interface.

| File or directory | Purpose |
| --- | --- |
| `app/main.cjs` | Window, tray, notifications, startup and interface request handlers |
| `app/engine.cjs` | Monitoring loop and check queue |
| `app/core.cjs` | Input validation, monitor state and status confirmation |
| `app/probes.cjs` | Ping, TCP and HTTP / HTTPS checks |
| `app/native/PingProbe.cs` | Windows Ping helper |
| `app/storage.cjs` | Settings and history storage |
| `app/telegram.cjs` | Telegram notification delivery |
| `app/ui/` | Interface, styles and translations |
| `installer/` | C# / WPF installer and uninstaller |

Interface translations live in `app/ui/translations.json`, and installer translations in `installer/translations.json`. Keep both languages up to date when making changes.

## Data and behavior

Settings and history are stored in `%APPDATA%\PulseDeck\pulsedeck.json`. The Telegram token is encrypted for the Windows account and excluded from exports. Uninstalling preserves user data.

History retains the last 120 checks per monitor and 1,000 activity entries. Lifetime sample counters are retained separately. By default, a status change requires two matching results. Concurrent checks are bounded; there is no fixed monitor-count limit.

Pending Telegram deliveries survive restarts, up to 200 messages. A retry after an ambiguous network failure can occasionally deliver a duplicate. Switching the bot or chat clears the queue.

## Release builds

Verify and commit the source, then push the commit to `origin/main`. Create a source archive with `git archive` and extract it into a separate clean directory. Install dependencies with `npm ci`, then run `npm run build` with the full commit SHA in `PULSEDECK_GIT_SHA` and the source archive's SHA-256 in `PULSEDECK_ARCHIVE_SHA256`.

The build creates the installer, `manifest.json` and `SHA256SUMS.txt` in `release/`. The manifest records the full commit SHA and hashes of the source, application payload and installer. The installer verifies payload hashes and creates per-user shortcuts. Startup with Windows is enabled only if the user selects it.

Do not commit builds, installers or local data. The source is MIT licensed; Electron and its components retain their own licenses in the installed distribution.

## Screenshots and descriptions

`node scripts/screenshots.mjs` captures the app with separate demonstration data for each language. `node scripts/preview-installer.mjs` captures installer previews. These commands do not use personal settings or history.

The Russian description is in `README.md`, and the English version is in `README.en.md`. Release descriptions live in `docs/releases/`. When updating the version, update the installer links in both languages.
