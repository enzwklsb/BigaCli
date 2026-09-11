import express from 'express';
import spawn from 'cross-spawn';
import { spawnCodex } from '../providers/services/codex-command.service.js';
import { buildCodexEnv, getCodexAccount } from '../providers/services/codex-account.service.js';

const TIMEOUT_MS = 16 * 60 * 1000;
const INIT_ID = 1;
const LOGIN_ID = 2;
const CANCEL_ID = 3;

function isLoopback(address) {
  const raw = String(address || '').replace(/^::ffff:/, '').split('%', 1)[0];
  return raw === '127.0.0.1' || raw === '::1' || raw === 'localhost';
}
function writeJson(proc, payload) {
  proc?.stdin?.write(`${JSON.stringify(payload)}\n`);
}

class CodexAuthManager {
  constructor() {
    this.proc = null;
    this.mode = null;
    this.profileId = 'default';
    this.state = 'idle';
    this.verificationUrl = null;
    this.userCode = null;
    this.browserAuthUrl = null;
    this.error = null;
    this.startedAt = null;
    this.loginId = null;
    this.stderr = '';
    this.stdoutBuffer = '';
    this.expectedClose = false;
  }

  snapshot(recommendedMode = null) {
    if ((this.state === 'starting' || this.state === 'waiting') && this.startedAt && Date.now() - this.startedAt > TIMEOUT_MS) {
      this.expire();
    }
    return {
      state: this.state,
      mode: this.mode,
      profileId: this.profileId,
      recommendedMode,
      verificationUrl: this.verificationUrl,
      userCode: this.userCode,
      browserAuthUrl: this.browserAuthUrl,
      error: this.error,
      startedAt: this.startedAt ? this.startedAt / 1000 : null,
    };
  }

  start(mode, profileId = 'default') {
    if (this.proc && this.proc.exitCode === null && (this.state === 'starting' || this.state === 'waiting')) {
      return this.snapshot(mode);
    }
    if (!getCodexAccount(profileId)) throw new Error('账号不存在');

    this.resetRuntime();
    Object.assign(this, {
      mode,
      profileId,
      state: 'starting',
      startedAt: Date.now(),
    });

    try {
      this.proc = spawnCodex(spawn, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildCodexEnv(profileId),
      });
    } catch (error) {
      this.state = 'failed';
      this.error = `启动 Codex 失败：${error.message}`;
      return this.snapshot(mode);
    }

    this.proc.stdout?.on('data', (chunk) => this.consumeStdout(chunk));
    this.proc.stderr?.on('data', (chunk) => { this.stderr = (this.stderr + String(chunk)).slice(-4000); });
    this.proc.on('error', (error) => this.fail(`启动 Codex 失败：${error.message}`));
    this.proc.on('close', (code) => {
      if (this.expectedClose || ['success', 'cancelled', 'expired', 'failed'].includes(this.state)) return;
      this.fail(this.stderr.trim() || `codex app-server exited with code ${code}`);
    });

    writeJson(this.proc, {
      id: INIT_ID,
      method: 'initialize',
      params: { clientInfo: { name: 'codex_shell', title: 'Codex Shell', version: '1' } },
    });
    return this.snapshot(mode);
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id === INIT_ID) {
      if (message.error) return this.fail(message.error.message || 'Codex initialize failed');
      writeJson(this.proc, { method: 'initialized' });
      writeJson(this.proc, {
        id: LOGIN_ID,
        method: 'account/login/start',
        params: { type: this.mode === 'browser' ? 'chatgpt' : 'chatgptDeviceCode' },
      });
      return;
    }

    if (message.id === LOGIN_ID) {
      if (message.error) return this.fail(message.error.message || 'Codex login start failed');
      const result = message.result || {};
      this.loginId = result.loginId || null;
      if (result.type === 'chatgptDeviceCode') {
        this.verificationUrl = result.verificationUrl || null;
        this.userCode = result.userCode || null;
      } else if (result.type === 'chatgpt') {
        this.browserAuthUrl = result.authUrl || null;
      }
      this.state = 'waiting';
      return;
    }

    if (message.method === 'account/login/completed') {
      const params = message.params || {};
      if (this.loginId && params.loginId && params.loginId !== this.loginId) return;
      if (params.success) {
        this.state = 'success';
        this.error = null;
        this.stopProcess();
      } else {
        this.fail(params.error || 'Codex 登录失败');
      }
    }
  }

  cancel() {
    if (this.proc && this.proc.exitCode === null && this.loginId) {
      writeJson(this.proc, { id: CANCEL_ID, method: 'account/login/cancel', params: { loginId: this.loginId } });
    }
    this.state = 'cancelled';
    this.error = null;
    this.stopProcess();
    return this.snapshot();
  }

  expire() {
    if (this.proc && this.proc.exitCode === null && this.loginId) {
      writeJson(this.proc, { id: CANCEL_ID, method: 'account/login/cancel', params: { loginId: this.loginId } });
    }
    this.state = 'expired';
    this.error = null;
    this.stopProcess();
  }

  fail(message) {
    if (['success', 'cancelled', 'expired'].includes(this.state)) return;
    this.state = 'failed';
    this.error = String(message || 'Codex 登录失败');
    this.stopProcess();
  }

  stopProcess() {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.expectedClose = true;
    try { this.proc.kill(); } catch {}
  }

  resetRuntime() {
    if (this.proc && this.proc.exitCode === null) {
      this.expectedClose = true;
      try { this.proc.kill(); } catch {}
    }
    this.proc = null;
    this.verificationUrl = null;
    this.userCode = null;
    this.browserAuthUrl = null;
    this.error = null;
    this.loginId = null;
    this.stderr = '';
    this.stdoutBuffer = '';
    this.expectedClose = false;
  }
}

const authManager = new CodexAuthManager();

export function createCodexAuthBridgeRouter() {
  const router = express.Router();
  const modeFor = (req) => isLoopback(req.socket?.remoteAddress) ? 'browser' : 'device';
  router.get('/status', (req, res) => res.json(authManager.snapshot(modeFor(req))));
  router.post('/start', (req, res) => {
    try {
      res.json(authManager.start(modeFor(req), String(req.body?.profileId || 'default')));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post('/cancel', (_req, res) => res.json(authManager.cancel()));
  return router;
}
