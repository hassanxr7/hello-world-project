import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ElectronBridge } from '../src/main/windows/platform';
import { WindowsPlatform } from '../src/main/windows/platform';
import { findFiles } from '../src/main/windows/findfiles';
import { cleanPsError, encodeCommand } from '../src/main/windows/ps';
import { SCRIPTS, withParams } from '../src/main/windows/scripts';
import { tmpDir } from './helpers';

// Syntax check of every embedded PowerShell script. Runs when AFUUFOW_PWSH points to any PowerShell (7+ on Linux/macOS, or powershell.exe on Windows CI).
const PWSH = process.env.AFUUFOW_PWSH;
describe.skipIf(!PWSH)('PowerShell scripts parse without syntax errors', () => {
  for (const [name, body] of Object.entries(SCRIPTS)) {
    it(name, () => {
      const script = withParams(body, { id: 'x', needles: ['a'], timeoutMs: 1000, browser: 'chrome', url: 'https://x', path: 'C:\\x', key: 'next', message: 'm', sinceMs: 1, level: 5, muted: true, kind: 'exe' });
      const checker = `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script).toString('base64')}')),[ref]$t,[ref]$e); if($e.Count){$e|%{$_.Message + ' @' + $_.Extent.StartLineNumber}; exit 1}`;
      const r = spawnSync(PWSH!, ['-NoProfile', '-NonInteractive', '-Command', checker], { encoding: 'utf8', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
      expect(r.stdout + r.stderr).toBe('');
      expect(r.status).toBe(0);
    });
  }
});

describe('PowerShell error text', () => {
  it('turns CLIXML noise into the readable error', () => {
    const raw = '#< CLIXML\r\n<Objs Version="1.1.0.1"><Obj S="progress"><AV>Preparing modules for first use.</AV></Obj><S S="Error">Exception setting "Volume": "Retrieving the COM class factory for component with CLSID _x000D__x000A_</S><S S="Error">At line:1 char:1_x000D__x000A_</S></Objs>';
    const out = cleanPsError(raw);
    expect(out).toContain('Retrieving the COM class factory');
    expect(out).not.toContain('<');
    expect(out).not.toContain('Preparing modules');
  });
  it('leaves plain errors alone', () => expect(cleanPsError('boom\n')).toBe('boom'));
});

describe('PowerShell parameter safety', () => {
  it('spoken/AI text never appears in the script body; it travels as base64 JSON', () => {
    const evil = `'; Remove-Item -Recurse -Force C:\\ ; '`;
    const script = withParams(SCRIPTS.launchApp, { id: evil });
    expect(script).not.toContain('Remove-Item');
    expect(script).toContain('FromBase64String');
    const b64 = /FromBase64String\('([^']+)'\)/.exec(script)![1]!;
    expect(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).id).toBe(evil);
  });
  it('encodes commands as UTF-16LE base64 (PowerShell -EncodedCommand)', () => {
    expect(Buffer.from(encodeCommand('Get-Date'), 'base64').toString('utf16le')).toBe('Get-Date');
  });
  it('no script shells out to arbitrary user-provided command strings', () => {
    for (const body of Object.values(SCRIPTS)) {
      expect(body).not.toMatch(/Invoke-Expression|\biex\b|Start-Process[^\n]*-Verb\s+RunAs|Set-ExecutionPolicy|DisableRealtimeMonitoring/i);
    }
  });
});

const bridge = (): ElectronBridge & { opened: string[]; clip: string } => {
  const b = {
    opened: [] as string[], clip: '',
    openExternal: async (u: string) => { b.opened.push(u); },
    openPath: async () => '',
    captureScreenPng: async () => Buffer.alloc(5000, 1),
    clipboardWrite: (t: string) => { b.clip = t; },
    clipboardRead: () => b.clip,
    knownFolder: (n: string) => 'C:\\Users\\H\\' + n,
  };
  return b as never;
};

