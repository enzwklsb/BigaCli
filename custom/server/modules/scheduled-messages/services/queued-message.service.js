import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/utils.js';

// Remove a queued item only after the existing send path has accepted it.
export function prepareQueueSend(drafts, userId, sessionId, selection) {
  if (!selection) return () => {};
  const draft = drafts.getDrafts(userId).find(d => d.scope === sessionId);
  const queue = draft?.queuedMessage;
  if (!queueItems(queue).some(i => i.id === selection.itemId) || !selection.owner ||
      queue?.editing?.owner !== selection.owner || queue.editing.itemId !== selection.itemId) {
    throw new AppError('编辑状态已变化，请重新打开。', {code:'QUEUE_CHANGED',statusCode:409});
  }
  return () => {
    const latest = drafts.getDrafts(userId).find(d => d.scope === sessionId);
    const remaining = queueWithItems(latest?.queuedMessage, queueItems(latest?.queuedMessage).filter(i => i.id !== selection.itemId));
    if (remaining?.editing?.itemId === selection.itemId) delete remaining.editing;
    drafts.saveDraft(userId, sessionId, {text:latest?.text || '',queuedMessage:remaining});
  };
}

// Keep each submission intact until dispatch; old single drafts remain one item.
export function queueItems(queue) {
  if (Array.isArray(queue?.items)) return queue.items;
  return queue && (queue.content || queue.attachments?.length) ? [{ id:'legacy', content:queue.content || '', attachments:queue.attachments || [], options:queue.options || {} }] : [];
}
export function queueWithItems(queue, items) {
  const next={...queue,items};
  delete next.content;delete next.attachments;delete next.options;
  return items.length || next.resume ? next : null;
}
export function appendQueue(queue, message) {
  return queueWithItems(queue,[...queueItems(queue),{id:randomUUID(),content:message.content || '',attachments:message.attachments || [],options:message.options || {}}]);
}
export function queueEditing(queue) { return queue?.editing?.until > Date.now(); }
export function queuedTurn(queue) {
  if(queue?.resume)return queue.resume;
  const items=queueItems(queue),options=items[0]?.options || {};
  const label=options.uiLanguage==='ja-JP'?'補足：':options.uiLanguage==='en-US'?'Additional request:':'补充：';
  return {content:items.map(i=>i.content).filter(Boolean).join('\n\n---\n\n'+label+'\n'),attachments:items.flatMap(i=>i.attachments || []),options};
}
