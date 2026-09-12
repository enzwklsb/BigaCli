import spawn from 'cross-spawn';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { spawnCodex } from './codex-command.service.js';

// Native App Server events adapted to the existing CloudCLI runtime contract.
const approvals = new Map();
export const codexStreamPermissions = {
    resolve(id, decision) { approvals.get(id)?.resolve(decision); },
    listPending(sessionId) { return [...approvals.values()].filter(a => a.sessionId === sessionId).map(({ resolve, ...a }) => a); },
};

export async function* streamCodexTurn(input, options, signal) {
    const proc = spawnCodex(spawn, ['app-server'], { env: options.env, cwd: options.workingDirectory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = createInterface({ input: proc.stdout });
    const pending = new Map(), queue = [], ownedApprovals = new Set();
    let nextId = 0, wake, failure, closed = false, finished = false, stderr = '', threadId = options.threadId, turnId, tokenUsage, lastError;
    const push = event => { queue.push(event); wake?.(); wake = null; };
    const fail = error => { failure = error; wake?.(); wake = null; for (const p of pending.values()) p.reject(error); pending.clear(); };
    const send = message => { if (!proc.stdin.destroyed) proc.stdin.write(JSON.stringify(message) + '\n'); };
    const request = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 20000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        send({ id, method, params });
    });
    const message = data => push({ type: 'normalized', message: data });
    const errorValue = error => ({ ...error, message: error?.codexErrorInfo === 'usageLimitExceeded' ? 'usage_limit_exceeded' : (error?.message || 'Codex turn failed') });
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    proc.stdin.on('error', fail);
    proc.on('error', fail);
    proc.on('close', code => { closed = true; if (!finished) fail(new Error(stderr.trim() || `Codex app-server exited (${code})`)); });
    lines.on('line', line => {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (!m.method && m.id !== undefined) {
            const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
            m.error ? p.reject(new Error(m.error.message || JSON.stringify(m.error))) : p.resolve(m.result); return;
        }
        const p = m.params || {};
        if (m.id !== undefined && m.method) {
            if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(m.method)) {
                const requestId = randomUUID(); ownedApprovals.add(requestId);
                approvals.set(requestId, { requestId, sessionId: options.sessionId, toolName: m.method.includes('commandExecution') ? 'command_execution' : 'file_change', input: p, receivedAt: new Date(), resolve: decision => {
                    send({ id: m.id, result: { decision: decision.allow ? 'accept' : 'decline' } });
                    approvals.delete(requestId); ownedApprovals.delete(requestId);
                } });
                message({ kind: 'permission_request', requestId, toolName: approvals.get(requestId).toolName, input: p });
            } else send({ id: m.id, error: { code: -32601, message: `Unsupported client request: ${m.method}` } });
            return;
        }
        if (m.method === 'thread/tokenUsage/updated') { tokenUsage = p.tokenUsage; return; }
        if (m.method === 'error') { lastError = errorValue(p.error); return; }
        if (m.method === 'turn/started') { turnId = p.turn?.id; push({ type: 'turn.started' }); return; }
        if (['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/plan/delta'].includes(m.method)) {
            message({ kind: 'stream_delta', itemId: p.itemId, messageKind: m.method.includes('/reasoning/') ? 'thinking' : m.method.includes('/plan/') ? 'plan' : 'text', content: p.delta || '' }); return;
        }
        if (m.method === 'item/completed') {
            const item = p.item; if (!item) return;
            if (['agentMessage', 'reasoning', 'plan'].includes(item.type)) {
                const content = item.type === 'reasoning' ? (item.summary || []).join('\n\n') : (item.text || '');
                message({ kind: 'stream_end', itemId: item.id, messageKind: item.type === 'reasoning' ? 'thinking' : item.type === 'plan' ? 'plan' : 'text', content, phase: item.phase ?? null }); return;
            }
            const types = { commandExecution: 'command_execution', fileChange: 'file_change', mcpToolCall: 'mcp_tool_call', webSearch: 'web_search' };
            if (types[item.type]) push({ type: 'item.completed', item: { ...item, type: types[item.type], aggregated_output: item.aggregatedOutput, exit_code: item.exitCode } });
            return;
        }
        if (m.method === 'turn/completed') {
            finished = true;
            if (p.turn?.status === 'failed') push({ type: 'turn.failed', error: errorValue(p.turn.error || lastError) });
            else {
                const total = tokenUsage?.total;
                push({ type: 'turn.completed', usage: total ? { input_tokens: total.inputTokens, output_tokens: total.outputTokens, total_tokens: total.totalTokens, model_context_window: tokenUsage.modelContextWindow } : undefined });
            }
        }
    });
    const abort = async () => {
        const error = new Error('Codex turn aborted'); error.name = 'AbortError';
        const timer = setTimeout(() => { proc.kill(); fail(error); }, 2000);
        try { if (threadId && turnId) await request('turn/interrupt', { threadId, turnId }); } catch {} finally { clearTimeout(timer); fail(error); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) { const error = new Error('Codex turn aborted'); error.name = 'AbortError'; throw error; }
        await request('initialize', { clientInfo: { name: 'bigacli', title: 'BigaCli', version: '0.2.0' }, capabilities: { experimentalApi: true } });
        send({ method: 'initialized' });
        const params = { cwd: options.workingDirectory, model: options.model, sandbox: options.sandboxMode, approvalPolicy: options.approvalPolicy };
        const result = await request(threadId ? 'thread/resume' : 'thread/start', { ...params, ...(threadId ? { threadId } : {}) });
        threadId = result.thread.id;
        yield { type: 'thread.started', thread_id: threadId };
        const userInput = typeof input === 'string' ? [{ type: 'text', text: input }] : input.map(item => item.type === 'local_image' ? { type: 'localImage', path: item.path } : { type: 'text', text: item.text });
        await request('turn/start', { threadId, input: userInput, serviceTierForTurn: options.serviceTier || 'default', ...(options.modelReasoningEffort ? { effort: options.modelReasoningEffort } : {}), summary: 'auto' });
        while (true) {
            if (failure) throw failure;
            if (queue.length) { yield queue.shift(); continue; }
            if (finished) break;
            await new Promise(resolve => { wake = resolve; });
        }
    } finally {
        signal?.removeEventListener('abort', abort);
        for (const id of ownedApprovals) approvals.delete(id);
        for (const p of pending.values()) p.reject(new Error('Codex transport closed'));
        pending.clear(); lines.close();
        if (!closed && finished) {
            await new Promise(resolve => {
                const timer = setTimeout(() => { proc.kill(); resolve(); }, 2000);
                proc.once('close', () => { clearTimeout(timer); resolve(); });
                proc.stdin.end();
            });
        } else if (!closed) proc.kill();
    }
}
