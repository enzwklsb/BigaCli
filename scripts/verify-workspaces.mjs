import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('cloudcli/package.json'));
const version = JSON.parse(fs.readFileSync('release.json')).version;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'biga-workspaces-'));
const app = path.join(temp, 'app'), home = path.join(temp, 'home');
fs.mkdirSync(home);
fs.cpSync(`build/${version}/components/app/cloudcli`, app, { recursive: true });
fs.symlinkSync(path.resolve('cloudcli/node_modules'), path.join(app, 'node_modules'), 'junction');
const server = fork(path.join(app, 'dist-server/server/index.js'), [], {
  cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: process.env.BIGA_TEST_CODEX_HOME || path.join(home, '.codex'), DATABASE_PATH: path.join(temp, 'auth.db'), SERVER_PORT: '3193', HOST: '127.0.0.1', BIGACLI_VERSION: version },
});
let logs = '', ws;
server.stdout.on('data', b => logs += b); server.stderr.on('data', b => logs += b);
async function api(url, method = 'GET', body) {
  const r = await fetch('http://127.0.0.1:3193' + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data.data ?? data;
}
try {
  let healthy = false;
  for (let i = 0; i < 50; i++) { try { healthy = (await api('/health')).bigaVersion === version; if (healthy) break; } catch {} await new Promise(r => setTimeout(r, 300)); }
  assert.ok(healthy, logs.slice(-3000));
  const base = '/api/providers/biga';
  assert.ok((await api(base + '/workspaces')).root.startsWith(home), 'isolated test home');
  const project = await api(base + '/workspaces', 'POST', { name: '测试工作树' });
  assert.equal(path.basename(project.fullPath), '测试工作树');
  assert.ok(fs.existsSync(path.join(project.fullPath, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(project.fullPath, '.agents/skills')));
  assert.ok(fs.existsSync(path.join(project.fullPath, 'docs')));
  const fileUrl='/api/file-tree/local-file/content?path='+encodeURIComponent(path.join(project.fullPath,'AGENTS.md'));
  const download=await fetch('http://127.0.0.1:3193'+fileUrl);
  assert.equal(download.status,200);
  assert.ok(download.headers.get('content-disposition').startsWith('attachment;'));
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),fs.readFileSync(path.join(project.fullPath,'AGENTS.md')));
  const missing=await fetch('http://127.0.0.1:3193/api/file-tree/local-file/content?path='+encodeURIComponent(path.join(project.fullPath,'missing.zip')));
  assert.equal(missing.status,404);assert.ok(missing.headers.get('content-type').includes('application/json'));
  console.log('PASS: Unicode file download matches bytes; missing file returns JSON 404');
  const session = await api('/api/providers/sessions', 'POST', { provider: 'codex', projectPath: project.fullPath });
  const details = await api('/api/providers/sessions/' + session.sessionId);
  assert.equal(details.project.fullPath, project.fullPath);
  const old = await api('/api/projects/create-project', 'POST', { path: path.join(home, '已有项目'), customName: '已有项目' });
  await api(base + '/workspaces/adopt', 'POST', { path: old.project.fullPath });
  assert.equal((await api(base + '/workspaces')).paths.length, 2);
  fs.mkdirSync(path.join(project.fullPath, '.agents/skills/example'));
  fs.writeFileSync(path.join(project.fullPath, '.agents/skills/example/SKILL.md'), '# example');
  const info = await api(base + '/workspaces/info?path=' + encodeURIComponent(project.fullPath));
  assert.deepEqual(info.skills, ['example']); assert.ok(info.rules.includes('测试工作树'));
  const prefUrl = base + '/sessions/' + session.sessionId + '/reply-preference';
  await api(prefUrl, 'PUT', { verbosity: 'low' });
  const account = await api('/api/providers/codex/accounts', 'POST');
  await api('/api/providers/codex/accounts/session/' + session.sessionId, 'POST', { accountId: account.id, mode: 'manual' });
  assert.equal((await api(prefUrl)).verbosity, 'low');
  await api('/api/providers/codex/accounts/session/' + session.sessionId, 'POST', { accountId: 'default', mode: 'manual' });
  assert.equal((await api(prefUrl)).verbosity, 'low');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.codexlite/biga-preferences.json'))).sessions[session.sessionId].verbosity, 'low');
  console.log('PASS: named folder, native project/session, project rules/skills, adoption, reply preference persists across account switches');
  if (process.env.BIGA_TEST_CODEX_HOME) {
    const WebSocket = require('ws'); ws = new WebSocket('ws://127.0.0.1:3193/ws');
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Agent timeout')), 90000); let text = '';
      ws.on('message', raw => { const event = JSON.parse(raw); const m = event.message ?? event;
        if (m.kind === 'error' || m.kind === 'account_limit') console.error('Agent error:', m.content ?? m.error ?? m.message);
        if (m.kind === 'stream_delta') text += m.content || '';
        if (m.kind === 'complete') { clearTimeout(timer); m.exitCode === 0 && text.includes('BIGA_OK') ? resolve() : reject(Error(JSON.stringify(m) + text)); }
      });
      ws.send(JSON.stringify({ type: 'chat.send', sessionId: session.sessionId, content: '仅回复 BIGA_OK，不要读取文件或调用工具。', options: { model: 'gpt-6-astra', effort: 'low', serviceTier: 'default', permissionMode: 'default' } }));
    });
    console.log('PASS: native Astra turn accepts conversation verbosity override');
  }
} catch (e) { console.error(logs.slice(-2500)); throw e; }
finally { ws?.close(); server.kill(); }
