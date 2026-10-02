import spawn from 'cross-spawn';
import { createInterface } from 'node:readline';
import { spawnCodex } from './codex-command.service.js';
import { buildCodexEnv } from './codex-account.service.js';

// Existing saved messages may still carry CloudCLI's old permission names.
export function nativePermissionId(value) {
    return ({ default: ':workspace', acceptEdits: ':workspace', bypassPermissions: ':danger-full-access' })[value] || value;
}

export async function readCodexPermissionProfiles(accountId, cwd) {
    const proc = spawnCodex(spawn, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: buildCodexEnv(accountId) });
    const pending = new Map();
    let nextId = 0;
    const fail = error => { for (const { reject } of pending.values()) reject(error); pending.clear(); };
    const timer = setTimeout(() => { fail(new Error('Codex permission request timed out')); proc.kill(); }, 8000);
    proc.on('error', fail);
    proc.stdin.on('error', fail);
    proc.stderr.resume();
    proc.on('close', () => fail(new Error('Codex permission service closed')));
    const lines = createInterface({ input: proc.stdout });
    lines.on('line', line => {
        let message; try { message = JSON.parse(line); } catch { return; }
        const waiter = pending.get(message.id); if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    });
    const request = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId; pending.set(id, { resolve, reject });
        proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    try {
        await request('initialize', { clientInfo: { name: 'bigacli', version: '1' }, capabilities: { experimentalApi: true } });
        proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
        const data = []; let cursor;
        do {
            const page = await request('permissionProfile/list', { cwd, ...(cursor ? { cursor } : {}) });
            data.push(...page.data); cursor = page.nextCursor;
        } while (cursor);
        const { config } = await request('config/read', { cwd, includeLayers: false });
        return { data, defaultId: config.default_permissions || null };
    } finally {
        clearTimeout(timer); lines.close(); proc.stdin.end(); proc.kill();
    }
}
