import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { getConnection } from '../../database/index.js';

function resolveTranscript(threadId) {
    const row = getConnection().prepare(`
        SELECT jsonl_path FROM sessions WHERE provider_session_id = ? AND provider = 'codex'
        UNION ALL
        SELECT jsonl_path FROM superseded_provider_sessions WHERE provider_session_id = ? AND provider = 'codex'
        LIMIT 1
    `).get(threadId, threadId);
    if (!row?.jsonl_path) throw new Error('无法读取父对话历史：' + threadId);
    return row.jsonl_path;
}

// Codex paginated forks reference a byte-bounded parent transcript rather
// than copying it. Feed that native history into the existing CloudCLI parser.
export async function* readCodexTranscriptLines(filePath, resolveParent = resolveTranscript, endByte, ancestors = new Set()) {
    if (ancestors.has(filePath)) throw new Error('对话历史存在循环引用');
    const chain = new Set(ancestors).add(filePath);
    const stream = createReadStream(filePath, endByte === undefined ? {} : { end: endByte - 1 });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
        let first = true;
        for await (const line of lines) {
            if (first && line.trim()) {
                first = false;
                const row = JSON.parse(line);
                const base = row.type === 'session_meta' ? row.payload?.history_base : null;
                if (base) {
                    if (!Number.isSafeInteger(base.end_byte_offset) || base.end_byte_offset <= 0) throw new Error('父对话历史边界无效');
                    yield* readCodexTranscriptLines(await resolveParent(base.thread_id), resolveParent, base.end_byte_offset, chain);
                }
            }
            yield line;
        }
    } finally {
        lines.close();
        stream.destroy();
    }
}
