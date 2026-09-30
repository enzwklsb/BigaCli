# BigaCli

Use minimal-engineering. Keep changes focused on the real user path.
`cloudcli/` contains the pinned upstream source. `custom/server/` contains the maintained JavaScript source for our customized modules; builds copy these modules after compiling upstream. `ui/` contains our page source. No minified string patching.
During local iteration, maintain source here, build, then deploy with scripts/deploy-local.ps1. It waits for running tasks before restarting 3101. No GitHub release is required for local development.
Android deliveries can make the installed app newer than this checkout. First resolve the installed active.json and preserve/synchronize the touched files from store/app/<app.id>/cloudcli. Never build stale source over phone edits. For a small local fix, stage only changed files through runtime/cloudcli and the installed local-start.cjs; this merges them into the current app and waits for tasks before restarting 3101.
Never commit or package credentials, local databases, account stores, or conversation history.
Never modify or stop the original CloudCLI on port 3001.
Quota query/reset controls now live in the composer quota panel. Reuse their existing account checks and idempotent reset request. Never consume a reset credit or invoke the reset endpoint for testing; verify the confirmation UI only with isolated mocks.
Prepare releases as drafts for verification. Publish only when the user explicitly requests publication.
Before each release, handwrite releases/update-notes.json with the matching version, date, and brief NEW/OPT/FIX entries in Chinese, English and Japanese. Packaging includes these notes in the update manifest; do not generate them from Git history.
