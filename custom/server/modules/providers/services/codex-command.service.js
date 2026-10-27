import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Codex } from '@openai/codex-sdk';

function pathEnvKey(env) {
  if (process.platform !== 'win32') return 'PATH';
  const keys = Object.keys(env || {}).filter((key) => key.toLowerCase() === 'path');
  return keys.includes('Path') ? 'Path' : (keys.at(-1) || 'PATH');
}

/**
 * Reuse the exact executable already resolved by the official Codex SDK.
 * No filesystem scan, PATH guessing, npm-layout guessing, or install gate lives here.
 */
function resolveFromCloudCliSdk(env) {
  const codex = new Codex({ env });
  const sdkExec = codex.exec;
  if (!sdkExec?.executablePath) {
    throw new Error('CloudCLI Codex SDK 未能解析 Codex CLI。');
  }
  return {
    executablePath: sdkExec.executablePath,
    pathDirs: Array.isArray(sdkExec.pathDirs) ? sdkExec.pathDirs : [],
  };
}

function copyNativePackage(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyNativePackage(from, to);
    else {
      try { fs.linkSync(from, to); }
      catch { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
    }
  }
}

function resolveWindowsPackage(resolved) {
  if (process.platform !== 'win32'
      || path.join(path.dirname(resolved.executablePath), 'codex-code-mode-host.exe').length < 260) return resolved;
  // Codex strips the namespace prefix when resolving its own child executables.
  // Keep the complete SDK-resolved native package at a short, physical path.
  const source = path.dirname(path.dirname(resolved.executablePath));
  const parent = path.join(os.tmpdir(), 'bigacli-codex');
  const id = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const destination = path.join(parent, id);
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(parent, { recursive: true });
    const stage = fs.mkdtempSync(path.join(parent, id + '-'));
    try {
      copyNativePackage(source, stage);
      try { fs.renameSync(stage, destination); }
      catch (error) { if (!fs.existsSync(destination)) throw error; }
    } finally {
      if (!path.resolve(stage).startsWith(path.resolve(parent) + path.sep)) throw new Error('Invalid Codex staging path');
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  return {
    executablePath: path.join(destination, path.relative(source, resolved.executablePath)),
    pathDirs: resolved.pathDirs.map(dir => path.join(destination, path.relative(source, dir))),
  };
}

export function spawnCodex(spawn, args, options = {}) {
  const baseEnv = { ...(options.env || process.env) };
  const resolved = resolveWindowsPackage(resolveFromCloudCliSdk(baseEnv));
  if (resolved.pathDirs.length) {
    const key = pathEnvKey(baseEnv);
    const existing = String(baseEnv[key] || '').split(path.delimiter).filter(Boolean);
    const merged = [...resolved.pathDirs, ...existing.filter((entry) => !resolved.pathDirs.includes(entry))];
    baseEnv[key] = merged.join(path.delimiter);
  }
  // Windows process creation requires the namespace prefix beyond MAX_PATH.
  return spawn(path.toNamespacedPath(resolved.executablePath), args, { ...options, env: baseEnv });
}
