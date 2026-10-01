# BigaCli

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

### Switch accounts. Continue the same task.

A mobile-friendly Codex workspace. Keep the conversation and continue your task with another signed-in account that has available quota.

[![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)](https://github.com/enzwklsb/BigaCli/releases/latest)
[![npm](https://img.shields.io/npm/v/bigacli?color=cb3837&logo=npm)](https://www.npmjs.com/package/bigacli)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL--3.0-blue)](LICENSE)

**[Download for Windows](https://github.com/enzwklsb/BigaCli/releases/latest) · [Watch demos](https://enzwklsb.github.io/BigaCli/?lang=en) · [Quick start](#quick-start)**

[![13-second demo: quota reached, account switched, same task continued](docs/media/bigacli-brief.gif)](https://enzwklsb.github.io/BigaCli/?lang=en#brief)

*Simulated demos using the original UI, without consuming real quota. Switching requires another signed-in account with available quota and support for the current model.*

| Automatic continuity · 17s | Manual selection · 23s |
| --- | --- |
| [![Watch automatic switching](docs/media/auto-poster.png)](https://enzwklsb.github.io/BigaCli/?lang=en#auto) | [![Watch manual switching](docs/media/manual-poster.png)](https://enzwklsb.github.io/BigaCli/?lang=en#manual) |
| Automatically choose an eligible account and continue when quota runs out. | Follow account selection, confirmation, and task recovery step by step. |

```powershell
npm i -g bigacli
bigacli start
```

Requires Windows x64 and Node.js 22+. Alternatively, download the ZIP with its bundled runtime, extract it, and run `start.cmd`.

## Why BigaCli?

| Continue the same task | Work from your phone | Keep working while you wait |
| --- | --- | --- |
| Switch accounts while keeping the conversation context. | Check quota, switch accounts, preview files, and download results. | Queue and edit follow-up messages, then resume after quota recovers. |

BigaCli is a Codex web client based on [CloudCLI](https://github.com/siteboon/claudecodeui), built for people who move between their phone and computer. Tasks run on your own computer; your phone controls them through a browser.

The features below describe the current repository. Older downloads may not include every feature.

## Features

1. **Continue across accounts.** Manage independently signed-in Codex accounts and resume within the same conversation, without copying context manually.
2. **Recover from quota limits.** Switch to an eligible account automatically or wait for quota to recover, including multiple paused conversations. Keep typing and queuing messages while waiting.
3. **Concise, task-focused communication.** Preset agent instructions favor clear results and the smallest sufficient changes. The concise-response setting controls answer detail.
4. **Preview and download files on mobile.** Open images, PDFs, HTML, Markdown, text, and other supported formats. A conversation file list helps you find and download results.
5. **One workspace on phone and desktop.** Both devices use the same service and task state. Reopen the URL while the computer and network remain available; no repeated application-level pairing is needed.
6. **Editable message queues.** Send immediately or queue during a task. Preview, edit, delete, or immediately send an individual queued message. Open editors pause automatic queue delivery.
7. **Reset quota from your phone.** Check available reset credits and expiry dates, then reset after confirmation. Availability depends on the account; simply opening the control does not consume a credit.
8. **Message timing.** Review message timestamps, progress, and available duration information across long tasks.
9. **Text and attachment drafts.** Upload or paste files, and restore text and saved pending attachments after refreshing.
10. **Your everyday browser.** Connect desktop Chrome or Edge with the [official Playwright extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) to use existing website logins. Select the browser in Settings → Connectors and allow the connection. A separate persistent Chromium browser remains available as a backup.
11. **GitHub account management.** Authorize GitHub from your phone or computer, switch accounts, and sign out in Settings → Connectors. Install [GitHub CLI](https://cli.github.com/) on the computer running BigaCli first.

<a id="quick-start"></a>

## Start and connect your phone

**Windows x64** is supported. Choose either ZIP or npm installation.

**ZIP:** Download **BigaCli-win-x64.zip** from the [latest release](https://github.com/enzwklsb/BigaCli/releases/latest), extract it to a writable folder, and run `start.cmd`. Node.js is bundled.

**npm:** Install Node.js 22 or later with npm, then run:

```powershell
npm i -g bigacli
bigacli start
```

On first launch, `bigacli start` downloads the matching full release from GitHub, verifies its SHA-256, and installs it under `%LOCALAPPDATA%\BigaCli`. Initial startup requires access to GitHub and a full program download. Subsequent launches use the installed program. The npm package is only a launcher; it contains no account credentials and does not download the application during npm installation.

Commands: `bigacli start` starts the app; `bigacli --help` / `-h` shows help; `bigacli --version` / `-v` shows the npm launcher version. Running `bigacli` without arguments also starts the app.

Open `http://localhost:3101` on the computer, add your own Codex account, and select a project and conversation. No sign-in information is included in the package.

**Both installations update through Settings → Check for updates.** Updates wait for running tasks to finish before switching versions. Release notes follow your interface language. The npm-installed app uses the same updater; reinstall npm only when updating the launcher itself. The actual app version appears in Settings. Removing the npm launcher does not delete the separately installed application, accounts, or conversations.

Existing ZIP installations can keep using their current directory. ZIP and npm installations do not automatically migrate or merge. Other component ZIPs, `release.json`, and checksum files are for the installer/updater.

**BigaCli does not provide network tunneling. For access across networks, use your own [Tailscale](https://tailscale.com/download) setup.** Connect your own devices with your own account; you do not join the author's network or depend on an author-operated connection server.

- Same LAN: open `http://YOUR-COMPUTER-LAN-IP:3101` on your phone.
- Across networks: install Tailscale on both devices, sign in to the same account, and open `http://YOUR-COMPUTER-TAILSCALE-IP:3101`.
- Keep the computer on, online, and running BigaCli. Its listener and firewall must allow the connection.

The BigaCli page currently has no separate web sign-in. Devices that can reach the service can operate it. Use a trusted LAN or private Tailscale network; do not expose port 3101 directly to the public internet. Codex account authentication is separate.

## Interface guide

| Location | Purpose |
| --- | --- |
| Top-left menu | Open the sidebar with project worktrees and recent conversations. |
| Sidebar search | Search projects, conversations, and message text. |
| New beside the worktree list | Create a worktree; New conversation starts a session within a project. |
| Conversation three-dot menu | Rename, copy the Codex session ID, fork, archive, or permanently delete. |
| Account area at the bottom of the sidebar | Open Accounts or Settings. |
| **Top-right folder icon** | **List files produced or referenced in the current conversation**, search by name/type, preview, and download. It is not a whole-computer file browser. |
| File cards / image thumbnails in messages | Preview attachments and download them from the preview toolbar. |
| Composer + button | Add images or files; pasting files is also supported. |
| Composer gauge icon | View quota, recovery times, reset credits and expiry; reset or open account selection. |
| Composer model label | Select a model, reasoning level, and available fast mode supported by the account. |
| Composer shield / warning icon | Select default, edit, or unrestricted permissions. Unrestricted mode uses a red warning icon. |
| Send / Stop | Send or stop a task. During a task, choose queue or immediate delivery. |
| Queue inside the composer | Preview each message's first line. Click to edit; click again or outside to close. × removes it. More than three rows scroll. |
| Quota recovery bar | View or cancel the recovery countdown; schedule it again after cancellation. |
| Quota-exhausted card | Review recovery/reset information and switch accounts to resume or reset quota. |
| Settings → Report a problem | Submit feedback without signing in to GitHub. Failed submissions retain the text; feedback goes to the maintainer's private list. |

## Everyday workflows

### Accounts and quota recovery

Add, select, or remove accounts in Accounts. The quota panel opens the same account page. An active task keeps its account environment locked.

Ordinary account selection changes the chosen account without automatically resuming an interrupted task. Use **Switch and resume** from the quota-exhausted card to recover the task. Automatic switching chooses an eligible account that supports the current model and reasoning level.

If no account is available, the default is to wait for quota recovery. The account list highlights the earliest recovery candidate; you can choose another account to wait for. Automatic resumption is scheduled one minute after recovery and checks quota again. You may cancel at any time and keep using the composer while waiting.

Exhausting either the 5-hour or 7-day window prevents continuation with that account. If a successful quota response reports no 5-hour limit, it is shown as unlimited; failed or abnormal responses are shown as unknown. Resetting quota requires confirmation.

### Queue and send immediately

Queued messages are sent when the current task finishes. Multiple queued messages are combined into one follow-up, using the model and reasoning level saved with the first queued message. Later settings changes apply to subsequent new messages.

Opening a queue preview does not automatically summon the keyboard. Edits save immediately. Automatic delivery waits while the editor is open. **Send now** in the editor sends only that message; the rest stay queued. Immediate delivery is unavailable while waiting for quota recovery, but you can add queued messages.

After quota recovery, the interrupted task resumes first; queued messages, including corrections, follow after it finishes. After manually stopping a task, the retained queue can proceed when quota and other delivery conditions allow.

### Files, drafts, and settings

The × on a pending attachment removes it from the draft. It differs from the preview control on sent files. Draft restoration after refresh does not mean unsent drafts synchronize live between devices.

Preview availability depends on the format; unsupported files can still be downloaded. Previews, downloads, and the conversation file list work on desktop and mobile.

The app supports Simplified Chinese, English, Japanese, and dark mode. Interface language controls UI labels, not the agent's response language; specify your preferred reply language in the conversation.

Concise responses apply from the next send and persist across account switches. Thinking-summary and tool-detail toggles only affect display. Version and update controls remain in Settings.

## Repository map

| Path | Responsibility |
| --- | --- |
| `AGENTS.md` | Collaboration, editing, and delivery rules. Read before changing code. |
| `ui/index.html` | Main UI, dialogs, composer, queue, account and quota controls. |
| `ui/locales.json`, `ui/i18n.js` | Chinese, English, and Japanese interface translations. |
| `ui/preview-ui.js`, `ui/vendor/` | File preview logic and dependencies. |
| `custom/server/modules/providers/` | Codex execution, account isolation, switching, quota, and interrupted-task recovery. |
| `custom/server/modules/scheduled-messages/` | Queued messages and scheduling. |
| `custom/server/modules/websocket/` | Live messages and cross-device subscriptions. |
| `feedback/` | Cloudflare Worker feedback API, D1 schema, and setup; see `feedback/SETUP_CN.md`. |
| `cloudcli/` | Pinned upstream source. |
| `scripts/` | Build, verification, and delivery scripts. |
| `bin/bigacli.cjs`, `npm/install.cjs` | npm launcher, first-run download/verification, and installation. |
| `releases/update-notes.json` | Handwritten Chinese, English, and Japanese release notes. |
| `docs/index.html`, `docs/site.js`, `docs/media/` | Public demo page, language selection, and videos. |

Phone connectivity uses your own network. The feedback receiver is a separate service. Self-hosting feedback requires changing the page's submission URL to your own endpoint.

## Build and release

Windows x64 and Node 24.19.0 are used for release builds. In `cloudcli/`, run `npm ci` then `npm run build`. At the repository root run `node scripts/build.mjs`, then `scripts/package.ps1 -NodeDirectory <directory-containing-node.exe>`. The packaging shell must use that Node version on PATH, with npm available for build-time dependency installation.

`release.json` pins our release and upstream versions; `cloudcli/package-lock.json` records exact dependencies. `cloudcli/` contains upstream source, while `custom/server/` is the readable source of customized runtime modules and `ui/` is our page source. The build compiles upstream and copies customized modules into their original locations. Changes should be maintained in these source directories, never patched into installed releases.

`nodeArchive` pins an already published Node component by URL and SHA-256. Reuse that archive while Node stays unchanged, so differences between compression tools cannot force a redundant client download. When changing Node, build and publish the new component and update this pin. For local rebuilds, `-ReuseDependencies` may reuse the dependency archive only when the lockfile has not changed.

The release workflow produces a **draft** release. Review it and publish it to make the update visible to installed users. Application, production dependencies and Node are separate complete component ZIPs. One release manifest selects the tested combination. This supports skipping releases without sequential patch installation.

For npm releases, keep the root `package.json`, `release.json` and `releases/update-notes.json` versions aligned. Run `npm pack --pack-destination build` to prepare the small launcher package; its file allowlist excludes app sources, builds and user data. Publish the matching GitHub release **with the full Windows ZIP and SHA256SUMS.txt first**, then use an authorized npm account to publish the tested tarball (`npm publish build/bigacli-<version>.tgz`). Do not publish npm ahead of its downloadable GitHub release. The root npm package has no production dependencies or install scripts.

For application-only updates, `-ComponentsOnly -ReuseDependencies` packages the app and reuses the unchanged component archives placed in the new version's assets directory. It does not rebuild a full installation ZIP. Downloads happen in the desktop launcher under `<install>/downloads`; successfully extracted components live under `<install>/store`, and temporary ZIPs are removed.

## Data and licensing

Do not place authentication files, personal databases or session histories in this repository or release assets. The default Codex home remains the user's existing `.codex`; additional account homes are isolated. This release keeps the existing CloudCLI application database and account-store locations so the bootstrap installation retains its data during the update.

Based on [CloudCLI](https://github.com/siteboon/claudecodeui), licensed under **AGPL-3.0-or-later**. BigaCli modifications are released under the same license. The exact corresponding source and build scripts are available at each release tag. Upstream notices are retained under `cloudcli/NOTICE`; bundled third-party packages retain their respective licenses. This software is provided without warranty.
