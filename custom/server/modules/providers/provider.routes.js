import express from 'express';
import { flattenAccountInfo, readQuotaUsage, readRecoveryAccounts, recoveryState, recoverPendingAccounts, isRecoverySwitching, pauseRecovery, scheduleRecovery, scheduleDefaultRecovery, checkRecoveryTicket } from './services/codex-recovery.service.js';
import { steerCodexTurn } from './services/codex-stream.service.js';
import { filterAttachmentsToUploadStore } from '../websocket/services/chat-websocket.service.js';
import { appendFilesInputTag, buildCodexInputItems, isImageAttachmentDescriptor, normalizeAttachmentDescriptors } from '../../shared/image-attachments.js';
import { readConversationStatus } from '../bigacli/conversation-status.service.js';
import bigaWorkspaceRoutes from '../bigacli/workspaces.routes.js';
import { getAccountNotes, mergeAccountNotes } from '../bigacli/preferences.service.js';
import { providerAuthService } from '../../modules/providers/services/provider-auth.service.js';
import { readCodexRateLimits, consumeCodexRateLimitReset } from './services/codex-rate-limits.service.js';
import { readCodexAccountInfo } from './services/codex-account-info.service.js';
import { readCodexModelCatalog } from './services/codex-models.service.js';
import { listCodexAccounts, createCodexAccount, deleteCodexAccount, getSessionCodexAccountConfig, setSessionCodexAccountConfig, setSessionCodexMode, recordCodexThreadAccount } from './services/codex-account.service.js';
import { chatRunRegistry } from '../websocket/services/chat-run-registry.service.js';
import { sessionsDb, sessionDraftsDb } from '../database/index.js';
import { prepareQueueSend } from '../scheduled-messages/services/queued-message.service.js';
import { providerCapabilitiesService } from '../../modules/providers/services/provider-capabilities.service.js';
import { providerMcpService } from '../../modules/providers/services/mcp.service.js';
import { providerModelsService } from '../../modules/providers/services/provider-models.service.js';
import { providerTokenUsageService } from '../../modules/providers/services/provider-token-usage.service.js';
import { providerSkillsService } from '../../modules/providers/services/skills.service.js';
import { sessionConversationsSearchService } from '../../modules/providers/services/session-conversations-search.service.js';
import { sessionsService } from '../../modules/providers/services/sessions.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '../../shared/utils.js';
const router = express.Router();
router.post('/codex/sessions/:sessionId/steer', asyncHandler(async (req, res) => {
    const sessionId = String(req.params.sessionId), session = sessionsDb.getSessionById(sessionId);
    if (!session || session.provider !== 'codex') throw new AppError('Codex session not found.', { code: 'SESSION_NOT_FOUND', statusCode: 404 });
    const text = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const supplied = normalizeAttachmentDescriptors(req.body?.attachments);
    const attachments = filterAttachmentsToUploadStore(supplied);
    if (attachments.length !== supplied.length) throw new AppError('附件路径无效，请重新上传。', { code: 'INVALID_ATTACHMENT', statusCode: 400 });
    if (!text && !attachments.length) throw new AppError('请输入引导消息。', { code: 'CONTENT_REQUIRED', statusCode: 400 });
    const run = chatRunRegistry.getRun(sessionId);
    if (run?.status !== 'running') throw new AppError('当前任务已经结束，请正常发送消息。', { code: 'NO_ACTIVE_TURN', statusCode: 409 });
    const completeQueueSend = prepareQueueSend(sessionDraftsDb, req.user?.id ?? req.user?.userId, sessionId, req.body?.queueItem);
    const prompt = appendFilesInputTag(text, attachments.filter(a => !isImageAttachmentDescriptor(a)));
    const input = buildCodexInputItems(prompt, attachments.filter(isImageAttachmentDescriptor), session.project_path)
        .map(item => item.type === 'local_image' ? { type: 'localImage', path: item.path } : item);
    const result = await steerCodexTurn(sessionId, input, () => chatRunRegistry.getRun(sessionId) === run && run.status === 'running');
    completeQueueSend();
    run.writer.send({ kind: 'text', role: 'user', content: text || '发送附件', attachments, steering: true, sentQueueIds: req.body?.queueItem ? [req.body.queueItem.itemId] : undefined, timestamp: new Date().toISOString() });
    res.json(createApiSuccessResponse(result));
}));
router.get('/codex/sessions/:sessionId/status', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await readConversationStatus(String(req.params.sessionId))));
}));
router.use('/biga', bigaWorkspaceRoutes);

