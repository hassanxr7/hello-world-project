// Layout test: launches the real app, fills the conversation, resizes the window and checks (with real geometry, not guesses) that
// the orb, the conversation and the input box are all visible at once, and that the page itself never needs scrolling on Home.
//   xvfb-run -a node tests/e2e/layout.mjs
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const shots = process.env.SHOTS_DIR ?? mkdtempSync(join(tmpdir(), 'afu-layout-'));
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'afu-layout-ud-'));
const isWin = process.platform === 'win32';
const exe = process.env.AFUUFOW_EXE;
const app = await electron.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: [...(exe ? [] : ['.']), ...(isWin ? [] : ['--no-sandbox', '--password-store=basic'])],
  env: { ...process.env, AFUUFOW_USER_DATA: userData, AFUUFOW_TEST_PLAINTEXT_KEYSTORE: '1' },
  timeout: 90_000,
});
app.process().stderr?.on('data', () => {});
const page = await app.firstWindow();
await page.waitForSelector('text=Dejinta koowaad', { timeout: 30_000 });
const inv = (name, ...args) => page.evaluate(([n, a]) => window.afuufow.invoke(n, ...a), [name, args]);
await inv('app.completeSetup', { approveDefaultFolders: false });
await page.click('nav >> text=Guriga');
for (let i = 0; i < 14; i++) {
  await page.fill('input[placeholder^="Qor amar"]', i % 2 ? 'Fariiso.' : 'Waa maxay wakhtiga hadda? (' + i + ')');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 120));
}
await new Promise((r) => setTimeout(r, 800));

const sizes = [[1920, 1000], [1366, 768], [1280, 720], [1100, 700], [960, 700], [880, 640], [800, 600]];
for (const [w, h] of sizes) {
  await app.evaluate(({ BrowserWindow }, [ww, hh]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(ww, hh); }, [w, h]);
  await new Promise((r) => setTimeout(r, 500));
  const g = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height, w: b.width }; };
    const pg = document.querySelector('.page');
    return { vw: innerWidth, vh: innerHeight, orb: r('.avatarBox canvas'), msgs: r('.msgs'), composer: r('.composer'), chat: r('.chat'), pageScroll: pg ? pg.scrollHeight - pg.clientHeight : null, docScroll: document.documentElement.scrollHeight - innerHeight };
  });
  const tag = `${w}x${h}`;
  await page.screenshot({ path: join(shots, `home-${tag}.png`) });
  const visible = (b) => !!b && b.top >= -1 && b.bottom <= g.vh + 1 && b.left >= -1 && b.right <= g.vw + 1 && b.h > 0;
  check(`${tag}: orb is visible`, visible(g.orb), JSON.stringify(g.orb));
  check(`${tag}: conversation is visible and tall enough to read (>= 150px)`, visible(g.msgs) && g.msgs.h >= 150, JSON.stringify(g.msgs));
  check(`${tag}: input box is visible without scrolling`, visible(g.composer), JSON.stringify(g.composer));
  check(`${tag}: the page itself does not scroll (only the message list does)`, g.pageScroll <= 2 && g.docScroll <= 2, `page ${g.pageScroll}, doc ${g.docScroll}`);
  if (w >= 900) check(`${tag}: two columns (orb left, chat right)`, g.orb && g.chat && g.orb.right <= g.chat.left + 1, JSON.stringify({ orbRight: g.orb?.right, chatLeft: g.chat?.left }));
}
await app.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} layout checks passed (screenshots in ${shots})`);
process.exit(failed ? 1 : 0);
