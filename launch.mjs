import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url)),
  url = 'http://127.0.0.1:3000/';
async function ready() {
  try {
    const r = await fetch(url + 'api/status', { signal: AbortSignal.timeout(1800) });
    const d = await r.json();
    return r.ok && typeof d.suggestions === 'string' && typeof d.visualAnalysis === 'string';
  } catch {
    return false;
  }
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 11)) {
  console.error('Node.js 22.11 or newer is required.');
  process.exit(1);
}
if (!(await ready())) {
  mkdirSync(new URL('./runtime/', import.meta.url), { recursive: true });
  const log = openSync(new URL('./runtime/launcher.log', import.meta.url), 'a');
  const child = spawn(process.execPath, ['--experimental-sqlite', 'server.mjs'], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  child.on('error', () => {});
  child.unref();
  closeSync(log);
  let started = false;
  for (let n = 0; n < 90; n++) {
    if (await ready()) {
      started = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!started) {
    console.error('The project could not start. Check runtime/launcher.log or whether port 3000 is in use.');
    process.exit(1);
  }
}
console.log('Smart AI Beauty is running: ' + url);
if (!process.argv.includes('--no-browser')) {
  const browser = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
    windowsHide: true,
    stdio: 'ignore',
  });
  browser.on('error', () => {});
  browser.unref();
}
