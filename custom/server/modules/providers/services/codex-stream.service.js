import spawn from 'cross-spawn';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/utils.js';
import { readFileSync } from 'node:fs';
import { readCodexTranscriptLines } from './codex-transcript.service.js';
import { spawnCodex } from './codex-command.service.js';
import { nativePermissionId } from './codex-permissions.service.js';
import { getReplyPreference } from '../../bigacli/preferences.service.js';
import { browserUseService } from '../../browser-use/browser-use.service.js';
import { createDesktopContext } from '../../desktop-use/desktop-use.service.js';

// Native App Server events adapted to the existing CloudCLI runtime contract.
const approvals = new Map();
const agentRules = readFileSync(new URL('../../bigacli/BIGACLI_AGENT_RULES.md', import.meta.url), 'utf8');
const activeTurns = new Map();
export async function steerCodexTurn(sessionId, input, isRunning) {
    const deadline = Date.now() + 30000;
    while (!activeTurns.has(sessionId) && isRunning?.() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const steer = activeTurns.get(sessionId);
    if (!steer && !isRunning?.()) throw new AppError('当前任务已经结束，请正常发送消息。', {code:'NO_ACTIVE_TURN',statusCode:409});
    if (!steer) throw new Error('当前任务尚未就绪或已经结束，请稍后发送。');
    return steer(input);
}
// Keep native response items (including tool pairs and image content), never
// reconstruct model history from the UI's paginated/filtered messages.
export async function readHandoffItems(transcriptPath) {
    if (!transcriptPath) throw new Error('无法恢复：原对话记录不存在');
    const entries = [];
    for await (const line of readCodexTranscriptLines(transcriptPath)) if (line.trim()) entries.push(JSON.parse(line));
    if (entries.some(row => row.type === 'event_msg' && row.payload?.type === 'thread_rolled_back')) {
        throw new Error('原对话包含回滚记录，无法完整恢复；已保留原对话');
    }
    const userTexts = new Set(entries.filter(row => row.type === 'event_msg' && row.payload?.type === 'user_message').map(row => row.payload.message));
    const items = entries.filter(row => row.type === 'response_item').map(row => row.payload);
    for (const item of items) {
        if (item.type !== 'message' || item.role !== 'user' || item.internal_chat_message_metadata_passthrough) continue;
        const text = (item.content || []).filter(part => part.type === 'input_text').map(part => part.text).join('\n');
        if (userTexts.has(text)) item.internal_chat_message_metadata_passthrough = { content_item_kinds: item.content.map(part => part.type === 'input_image' ? 'user.image' : 'user.text') };
    }
    if (!items.length) throw new Error('原对话没有可恢复的原生上下文；已保留原对话');
    return items;
}
export const codexStreamPermissions = {
    resolve(id, decision) { approvals.get(id)?.resolve(decision); },
    listPending(sessionId) { return [...approvals.values()].filter(a => a.sessionId === sessionId).map(({ resolve, ...a }) => a); },
};

function compactActivityDetail(value, max = 96) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function activityFromItem(item) {
    if (!item?.type) return null;
    if (item.type === 'commandExecution') {
        const command = compactActivityDetail(item.command);
        return { activityType: 'command_execution', itemId: item.id, text: command ? `正在执行 ${command}…` : '正在执行命令…' };
    }
    if (item.type === 'fileChange') {
        const path = compactActivityDetail(item.changes?.[0]?.path || item.changes?.[0]?.filePath || '');
        return { activityType: 'file_change', itemId: item.id, text: path ? `正在修改 ${path}…` : '正在修改文件…' };
    }
    if (item.type === 'mcpToolCall') {
        const server = compactActivityDetail(item.server || item.appName || '');
        const tool = compactActivityDetail(item.tool || item.actionName || '');
        const args = item.arguments;
        const target = typeof args === 'string' ? compactActivityDetail(args, 72) : compactActivityDetail(args?.query || args?.q || args?.url || args?.path || args?.pattern || args?.search_query || '', 72);
        const detail = [server, tool, target].filter(Boolean).join(' · ');
        return { activityType: 'mcp_tool_call', itemId: item.id, text: detail ? `正在使用 ${detail}…` : '正在使用工具…' };
    }
    if (item.type === 'webSearch') {
        const query = compactActivityDetail(item.query || item.action?.query || '');
        return { activityType: 'web_search', itemId: item.id, text: query ? `正在搜索 ${query}…` : '正在搜索网页…' };
    }
    return null;
}

export async function* streamCodexTurn(input, options, signal) {
    const desktop = createDesktopContext();
    const proc = spawnCodex(spawn, ['app-server'], { env: options.env, cwd: options.workingDirectory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = createInterface({ input: proc.stdout });
    const pending = new Map(), queue = [], ownedApprovals = new Set();
    const messagePhases = new Map();
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
            const desktopElicitation = m.method === 'mcpServer/elicitation/request' && p.serverName === 'bigacli-desktop' && p.mode === 'form';
            const nativeDesktopApproval = desktopElicitation && p._meta?.codex_approval_kind === 'mcp_tool_call';
            const desktopApproval = nativeDesktopApproval || desktopElicitation && p.requestedSchema?.properties?.allow?.type === 'boolean';
            if (desktopApproval && (desktop?.access() !== 'workspaceWrite' || !desktop?.canAsk())) {
                const allow = desktop?.access() === 'dangerFullAccess';
                send({ id: m.id, result: { action: allow ? 'accept' : 'decline', content: allow ? (nativeDesktopApproval ? {} : { allow: true }) : null } }); return;
            }
            if (desktopApproval && desktop?.approved()) {
                send({ id: m.id, result: { action: 'accept', content: nativeDesktopApproval ? {} : { allow: true } } }); return;
            }
            if (desktopApproval || ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(m.method)) {
                const requestId = randomUUID(); ownedApprovals.add(requestId);
                const permissionGrant = m.method === 'item/permissions/requestApproval';
                const approvalInput = desktopApproval ? { message: p.message, scope: 'turn' } : p;
                approvals.set(requestId, { requestId, sessionId: options.sessionId, toolName: desktopApproval ? 'desktop_control' : permissionGrant ? 'permissions' : m.method.includes('commandExecution') ? 'command_execution' : 'file_change', input: approvalInput, receivedAt: new Date(), resolve: decision => {
                    if (signal?.aborted) decision = { allow: false };
                    if (desktopApproval && decision.allow) desktop?.grant();
                    send({ id: m.id, result: desktopApproval ? { action: decision.allow ? 'accept' : 'decline', content: decision.allow ? (nativeDesktopApproval ? {} : { allow: true }) : null } : permissionGrant ? { permissions: decision.allow ? p.permissions : {}, scope: 'turn' } : { decision: decision.allow ? 'accept' : 'decline' } });
                    approvals.delete(requestId); ownedApprovals.delete(requestId);
                } });
                message({ kind: 'permission_request', requestId, toolName: approvals.get(requestId).toolName, input: approvalInput });
            } else send({ id: m.id, error: { code: -32601, message: `Unsupported client request: ${m.method}` } });
            return;
        }
        if (m.method === 'thread/tokenUsage/updated') { tokenUsage = p.tokenUsage; return; }
        if (m.method === 'error') { lastError = errorValue(p.error); return; }
        if (m.method === 'turn/started') { turnId = p.turn?.id; push({ type: 'turn.started' }); return; }
        if (p.item?.type === 'contextCompaction' && ['item/started', 'item/completed'].includes(m.method)) {
            message({ kind: 'status', text: m.method === 'item/started' ? '正在压缩上下文' : '正在处理' });
            return;
        }
        if (m.method === 'item/started' && p.item?.type === 'agentMessage') {
            messagePhases.set(p.item.id, p.item.phase ?? null);
            if (p.item.phase === 'final_answer') message({ kind: 'final_answer_start', itemId: p.item.id });
            else if (p.item.phase === 'commentary') message({ kind: 'activity_end', itemId: p.item.id });
            return;
        }
        if (m.method === 'item/started') {
            const activity = activityFromItem(p.item);
            if (activity) { message({ kind: 'activity_start', ...activity }); return; }
        }
        if (m.method === 'item/mcpToolCall/progress') {
            const text = compactActivityDetail(p.message, 160);
            if (text) message({ kind: 'activity_progress', activityType: 'mcp_tool_call', itemId: p.itemId, text });
            return;
        }
        if (['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/plan/delta'].includes(m.method)) {
            message({ kind: 'stream_delta', itemId: p.itemId, messageKind: m.method.includes('/reasoning/') ? 'thinking' : m.method.includes('/plan/') ? 'plan' : 'text', content: p.delta || '', phase: messagePhases.get(p.itemId) ?? null }); return;
        }
        if (m.method === 'item/completed') {
            const item = p.item; if (!item) return;
            if (['agentMessage', 'reasoning', 'plan'].includes(item.type)) {
                const content = item.type === 'reasoning' ? (item.summary || []).join('\n\n') : (item.text || '');
                message({ kind: 'stream_end', itemId: item.id, messageKind: item.type === 'reasoning' ? 'thinking' : item.type === 'plan' ? 'plan' : 'text', content, phase: item.phase ?? messagePhases.get(item.id) ?? null });
                messagePhases.delete(item.id); return;
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
        desktop?.close();
        const error = new Error('Codex turn aborted'); error.name = 'AbortError';
        const timer = setTimeout(() => { proc.kill(); fail(error); }, 2000);
        try { if (threadId && turnId) await request('turn/interrupt', { threadId, turnId }); } catch {} finally { clearTimeout(timer); fail(error); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) { const error = new Error('Codex turn aborted'); error.name = 'AbortError'; throw error; }
        await request('initialize', { clientInfo: { name: 'bigacli', title: 'BigaCli', version: '0.2.0' }, capabilities: { experimentalApi: true } });
        send({ method: 'initialized' });
        const { config } = await request('config/read', { cwd: options.workingDirectory, includeLayers: false });
        const developerInstructions = [config.developer_instructions, agentRules, desktop?.instructions].filter(Boolean).join('\n\n');
        const params = { cwd: options.workingDirectory, model: options.model, permissions: nativePermissionId(options.permissionMode) || undefined,
            config: { model_verbosity: getReplyPreference(options.sessionId).verbosity, developer_instructions: developerInstructions,
                'mcp_servers.bigacli-browser': browserUseService.getAgentMcpConfig(), ...(desktop ? { 'mcp_servers.bigacli-desktop': desktop.config } : {}) } };
        let result;
        if (options.handoff) {
            try {
                try {
                    result = await request('thread/fork', { ...params, threadId });
                } catch (error) {
                    if (signal?.aborted || !/active writer|\bhistory\b|\bordinal\b|corrupt/i.test(error.message)) throw error;
                    const items = await readHandoffItems(options.transcriptPath);
                    result = await request('thread/start', params);
                    await request('thread/inject_items', { threadId: result.thread.id, items });
                }
                await options.onThreadReady?.(result.thread);
            } catch (error) {
                if (result?.thread?.id) await request('thread/archive', { threadId: result.thread.id }).catch(() => {});
                throw error;
            }
        } else {
            result = await request(threadId ? 'thread/resume' : 'thread/start', { ...params, ...(threadId ? { threadId } : {}) });
            await options.onThreadReady?.(result.thread);
        }
        if (signal?.aborted) { const error = new Error('Codex turn aborted'); error.name = 'AbortError'; throw error; }
        desktop?.update(result);
        threadId = result.thread.id;
        yield { type: 'thread.started', thread_id: threadId };
        const userInput = typeof input === 'string' ? [{ type: 'text', text: input }] : input.map(item => item.type === 'local_image' ? { type: 'localImage', path: item.path } : { type: 'text', text: item.text });
        const started = await request('turn/start', { threadId, input: userInput, serviceTierForTurn: options.serviceTier || 'default', ...(options.modelReasoningEffort ? { effort: options.modelReasoningEffort } : {}), summary: 'auto' });
        turnId ||= started.turn?.id;
        activeTurns.set(options.sessionId, input => {
            if (finished || failure || closed || !turnId) throw new AppError('当前任务已经结束，请正常发送消息。', {code:'NO_ACTIVE_TURN',statusCode:409});
            return request('turn/steer', { threadId, expectedTurnId: turnId, input });
        });
        while (true) {
            if (failure) throw failure;
            if (queue.length) { yield queue.shift(); continue; }
            if (finished) break;
            await new Promise(resolve => { wake = resolve; });
        }
    } finally {
        desktop?.close();
        activeTurns.delete(options.sessionId);
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
