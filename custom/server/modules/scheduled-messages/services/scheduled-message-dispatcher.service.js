import { scheduledMessagesDb, sessionDraftsDb } from '../../../modules/database/index.js';
import { recoverPendingAccounts, recoveryBlocksQueue } from '../../providers/services/codex-recovery.service.js';
import { chatRunRegistry, runDetachedChatTurn } from '../../../modules/websocket/index.js';
import { queueItems, queueWithItems, queuedTurn } from './queued-message.service.js';
/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;
let pollTimer = null;
let dispatchInFlight = false;
function readOptions(raw) {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function readQueuedMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const content = typeof record.content === 'string' ? record.content : '';
    const attachments = Array.isArray(record.attachments)
        ? record.attachments
        : Array.isArray(record.images)
            ? record.images
            : [];
    if (!content.trim() && attachments.length === 0) {
        return null;
    }
    const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options)
        ? record.options
        : {};
    return { content, options, attachments };
}
async function sendClaimedQueuedMessage(candidate, runtime) {
    const original=candidate.queuedMessage;
    const message = readQueuedMessage(queuedTurn(original));
    const remaining=original.resume?queueWithItems({...original,resume:null,paused:false},queueItems(original)):null;
    const draft=sessionDraftsDb.getDrafts(candidate.userId).find(d=>d.scope===candidate.sessionId);
    sessionDraftsDb.saveDraft(candidate.userId,candidate.sessionId,{text:draft?.text || '',queuedMessage:remaining});
    if (!message) {
        sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
        return;
    }
    let result;try{result = await runDetachedChatTurn({
        sessionId: candidate.sessionId,
        userId: candidate.userId,
        content: message.content,
        sentQueueIds: original.resume ? [] : queueItems(original).map(item => item.id),
        options: { ...message.options, attachments: message.attachments },
    }, { runtime });}catch(error){result={started:false,error:error.message}}
    // The registry check and run reservation are separate operations. If a run
    // wins that tiny race, put the turn back so the next poll tries again.
    if (!result.started) {
        const current=sessionDraftsDb.getDrafts(candidate.userId).find(d=>d.scope===candidate.sessionId);
        const retry=['A run was already in progress for this session.','A run is already in progress for this session.','Account recovery is in progress.'].includes(result.error);
        const items=original.resume?queueItems(current?.queuedMessage):[...queueItems(original),...queueItems(current?.queuedMessage)];
        sessionDraftsDb.saveDraft(candidate.userId,candidate.sessionId,{text:current?.text || '',queuedMessage:queueWithItems({...original,...current?.queuedMessage,resume:original.resume,paused:!retry},items)});
        return;
    }
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}
/** Sends every persisted queued turn whose session is currently idle. */
export async function dispatchQueuedMessages(runtime) {
    await recoverPendingAccounts();
    const candidates = sessionDraftsDb.listQueuedMessages();
    let claimed = 0;
    await Promise.all(candidates.map(async (candidate) => {
        const run=chatRunRegistry.getRun(candidate.sessionId);
        if (chatRunRegistry.isProcessing(candidate.sessionId) || run?.providerSettled===false || candidate.queuedMessage?.editing || candidate.queuedMessage?.paused || recoveryBlocksQueue(candidate.sessionId)) {
            return;
        }
        if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
            return;
        }
        claimed += 1;
        await sendClaimedQueuedMessage(candidate, runtime);
    }));
    return claimed;
}
async function sendClaimedMessage(row, runtime) {
    try {
        const result = await runDetachedChatTurn({
            sessionId: row.session_id,
            userId: row.user_id,
            content: row.content,
            options: readOptions(row.options),
            // The user picked this time on purpose; a run that happens to be going
            // is aborted so the scheduled message lands when it was due, instead
            // of being recorded as "not sent — session was busy".
            interruptActiveRun: true,
        }, { runtime });
        // Recorded rather than retried, and recorded whether the run never started
        // (deleted session, unavailable provider) or started and then failed.
        // Silently dropping a message the user scheduled is worse than telling
        // them it did not go.
        if (!result.started || result.error) {
            scheduledMessagesDb.markFailed(row.id, result.error ?? 'The session was unavailable when this was due.');
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scheduledMessagesDb.markFailed(row.id, message);
    }
}
/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(runtime, now = new Date()) {
    // Claimed before any of them runs, so a long turn cannot let the next poll
    // pick the same message up again.
    const due = scheduledMessagesDb.claimDue(now);
    if (due.length === 0) {
        return 0;
    }
    // Sequentially: a session can only have one run at a time, and two due
    // messages for the same session must not race each other into it.
    for (const row of due) {
        await sendClaimedMessage(row, runtime);
    }
    return due.length;
}
/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime) {
    if (pollTimer) {
        return;
    }
    const poll = () => {
        // A pass that overruns the interval must not be started again underneath
        // itself; the claim is transactional but the runs are not.
        if (dispatchInFlight) {
            return;
        }
        dispatchInFlight = true;
        void dispatchDueScheduledMessages(runtime)
            .then(() => dispatchQueuedMessages(runtime))
            .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
        })
            .finally(() => {
            dispatchInFlight = false;
        });
    };
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    // Never keep the process alive just to poll for scheduled messages.
    pollTimer.unref?.();
    // Catch up on anything that came due while the server was not running.
    poll();
}
export function closeScheduledMessageDispatcher() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
//# sourceMappingURL=scheduled-message-dispatcher.service.js.map
