import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/plain' });
    res.end(data);
  });
});
await new Promise(r => server.listen(8777, r));

// Playwright normally finds its own browser. The env var is only here so this
// still runs in a sandbox where the browser lives somewhere unusual.
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url()));
page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push('HTTP ' + r.status() + ': ' + r.url()); });

await page.goto('http://127.0.0.1:8777/', { waitUntil: 'load' });
await page.waitForTimeout(1500);

const hasCore = await page.evaluate(() => typeof window.GhostCore === 'object' && !!window.GhostCore.FaceTracker);
console.log(hasCore ? 'PASS  page parsed, module loaded' : 'FAIL  module did not load');

// ---- the panel must render every control before any camera exists ----
const ui = await page.evaluate(() => {
  const need = ['startBtn','markBtn','bgBtn','phoneBtn','focusBtn','panicBtn','recBtn','clearInk','selfBlur','status','veil'];
  return {
    missing: need.filter(id => !document.getElementById(id)),
    emoji:   document.querySelectorAll('[data-emoji]').length,
    colours: document.querySelectorAll('[data-colour]').length,
    modes:   document.querySelectorAll('[data-mode]').length,
    groups:  document.querySelectorAll('.group').length,
    notes:   document.querySelectorAll('.why').length,
    veil:    !document.getElementById('veil').classList.contains('gone'),
    status:  document.getElementById('status').textContent.trim(),
  };
});
console.log(ui.missing.length === 0 ? 'PASS  every control present' : 'FAIL  missing ' + ui.missing.join(','));
console.log(ui.emoji === 12 ? 'PASS  11 emoji plus off' : `FAIL  ${ui.emoji} emoji buttons`);
console.log(ui.colours === 5 ? 'PASS  4 colours plus off' : `FAIL  ${ui.colours} colour buttons`);
console.log(ui.modes === 3 ? 'PASS  3 ways to hide others' : `FAIL  ${ui.modes} hide modes`);
console.log(ui.groups >= 5 ? `PASS  ${ui.groups} labelled groups` : `FAIL  only ${ui.groups} groups`);
console.log(ui.notes >= 5 ? 'PASS  every group carries a plain explanation' : `FAIL  only ${ui.notes} explanations`);
console.log(ui.veil ? 'PASS  start overlay shown before camera' : 'FAIL  overlay state wrong');
console.log(/off/i.test(ui.status) ? 'PASS  initial status correct' : `FAIL  status "${ui.status}"`);

// nothing important should be cut off or overlapping at a normal window size
const layout = await page.evaluate(() => {
  const bad = [];
  for (const b of document.querySelectorAll('.panel button')) {
    const r = b.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) bad.push(b.id || b.textContent.trim() || b.dataset.emoji || b.dataset.colour);
  }
  const p = document.querySelector('.panel').getBoundingClientRect();
  return { bad, overflows: p.right > window.innerWidth + 2, scrollX: document.documentElement.scrollWidth > window.innerWidth + 2 };
});
console.log(layout.bad.length === 0 ? 'PASS  all buttons have real size' : 'FAIL  collapsed: ' + layout.bad.join(','));
console.log(!layout.overflows && !layout.scrollX ? 'PASS  panel fits the window' : 'FAIL  panel overflows');

