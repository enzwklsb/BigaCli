import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-fs';
import { browserRoot } from './biga-browser-runtime.js';

const version = '0.0.83';
const root = path.join(browserRoot, 'extension', version);
const cli = path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js');
let installing;
export function prepareExtensionPackage() {
    if (fs.existsSync(cli)) return Promise.resolve(cli);
    return installing ||= install().finally(() => { installing = null; });
}
async function install() {
    const stage = path.join(browserRoot, 'extension', 'install-' + randomUUID());
    async function download(name, packageVersion) {
        const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${packageVersion}`, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Browser connector download failed (${response.status})`);
        const metadata = await response.json();
        const archive = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(180000) });
        if (!archive.ok) throw new Error(`Browser connector download failed (${archive.status})`);
        const bytes = Buffer.from(await archive.arrayBuffer());
        if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== metadata.dist.integrity) throw new Error('Browser connector package integrity mismatch');
        const destination = path.join(stage, 'node_modules', name);
        fs.mkdirSync(destination, { recursive: true });
        await pipeline(Readable.from([bytes]), createGunzip(), tar.extract(destination, { strip: 1 }));
        return metadata;
    }
    try {
        const mcp = await download('@playwright/mcp', version);
        await Promise.all(['playwright', 'playwright-core'].map(name => download(name, mcp.dependencies[name])));
        // Publish the complete dependency tree atomically, including concurrent first starts.
        try { fs.renameSync(stage, root); }
        catch (error) { if (!fs.existsSync(cli)) throw error; }
        return cli;
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}
