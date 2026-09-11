# BigaCli

A CloudCLI-based, self-contained Windows client for Codex. Includes a mobile-friendly UI, isolated Codex accounts, streaming replies, and component updates.

## Install

Download `BigaCli-win-x64.zip` from [Releases](https://github.com/enzwklsb/BigaCli/releases/latest), extract to a writable directory, and double-click `start.cmd`. Open port **3101**. No global Node, npm or Codex installation is needed.

The page checks for published updates automatically. Click **下载并更新** once; unchanged components are not downloaded. Chat remains available during download, then the app waits for running tasks, restarts and reconnects. A failed startup returns to the previous application version. Account data and conversations are outside the program directory.

## Build and release

Windows x64 and Node 24.19.0 are used for release builds. In `cloudcli/`, run `npm ci` then `npm run build`. At the repository root run `node scripts/build.mjs`, then `scripts/package.ps1 -NodeDirectory <directory-containing-node.exe>`. The packaging shell must use that Node version on PATH, with npm available for build-time dependency installation.

`release.json` pins our release and upstream versions; `cloudcli/package-lock.json` records exact dependencies. `cloudcli/` contains upstream source, while `custom/server/` is the readable source of customized runtime modules and `ui/` is our page source. The build compiles upstream and copies customized modules into their original locations. Changes should be maintained in these source directories, never patched into installed releases.

The release workflow produces a **draft** release. Review it and publish it to make the update visible to installed users. Application, production dependencies and Node are separate complete component ZIPs. One release manifest selects the tested combination. This supports skipping releases without sequential patch installation.

## Data and licensing

Do not place authentication files, personal databases or session histories in this repository or release assets. The default Codex home remains the user's existing `.codex`; additional account homes are isolated. Version 0.1 uses the existing CloudCLI application database for compatibility with the bootstrap installation.

Based on [CloudCLI](https://github.com/siteboon/claudecodeui), licensed under **AGPL-3.0-or-later**. BigaCli modifications are released under the same license. The exact corresponding source and build scripts are available at each release tag. Upstream notices are retained under `cloudcli/NOTICE`; bundled third-party packages retain their respective licenses. This software is provided without warranty.
