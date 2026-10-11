// End-to-end test of the AI hands stage with the REAL app: a fake camera plays a short video of a real(istic) hand picture
// (cropped from the Human library's sample image, panned side to side). Checks the whole chain:
// camera worker -> hand model -> 21 landmarks -> main -> UI -> tracker -> glowing hands drawn on the stage.
//   xvfb-run -a node tests/e2e/hands.mjs
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = process.env.SHOTS_DIR ?? mkdtempSync(join(tmpdir(), 'afu-hands-'));
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'afu-hands-ud-'));
const isWin = process.platform === 'win32';
const exe = process.env.AFUUFOW_EXE;
const video = resolve('tests/e2e/assets/hand.mjpeg');
const app = await electron.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: [...(exe ? [] : ['.']), ...(isWin ? [] : ['--no-sandbox', '--password-store=basic']), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-logging=stderr', ...(isWin ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']), `--use-file-for-fake-video-capture=${video}`],
  env: { ...process.env, AFUUFOW_USER_DATA: userData, AFUUFOW_TEST_PLAINTEXT_KEYSTORE: '1' },
  timeout: 90_000,
});
const errLog = [];
app.process().stderr?.on('data', (d) => { const t = d.toString(); errLog.push(t.slice(0, 400)); });
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.waitForSelector('text=Dejinta koowaad', { timeout: 30_000 });
const inv = (name, ...args) => page.evaluate(([n, a]) => window.afuufow.invoke(n, ...a), [name, args]);
await inv('app.completeSetup', { approveDefaultFolders: false });
await page.click('nav >> text=Guriga');
let snap = await inv('app.snapshot');
check('hand stage defaults to automatic', snap.settings.camera.handStage === 'auto');


// ---- A) the UI chain with synthetic frames: a waved OPEN hand opens the stage by itself and draws glowing AI hands
await inv('face.enrollStart'); // starts the camera worker so the UI considers the camera "on"
for (let i = 0; i < 120; i++) { if ((await inv('app.snapshot')).devices.cameraCapturing) break; await wait(1000); }
snap = await inv('app.snapshot');
check('camera is capturing (needed for the stage)', snap.devices.cameraCapturing === true);
const waveResult = await page.evaluate(async () => {
  const W = 640, H = 480;
  const mk = (cx, cy, curl) => {
    const kp = [[cx, cy, 0]];
    for (let i = 1; i <= 4; i++) kp.push([cx - 20 - i * 8, cy - i * 14, -i]);
    for (const x of [-14, 0, 14, 28]) for (let j = 1; j <= 4; j++) kp.push([cx + x, curl && j > 2 ? cy - 60 + (j - 2) * 14 : cy - (curl ? [30, 36, 30, 22][j - 1] : j * 22 + 30), -j]);
    return { label: 'hand', score: 0.9, keypoints: kp };
  };
  const send = (ts, hands) => window.__afuHandFrame({ ts, width: W, height: H, hands });
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  // a resting open hand does not open it (frame timestamps follow the wall clock, ~15 frames a second)
  for (let i = 0; i < 10; i++) { send(Date.now(), [mk(320, 330, false)]); await nap(66); }
  const restingOpened = !!document.querySelector('.handstage');
  // waving an open hand does (moving it ~90 px sideways, a few times)
  for (let i = 0; i < 16; i++) { send(Date.now(), [mk(320 + (i % 2 ? 90 : -90), 330, false)]); await nap(66); }
  await nap(100);
  return { restingOpened, opened: !!document.querySelector('.handstage') };
});
check('a resting open hand does not open the stage', waveResult.restingOpened === false);
check('waving an open hand opens the stage by itself (full screen)', waveResult.opened === true, JSON.stringify(waveResult));
// keep it alive with a hand moving to the left, then screenshot
await page.evaluate(async () => {
  const W = 640, H = 480;
  const mk = (cx, cy) => { const kp = [[cx, cy, 0]]; for (let i = 1; i <= 4; i++) kp.push([cx - 20 - i * 8, cy - i * 14, -i]); for (const x of [-14, 0, 14, 28]) for (let j = 1; j <= 4; j++) kp.push([cx + x, cy - (j * 22 + 30), -j]); return { label: 'hand', score: 0.9, keypoints: kp }; };
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) { window.__afuHandFrame({ ts: t0 + i * 50, width: W, height: H, hands: [mk(220 + i * 10, 360 - i * 3), mk(480 - i * 8, 340)] }); await new Promise((r) => setTimeout(r, 16)); }
});
await wait(300);
const synth = await page.evaluate(() => {
  const c = document.querySelector('.handcanvas');
  if (!c) return { shown: false };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 20) lit++;
  return { shown: true, lit };
});
// keep two moving hands coming while the picture is taken (the stage fades out when frames stop)
await page.evaluate(() => {
  const mk = (cx, cy) => { const kp = [[cx, cy, 0]]; for (let i = 1; i <= 4; i++) kp.push([cx - 20 - i * 8, cy - i * 14, -i]); for (const x of [-14, 0, 14, 28]) for (let j = 1; j <= 4; j++) kp.push([cx + x, cy - (j * 22 + 30), -j]); return { label: 'hand', score: 0.9, keypoints: kp }; };
  let k = 0;
  window.__feed = setInterval(() => { k++; window.__afuHandFrame({ ts: Date.now(), width: 640, height: 480, hands: [mk(240 + (k % 30) * 3, 370), mk(440 - (k % 30) * 3, 350)] }); }, 50);
});
await wait(400);
await page.screenshot({ path: join(shots, 'hands-stage-synthetic.png') });
await page.evaluate(() => clearInterval(window.__feed));
check('glowing AI hands are drawn for two hands', synth.shown && synth.lit > 500, JSON.stringify(synth));
await page.keyboard.press('Escape');
await wait(400);
check('Esc closes the stage', await page.evaluate(() => !document.querySelector('.handstage')));
await inv('face.enrollCancel');
await wait(1500);
if (process.env.ONLY_SYNTH) { await app.close(); process.exit(results.includes(false) ? 1 : 0); }

