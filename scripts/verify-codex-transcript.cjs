// Isolated regression for compressed Codex history; never reads user accounts.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { zstdCompressSync } = require('node:zlib');

(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../custom/server/modules/providers/services/codex-transcript.service.js'), 'utf8')
        .replace("import { getConnection } from '../../database/index.js';", "function getConnection() { throw Error('Test must not access the application database'); }");
    const { readCodexTranscriptLines: read } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bigacli-transcript-'));
    try {
        const parent = path.join(root, 'parent.jsonl');
        const expected = JSON.stringify({ type: 'session_meta', payload: {} }) + '\n'
            + JSON.stringify({ type: 'response_item', payload: { type: 'message', content: '中文历史' } }) + '\n';
        const bytes = Buffer.from(expected + JSON.stringify({ type: 'response_item', payload: { content: 'excluded' } }) + '\n');
        const boundary = Buffer.byteLength(expected);
        const collect = async (file, end) => {
            const lines = [];
            for await (const line of read(file, () => parent, end)) lines.push(line);
            return lines;
        };
        fs.writeFileSync(parent, bytes);
        const plain = await collect(parent, boundary);
        assert.deepEqual(plain, expected.trimEnd().split('\n'));
        fs.writeFileSync(parent + '.zst', zstdCompressSync(bytes));
        fs.unlinkSync(parent);
        assert.deepEqual(await collect(parent, boundary), plain);
        assert.deepEqual(await collect(parent + '.zst', boundary), plain);
        const child = path.join(root, 'child.jsonl');
        const childMeta = JSON.stringify({ type: 'session_meta', payload: { history_base: { thread_id: 'parent', end_byte_offset: boundary } } });
        fs.writeFileSync(child, childMeta + '\n');
        assert.deepEqual(await collect(child), [...plain, childMeta]);
        await assert.rejects(collect(path.join(root, 'missing.jsonl')), /ENOENT/);
        fs.writeFileSync(path.join(root, 'broken.jsonl.zst'), 'invalid zstd');
        await assert.rejects(collect(path.join(root, 'broken.jsonl')));
        console.log('PASS: plain/compressed history, uncompressed byte boundary, parent history, missing/corrupt file errors');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