// ---- the identity logic, the part that actually matters ----
const logic = await page.evaluate(() => {
  const { FaceTracker } = window.GhostCore;
  const out = {};
  const mk = (cx, cy, eye = 70) => ({ cx, cy, eye, area: eye * eye * 4, x: cx-eye, y: cy-eye, w: eye*2, h: eye*2 });

  let t = new FaceTracker();
  let live = t.update([mk(640, 360, 90), mk(1050, 330, 45)]);
  t.markOwner(live, 1280, 720);
  const owner = t.ownerId;
  out.ownerIsBiggestCentral = owner === live[0].id;

  for (let i = 1; i <= 12; i++) {
    live = t.update([mk(640 + i*18, 360 + i*6, 90), mk(1050 - i*9, 330 + i*3, 45)]);
  }
  out.survivesMovement = t.ownerId === owner && live.some(f => f.id === owner);
  out.strangerStaysDistinct = new Set(live.map(f => f.id)).size === 2;
  out.certainWhileVisible = !t.ownerUncertain();

  for (let i = 0; i < 10; i++) t.update([mk(1000, 330, 45)]);
  out.reportsLoss = t.ownerUncertain();

  for (let i = 0; i < 3; i++) live = t.update([mk(838, 426, 90), mk(1000, 330, 45)]);
  out.recognisedOnReturn = !t.ownerUncertain() && live.some(f => f.id === t.ownerId);

  let t2 = new FaceTracker();
  let l2 = t2.update([mk(300, 360, 90)]);
  t2.markOwner(l2, 1280, 720);
  for (let i = 0; i < 20; i++) t2.update([]);
  const lostFirst = t2.ownerUncertain();
  for (let i = 0; i < 4; i++) l2 = t2.update([mk(1150, 620, 45)]);
  out.distantStrangerRefused = lostFirst && l2.every(f => f.id !== t2.ownerId) && t2.ownerUncertain();

  let t3 = new FaceTracker();
  let l3 = t3.update([mk(640, 360, 100)]);
  t3.markOwner(l3, 1280, 720);
  for (let i = 0; i < 20; i++) t3.update([]);
  for (let i = 0; i < 4; i++) l3 = t3.update([mk(660, 370, 35)]);
  out.wrongSizeRefused = l3.every(f => f.id !== t3.ownerId) && t3.ownerUncertain();

  let t4 = new FaceTracker();
  let l4 = t4.update([mk(500, 300, 80)]);
  t4.markOwner(l4, 1280, 720);
  for (let i = 0; i < t4.reclaimWindow + 12; i++) t4.update([]);
  const expired = t4.ownerMemory === null;
  for (let i = 0; i < 3; i++) l4 = t4.update([mk(505, 305, 80)]);
  out.memoryExpires = expired && l4.every(f => f.id !== t4.ownerId);

  out.markOnEmptySafe = new FaceTracker().markOwner([], 1280, 720) === false;
  return out;
});
for (const [k, v] of Object.entries(logic)) console.log((v ? 'PASS  ' : 'FAIL  ') + k);

// ---- effects must paint, and survive rubbish input ----
const draw = await page.evaluate(() => {
  const { applyFocus, panicBlur, blurRegion, blockRegion, pixelateRegion, drawEmoji } = window.GhostCore;
  const c = document.createElement('canvas'); c.width = 640; c.height = 360;
  const x = c.getContext('2d');
  const src = document.createElement('canvas'); src.width = 640; src.height = 360;
  const sx = src.getContext('2d');
  sx.fillStyle = '#c33'; sx.fillRect(0,0,640,360);

  const painted = () => {
    const d = x.getImageData(0,0,640,360).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  };
  const clear = () => x.clearRect(0,0,640,360);
  const face = (roll=0) => ({
    x:200,y:120,w:200,h:150,cx:300,cy:195,area:30000,eye:80,roll,
    eyeMid:{x:300,y:170}, nose:{x:300,y:200},
  });

  const r = {};
  clear(); blockRegion(x, face());                 r.block = painted();
  clear(); blurRegion(x, src, face(), 640, 360);   r.blur = painted();
  clear(); pixelateRegion(x, src, face(), 640,360);r.pixelate = painted();
  clear(); drawEmoji(x, face(0), '\u{1F600}');     r.emoji = painted();
  clear(); drawEmoji(x, face(0.5), '\u{1F600}');   r.emojiRolled = painted();
  clear(); drawEmoji(x, face(0), '');              r.emojiOffPaintsNothing = !painted();
  clear(); drawEmoji(x, {...face(), eye:0}, '\u{1F600}'); r.emojiZeroEyeSafe = !painted();
  clear(); applyFocus(x, src, [{x:50,y:50},{x:300,y:60},{x:310,y:250},{x:40,y:240}], 640,360); r.focus = painted();
  clear(); applyFocus(x, src, [{x:1,y:1}], 640, 360); r.focusDegenerateSafe = !painted();
  clear(); panicBlur(x, src, 640, 360);            r.panic = painted();

  try {
    for (const f of [{...face(), x:-500,y:-500}, {...face(), x:900,y:700}, {...face(), w:0,h:0}]) {
      blockRegion(x, f); blurRegion(x, src, f, 640, 360); pixelateRegion(x, src, f, 640, 360);
      drawEmoji(x, f, '\u{1F600}');
    }
    r.offscreenSafe = true;
  } catch (e) { r.offscreenSafe = false; }
  return r;
});
for (const [k, v] of Object.entries(draw)) console.log((v ? 'PASS  ' : 'FAIL  ') + k);

