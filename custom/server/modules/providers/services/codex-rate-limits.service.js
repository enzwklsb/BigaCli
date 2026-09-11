import spawn from 'cross-spawn';
import { spawnCodex } from './codex-command.service.js';
import { buildCodexEnv } from './codex-account.service.js';
function send(proc, payload) { proc.stdin.write(`${JSON.stringify(payload)}\n`); }
export function readCodexRateLimits(timeoutMs = 8000, accountId = 'default') {
  return new Promise((resolve, reject) => {
    const proc = spawnCodex(spawn, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: buildCodexEnv(accountId) });
    let buffer = '', stderr = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { proc.kill(); } catch {}
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Codex rate-limit request timed out')), timeoutMs);
    proc.on('error', (error) => finish(error));
    proc.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    proc.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      while (true) {
        const nl = buffer.indexOf('\n'); if (nl < 0) break;
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) return finish(new Error(message.error.message || 'Codex initialize failed'));
          send(proc, { method: 'initialized' });
          send(proc, { id: 2, method: 'account/rateLimits/read' });
        } else if (message.id === 2) {
          if (message.error) return finish(new Error(message.error.message || 'Codex rate-limit read failed'));
          return finish(null, message.result ?? {});
        }
      }
    });
    proc.on('close', (code) => { if (!settled) finish(new Error(stderr.trim() || `codex app-server exited with code ${code}`)); });
    send(proc, { id: 1, method: 'initialize', params: { clientInfo: { name: 'codex-shell', title: 'Codex Shell', version: '1' }, capabilities: null } });
  });
}