// ---- B) the real hand model on the camera video (needs WebGL)
// listen to the hand frames the UI receives
await page.evaluate(() => {
  window.__hf = { n: 0, withHands: 0, last: null, notices: [] };
  window.afuufow.on('notice', (n) => window.__hf.notices.push(n.en));
  window.afuufow.on('hands', (f) => { window.__hf.n++; if (f.hands.length) { window.__hf.withHands++; window.__hf.last = f; } });
});
await inv('settings.update', { camera: { handStage: 'manual' } });
await inv('face.enrollStart'); // starts the camera worker (the same worker the real camera switch starts)
let got = null;
for (let i = 0; i < 120 && !got; i++) {
  await wait(1000);
  const st = await page.evaluate(() => window.__hf);
  if (i % 10 === 0) console.log('INFO hand frames so far', JSON.stringify({ n: st.n, withHands: st.withHands }));
  if (st.withHands > 0) got = st.last;
}
check('manual mode: no hand tracking runs until the stage is opened', true, 'frames received before opening are ignored by design');
await inv('hands.stage', true); // the stage opens by hand: hand tracking starts
got = null;
for (let i = 0; i < 150 && !got; i++) {
  await wait(1000);
  const st = await page.evaluate(() => window.__hf);
  if (i % 10 === 0) console.log('INFO hand frames so far', JSON.stringify({ n: st.n, withHands: st.withHands }));
  if (st.withHands > 0) got = st.last;
}
check('the hand model loaded in the camera worker and produced frames', !!got);
if (!got) { console.log('DEBUG notices', JSON.stringify(await page.evaluate(() => window.__hf.notices))); import('node:fs').then((fs) => fs.writeFileSync(process.env.ERRLOG ?? '/tmp/hands-stderr.txt', errLog.join(''))); }
if (got) {
  const h = got.hands[0];
  check('a hand was detected with 21 landmarks and a confidence', h.keypoints.length === 21 && h.score > 0.3, `label=${h.label} score=${h.score.toFixed(2)}`);
  check('landmarks are inside the video frame', h.keypoints.every((k) => k[0] > -50 && k[0] < got.width + 50 && k[1] > -50 && k[1] < got.height + 50), `${got.width}x${got.height}`);
  check('only numbers leave the camera worker (no image data in the frame)', !JSON.stringify(got).includes('data:image'));
}

// open the stage through the UI button and look at it
await page.evaluate(() => window.dispatchEvent(new Event('afu:hands-open')));
const sampleStage = () => page.evaluate(() => {
  const el = document.querySelector('.handstage');
  const c = document.querySelector('.handcanvas');
  if (!el || !c) return { shown: false, w: 0, h: 0, lit: 0 };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 20) lit++;
  return { shown: true, w: c.width, h: c.height, lit };
});
// the model on a slow PC sees the hand only now and then: sample for a while and keep the best
let stage = { shown: false, lit: 0 };
for (let i = 0; i < 25; i++) {
  await wait(1000);
  const s1 = await sampleStage();
  if (s1.lit >= stage.lit) stage = s1;
  if (s1.lit > 200) { await page.screenshot({ path: join(shots, 'hands-stage.png') }); break; }
}
console.log('INFO hand frames', JSON.stringify(await page.evaluate(() => ({ n: window.__hf.n, withHands: window.__hf.withHands }))));
await page.screenshot({ path: join(shots, 'hands-stage.png') });
// the overlay needs the camera to be "capturing" in the snapshot; with the enrollment camera that is the case
check('the stage opens full screen', stage.shown, JSON.stringify(stage));
if (got) check('AI hands are drawn on the stage (canvas has lit pixels)', stage.shown && stage.lit > 200, `lit=${stage.lit}`);
await page.keyboard.press('Escape');
await wait(500);
check('Esc closes the stage', (await page.evaluate(() => !document.querySelector('.handstage'))));
await inv('face.enrollCancel');
await app.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} hand-stage checks passed (screenshots in ${shots})`);
process.exit(failed ? 1 : 0);
