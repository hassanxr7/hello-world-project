// Renders the Afuufow icon (SVG) to PNG/ICO using Electron itself, so no extra image dependencies are needed.
// Run:  npx electron scripts/make-icons.cjs     (on Linux CI: xvfb-run -a npx electron --no-sandbox scripts/make-icons.cjs)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SVG = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#36d6c3"/></linearGradient></defs>
<rect width="256" height="256" rx="58" fill="url(#g)"/>
<path fill="#fff" fill-rule="evenodd" d="M128 48 L190 204 H162 L149 169 H107 L94 204 H66 Z M115 143 H141 L128 104 Z"/>
<path d="M205 92 q22 36 0 72 M226 74 q32 54 0 108" stroke="#fff" stroke-opacity=".85" stroke-width="10" stroke-linecap="round" fill="none"/>
</svg>`;

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.buf)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'resources');
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true, transparent: true, frame: false });
  const file = path.join(require('node:os').tmpdir(), 'afuufow-icon.html');
  fs.writeFileSync(file, `<html><body style="margin:0;background:transparent">${SVG(256)}</body></html>`);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 400));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = sizes.map((size) => ({ size, buf: size === 256 ? big.toPNG() : big.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(out, 'icon.png'), pngs.find((p) => p.size === 256).buf);
  fs.writeFileSync(path.join(out, 'tray.png'), pngs.find((p) => p.size === 32).buf);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
  console.log('icons written to', out);
  app.quit();
});
