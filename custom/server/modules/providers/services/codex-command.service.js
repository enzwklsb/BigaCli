import path from 'node:path';
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

export function spawnCodex(spawn, args, options = {}) {
  const baseEnv = { ...(options.env || process.env) };
  const resolved = resolveFromCloudCliSdk(baseEnv);
  if (resolved.pathDirs.length) {
    const key = pathEnvKey(baseEnv);
    const existing = String(baseEnv[key] || '').split(path.delimiter).filter(Boolean);
    const merged = [...resolved.pathDirs, ...existing.filter((entry) => !resolved.pathDirs.includes(entry))];
    baseEnv[key] = merged.join(path.delimiter);
  }
  return spawn(resolved.executablePath, args, { ...options, env: baseEnv });
}
