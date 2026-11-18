import os from 'node:os';
import path from 'node:path';
import { findCodexTranscriptFiles, isCodexTranscriptFile } from '../../services/codex-history-files.service.js';
import { readCodexTranscriptFileLines } from '../../services/codex-transcript.service.js';
import { sessionsDb } from '../../../../modules/database/index.js';
import { buildLookupMap, normalizeSessionName, readFileTimestamps, } from '../../../../shared/utils.js';
/**
 * Session indexer for Codex transcript artifacts.
 */
export class CodexSessionSynchronizer {
    provider = 'codex';
    initialScan = true;
    codexHome = path.join(os.homedir(), '.codex');
    /**
     * Scans ~/.codex/sessions and upserts discovered sessions into DB.
     */
    async synchronize(since) {
        const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
        const files = await findCodexTranscriptFiles(path.join(this.codexHome, 'sessions'), this.initialScan ? null : since);
        let processed = 0;
        for (const filePath of files) {
            const parsed = await this.processSessionFile(filePath, nameMap);
            if (!parsed) {
                continue;
            }
            const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
                ?? sessionsDb.getSessionById(parsed.sessionId);
            if (existingSession) {
                // If session name is untitled and we now have a name, update it
                if (existingSession.custom_name === 'Untitled Codex Session' && parsed.sessionName && parsed.sessionName !== 'Untitled Codex Session') {
                    sessionsDb.updateSessionCustomName(existingSession.session_id, parsed.sessionName);
                }
            }
            const timestamps = await readFileTimestamps(filePath);
            sessionsDb.createSession(parsed.sessionId, this.provider, parsed.projectPath, parsed.sessionName, timestamps.createdAt, timestamps.updatedAt, filePath);
            processed += 1;
        }
        this.initialScan = false;
        return processed;
    }
    /**
     * Parses and upserts one Codex session JSONL file.
     */
    async synchronizeFile(filePath) {
        if (!isCodexTranscriptFile(filePath)) {
            return null;
        }
        const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
        const parsed = await this.processSessionFile(filePath, nameMap);
        if (!parsed) {
            return null;
        }
        const timestamps = await readFileTimestamps(filePath);
        return sessionsDb.createSession(parsed.sessionId, this.provider, parsed.projectPath, parsed.sessionName, timestamps.createdAt, timestamps.updatedAt, filePath);
    }
    /**
     * Extracts session metadata from one Codex JSONL session file.
     */
    async processSessionFile(filePath, nameMap) {
        let parsed;
        for await (const line of readCodexTranscriptFileLines(filePath)) {
            if (!line.trim()) continue;
            let row; try { row = JSON.parse(line); } catch { continue; }
            const payload = row.type === 'session_meta' && row.payload;
            if (typeof payload?.id !== 'string' || typeof payload?.cwd !== 'string') continue;
            parsed = { sessionId: payload.id, projectPath: payload.cwd, isSubagent: this.isSubagentSessionMeta(payload) };
            break;
        }
        if (!parsed || parsed.isSubagent) {
            return null;
        }
        // A thread a session was edited off is left on disk on purpose, but it is
        // nobody's conversation any more. Re-indexing it would add a sidebar entry
        // for the version the user edited away from — and for a session that was
        // itself discovered from disk, whose app id is its original thread id, it
        // would hand the row back to that thread.
        if (sessionsDb.isProviderSessionSuperseded(parsed.sessionId, this.provider)) {
            return null;
        }
        // App-created sessions are keyed by an app id, so disk-discovered provider
        // ids must be resolved through the provider-id mapping first.
        const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
            ?? sessionsDb.getSessionById(parsed.sessionId);
        if (existingSession?.isArchived) return null;
        const existingSessionName = existingSession?.custom_name;
        if (existingSessionName && existingSessionName !== 'Untitled Codex Session') {
            return {
                ...parsed,
                sessionName: normalizeSessionName(existingSessionName, 'Untitled Codex Session'),
            };
        }
        let sessionName = nameMap.get(parsed.sessionId);
        if (!sessionName) {
            sessionName = await this.extractLastAgentMessageFromEnd(filePath);
        }
        return {
            ...parsed,
            sessionName: normalizeSessionName(sessionName, 'Untitled Codex Session'),
        };
    }
    /**
     * Returns true when a session_meta payload belongs to a Codex sub-agent
     * thread (Codex >=0.144 collaboration spawn_agent, review, compact, etc.).
     * Sub-agent rollouts live in the same sessions tree as user sessions, so
     * they must be skipped here to stay out of the sidebar — the Codex
     * equivalent of the Claude synchronizer's subagent transcript skip.
     * Top-level sessions carry thread_source "user" and a string source
     * ("exec"/"cli"); sub-agents carry thread_source "subagent" and an object
     * source keyed by "subagent".
     */
    isSubagentSessionMeta(payload) {
        if (payload.thread_source === 'subagent') {
            return true;
        }
        const source = payload.source;
        return typeof source === 'object' && source !== null && 'subagent' in source;
    }
    async extractLastAgentMessageFromEnd(filePath) {
        let last;
        for await (const line of readCodexTranscriptFileLines(filePath)) {
            let row; try { row = JSON.parse(line); } catch { continue; }
            if (row.type === 'event_msg' && row.payload?.type === 'task_complete'
                && typeof row.payload.last_agent_message === 'string' && row.payload.last_agent_message.trim()) last = row.payload.last_agent_message;
        }
        return last;
    }
}
