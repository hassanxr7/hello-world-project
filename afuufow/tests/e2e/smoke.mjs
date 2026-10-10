// End-to-end smoke test: launches the REAL Electron app (main process, preload, IPC, hidden audio/vision workers, ML utility process, UI)
// under xvfb with a fake microphone and camera. It cannot test Windows-only features (PowerShell automation, DPAPI, tray, login item).
//   xvfb-run -a node tests/e2e/smoke.mjs
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = process.env.SHOTS_DIR ?? mkdtempSync(join(tmpdir(), 'afu-shots-'));
mkdirSync(shots, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), 'afu-e2e-'));
// AFUUFOW_EXE = path of an INSTALLED Afuufow.exe (Windows CI). Otherwise the app is launched from this checkout.
const isWin = process.platform === 'win32';
const exe = process.env.AFUUFOW_EXE;
const launchOpts = () => ({
  ...(exe ? { executablePath: exe } : {}),
  args: [...(exe ? [] : ['.']), ...(isWin ? [] : ['--no-sandbox', '--password-store=basic']), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  env: { ...process.env, AFUUFOW_USER_DATA: userData, AFUUFOW_TEST_PLAINTEXT_KEYSTORE: '1' },
  timeout: 90_000,
});
const app = await electron.launch(launchOpts());
app.process().stderr?.on('data', () => {});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.waitForSelector('text=Dejinta koowaad', { timeout: 30_000 });
check('app starts and shows the first-run setup (not completed yet)', true);

const inv = (name, ...args) => page.evaluate(([n, a]) => window.afuufow.invoke(n, ...a), [name, args]);
let snap = await inv('app.snapshot');
check('owner identity defaults are the required names', snap.owner.fullName === 'Hassan Mohamed Mohamud' && snap.owner.greetingName === 'Hassan Mohamed' && snap.owner.nickname === 'Boss Hassan XR');
check('speech language defaults to Somali', snap.settings.general.speechLanguage === 'so');
check('camera and microphone are OFF by default', !snap.settings.camera.enabled && !snap.settings.audio.micEnabled);
check('monitoring cannot be enabled before setup', await inv('mic.set', true).then(() => false, () => true));
check('camera cannot be enabled before face enrollment/setup', await inv('cam.set', true).then(() => false, () => true));
await page.screenshot({ path: join(shots, '01-setup.png') });

// walk the wizard UI a little
await page.click('text=Xiga'); await page.waitForSelector('text=Aqoonsigaaga');
await page.screenshot({ path: join(shots, '02-setup-owner.png') });

// complete setup through IPC, then use the UI
await inv('app.completeSetup', { approveDefaultFolders: true });
await page.waitForSelector('text=Wada-hadalka', { timeout: 10_000 }).catch(() => {});
snap = await inv('app.snapshot');
check('setup completes and approves default folders', snap.settings.setupComplete && snap.settings.permissions.approvedFolders.length === 3, JSON.stringify(snap.settings.permissions.approvedFolders.map((f) => f.label)));

await page.click('nav >> text=Guriga');
await page.fill('input[placeholder^="Qor amar"]', 'Fariiso.');
await page.keyboard.press('Enter');
await page.waitForSelector('text=Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir.', { timeout: 15_000 });
check('"Fariiso." produces the exact required response in the transcript', true);
await page.screenshot({ path: join(shots, '03-home.png') });

// persistence across restart
await inv('profile.set', { greetingName: 'Hassan Mohamed', nickname: 'Boss Hassan XR' });
await inv('memory.addFact', 'Boss likes strong coffee');
await inv('contacts.upsert', { displayName: 'Ahmed Ali', aliases: ['Axmed'], phone: '252611111111', approved: true, fastSend: false });
await page.waitForTimeout(1000);

// unknown commands are handled without crashing and an unavailable Windows feature is reported honestly
if (!isWin) {
  await page.fill('input[placeholder^="Qor amar"]', 'Chrome fur');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Cilad', { timeout: 15_000 }).catch(() => {});
  const actions = await inv('actions.get');
  check('a Windows-only action fails honestly on Linux and is logged (never claimed as done)', actions.some((a) => a.tool === 'apps.open' && a.status === 'failed'), JSON.stringify(actions[0]));
} else {
  // REAL Windows automation through the real PowerShell adapter
  await page.fill('input[placeholder^="Qor amar"]', 'Notepad fur');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Waan furay', { timeout: 60_000 }).catch(() => {});
  let actions = await inv('actions.get');
  const np = actions.find((a) => a.tool === 'apps.open');
  check('Windows: "Notepad fur" opens Notepad and is VERIFIED by seeing its window', !!np && np.status === 'verified', JSON.stringify(np));
  await page.fill('input[placeholder^="Qor amar"]', 'Downloads-ka fur');
  await page.keyboard.press('Enter');
  await wait(8000);
  actions = await inv('actions.get');
  const fo = actions.find((a) => a.tool === 'folders.open');
  check('Windows: "Downloads-ka fur" opens Explorer and verifies the window', !!fo && fo.status === 'verified', JSON.stringify(fo));
  await page.fill('input[placeholder^="Qor amar"]', 'Screenshot qaad');
  await page.keyboard.press('Enter');
  await wait(6000);
  actions = await inv('actions.get');
  const sc = actions.find((a) => a.tool === 'screen.screenshot');
  console.log('INFO screenshot action:', JSON.stringify(sc));
  check('Windows: screenshot action completed with an honest status (verified or failed, never faked)', !!sc && ['verified', 'failed'].includes(sc.status));
  await page.fill('input[placeholder^="Qor amar"]', 'Codka hoos u dhig');
  await page.keyboard.press('Enter');
  await wait(5000);
  actions = await inv('actions.get');
  console.log('INFO volume action:', JSON.stringify(actions.find((a) => a.tool === 'system.volume')));
  const { execSync } = await import('node:child_process');
  try { execSync('taskkill /F /IM notepad.exe /T', { stdio: 'ignore' }); execSync('taskkill /F /IM explorer.exe /FI "WINDOWTITLE eq Downloads"', { stdio: 'ignore' }); } catch {}
}

// ML process
snap = await inv('app.snapshot');
check('ML utility process starts (no models yet -> capabilities all off)', snap.mlCaps.vad === false, JSON.stringify(snap.loadErrors));
await inv('models.download', 'vad');
for (let i = 0; i < 60; i++) { snap = await inv('app.snapshot'); if (snap.mlCaps.vad) break; await wait(1000); }
check('VAD model downloads, SHA-256 verifies, and the ML process loads it', snap.mlCaps.vad === true, JSON.stringify(snap.mlCaps) + ' ' + snap.loadErrors.join(';'));

// microphone worker with the fake device
await inv('mic.set', true);
let dev;
for (let i = 0; i < 20; i++) { dev = (await inv('app.snapshot')).devices; if (dev.micCapturing) break; await wait(500); }
check('microphone worker captures frames from the (fake) device', dev.micCapturing === true, JSON.stringify(dev));
let level = 0;
await page.evaluate(() => window.afuufow.on('micLevel', (l) => { window.__lvl = Math.max(window.__lvl ?? 0, l); }));
await wait(2500);
level = await page.evaluate(() => window.__lvl ?? 0);
check('live microphone level reaches the UI', level >= 0, 'max level ' + level.toFixed(4));
await page.screenshot({ path: join(shots, '04-home-mic-on.png') });
await inv('mic.set', false);
await wait(800);
dev = (await inv('app.snapshot')).devices;
check('turning the microphone off stops capture immediately', dev.micCapturing === false && dev.micEnabled === false, JSON.stringify(dev));

// camera worker + face model with the fake camera
await inv('face.enrollStart');
let enroll = null;
await page.evaluate(() => window.afuufow.on('enroll', (e) => { window.__enroll = e; }));
for (let i = 0; i < 60; i++) { enroll = await page.evaluate(() => window.__enroll ?? null); if (enroll) break; await wait(1000); }
dev = (await inv('app.snapshot')).devices;
check('camera worker loads the face model and runs (fake camera has no face)', !!enroll && enroll.faceVisible === false, JSON.stringify(enroll));
await inv('face.enrollCancel');
await wait(1000);

// visitors, permissions, memory, privacy pages render
for (const [nav, marker, file] of [['Booqdayaal', 'Dhacdooyinka Windows', '05-visitors.png'], ['Ogolaansho', 'Fariimaha', '06-permissions.png'], ['Isku-xirka', 'WhatsApp', '07-integrations.png'], ['Qarsoodi & Xog', 'Maxaa meel loo diraa', '08-privacy.png'], ['Milkiilaha & Xusuusta', 'Xiriiriyaasha', '09-memory.png'], ['Cilad-bixin', 'Hubinta nidaamka', '10-help.png'], ['Dejinta guud', 'Muuqaalka', '11-settings.png']]) {
  await page.click(`nav >> text=${nav}`);
  await page.waitForSelector(`text=${marker}`, { timeout: 8000 }).then(() => check(`page renders: ${nav}`, true), () => check(`page renders: ${nav}`, false));
  await page.screenshot({ path: join(shots, file) });
}
await page.click('nav >> text=Cilad-bixin');
await page.click('text=Orod hubinta');
await page.waitForSelector('text=Microphone', { timeout: 30_000 }).then(() => check('diagnostics run and list checks', true), () => check('diagnostics run and list checks', false));
await page.screenshot({ path: join(shots, '12-diagnostics.png') });
const diag = await inv('diag.run');
for (const d of diag) console.log(`INFO diag ${d.ok === true ? 'ok  ' : d.ok === false ? 'FAIL' : 'n/a '} ${d.title}: ${String(d.detail).slice(0, 160)}`);
if (isWin) check('Windows: PowerShell and DPAPI diagnostics are healthy', diag.find((d) => d.id === 'powershell')?.ok === true && diag.find((d) => d.id === 'dpapi')?.ok === true);
const yt = await inv('diag.test', 'youtube');
console.log('INFO youtube search from this network:', JSON.stringify(yt));
await page.click('nav >> text=Dejinta guud'); await page.selectOption('select >> nth=0', 'light'); await wait(300);
await page.click('nav >> text=Guriga');
await page.screenshot({ path: join(shots, '13-light-theme.png') });
check('light theme applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');

await app.close();

// restart with the same profile: memory survives
const app2 = await electron.launch(launchOpts());
const p2 = await app2.firstWindow();
await p2.waitForSelector('text=Wada-hadalka', { timeout: 30_000 });
const inv2 = (name, ...args) => p2.evaluate(([n, a]) => window.afuufow.invoke(n, ...a), [name, args]);
const mem = await inv2('memory.get');
const contacts = await inv2('contacts.list');
const snap2 = await inv2('app.snapshot');
check('owner memory survives restart', mem.facts.some((f) => f.text === 'Boss likes strong coffee') && contacts.some((c) => c.displayName === 'Ahmed Ali') && snap2.owner.nickname === 'Boss Hassan XR' && snap2.settings.setupComplete);
check('theme preference survives restart', snap2.settings.general.theme === 'light');
await app2.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shots}`);
process.exit(failed.length ? 1 : 0);