router.get('/codex/rate-limits', asyncHandler(async (req, res) => {
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : 'default';
  try {
    const data=await readCodexRateLimits(8000, accountId);
    res.json(createApiSuccessResponse({...data,quotaState:readQuotaUsage(data)}));
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Codex 额度读取失败', {
      code: 'CODEX_RATE_LIMITS_FAILED',
      statusCode: 502,
    });
  }
}));
router.post('/codex/rate-limits/reset', asyncHandler(async (req, res) => {
    const { accountId, idempotencyKey } = req.body || {};
    if (typeof accountId !== 'string' || !accountId.trim() || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw new AppError('账号和重置请求编号不能为空。', { code: 'INVALID_RESET_REQUEST', statusCode: 400 });
    }
    if (req.body.recoveryTicket !== undefined) {
        checkRecoveryTicket(req.body.recoveryTicket);
        if (isRecoverySwitching() || getSessionCodexAccountConfig().currentAccountId !== accountId) throw new AppError('当前账号已变化，请重新查询', { statusCode:409 });
    }
    res.json(createApiSuccessResponse(await consumeCodexRateLimitReset(accountId, idempotencyKey)));
}));
router.get('/codex/accounts', asyncHandler(async (_req,res)=>{
    const accounts=listCodexAccounts();
    const enriched=await Promise.all(accounts.map(async a=>{
        try{const info=flattenAccountInfo(await readCodexAccountInfo(a.id));return {...a,...info}}catch{return {...a,email:null,planType:null,authenticated:false}}
    }));
    res.json(createApiSuccessResponse(enriched));
}));
router.post('/codex/accounts', asyncHandler(async (_req,res)=>res.json(createApiSuccessResponse(await createCodexAccount()))));
router.get('/codex/accounts/current', asyncHandler(async (req,res)=>res.json(createApiSuccessResponse(getSessionCodexAccountConfig(readOptionalQueryString(req.query.sessionId))))));
router.post('/codex/accounts/current', asyncHandler(async (req,res)=>{
    if (isRecoverySwitching()) throw new AppError('Account recovery is in progress.', { statusCode:409 });
    if (chatRunRegistry.listRunningRuns().some(r => r.provider === 'codex')) throw new AppError('任务运行中，结束后才能切换账号。', {statusCode:409});
    if (!listCodexAccounts().some(a => a.id === req.body?.accountId)) throw new AppError('账号不存在。', {statusCode:404});
    if (!req.body?.modeOnly) pauseRecovery();
    res.json(createApiSuccessResponse(setSessionCodexAccountConfig(undefined,{accountId:String(req.body?.accountId||''),mode:req.body?.mode})));
}));
router.delete('/codex/accounts/:accountId', asyncHandler(async (req,res)=>{deleteCodexAccount(String(req.params.accountId));res.json(createApiSuccessResponse({deleted:true}))}));
router.get('/codex/accounts/session/:sessionId', asyncHandler(async (req,res)=>res.json(createApiSuccessResponse(getSessionCodexAccountConfig(String(req.params.sessionId))))));
router.post('/codex/accounts/session/:sessionId', asyncHandler(async (req,res)=>{
    const sessionId=String(req.params.sessionId); const session=sessionsDb.getSessionById(sessionId);
    if(!session||session.provider!=='codex')throw new AppError('Codex session not found.',{code:'SESSION_NOT_FOUND',statusCode:404});
    if(chatRunRegistry.isProcessing(sessionId))throw new AppError('任务运行中，停止后才能切换 Codex 账号。',{code:'RUN_IN_PROGRESS',statusCode:409});
    const accountId=String(req.body?.accountId||''); const mode=req.body?.mode;
    if (isRecoverySwitching() || chatRunRegistry.listRunningRuns().some(r => r.provider === 'codex')) throw new AppError('任务运行中，结束后才能切换账号。', {statusCode:409});
    if (!listCodexAccounts().some(a => a.id === accountId)) throw new AppError('账号不存在。', {statusCode:404});
    pauseRecovery();
    res.json(createApiSuccessResponse(setSessionCodexAccountConfig(sessionId,{accountId,mode})));
}));
router.post('/codex/accounts/session/:sessionId/mode', asyncHandler(async (req,res)=>{
    const sessionId=String(req.params.sessionId); if(chatRunRegistry.isProcessing(sessionId))throw new AppError('任务运行中，停止后才能修改账号模式。',{code:'RUN_IN_PROGRESS',statusCode:409});
    res.json(createApiSuccessResponse(setSessionCodexMode(sessionId,String(req.body?.mode||'manual'))));
}));
router.get('/codex/accounts/session/:sessionId/recovery-options', asyncHandler(async (req,res)=>{
    const sessionId=String(req.params.sessionId), config=getSessionCodexAccountConfig(sessionId);
    const pending=recoveryState().sessionIds;
    const ticket = recoveryState().ticket;
    res.json(createApiSuccessResponse({config,ticket,accounts:await readRecoveryAccounts(pending.length?pending:[sessionId])}));
}));
router.post('/codex/accounts/recovery', asyncHandler(async (req,res)=>{
    const { action, accountId, ticket } = req.body || {};
    checkRecoveryTicket(ticket);
    if (action === 'schedule') await scheduleRecovery(String(accountId || ''), ticket);
    else if (action === 'schedule-default') await scheduleDefaultRecovery(ticket);
    else if (action === 'resume') await recoverPendingAccounts(String(accountId || ''), ticket);
    else if (action === 'cancel') pauseRecovery();
    else throw new AppError('无效操作。', {statusCode:400});
    res.json(createApiSuccessResponse(recoveryState()));
}));
const readPathParam = (value, name) => {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
    }
    throw new AppError(`${name} path parameter is invalid.`, {
        code: 'INVALID_PATH_PARAMETER',
        statusCode: 400,
    });
};
const normalizeProviderParam = (value) => readPathParam(value, 'provider').trim().toLowerCase();
const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;
const parseSessionId = (value) => {
    const sessionId = readPathParam(value, 'sessionId').trim();
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new AppError('Invalid sessionId.', {
            code: 'INVALID_SESSION_ID',
            statusCode: 400,
        });
    }
    return sessionId;
};
const readOptionalQueryString = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
};
const parseOptionalBooleanQuery = (value, name) => {
    if (value === undefined) {
        return undefined;
    }
    const normalized = readOptionalQueryString(value);
    if (!normalized) {
        return undefined;
    }
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }
    throw new AppError(`${name} must be "true" or "false".`, {
        code: 'INVALID_QUERY_PARAMETER',
        statusCode: 400,
    });
};
const parseMcpScope = (value) => {
    if (value === undefined) {
        return undefined;
    }
    const normalized = readOptionalQueryString(value);
    if (!normalized) {
        return undefined;
    }
    if (normalized === 'user' || normalized === 'local' || normalized === 'project') {
        return normalized;
    }
    throw new AppError(`Unsupported MCP scope "${normalized}".`, {
        code: 'INVALID_MCP_SCOPE',
        statusCode: 400,
    });
};
const parseMcpTransport = (value) => {
    const normalized = readOptionalQueryString(value);
    if (!normalized) {
        throw new AppError('transport is required.', {
            code: 'MCP_TRANSPORT_REQUIRED',
            statusCode: 400,
        });
    }
    if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
        return normalized;
    }
    throw new AppError(`Unsupported MCP transport "${normalized}".`, {
        code: 'INVALID_MCP_TRANSPORT',
        statusCode: 400,
    });
};
const parseMcpUpsertPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new AppError('Request body must be an object.', {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
        });
    }
    const body = payload;
    const name = readOptionalQueryString(body.name);
    if (!name) {
        throw new AppError('name is required.', {
            code: 'MCP_NAME_REQUIRED',
            statusCode: 400,
        });
    }
    const transport = parseMcpTransport(body.transport);
    const scope = parseMcpScope(body.scope);
    const workspacePath = readOptionalQueryString(body.workspacePath);
    return {
        name,
        transport,
        scope,
        workspacePath,
        command: readOptionalQueryString(body.command),
        args: Array.isArray(body.args) ? body.args.filter((entry) => typeof entry === 'string') : undefined,
        env: typeof body.env === 'object' && body.env !== null
            ? Object.fromEntries(Object.entries(body.env).filter((entry) => typeof entry[1] === 'string'))
            : undefined,
        cwd: readOptionalQueryString(body.cwd),
        url: readOptionalQueryString(body.url),
        headers: typeof body.headers === 'object' && body.headers !== null
            ? Object.fromEntries(Object.entries(body.headers).filter((entry) => typeof entry[1] === 'string'))
            : undefined,
        envVars: Array.isArray(body.envVars)
            ? body.envVars.filter((entry) => typeof entry === 'string')
            : undefined,
        bearerTokenEnvVar: readOptionalQueryString(body.bearerTokenEnvVar),
        envHttpHeaders: typeof body.envHttpHeaders === 'object' && body.envHttpHeaders !== null
            ? Object.fromEntries(Object.entries(body.envHttpHeaders).filter((entry) => typeof entry[1] === 'string'))
            : undefined,
    };
};
const parseProviderSkillCreatePayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new AppError('Request body must be an object.', {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
        });
    }
    const body = payload;
    const rawEntries = Array.isArray(body.entries)
        ? body.entries
        : typeof body.content === 'string'
            ? [{
                    content: body.content,
                    directoryName: body.directoryName,
                    fileName: body.fileName,
                    files: body.files,
                }]
            : null;
    if (!rawEntries || rawEntries.length === 0) {
        throw new AppError('At least one skill entry is required.', {
            code: 'PROVIDER_SKILLS_REQUIRED',
            statusCode: 400,
        });
    }
    const entries = rawEntries.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new AppError(`Skill entry ${index + 1} must be an object.`, {
                code: 'INVALID_REQUEST_BODY',
                statusCode: 400,
            });
        }
        const record = entry;
        const content = typeof record.content === 'string' ? record.content : '';
        const directoryName = readOptionalQueryString(record.directoryName);
        const fileName = readOptionalQueryString(record.fileName);
        const rawFiles = record.files;
        if (!content.trim()) {
            throw new AppError(`Skill entry ${index + 1} must include markdown content.`, {
                code: 'PROVIDER_SKILL_CONTENT_REQUIRED',
                statusCode: 400,
            });
        }
        if (rawFiles !== undefined && !Array.isArray(rawFiles)) {
            throw new AppError(`Skill entry ${index + 1} files must be an array.`, {
                code: 'INVALID_REQUEST_BODY',
                statusCode: 400,
            });
        }
        const files = rawFiles?.map((file, fileIndex) => {
            if (!file || typeof file !== 'object') {
                throw new AppError(`Skill entry ${index + 1} file ${fileIndex + 1} must be an object.`, {
                    code: 'INVALID_REQUEST_BODY',
                    statusCode: 400,
                });
            }
            const fileRecord = file;
            const relativePath = readOptionalQueryString(fileRecord.relativePath);
            const fileContent = typeof fileRecord.content === 'string' ? fileRecord.content : null;
            const encoding = fileRecord.encoding === 'utf8' || fileRecord.encoding === 'base64'
                ? fileRecord.encoding
                : null;
            if (!relativePath || fileContent === null || !encoding) {
                throw new AppError(`Skill entry ${index + 1} file ${fileIndex + 1} requires relativePath, content, and encoding.`, {
                    code: 'INVALID_REQUEST_BODY',
                    statusCode: 400,
                });
            }
            return {
                relativePath,
                content: fileContent,
                encoding,
            };
        });
        return {
            content,
            directoryName,
            fileName,
            files,
        };
    });
    return { entries };
};
const parseProvider = (value) => {
    const normalized = normalizeProviderParam(value);
    if (normalized === 'claude'
        || normalized === 'codex'
        || normalized === 'cursor'
        || normalized === 'opencode') {
        return normalized;
    }
    throw new AppError(`Unsupported provider "${normalized}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
    });
};
const parseSessionRenameSummary = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new AppError('Request body must be an object.', {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
        });
    }
    const body = payload;
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!summary) {
        throw new AppError('Summary is required.', {
            code: 'INVALID_SESSION_SUMMARY',
            statusCode: 400,
        });
    }
    if (summary.length > 500) {
        throw new AppError('Summary must not exceed 500 characters.', {
            code: 'INVALID_SESSION_SUMMARY',
            statusCode: 400,
        });
    }
    return summary;
};
const parseSessionSearchQuery = (value) => {
    const query = readOptionalQueryString(value) ?? '';
    if (query.length < 2) {
        throw new AppError('Query must be at least 2 characters', {
            code: 'INVALID_SEARCH_QUERY',
            statusCode: 400,
        });
    }
    return query;
};
const parseSessionSearchLimit = (value) => {
    const raw = readOptionalQueryString(value);
    if (!raw) {
        return 50;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
        throw new AppError('limit must be a valid integer.', {
            code: 'INVALID_QUERY_PARAMETER',
            statusCode: 400,
        });
    }
    return Math.max(1, Math.min(parsed, 100));
};
const parseBoundedIntegerQuery = (value, name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
    const raw = readOptionalQueryString(value);
    if (raw === undefined) {
        return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new AppError(`${name} must be an integer between ${minimum} and ${maximum}.`, {
            code: 'INVALID_QUERY_PARAMETER',
            statusCode: 400,
        });
    }
    return parsed;
};
const parseSessionModelPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new AppError('Request body must be an object.', {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
        });
    }
    const body = payload;
    const model = readOptionalQueryString(body.model);
    if (!model) {
        throw new AppError('model is required.', {
            code: 'MODEL_REQUIRED',
            statusCode: 400,
        });
    }
    return model;
};
const parseSessionEffortPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new AppError('Request body must be an object.', {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
        });
    }
    const body = payload;
    const effort = readOptionalQueryString(body.effort);
    if (!effort) {
        throw new AppError('effort is required.', {
            code: 'EFFORT_REQUIRED',
            statusCode: 400,
        });
    }
    if (effort.length > 32) {
        throw new AppError('effort must be 32 characters or fewer.', {
            code: 'INVALID_EFFORT',
            statusCode: 400,
        });
    }
    return effort;
};
const parseModelRecordId = (value) => {
    const rawRecordId = readPathParam(value, 'recordId').trim();
    if (!/^\d+$/.test(rawRecordId)) {
        throw new AppError('recordId must be a positive integer.', {
            code: 'INVALID_MODEL_RECORD_ID',
            statusCode: 400,
        });
    }
    const recordId = Number.parseInt(rawRecordId, 10);
    if (!Number.isSafeInteger(recordId) || recordId < 1) {
        throw new AppError('recordId must be a positive integer.', {
            code: 'INVALID_MODEL_RECORD_ID',
            statusCode: 400,
        });
    }
    return recordId;
};
const parseCustomProviderModelPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new AppError('Request body must be an object.', {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
        });
    }
    const body = payload;
    const model = readOptionalQueryString(body.model);
    const id = readOptionalQueryString(body.id);
    if (!model) {
        throw new AppError('model is required.', {
            code: 'MODEL_NAME_REQUIRED',
            statusCode: 400,
        });
    }
    if (!id) {
        throw new AppError('id is required.', {
            code: 'MODEL_ID_REQUIRED',
            statusCode: 400,
        });
    }
    if (model.length > 80) {
        throw new AppError('model must be 80 characters or fewer.', {
            code: 'MODEL_NAME_TOO_LONG',
            statusCode: 400,
        });
    }
    if (id.length > 200 || /\s/.test(id)) {
        throw new AppError('id must be 200 characters or fewer and cannot contain whitespace.', {
            code: 'INVALID_MODEL_ID',
            statusCode: 400,
        });
    }
    return { model, id };
};
router.get('/:provider/auth/status', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const status = await providerAuthService.getProviderAuthStatus(provider);
    res.json(createApiSuccessResponse(status));
}));
router.get('/:provider/models', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = readOptionalQueryString(req.query.sessionId);
    const accountId = provider === 'codex' && sessionId ? getSessionCodexAccountConfig(sessionId).currentAccountId : readOptionalQueryString(req.query.accountId) || 'default';
    const models = provider === 'codex'
        ? await readCodexModelCatalog(accountId)
        : await providerModelsService.getProviderModels(provider);
    res.json(createApiSuccessResponse({ provider, models }));
}));
router.post('/:provider/models', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const input = parseCustomProviderModelPayload(req.body);
    const result = await providerModelsService.createCustomModel(provider, input);
    res.status(201).json(createApiSuccessResponse({ provider, ...result }));
}));
router.patch('/:provider/models/:recordId', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const recordId = parseModelRecordId(req.params.recordId);
    const input = parseCustomProviderModelPayload(req.body);
    const result = await providerModelsService.updateCustomModel(provider, recordId, input);
    res.json(createApiSuccessResponse({ provider, ...result }));
}));
router.delete('/:provider/models/:recordId', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const recordId = parseModelRecordId(req.params.recordId);
    const result = await providerModelsService.deleteCustomModel(provider, recordId);
    res.json(createApiSuccessResponse({ provider, ...result }));
}));
/**
 * Reports which model one session is using. `requestedModel` lets the client
 * pass the default it would otherwise send, so a session that has not been
 * sent on yet resolves to that instead of the catalog default.
 */
router.get('/:provider/sessions/:sessionId/active-model', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const requestedModel = readOptionalQueryString(req.query.requestedModel);
    const result = await providerModelsService.resolveSessionModel(provider, {
        sessionId,
        requestedModel,
    });
    res.json(createApiSuccessResponse(result));
}));
router.post('/:provider/sessions/:sessionId/active-model', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const model = parseSessionModelPayload(req.body);
    const stored = providerModelsService.setSessionModel(provider, sessionId, model);
    // A session row only exists once the gateway has allocated one. Report the
    // selection back either way so the client can hold it until the first send.
    res.json(createApiSuccessResponse(stored ?? { provider, sessionId, model, effort: null, source: 'session' }));
}));
/** Records the reasoning-effort choice for one app session. */
router.post('/:provider/sessions/:sessionId/active-effort', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const effort = parseSessionEffortPayload(req.body);
    const stored = providerModelsService.setSessionEffort(provider, sessionId, effort);
    // Mirror active-model behavior for a composer that picked an effort just
    // before the session gateway created its row.
    res.json(createApiSuccessResponse(stored ?? { provider, sessionId, effort, source: 'session' }));
}));
// ----------------- Skills routes -----------------
router.get('/:provider/skills', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const skills = await providerSkillsService.listProviderSkills(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, skills }));
}));
router.post('/:provider/skills', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const input = parseProviderSkillCreatePayload(req.body);
    const skills = await providerSkillsService.addProviderSkills(provider, input);
    res.json(createApiSuccessResponse({ provider, skills }));
}));
router.delete('/:provider/skills/:directoryName', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const result = await providerSkillsService.removeProviderSkill(provider, {
        directoryName: readPathParam(req.params.directoryName, 'directoryName'),
    });
    res.json(createApiSuccessResponse(result));
}));
// ----------------- MCP routes -----------------
router.get('/:provider/mcp/servers', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const scope = parseMcpScope(req.query.scope);
    if (scope) {
        const servers = await providerMcpService.listProviderMcpServersForScope(provider, scope, { workspacePath });
        res.json(createApiSuccessResponse({ provider, scope, servers }));
        return;
    }
    const groupedServers = await providerMcpService.listProviderMcpServers(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, scopes: groupedServers }));
}));
router.post('/:provider/mcp/servers', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseMcpUpsertPayload(req.body);
    const server = await providerMcpService.upsertProviderMcpServer(provider, payload);
    res.status(201).json(createApiSuccessResponse({ server }));
}));
router.delete('/:provider/mcp/servers/:name', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const result = await providerMcpService.removeProviderMcpServer(provider, {
        name: readPathParam(req.params.name, 'name'),
        scope,
        workspacePath,
    });
    res.json(createApiSuccessResponse(result));
}));
router.post('/mcp/servers/global', asyncHandler(async (req, res) => {
    const payload = parseMcpUpsertPayload(req.body);
    if (payload.scope === 'local') {
        throw new AppError('Global MCP add supports only "user" or "project" scopes.', {
            code: 'INVALID_GLOBAL_MCP_SCOPE',
            statusCode: 400,
        });
    }
    const results = await providerMcpService.addMcpServerToAllProviders({
        ...payload,
        scope: payload.scope === 'user' ? 'user' : 'project',
    });
    res.status(201).json(createApiSuccessResponse({ results }));
}));
router.get('/capabilities', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({
        providers: providerCapabilitiesService.listAllProviderCapabilities(),
    }));
}));
router.get('/:provider/capabilities', asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider);
    res.json(createApiSuccessResponse(providerCapabilitiesService.getProviderCapabilities(provider)));
}));
// ----------------- Session routes -----------------
/**
 * Session gateway entry point: allocates the stable app-facing session id for
 * a brand-new chat. The frontend must call this before the first `chat.send`
 * so the session id in the URL, the store, and the websocket all agree from
 * the very first message — there is no client-visible session-id handoff.
 */
router.post('/sessions', asyncHandler(async (req, res) => {
    const body = (req.body ?? {});
    const provider = parseProvider(body.provider);
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
    const initialMessage = typeof body.initialMessage === 'string' ? body.initialMessage : '';
    const result = sessionsService.createAppSession(provider, projectPath, initialMessage);
    if (initialMessage.trim()) {
        result.sessionName = initialMessage.trim().slice(0, 500);
        sessionsService.renameSessionById(result.sessionId, result.sessionName);
    }
    res.status(201).json(createApiSuccessResponse(result));
}));
router.get('/sessions/running', asyncHandler(async (_req, res) => {
    const sessions = sessionsService.listRunningSessions();
    res.json(createApiSuccessResponse({ sessions }));
}));
router.get('/sessions/recent', asyncHandler(async (req, res) => {
    const limit = parseBoundedIntegerQuery(req.query.limit, 'limit', 40, 1, 100);
    const offset = parseBoundedIntegerQuery(req.query.offset, 'offset', 0, 0);
    const page = sessionsService.listRecentSessions(limit, offset);
    res.json(createApiSuccessResponse(page));
}));
router.get('/sessions/archived', asyncHandler(async (_req, res) => {
    const sessions = sessionsService.listArchivedSessions();
    res.json(createApiSuccessResponse({ sessions }));
}));
router.get('/sessions/:sessionId/provider-id', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const providerSessionId = sessionsService.getProviderSessionId(sessionId);
    res.json(createApiSuccessResponse({ sessionId: providerSessionId }));
}));
router.get('/sessions/:sessionId/token-usage', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await providerTokenUsageService.getSessionTokenUsage(sessionId);
    res.json(createApiSuccessResponse(result));
}));
// Must stay registered after the static and session-specific routes so their
// literals never match the generic `:sessionId` parameter.
router.get('/sessions/:sessionId', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = sessionsService.getSessionDetailsById(sessionId);
    res.json(createApiSuccessResponse(result));
}));
router.delete('/sessions/:sessionId', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const force = parseOptionalBooleanQuery(req.query.force, 'force') ?? false;
    const deletedFromDisk = parseOptionalBooleanQuery(req.query.deletedFromDisk, 'deletedFromDisk') ?? force;
    const result = await sessionsService.deleteOrArchiveSessionById(sessionId, {
        force,
        deletedFromDisk,
    });
    res.json(createApiSuccessResponse(result));
}));
router.post('/sessions/:sessionId/restore', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = sessionsService.restoreSessionById(sessionId);
    res.json(createApiSuccessResponse(result));
}));
router.post('/sessions/:sessionId/fork', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await sessionsService.forkSessionById(sessionId);
    if (result.provider === 'codex') {
        const config = getSessionCodexAccountConfig(sessionId);
        recordCodexThreadAccount(result.sessionId, config.threadAccountId);
    }
    res.status(201).json(createApiSuccessResponse(result));
}));
router.put('/sessions/:sessionId', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const summary = parseSessionRenameSummary(req.body);
    const result = sessionsService.renameSessionById(sessionId, summary);
    res.json(createApiSuccessResponse(result));
}));
router.get('/sessions/:sessionId/messages', asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const limit = parseBoundedIntegerQuery(req.query.limit, 'limit', null, 0);
    const offset = parseBoundedIntegerQuery(req.query.offset, 'offset', 0, 0);
    const result = await sessionsService.fetchHistory(sessionId, {
        limit: req.query.visible === 'true' ? null : limit,
        offset: req.query.visible === 'true' ? 0 : offset,
    });
    if (req.query.visible === 'true') {
        const messages = mergeAccountNotes(result.messages, getAccountNotes(sessionId)).filter(m =>
            m.kind !== 'tool_result' &&
            (req.query.tools === 'true' || !(['tool_use', 'tool_result', 'tool'].includes(m.kind ?? m.type) || m.isToolUse)) &&
            (req.query.thinking === 'true' || !(m.kind === 'thinking' || m.isThinking || m.reasoning)));
        const previousTotal = parseBoundedIntegerQuery(req.query.total, 'total', messages.length, 0);
        const adjustedOffset = offset + Math.max(0, messages.length - previousTotal);
        const end = Math.max(0, messages.length - adjustedOffset);
        const start = limit === null ? 0 : Math.max(0, end - limit);
        return res.json(createApiSuccessResponse({ ...result, messages: messages.slice(start, end),
            total: messages.length, offset: adjustedOffset, limit, hasMore: start > 0 }));
    }
    res.json(createApiSuccessResponse(result));
}));
router.get('/search/sessions', asyncHandler(async (req, res) => {
    const query = parseSessionSearchQuery(req.query.q);
    const limit = parseSessionSearchLimit(req.query.limit);
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    let closed = false;
    const abortController = new AbortController();
    req.on('close', () => {
        closed = true;
        abortController.abort();
    });
    try {
        await sessionConversationsSearchService.search({
            query,
            limit,
            signal: abortController.signal,
            onTitleResults: (titleResults) => {
                if (!closed) {
                    res.write(`event: title-results\ndata: ${JSON.stringify({ titleResults })}\n\n`);
                }
            },
            onProgress: ({ projectResult, totalMatches, scannedProjects, totalProjects }) => {
                if (closed) {
                    return;
                }
                if (projectResult) {
                    res.write(`event: result\ndata: ${JSON.stringify({ projectResult, totalMatches, scannedProjects, totalProjects })}\n\n`);
                    return;
                }
                res.write(`event: progress\ndata: ${JSON.stringify({ totalMatches, scannedProjects, totalProjects })}\n\n`);
            },
        });
        if (!closed) {
            res.write('event: done\ndata: {}\n\n');
        }
    }
    catch (error) {
        console.error('Error searching conversations:', error);
        if (!closed) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
        }
    }
    finally {
        if (!closed) {
            res.end();
        }
    }
}));
export default router;
//# sourceMappingURL=provider.routes.js.map
