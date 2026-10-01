// Use Microsoft's extension transport; the user's browser owns its login/profile.
import { prepareExtensionPackage } from './biga-extension-runtime.js';
import { pathToFileURL } from 'node:url';

const cli = await prepareExtensionPackage();
const browser = process.env.BIGACLI_BROWSER_CHANNEL === 'msedge' ? 'msedge' : 'chrome';
process.argv = [process.execPath, cli, '--extension', '--browser', browser];
await import(pathToFileURL(cli).href);