describe('Windows platform adapter (PowerShell mocked)', () => {
  it('lists apps and classifies classic vs. store apps', async () => {
    const run = async () => JSON.stringify([{ name: 'Google Chrome', id: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' }, { name: 'Calculator', id: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }]);
    const apps = await new WindowsPlatform(run, bridge()).listApps();
    expect(apps.map((a) => a.kind)).toEqual(['exe', 'uwp']);
  });
  it('a single app (PowerShell unwraps one-element arrays) still works', async () => {
    const run = async () => JSON.stringify({ name: 'Notepad', id: 'C:\\Windows\\notepad.exe' });
    expect(await new WindowsPlatform(run, bridge()).listApps()).toHaveLength(1);
  });
  it('opens with the default browser through Electron when no specific browser is requested', async () => {
    const b = bridge();
    await new WindowsPlatform(async () => '{"ok":false}', b).openUrl('https://example.com', 'default');
    expect(b.opened).toEqual(['https://example.com']);
  });
  it('falls back to the default browser if the requested one is not installed', async () => {
    const b = bridge();
    await new WindowsPlatform(async () => '{"ok":false}', b).openUrl('https://example.com', 'chrome');
    expect(b.opened).toEqual(['https://example.com']);
  });
  it('saves screenshots as PNG files with a timestamped name', async () => {
    const dir = tmpDir();
    const r = await new WindowsPlatform(async () => '', bridge()).screenshot(dir);
    expect(path.basename(r.path)).toMatch(/^screenshot_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
    expect(fs.statSync(r.path).size).toBe(5000);
  });
  it('reports PowerShell failures instead of hiding them', async () => {
    const p = new WindowsPlatform(async () => { throw new Error('PowerShell exited with 1: boom'); }, bridge());
    await expect(p.getVolume()).rejects.toThrow('boom');
  });
});

describe('file search in approved folders', () => {
  const make = () => {
    const root = tmpDir();
    const w = (rel: string, body = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
    w('invoice-2026.pdf'); w('Invoice_Hassan.docx'); w('sub/deep/Invoice March.xlsx'); w('notes.txt'); w('node_modules/invoice-hidden.pdf'); w('Faylka/FACTURA invoice.pdf');
    return { root, w };
  };
  it('matches names case-insensitively, recurses, and skips noise folders', async () => {
    const { root } = make();
    const r = await findFiles('invoice', [root], 20);
    const names = r.map((x) => x.name).sort();
    expect(names).toEqual(['FACTURA invoice.pdf', 'Invoice March.xlsx', 'Invoice_Hassan.docx', 'invoice-2026.pdf']);
  });
  it('multi-word queries need every word', async () => {
    const { root } = make();
    expect((await findFiles('invoice march', [root], 20)).map((x) => x.name)).toEqual(['Invoice March.xlsx']);
  });
  it('honours the limit and sorts newest first', async () => {
    const { root, w } = make();
    const f = w('newest-invoice.pdf');
    fs.utimesSync(f, new Date(), new Date(Date.now() + 100000));
    const r = await findFiles('invoice', [root], 2);
    expect(r).toHaveLength(2);
    expect(r[0]!.name).toBe('newest-invoice.pdf');
  });
  it('never reads outside the given roots and ignores symlinks', async () => {
    const { root } = make();
    const outside = tmpDir();
    fs.writeFileSync(path.join(outside, 'invoice-secret.pdf'), 'x');
    fs.symlinkSync(outside, path.join(root, 'link'));
    const r = await findFiles('invoice', [root], 50);
    expect(r.some((x) => x.name === 'invoice-secret.pdf')).toBe(false);
  });
  it('is cancellable', async () => {
    const { root } = make();
    const ctl = new AbortController();
    ctl.abort();
    await expect(findFiles('invoice', [root], 5, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('an unreadable or missing root is skipped, not fatal', async () => {
    expect(await findFiles('x', ['/definitely/not/here'], 5)).toEqual([]);
  });
});
