import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const file = path.join(os.homedir(), '.codexlite', 'biga-preferences.json');
export const workspaceRoot = path.join(os.homedir(), 'BigaCli工作区');
export function readPreferences() {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { workspaces: [], sessions: {} }; throw error; }
}
export function getPendingRecoveries() { return readPreferences().pendingRecoveries || {}; }
export function setPendingRecoveries(pendingRecoveries) {
  const value = readPreferences(); value.pendingRecoveries = pendingRecoveries; save(value);
}
function save(value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}
export function rememberWorkspace(projectPath) {
  const value = readPreferences();
  if (!value.workspaces.includes(projectPath)) value.workspaces.push(projectPath);
  save(value);
}
export function getReplyPreference(sessionId) {
  return readPreferences().sessions[sessionId] || { verbosity: 'medium' };
}
export function setReplyPreference(sessionId, verbosity) {
  const value = readPreferences();
  value.sessions[sessionId] = { verbosity };
  save(value);
  return value.sessions[sessionId];
}
export function getAccountNotes(sessionId) {
  return readPreferences().accountNotes?.[sessionId] || [];
}
export function saveAccountNote(sessionId, note) {
  const value = readPreferences();
  value.accountNotes ||= {};
  const notes = value.accountNotes[sessionId] ||= [];
  const index = notes.findIndex(item => item.id === note.id);
  if (index < 0) notes.push({ ...note, kind: 'account_note', role: 'system' });
  else notes[index].content = note.content;
  save(value);
  return notes.find(item => item.id === note.id);
}
export function mergeAccountNotes(messages, notes) {
  const result = [...messages];
  for (const note of [...notes].sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp))) {
    const index = result.findIndex(message => Date.parse(message.timestamp) > Date.parse(note.timestamp));
    result.splice(index < 0 ? result.length : index, 0, note);
  }
  return result;
}
