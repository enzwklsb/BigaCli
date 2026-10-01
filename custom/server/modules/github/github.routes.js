import express from 'express';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const pending = state => ['starting', 'waiting'].includes(state);

// gh owns credentials. Only the public device code and account name reach the UI.
export class GitHubConnection {
  constructor() { this.login = { state: 'idle' }; this.proc = null; }

  async status() {
    if (pending(this.login.state)) return { available: true, ...this.login };
    try {
      const { stdout } = await run('gh', ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts', '--jq', '.hosts["github.com"] | map({login,active,state})'], { windowsHide: true, timeout: 20000 });
      const accounts = JSON.parse(stdout || '[]') || [];
      const account = accounts.find(a => a.active && a.state === 'success');
      return { available: true, ...this.login, connected: !!account, account: account?.login || null, accounts };
    } catch (error) {
      if (error.code === 'ENOENT') return { available: false, state: 'missing', connected: false };
      throw new Error('无法检查 GitHub 登录状态，请稍后重试。');
    }
  }

  start() {
    if (this.changing) throw new Error('正在更改 GitHub 账号，请稍候。');
    if (pending(this.login.state)) return this.login;
    if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) throw new Error('当前使用环境变量提供 GitHub 授权，请先移除该配置再进行网页登录。');
    this.login = { state: 'starting' };
    // Piped input makes gh print the URL instead of opening the host PC browser.
    const proc = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard=false'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', GH_PROMPT_DISABLED: '1' } });
    this.proc = proc;
    proc.stdin.end();
    let output = '';
    const consume = chunk => {
      if (this.proc !== proc) return;
      output = (output + chunk.toString()).slice(-8000);
      const code = output.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
      if (code) this.login = { state: 'waiting', userCode: code, verificationUrl: 'https://github.com/login/device' };
    };
    proc.stdout.on('data', consume);
    proc.stderr.on('data', consume);
    const timer = setTimeout(() => {
      if (this.proc === proc) { this.login = { state: 'expired' }; this.proc = null; proc.kill(); }
    }, 15 * 60 * 1000);
    timer.unref();
    proc.on('error', error => {
      clearTimeout(timer);
      if (this.proc !== proc) return;
      this.proc = null;
      this.login = { state: error.code === 'ENOENT' ? 'missing' : 'failed' };
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (this.proc !== proc) return;
      this.proc = null;
      this.login = { state: code === 0 ? 'success' : 'failed' };
    });
    return this.login;
  }

  cancel() {
    const proc = this.proc;
    this.proc = null;
    this.login = { state: 'idle' };
    proc?.kill();
    return this.login;
  }

  async change(action, account) {
    if (this.changing || pending(this.login.state)) throw new Error('请先完成或取消当前 GitHub 操作。');
    if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) throw new Error('当前授权来自环境变量，不能在此切换或退出。');
    if (typeof account !== 'string' || !/^[a-zA-Z0-9-]+$/.test(account)) throw new Error('请选择 GitHub 账号。');
    this.changing = true;
    try {
      const status = await this.status();
      if (!status.accounts?.some(a => a.login === account)) throw new Error('该 GitHub 账号已不在登录列表中，请刷新。');
      await run('gh', ['auth', action, '--hostname', 'github.com', '--user', account], { windowsHide: true, timeout: 20000 });
      this.login = { state: 'idle' };
      return await this.status();
    } finally { this.changing = false; }
  }
}

const connection = new GitHubConnection();
const router = express.Router();
router.get('/status', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json({ success: true, data: await connection.status() }); }
  catch (error) { res.status(502).json({ error: error.message }); }
});
router.post('/login', (_req, res) => {
  try { res.json({ success: true, data: connection.start() }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/cancel', (_req, res) => res.json({ success: true, data: connection.cancel() }));
for (const action of ['switch', 'logout']) router.post('/' + action, async (req, res) => {
  try { res.json({ success: true, data: await connection.change(action, req.body?.account) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
export default router;