// ---- gestures: one finger draws, two vanish, open palm panics ----
const gest = await page.evaluate(() => {
  const { readHand } = window.GhostCore;
  // a pip joint sits roughly 60% of the way from wrist to tip on a straight finger
  const hand = (reach) => {
    const pts = [{ x: .5, y: .9 }];
    for (let i = 1; i <= 20; i++) pts.push({ x: .5, y: .88 });
    const set = (i, d) => { pts[i] = { x: .5, y: .9 - d }; };
    const pairs = [[8,6],[12,10],[16,14],[20,18]];
    pairs.forEach(([tip, pip], n) => { set(pip, 0.18); set(tip, 0.18 * reach[n]); });
    return pts;
  };
  const point = hand([1.7, 0.5, 0.5, 0.5]);
  const palm  = hand([1.7, 1.7, 1.7, 1.7]);
  const fist  = hand([0.5, 0.5, 0.5, 0.5]);
  return {
    pointIsPoint: readHand(point).pose === 'point',
    palmIsPalm:   readHand(palm).pose === 'palm',
    fistIsFist:   readHand(fist).pose === 'fist',
    tipReported:  typeof readHand(point).tip.x === 'number',
  };
});
for (const [k, v] of Object.entries(gest)) console.log((v ? 'PASS  ' : 'FAIL  ') + k);

// ---- which detected objects count as a screen ----
const screens = await page.evaluate(() => {
  const { isScreen } = window.GhostCore;
  return {
    phoneCounts:  isScreen('cell phone') && isScreen('Phone') && isScreen('laptop'),
    variantsOk:   isScreen('tvmonitor') && isScreen('monitor'),
    personIgnored: !isScreen('person') && !isScreen('chair') && !isScreen('') && !isScreen(null),
  };
});
for (const [k, v] of Object.entries(screens)) console.log((v ? 'PASS  ' : 'FAIL  ') + k);

// ---- clicking through the panel must not throw before a camera exists ----
const clicks = await page.evaluate(async () => {
  const ids = ['phoneBtn','focusBtn','panicBtn','selfBlur','clearInk','markBtn','bgBtn','recBtn'];
  const bad = [];
  for (const id of ids) { try { document.getElementById(id).click(); } catch (e) { bad.push(id + ': ' + e.message); } }
  // saving a blank background or recording an empty canvas must be refused, not silently done
  if (document.getElementById('bgBtn').textContent.includes('again')) bad.push('bgBtn saved a blank room');
  if (document.getElementById('recBtn').getAttribute('aria-pressed') === 'true') bad.push('recBtn recorded with no camera');
  for (const b of document.querySelectorAll('[data-emoji],[data-colour],[data-mode]')) {
    try { b.click(); } catch (e) { bad.push('swatch: ' + e.message); }
  }
  return bad;
});
console.log(clicks.length === 0 ? 'PASS  every control clickable with no camera' : 'FAIL  ' + clicks.join(' | '));

console.log('\n--- console errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');

await page.screenshot({ path: '/tmp/ghostweb.png', fullPage: true });
await browser.close();
server.close();
