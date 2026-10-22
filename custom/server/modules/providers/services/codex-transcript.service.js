import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
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

async function* readTranscriptBytes(filePath, endByte) {
    const compressed = filePath.endsWith('.zst') || (!existsSync(filePath) && existsSync(filePath + '.zst'));
    const file = createReadStream(compressed && !filePath.endsWith('.zst') ? filePath + '.zst' : filePath);
    const stream = compressed ? file.pipe(createZstdDecompress()) : file;
    if (compressed) file.on('error', error => stream.destroy(error));
    let remaining = endByte ?? Infinity;
    try {
        for await (const chunk of stream) {
            // Parent offsets refer to uncompressed bytes, not the .zst file.
            if (chunk.length >= remaining) {
                yield chunk.subarray(0, remaining);
                return;
            }
            remaining -= chunk.length;
            yield chunk;
        }
    } finally {
        stream.destroy();
        file.destroy();
    }
}

// Codex paginated forks reference a byte-bounded parent transcript rather
// than copying it. Feed that native history into the existing CloudCLI parser.
export async function* readCodexTranscriptLines(filePath, resolveParent = resolveTranscript, endByte, ancestors = new Set()) {
    if (ancestors.has(filePath)) throw new Error('对话历史存在循环引用');
    const chain = new Set(ancestors).add(filePath);
    const stream = Readable.from(readTranscriptBytes(filePath, endByte));
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
