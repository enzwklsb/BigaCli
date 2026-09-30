import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectsDb, sessionsDb } from '../database/index.js';
import { createProject } from '../projects/services/project-management.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '../../shared/utils.js';
import { workspaceRoot, readPreferences, rememberWorkspace, getReplyPreference, setReplyPreference, saveAccountNote } from './preferences.service.js';

const router = express.Router();
const invalid = message => new AppError(message, { code: 'INVALID_WORKSPACE', statusCode: 400 });
router.get('/workspaces', (_req, res) => res.json(createApiSuccessResponse({ root: workspaceRoot, paths: readPreferences().workspaces })));
router.post('/workspaces', asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw invalid('请输入有效的文件夹名称。');
  const projectPath = path.join(workspaceRoot, name);
  await fs.mkdir(workspaceRoot, { recursive: true });
  try { await fs.mkdir(projectPath); }
  catch (error) { if (error.code === 'EEXIST') throw invalid('同名文件夹已存在，请换一个名称或从历史项目中纳入。'); throw error; }
  await fs.mkdir(path.join(projectPath, '.agents', 'skills'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'docs'));
  await fs.writeFile(path.join(projectPath, 'AGENTS.md'), `# ${name}\n\n本目录是该项目所有对话共用的工作目录。\n\n## 项目说明\n\n在这里补充项目目标、开发约定和常用命令。\n\n## 共享资料\n\n- 项目文档与已确认决策放在 docs/，在此添加相关文档链接。\n- 项目技能放在 .agents/skills/<技能名称>/SKILL.md。\n- 不将其他对话的未确认推测当作项目事实。\n`, { flag: 'wx' });
  const result = await createProject({ projectPath, customName: name });
  rememberWorkspace(result.project.fullPath);
  res.json(createApiSuccessResponse(result.project));
}));
router.post('/workspaces/adopt', asyncHandler(async (req, res) => {
  const project = projectsDb.getProjectPath(String(req.body?.path || ''));
  if (!project) throw invalid('项目不存在。');
  rememberWorkspace(project.project_path);
  res.json(createApiSuccessResponse({ saved: true }));
}));
router.get('/workspaces/info', asyncHandler(async (req, res) => {
  const project = projectsDb.getProjectPath(String(req.query.path || ''));
  if (!project) throw invalid('项目不存在。');
  const root = project.project_path, rulesPath = path.join(root, 'AGENTS.md'), skillsPath = path.join(root, '.agents', 'skills');
  let rules = '', skills = [];
  try { rules = await fs.readFile(rulesPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { for (const item of await fs.readdir(skillsPath, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    try { await fs.access(path.join(skillsPath, item.name, 'SKILL.md')); skills.push(item.name); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  } } catch (e) { if (e.code !== 'ENOENT') throw e; }
  res.json(createApiSuccessResponse({ path: root, rulesPath, rules, skillsPath, skills }));
}));
router.get('/sessions/:sessionId/reply-preference', (req, res) => res.json(createApiSuccessResponse(getReplyPreference(req.params.sessionId))));
router.put('/sessions/:sessionId/reply-preference', asyncHandler(async (req, res) => {
  const session = sessionsDb.getSessionById(req.params.sessionId);
  if (!session || session.provider !== 'codex') throw invalid('请先选择 Codex 对话。');
  if (!['low', 'medium', 'high'].includes(req.body?.verbosity)) throw invalid('回复长度无效。');
  res.json(createApiSuccessResponse(setReplyPreference(req.params.sessionId, req.body.verbosity)));
}));
router.put('/sessions/:sessionId/account-notes/:noteId', asyncHandler(async (req, res) => {
  const session = sessionsDb.getSessionById(req.params.sessionId);
  if (!session || session.provider !== 'codex') throw invalid('请先选择 Codex 对话。');
  const { content, timestamp } = req.body || {};
  if (typeof content !== 'string' || !content.trim() || content.length > 20000 || !Number.isFinite(Date.parse(timestamp)) || !/^[a-zA-Z0-9-]{1,80}$/.test(req.params.noteId)) throw invalid('切换账号记录无效。');
  res.json(createApiSuccessResponse(saveAccountNote(req.params.sessionId, { id: req.params.noteId, content, timestamp })));
}));
export default router;
