import path from 'node:path';
import { resolveCodexTranscriptPath } from './codex-history-files.service.js';
import { access } from 'node:fs/promises';
import { scanStateDb, sessionsDb } from '../../../modules/database/index.js';
import { providerRegistry } from '../../../modules/providers/provider.registry.js';
const pathExists = async (target) => {
    try {
        await access(target);
        return true;
    }
    catch {
        return false;
    }
};
/**
 * Removes indexed sessions whose transcript file has disappeared from disk.
 *
 * Nothing else deletes these rows: the synchronizers only ever upsert, and the
 * watcher reacts to `add`/`change` but not `unlink`. A transcript removed by
 * hand — or written by a test run that pointed at the real `~/.claude` — left a
 * permanent sidebar entry that opened an empty "Untitled" session.
 *
 * A row is only dropped when its *containing directory* still exists. That
 * keeps an unmounted or not-yet-created home from being read as "every
 * transcript was deleted" and wiping the whole index.
 */
const pruneOrphanedSessions = async () => {
    const knownDirectoryExists = new Map();
    let pruned = 0;
    for (const { session_id: sessionId, jsonl_path: jsonlPath } of sessionsDb.getSessionsWithTranscriptPath()) {
        if (sessionsDb.getSessionById(sessionId)?.provider === 'codex'
            ? await resolveCodexTranscriptPath(jsonlPath) : await pathExists(jsonlPath)) {
            continue;
        }
        const directory = path.dirname(jsonlPath);
        let directoryExists = knownDirectoryExists.get(directory);
        if (directoryExists === undefined) {
            directoryExists = await pathExists(directory);
            knownDirectoryExists.set(directory, directoryExists);
        }
        if (!directoryExists) {
            continue;
        }
        if (sessionsDb.deleteSessionById(sessionId)) {
            pruned += 1;
        }
    }
    return pruned;
};
/**
 * The scan that every `synchronizeSessions()` caller shares while it runs.
 *
 * Opening the UI fires `/api/projects` and `/api/projects/archived` at once,
 * and each used to start its own full provider scan from the same
 * `last_scanned_at` cursor: identical work over identical transcripts,
 * contending for the same synchronous SQLite writes and doubling how long the
 * sidebar sits on its loading screen. Callers that arrive while a scan is
 * already running now await that scan instead of starting another.
 */
let inFlightSynchronization = null;
/**
 * Runs all provider synchronizers and updates scan_state.last_scanned_at.
 */
async function runSessionSynchronization() {
    const lastScanAt = scanStateDb.getLastScannedAt();
    const scanBoundary = new Date();
    const processedByProvider = {
        claude: 0,
        codex: 0,
        cursor: 0,
        opencode: 0,
    };
    const failures = [];
    const results = await Promise.allSettled(providerRegistry.listProviders().map(async (provider) => ({
        provider: provider.id,
        processed: await provider.sessionSynchronizer.synchronize(lastScanAt ?? undefined),
    })));
    for (const result of results) {
        if (result.status === 'fulfilled') {
            processedByProvider[result.value.provider] = result.value.processed;
            continue;
        }
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(reason);
    }
    // Pruning is skipped after a partial sync: a provider that just failed may
    // not have re-indexed transcripts it would otherwise have re-created.
    const prunedOrphans = failures.length === 0 ? await pruneOrphanedSessions() : 0;
    if (failures.length === 0) {
        scanStateDb.updateLastScannedAt(scanBoundary);
    }
    else {
        console.warn(`[Sessions] Skipping scan_state cursor advance because ${failures.length} provider sync(s) failed.`);
    }
    return {
        processedByProvider,
        prunedOrphans,
        failures,
    };
}
/**
 * Orchestrates provider-specific session indexers and indexed-session lifecycle operations.
 */
export const sessionSynchronizerService = {
    /**
     * Scans every provider for new or changed sessions, coalescing concurrent
     * callers onto a single scan.
     */
    async synchronizeSessions() {
        if (inFlightSynchronization) {
            return inFlightSynchronization;
        }
        inFlightSynchronization = runSessionSynchronization().finally(() => {
            inFlightSynchronization = null;
        });
        return inFlightSynchronization;
    },
    /**
     * Indexes one provider artifact file without running a full provider rescan.
     */
    async synchronizeProviderFile(provider, filePath) {
        const resolvedProvider = providerRegistry.resolveProvider(provider);
        const sessionId = await resolvedProvider.sessionSynchronizer.synchronizeFile(filePath);
        return {
            provider,
            indexed: Boolean(sessionId),
            sessionId,
        };
    },
};
//# sourceMappingURL=session-synchronizer.service.js.map
