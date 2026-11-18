# Codex history lifecycle

The database is an index; Codex rollout files remain the history source.

- `codex-history-files.service.js` owns discovery and physical path resolution. A `.jsonl` and its `.jsonl.zst` counterpart identify the same rollout; prefer the plain representation when both exist.
- `codex-transcript.service.js` streams either representation and expands paginated fork parents using uncompressed byte offsets. Missing parents can be found in active or archived native storage even when they have no sidebar row.
- The Codex synchronizer reads its own rollout metadata without expanding parents. Its first scan on startup reconciles all active rollouts, including older files missed by earlier versions. Subsequent scans are incremental. Subagents, superseded threads and app-archived sessions stay excluded.
- File watchers accept both representations. Index pruning resolves both representations before deciding that a Codex history was deleted. Failed scans do not trigger orphan pruning.
- Main and subagent message readers share the streaming reader. Read failures are reported as errors rather than empty conversations.

Run `node scripts/verify-codex-transcript.cjs` and `node scripts/verify-history-lifecycle.cjs` after building. Tests use isolated data and never require a model request or real account.
