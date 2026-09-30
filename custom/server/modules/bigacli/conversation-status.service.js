import fs from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { sessionsDb } from '../database/index.js';
import { AppError } from '../../shared/utils.js';
import { getCodexAccount, getSessionCodexAccountConfig } from '../providers/services/codex-account.service.js';
import { readCodexAccountInfo } from '../providers/services/codex-account-info.service.js';
import { readCodexRateLimits } from '../providers/services/codex-rate-limits.service.js';

// Read the native record, never infer an executed configuration from composer selections.
export async function readRecordedStatus(file) {
  const result = { latest: null, usage: null, codexVersion: null };
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!/"type"\s*:\s*"(?:session_meta|turn_context|event_msg)"/.test(line)) continue;
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      const p = entry.payload;
      if (entry.type === 'session_meta') result.codexVersion = p?.cli_version ?? null;
      if (entry.type === 'turn_context') result.latest = {
        timestamp: entry.timestamp, model: p.model ?? null, effort: p.effort ?? null,
        cwd: p.cwd ?? null, approval: p.approval_policy ?? null,
        sandbox: p.sandbox_policy?.type ?? null, serviceTier: p.service_tier ?? null,
      };
      if (entry.type === 'event_msg' && p?.type === 'token_count' && p.info) {
        result.usage = { timestamp: entry.timestamp, contextUsed: p.info.last_token_usage?.total_tokens ?? null,
          contextWindow: p.info.model_context_window ?? null, input: p.info.total_token_usage?.input_tokens ?? null,
          cachedInput: p.info.total_token_usage?.cached_input_tokens ?? null,
          output: p.info.total_token_usage?.output_tokens ?? null,
          reasoning: p.info.total_token_usage?.reasoning_output_tokens ?? null };
      }
    }
  } finally { lines.close(); stream.destroy(); }
  return result;
}

export async function readConversationStatus(sessionId) {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session || session.provider !== 'codex') throw new AppError('Codex 对话不存在。', { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  const config = getSessionCodexAccountConfig(sessionId);
  const account = getCodexAccount(config.currentAccountId);
  if (!account) throw new AppError('当前对话的账号不存在。', { code: 'ACCOUNT_NOT_FOUND', statusCode: 404 });
  const threadId = session.provider_session_id || sessionId;
  let file = session.jsonl_path && fs.existsSync(session.jsonl_path) ? session.jsonl_path : null;
  if (!file && !sessionsDb.isProviderSessionSuperseded(sessionId, 'codex') && /^[a-zA-Z0-9-]+$/.test(threadId)) {
    for await (const match of glob('**/*' + threadId + '.jsonl', { cwd: path.join(account.codexHome, 'sessions') })) {
      file = path.join(account.codexHome, 'sessions', match); break;
    }
  }
  const [record, identity, quota] = await Promise.allSettled([
    file ? readRecordedStatus(file) : Promise.resolve({ latest: null, usage: null, codexVersion: null }),
    readCodexAccountInfo(account.id), readCodexRateLimits(8000, account.id),
  ]);
  const info = identity.status === 'fulfilled' ? identity.value.account : null;
  return {
    sessionId, threadId, workingDirectory: session.project_path ?? null,
    account: { label: account.label, plan: info?.planType ?? null, authenticated: info ? true : identity.status === 'fulfilled' ? false : null },
    ...(record.status === 'fulfilled' ? record.value : { latest: null, usage: null, recordError: '无法读取对话记录。' }),
    quota: quota.status === 'fulfilled' ? quota.value : null,
    accountError: identity.status === 'rejected' ? '账号状态读取失败。' : null,
    quotaError: quota.status === 'rejected' ? '额度读取失败。' : null,
  };
}
