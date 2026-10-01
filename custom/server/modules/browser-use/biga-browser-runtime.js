import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-fs';

// Only BigaCli uses this runtime; neither global npm nor CloudCLI 3001 is changed.
export const browserRoot = process.env.BIGACLI_BROWSER_ROOT || path.join(os.homedir(), '.codexlite', 'browser-use');
const version = '1.62.1';
const packageRoot = path.join(browserRoot, 'runtime', version);
const require = createRequire(import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(browserRoot, 'browsers');
export function loadBrowserRuntime() {
    try { return require(packageRoot); } catch { return null; }
}
// CloudCLI's existing installer owns concurrency and progress; this prepares its dependency.
export async function prepareBrowserPackage() {
    if (!loadBrowserRuntime()) {
        const response = await fetch(`https://registry.npmjs.org/playwright-core/${version}`, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Playwright metadata download failed (${response.status})`);
        const metadata = await response.json();
        const archive = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(180000) });
        if (!archive.ok) throw new Error(`Playwright download failed (${archive.status})`);
        const bytes = Buffer.from(await archive.arrayBuffer());
        const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
        if (integrity !== metadata.dist.integrity) throw new Error('Playwright package integrity mismatch');
        const staging = path.join(browserRoot, 'runtime', 'install-' + randomUUID());
        fs.mkdirSync(staging, { recursive: true });
        await pipeline(Readable.from([bytes]), createGunzip(), tar.extract(staging));
        fs.renameSync(path.join(staging, 'package'), packageRoot);
        fs.rmdirSync(staging);
    }
    return path.join(packageRoot, 'cli.js');
}
