// Real bundled CLI startup/login initiation with an empty, isolated CODEX_HOME.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

(async () => {
  assert.equal(process.platform, 'win32');
  const repo = path.resolve(__dirname, '..');
  const install = path.resolve(repo, '../BigaCli-local');
  const active = JSON.parse(fs.readFileSync(path.join(install, 'active.json')));
  const deps = path.join(install, 'store/deps', active.components.deps.id, 'node_modules');
  const spawn = createRequire(path.join(deps, '_.cjs'))('cross-spawn');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biga-long-path-'));
  let child;
  try {
    const shortRoot = path.join(root, 'short'); fs.mkdirSync(shortRoot);
    fs.symlinkSync(deps, path.join(shortRoot, 'node_modules'), 'junction');
    const shortService = path.join(shortRoot, 'codex-command.mjs');
    fs.copyFileSync(path.join(repo, 'custom/server/modules/providers/services/codex-command.service.js'), shortService);
    const { spawnCodex: spawnShort } = await import(pathToFileURL(shortService));
    assert.equal(spawnShort(spawn.sync, ['--version'], { windowsHide: true }).status, 0, 'Normal installation paths must still work');
    const longRoot = path.join(root, '新电脑 测试', 'github-https-github-com-enzwklsb-gamedailyagent', 'outputs/BigaCli/program/store/deps', active.components.deps.id);
    const modules = path.join(longRoot, 'node_modules');
    fs.mkdirSync(path.join(modules, '@openai/codex'), { recursive: true });
    fs.cpSync(path.join(deps, '@openai/codex-sdk'), path.join(modules, '@openai/codex-sdk'), { recursive: true });
    fs.copyFileSync(path.join(deps, '@openai/codex/package.json'), path.join(modules, '@openai/codex/package.json'));
    const native = path.join(deps, '@openai/codex-win32-x64');
    for (const relative of fs.readdirSync(native, { recursive: true })) {
      const source = path.join(native, relative), dest = path.join(modules, '@openai/codex-win32-x64', relative);
      if (fs.statSync(source).isDirectory()) fs.mkdirSync(dest, { recursive: true });
      else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.linkSync(source, dest); }
    }
    const service = path.join(longRoot, 'codex-command.mjs');
    fs.copyFileSync(path.join(repo, 'custom/server/modules/providers/services/codex-command.service.js'), service);
    const { Codex } = await import(pathToFileURL(path.join(modules, '@openai/codex-sdk/dist/index.js')));
    const exe = new Codex().exec.executablePath;
    assert(exe.length > 260 && fs.existsSync(exe));
    assert.equal(spawnSync(exe, ['--version'], { windowsHide: true }).error?.code, 'ENOENT', 'Reproduce the unprefixed Windows startup failure');
    const { spawnCodex } = await import(pathToFileURL(service));
    const home = path.join(root, 'empty-home'); fs.mkdirSync(home);
    const env = { ...process.env, CODEX_HOME: home };
    const version = spawnCodex(spawn.sync, ['--version'], { env, windowsHide: true, encoding: 'utf8' });
    assert.equal(version.status, 0, version.error?.message || version.stderr);
    assert.match(version.stdout, /codex-cli/);
    child = spawnCodex(spawn, ['app-server'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', id = 0; const pending = new Map();
    const rejectPending = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
    child.on('error', rejectPending);
    child.on('close', code => rejectPending(Error('CLI closed: ' + code)));
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        const p = pending.get(m.id); if (!p) continue;
        clearTimeout(p.timer); pending.delete(m.id);
        if (m.error) p.reject(Error(m.error.message)); else p.resolve(m.result);
      }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(Error('RPC timed out: ' + method)); }, 20000);
      pending.set(key, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id: key, method, params }) + '\n');
    });
    await rpc('initialize', { clientInfo: { name: 'bigacli_long_path_test', version: '1' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    assert.equal((await rpc('account/read', {})).account, null);
    const login = await rpc('account/login/start', { type: 'chatgpt' });
    assert(login.loginId && login.authUrl, 'First login must return an authorization URL');
    await rpc('account/login/cancel', { loginId: login.loginId });
    assert(!fs.existsSync(path.join(home, 'auth.json')), 'Test must not authenticate a real account');
    console.log('PASS: reproduced ENOENT at ' + exe.length + ' characters; fixed CLI version, app-server and first login URL/cancel with an empty account home');
  } finally {
    if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('close', resolve)); }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
