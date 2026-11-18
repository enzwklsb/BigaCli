import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';

export const isCodexTranscriptFile = file => /\.jsonl(?:\.zst)?$/.test(file);
export const codexTranscriptKey = file => file.replace(/\.zst$/, '');

// A rollout keeps its identity when Codex compresses or decompresses it.
export async function resolveCodexTranscriptPath(file) {
    const plain = codexTranscriptKey(file);
    for (const candidate of [plain, plain + '.zst']) {
        try { if ((await stat(candidate)).isFile()) return candidate; }
        catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    }
    return null;
}

export async function findCodexTranscriptFiles(root, since) {
    const files = new Map();
    async function visit(directory) {
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of entries) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) { await visit(file); continue; }
            if (!entry.isFile() || !isCodexTranscriptFile(file)) continue;
            let info;
            try { info = await stat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            if (since && info.mtime <= since && info.birthtime <= since) continue;
            const key = codexTranscriptKey(file);
            files.set(key, file.endsWith('.zst') ? files.get(key) || file : file);
        }
    }
    await visit(root);
    return [...files.values()];
}

export async function findCodexTranscriptById(home, threadId) {
    if (!/^[a-zA-Z0-9-]+$/.test(threadId)) return null;
    for (const folder of ['sessions', 'archived_sessions']) {
        const files = await findCodexTranscriptFiles(path.join(home, folder));
        const file = files.find(file => codexTranscriptKey(file).endsWith('-' + threadId + '.jsonl'));
        if (file) return file;
    }
    return null;
}
