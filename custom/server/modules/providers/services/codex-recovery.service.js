import { getPendingRecoveries, setPendingRecoveries, saveAccountNote } from '../../bigacli/preferences.service.js';
import { listCodexAccounts, getSessionCodexAccountConfig, setSessionCodexAccountConfig } from './codex-account.service.js';
import { readCodexAccountInfo } from './codex-account-info.service.js';
import { readCodexRateLimits } from './codex-rate-limits.service.js';
import { readCodexModels } from './codex-models.service.js';
import { sessionsDb, sessionDraftsDb } from '../../database/index.js';
import { chatRunRegistry } from '../../websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '../../websocket/services/websocket-state.service.js';
import { AppError } from '../../../shared/utils.js';
import { queueItems, queueWithItems } from '../../scheduled-messages/services/queued-message.service.js';

let switching = false;
let reason = '';
export function flattenAccountInfo(raw) {
  const account = raw?.account ?? raw?.data?.account ?? null;
  return { email: account?.email || null, planType: account?.planType || account?.plan_type || null, authenticated: Boolean(account && typeof account === 'object') };
}
function supports(models, session) {
  const model = session.model ? models.find(m => m.id === session.model || m.model === session.model) : models.find(m => m.isDefault);
  if (!model || model.hidden) return false;
  const effort = String(session.effort || 'default').toLowerCase().replace(/^extra[_-]high$/, 'xhigh');
  return effort === 'default' || (model.supportedReasoningEfforts || []).some(e => (typeof e === 'string' ? e : e.reasoningEffort) === effort);
}
export function readQuotaUsage(raw) {
  const buckets = raw?.rateLimitsByLimitId || raw?.rate_limits_by_limit_id || {};
  let usedPercent = null, weeklyUsedPercent = null, resetAt = null, weeklyResetAt = null;
  const snapshot=buckets.codex || raw?.rateLimits || raw?.rate_limits;
  const windows=[snapshot?.primary,snapshot?.secondary].filter(w=>w!=null);
  const valid=windows.length>0&&windows.every(w=>typeof (w.usedPercent??w.used_percent)==='number'&&Number.isFinite(w.usedPercent??w.used_percent)&&(w.usedPercent??w.used_percent)>=0&&[300,10080].includes(Number(w.windowDurationMins??w.window_duration_mins)));
  for (const c of [snapshot].filter(Boolean)) {
    for (const w of [c.primary, c.secondary, c]) {
      const mins = Number(w?.windowDurationMins ?? w?.window_duration_mins), value = w?.usedPercent ?? w?.used_percent;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      const reset = Number(w.resetsAt ?? w.resets_at), at = Number.isFinite(reset) && reset > 0 ? (reset < 1e12 ? reset * 1000 : reset) : null;
      if (mins === 300) { usedPercent = Number(value); resetAt = at; }
      if (mins === 10080) { weeklyUsedPercent = Number(value); weeklyResetAt = at; }
    }
  }
  const fiveUnlimited=valid&&weeklyUsedPercent!==null&&!windows.some(w=>Number(w.windowDurationMins??w.window_duration_mins)===300);
  const quotaKnown=valid&&weeklyUsedPercent!==null&&(usedPercent!==null||fiveUnlimited);
  const limited=Boolean(snapshot?.rateLimitReachedType||snapshot?.rate_limit_reached_type||snapshot?.spendControlReached);
  const exhausted = [usedPercent >= 100 ? resetAt : 0, weeklyUsedPercent >= 100 ? weeklyResetAt : 0];
  const availableAt = !quotaKnown||exhausted.some(x=>x===null)?null:Math.max(...exhausted)||null;
  return { usedPercent, weeklyUsedPercent, resetAt, weeklyResetAt, availableAt, fiveUnlimited, quotaKnown, limited };
}
export async function readRecoveryAccounts(sessionIds, accountId) {
  const pending = getPendingRecoveries();
  const sessions = sessionIds.map(id => { const session = sessionsDb.getSessionById(id); return session && { ...session, ...pending[id]?.options }; }).filter(Boolean);
  for (const queued of sessionDraftsDb.listQueuedMessages()) if (sessionIds.includes(queued.sessionId)) {
    const session = sessionsDb.getSessionById(queued.sessionId);
    if (session) sessions.push({ ...session, ...queueItems(queued.queuedMessage)[0]?.options });
  }
  return Promise.all(listCodexAccounts().filter(a => !accountId || a.id === accountId).map(async a => {
    let info = { authenticated: false }, usage = { usedPercent: null, weeklyUsedPercent: null }, models = [];
    try { info = flattenAccountInfo(await readCodexAccountInfo(a.id)); } catch {}
    if (info.authenticated) await Promise.all([
      readCodexRateLimits(8000, a.id).then(raw => { usage = readQuotaUsage(raw); }).catch(() => {}),
      readCodexModels(a.id).then(value => { models = value; }).catch(() => {}),
    ]);
    return { ...a, ...info, ...usage, compatible: info.authenticated && Array.isArray(models) && sessions.every(s => supports(models, s)) };
  }));
}
export function recoveryState() {
  const pending = getPendingRecoveries(), entries = Object.values(pending);
  return { sessionIds: Object.keys(pending), switching, reason: entries.find(p => p.reason)?.reason || reason,
    accountIds: Object.fromEntries(Object.entries(pending).map(([id,p]) => [id,p.accountId])),
    currentAccountId: getSessionCodexAccountConfig().currentAccountId,
    ticket: JSON.stringify(Object.entries(pending).map(([id,p]) => [id,p.createdAt || 0])),
    appointment: entries.find(p => p.appointment)?.appointment || null };
}
function fail(message, code = 'RECOVERY_UNAVAILABLE') { throw new AppError(message, { code, statusCode:409 }); }
export function checkRecoveryTicket(ticket) {
  if (!recoveryState().sessionIds.length || ticket !== recoveryState().ticket) fail('恢复状态已变化，请重新选择。', 'RECOVERY_STALE');
}
export function pauseRecovery() {
  const pending = getPendingRecoveries();
  for (const [id,p] of Object.entries(pending)) {
    if (p.appointment) note(id, recoveryText(p.options.uiLanguage, 'cancelled'));
    delete p.appointment; p.paused = true; p.reason = 'manual'; p.createdAt = Math.max(Date.now(), (p.createdAt || 0) + 1);
  }
  setPendingRecoveries(pending); reason = 'manual'; broadcast();
}
export async function changeRecoveryAccount(accountId, mode, ticket) {
  if (ticket !== undefined) checkRecoveryTicket(ticket);
  const pending = getPendingRecoveries();
  if (switching || chatRunRegistry.listRunningRuns().some(r => r.provider === 'codex') || Object.keys(pending).some(id => chatRunRegistry.getRun(id)?.providerSettled === false)) fail('任务运行中，结束后才能切换账号。');
  const config = setSessionCodexAccountConfig(undefined, { accountId, mode });
  for (const p of Object.values(pending)) {
    p.accountId = accountId;
    if (p.appointment) p.appointment = { accountId, label: accountId, at: null };
    p.createdAt = Math.max(Date.now(), (p.createdAt || 0) + 1);
  }
  setPendingRecoveries(pending); broadcast();
  await recoverPendingAccounts(accountId);
  return { ...config, recovery: recoveryState() };
}
function broadcast() {
  const data = JSON.stringify({ kind: 'account_recovery', recovery: recoveryState() });
  for (const client of connectedClients) if (client.readyState === WS_OPEN_STATE) client.send(data);
}
export async function scheduleDefaultRecovery(ticket) {
  checkRecoveryTicket(ticket);
  if (switching) fail('正在切换账号，请稍后再试。');
  const accountId = getSessionCodexAccountConfig().currentAccountId, pending = getPendingRecoveries();
  for (const p of Object.values(pending)) {
    p.appointment = { accountId, label: accountId, at: null };
    p.paused = true; p.reason = ''; p.createdAt = Math.max(Date.now(), (p.createdAt || 0) + 1);
  }
  setPendingRecoveries(pending); reason = ''; broadcast();
  await recoverPendingAccounts(accountId);
  return recoveryState();
}
function note(sessionId, content) {
  const note={ id: 'recovery-' + Date.now(), timestamp: new Date().toISOString(), content, kind:'account_note', role:'system' };
  saveAccountNote(sessionId, note);
  const data=JSON.stringify({...note,sessionId});
  for(const client of connectedClients)if(client.readyState===WS_OPEN_STATE&&client.bigaSessions?.has(sessionId))client.send(data);
}
export function recordAccountLimit(sessionId, userId, accountId, options) {
  const pending = getPendingRecoveries();
  const tried = [...new Set([...(options.bigaRecoveryTried || []), ...(pending[sessionId]?.tried || []), accountId])];
  pending[sessionId] = { userId, accountId, options, tried, createdAt:Date.now() };
  setPendingRecoveries(pending); reason = ''; broadcast();
  note(sessionId, recoveryText(options.uiLanguage, 'limited'));
}
export function cancelRecovery(sessionId) {
  const pending = getPendingRecoveries();
  if (!pending[sessionId]) return false;
  delete pending[sessionId]; setPendingRecoveries(pending); broadcast(); return true;
}
export function recoveryBlocksQueue(sessionId) {
  if (sessionsDb.getSessionById(sessionId)?.provider !== 'codex') return false;
  const pending = getPendingRecoveries();
  return switching || !!pending[sessionId] || Object.values(pending).some(p => p.accountId === getSessionCodexAccountConfig(sessionId).currentAccountId);
}
export function isRecoverySwitching() { return switching; }
function recoveryText(language, kind) {
  const texts = {
    limited: ['额度耗尽，任务已暂停。', 'Usage limit reached. Task paused.', '利用上限に達したため、タスクを中断しました。'],
    resume: ['继续完成中断的任务，并处理下方补充要求（如有）。', 'Continue the unfinished task and address any additional request below.', '中断した作業を再開し、以下に追加の依頼があれば併せて対応してください。'],
    ready: ['额度可用，继续任务。', 'Quota available. Resuming task.', '利用枠が回復しました。タスクを再開します。'],
    scheduled: ['已预约额度恢复后继续任务。', 'Task resume scheduled after quota resets.', '利用枠回復後の再開を予約しました。'],
    cancelled: ['已取消预约，任务保持暂停。', 'Reservation cancelled. Tasks remain paused.', '予約を取り消しました。タスクは中断したままです。'],
    unavailable: ['预约时间已到，但账号额度暂不可用；任务保持暂停，请重新选择。', 'The reservation is due, but quota is not available. Tasks remain paused; select again.', '予約時刻になりましたが利用枠を確認できません。中断したまま再選択してください。'],
  };
  return texts[kind][language === 'en-US' ? 1 : language === 'ja-JP' ? 2 : 0];
}
// The existing dispatcher calls this before claiming any queued messages.
export async function recoverPendingAccounts(accountId, ticket) {
  if (ticket !== undefined) checkRecoveryTicket(ticket);
  const requested = accountId !== undefined;
  if (requested && !accountId) fail('请选择账号。');
  if (switching) { if (requested) fail('正在恢复任务，请稍后再试。'); return; }
  const pending = getPendingRecoveries();
  let removed = false;
  for (const id of Object.keys(pending)) if (!sessionsDb.getSessionById(id)) { delete pending[id]; removed = true; }
  if (removed) setPendingRecoveries(pending);
  const ids = Object.keys(pending);
  if (!ids.length) return;
  const config = getSessionCodexAccountConfig();
  const appointment = Object.values(pending).find(p => p.appointment)?.appointment;
  const cancelled = Object.values(pending).every(p => p.paused && !p.appointment);
  if (!requested) {
    if (appointment) {
      if (appointment.at > Date.now()) return;
      accountId = appointment.accountId;
    } else if (cancelled || config.mode !== 'auto') accountId = config.currentAccountId;
  }
  if (chatRunRegistry.listRunningRuns().some(r => r.provider === 'codex') || ids.some(id => chatRunRegistry.getRun(id)?.providerSettled === false)) {
    reason = 'waiting'; broadcast(); return;
  }
  switching = true; reason = ''; broadcast();
  const snapshot = JSON.stringify(pending);
  let resumed = false;
  try {
    const accounts = await readRecoveryAccounts(ids, accountId);
    if (snapshot !== JSON.stringify(getPendingRecoveries()) || config.currentAccountId !== getSessionCodexAccountConfig().currentAccountId || chatRunRegistry.listRunningRuns().some(r => r.provider === 'codex')) return;
    const tried = new Set(Object.values(pending).flatMap(p => p.tried));
    const eligible = accounts.filter(a => a.authenticated && a.compatible && a.quotaKnown && !a.limited && (a.usedPercent == null || a.usedPercent < 100) && a.weeklyUsedPercent < 100);
    const pick = accountId ? eligible.find(a => a.id === accountId) : eligible.filter(a => !tried.has(a.id)).sort((a,b) => Math.max(a.usedPercent||0,a.weeklyUsedPercent)-Math.max(b.usedPercent||0,b.weeklyUsedPercent))[0];
    if (!pick) {
      const earliest = !accountId && config.mode === 'auto' && !eligible.length
        ? accounts.filter(a => a.authenticated && a.compatible && a.quotaKnown && !a.limited
          && (a.usedPercent >= 100 || a.weeklyUsedPercent >= 100) && Number.isFinite(a.availableAt) && a.availableAt > 0)
          .sort((a,b) => a.availableAt - b.availableAt)[0] : null;
      const targetId = accountId || earliest?.id || config.currentAccountId;
      const account = accounts.find(a => a.id === targetId);
      if (earliest && targetId !== config.currentAccountId) setSessionCodexAccountConfig(undefined, { accountId: targetId });
      const waiting = { accountId: targetId, label: account?.email || account?.label || targetId, at: account?.availableAt ? Math.max(Date.now(), account.availableAt) + 60000 : null };
      for (const p of Object.values(pending)) {
        const autoContinue = !!p.appointment || !p.paused;
        p.accountId = targetId;
        if (autoContinue) {
          p.appointment = waiting;
          p.reason = !accountId && config.mode === 'auto' ? 'auto_unavailable' : (p.reason === 'auto_unavailable' && !requested ? p.reason : 'reservation_failed');
        } else { delete p.appointment; p.reason = 'manual'; }
        p.paused = true;
      }
      setPendingRecoveries(pending);
      return;
    }
    if (pick.id !== config.currentAccountId) setSessionCodexAccountConfig(undefined, { accountId: pick.id });
    for (const id of ids) {
      const entry = pending[id], autoContinue = !!entry.appointment || !entry.paused;
      const draft = sessionDraftsDb.getDrafts(entry.userId).find(d => d.scope === id);
      const queued = draft?.queuedMessage;
      if (autoContinue) {
        sessionDraftsDb.saveDraft(entry.userId, id, { text: draft?.text || '', queuedMessage: {
          ...queueWithItems(queued,queueItems(queued)), paused:false,
          resume:{content:recoveryText(entry.options.uiLanguage, 'resume'),attachments:[],options:{...entry.options,images:[],files:[],attachments:[],bigaQueued:true,bigaRecoveryTried:entry.tried}},
        } });
        resumed = true;
        note(id, recoveryText(entry.options.uiLanguage, 'ready') + ' (' + (pick.email || pick.label || pick.id) + ')');
      } else if (queued) {
        // Unlock manual input without dispatching the old queue or a resume turn.
        sessionDraftsDb.saveDraft(entry.userId, id, { text: draft.text || '', queuedMessage: queueWithItems({...queued, paused:true, resume:null},queueItems(queued)) });
      }
      delete pending[id];
    }
    setPendingRecoveries(pending);
  } catch (error) {
    if (requested) throw error;
    console.error('[BigaCli] Account recovery:', error.message);
  } finally {
    switching = false; broadcast();
    if (requested && resumed) setImmediate(async () => {
      try {
        const [{ dispatchQueuedMessages }, { providerRuntimeService }] = await Promise.all([
          import('../../scheduled-messages/services/scheduled-message-dispatcher.service.js'),
          import('./provider-runtime.service.js'),
        ]);
        await dispatchQueuedMessages(providerRuntimeService);
      } catch (error) { console.error('[BigaCli] Recovery dispatch:', error.message); }
    });
  }
}
