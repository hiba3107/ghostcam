// The sandbox cannot reach the model host, so this checks the thing that
// matters when a download fails: the page must say something useful rather
// than sit on a blank screen.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PKG  = process.env.MEDIAPIPE_PKG || '/tmp/mpv/package';

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/plain' });
    res.end(data);
  });
});
await new Promise(r => server.listen(8780, r));

// Playwright normally finds its own browser. The env var is only here so this
// still runs in a sandbox where the browser lives somewhere unusual.
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const browser = await chromium.launch({
  ...launchOptions,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// The library itself comes from the real CDN. If a local copy of the package
// happens to be on disk, use that instead, so this still runs offline.
if (fs.existsSync(PKG)) {
  await page.route('**/cdn.jsdelivr.net/**', route => {
    const name = route.request().url().split('/').pop().split('?')[0];
    const direct = path.join(PKG, name);
    const inWasm = path.join(PKG, 'wasm', name);
    const f = fs.existsSync(direct) ? direct : inWasm;
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'no' });
    const type = f.endsWith('.mjs') || f.endsWith('.js') ? 'text/javascript'
               : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
}

// the model downloads are the thing being broken on purpose
await page.route('**/storage.googleapis.com/**', route => route.fulfill({ status: 404, body: 'no' }));

const crashes = [];
page.on('pageerror', e => crashes.push(e.message));

await page.goto('http://127.0.0.1:8780/', { waitUntil: 'load' });
await page.click('#startBtn');
await page.waitForTimeout(15000);

const s = await page.evaluate(() => ({
  title: document.getElementById('veilTitle').textContent.trim(),
  text:  document.getElementById('veilText').textContent.trim(),
  btn:   document.getElementById('startBtn').textContent.trim(),
  btnEnabled: !document.getElementById('startBtn').disabled,
  err:   document.getElementById('err').textContent.trim(),
  cameraLive: !!document.querySelector('video').srcObject,
}));

console.log('veil title :', s.title);
console.log('veil text  :', s.text);
console.log('button     :', s.btn, s.btnEnabled ? '(enabled)' : '(stuck disabled)');
console.log('panel note :', s.err || '(none)');
console.log('camera live:', s.cameraLive);
console.log('uncaught   :', crashes.length ? crashes.join(' | ') : '(none)');

const ok = /face model|Could not load/i.test(s.title) && s.btnEnabled && crashes.length === 0;
console.log(ok ? '\nPASS  a dead model url gives a readable message and a retry'
               : '\nFAIL  bad degradation');

await page.screenshot({ path: '/tmp/ghostweb-degrade.png' });
await browser.close();
server.close();
