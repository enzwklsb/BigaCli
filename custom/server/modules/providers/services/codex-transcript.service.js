import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { getConnection } from '../../database/index.js';
import { resolveCodexTranscriptPath, findCodexTranscriptById, codexTranscriptKey } from './codex-history-files.service.js';

async function resolveTranscript(threadId) {
    const row = getConnection().prepare(`
        SELECT jsonl_path FROM sessions WHERE provider_session_id = ? AND provider = 'codex'
        UNION ALL
        SELECT jsonl_path FROM superseded_provider_sessions WHERE provider_session_id = ? AND provider = 'codex'
        LIMIT 1
    `).get(threadId, threadId);
    const file = row?.jsonl_path && await resolveCodexTranscriptPath(row.jsonl_path)
        || await findCodexTranscriptById(path.join(os.homedir(), '.codex'), threadId);
    if (!file) throw new Error('无法读取父对话历史：' + threadId);
    return file;
}

async function* readTranscriptBytes(filePath, endByte) {
    const actual = await resolveCodexTranscriptPath(filePath);
    if (!actual) throw Object.assign(new Error('历史文件不存在：' + filePath), { code: 'ENOENT' });
    const compressed = actual.endsWith('.zst');
    const file = createReadStream(actual);
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
export async function* readCodexTranscriptFileLines(filePath, endByte) {
    const stream = Readable.from(readTranscriptBytes(filePath, endByte));
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
        for await (const line of lines) yield line;
    } finally { lines.close(); stream.destroy(); }
}

export async function* readCodexTranscriptLines(filePath, resolveParent = resolveTranscript, endByte, ancestors = new Set()) {
    const key = codexTranscriptKey(filePath);
    if (ancestors.has(key)) throw new Error('对话历史存在循环引用');
    const chain = new Set(ancestors).add(key);
    const lines = readCodexTranscriptFileLines(filePath, endByte);
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
        await lines.return();
    }
}
