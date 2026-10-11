/**
 * Real install + real engine, through Afuufow's own EngineManager and OpenInterpreterRunner.
 * Network-heavy (~250 MB), so it only runs when AFU_ENGINE_INSTALL=1 (the Windows CI job sets it).
 * Verifies: the pinned release downloads and matches its SHA-256, extraction works with the platform's tar,
 * the engine starts, the owner is asked before commands, "no" prevents the command, and the Somali instructions arrive.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/config/settings';
import { ENGINE, EngineManager, OpenInterpreterRunner, assetKey } from '../src/main/interpreter/engine';

const RUN = process.env.AFU_ENGINE_INSTALL === '1';
const isWin = process.platform === 'win32';

describe.skipIf(!RUN)('Open Interpreter: pinned install and runner (real engine)', () => {
  let tmp: string;
  let mgr: EngineManager;
  let server: http.Server;
  let port = 0;
  let script: Array<{ tool: string } | { text: string }> = [];
  const requests: any[] = [];
  let failWith = 0;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afu-oi-install-'));
    mgr = new EngineManager(path.join(tmp, 'interpreter'));
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        requests.push(b ? JSON.parse(b) : {});
        if (failWith) {
          res.writeHead(failWith, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        const r = script.shift() ?? { text: 'Waa dhammaaday.' };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta: object, fin: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
        if ('tool' in r) {
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + requests.length, type: 'function', function: { name: 'exec_command', arguments: JSON.stringify({ cmd: r.tool, yield_time_ms: 3000 }) } }] });
          chunk({}, 'tool_calls');
        } else {
          chunk({ role: 'assistant', content: r.text });
          chunk({}, 'stop');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => { port = (server.address() as any).port; r(); }));
  }, 30_000);
  afterAll(() => { server?.close(); });

  it('has a pinned asset for this platform', () => {
    expect(assetKey()).not.toBeNull();
    expect(ENGINE.assets[assetKey()!]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('downloads, verifies the pinned SHA-256, extracts and finds the executable', async () => {
    expect(mgr.status().installed).toBe(false);
    let last = 0;
    await mgr.install((rec) => { last = rec; });
    expect(last).toBeGreaterThan(50_000_000);
    const st = mgr.status();
    expect(st.installed).toBe(true);
    expect(st.version).toBe(ENGINE.version);
    expect(st.binPath).toBeTruthy();
    if (isWin) expect(st.binPath!.toLowerCase().endsWith('.exe')).toBe(true);
  }, 600_000);

  it('rejects a corrupted download (checksum mismatch)', async () => {
    const bad = new EngineManager(path.join(tmp, 'bad'));
    const fake = (async () => new Response(new Blob([new Uint8Array(1000)]), { status: 200 })) as unknown as typeof fetch;
    await expect(bad.install(() => undefined, undefined, fake)).rejects.toThrow(/checksum mismatch/);
    expect(bad.status().installed).toBe(false);
  });

  const makeRunner = (settingsPatch: (s: ReturnType<typeof defaultSettings>) => void = () => undefined) => {
    const work = path.join(tmp, 'my work');
    fs.mkdirSync(work, { recursive: true });
    const settings = defaultSettings();
    settings.agent.enabled = true;
    settings.agent.workDir = work;
    settingsPatch(settings);
    return new OpenInterpreterRunner({
      mgr, settings: () => settings, secret: () => undefined, documentsDir: () => tmp, ownerName: () => 'Hassan Mohamed Mohamud',
      log: { info: () => undefined, warn: () => undefined },
      customProvider: { id: 'mock', name: 'Mock', baseUrl: `http://127.0.0.1:${port}/v1`, envKey: 'MOCK_KEY', wireApi: 'chat', apiKey: 'k', model: 'mock-model' },
    });
  };

  it('a rejected API key is reported as such, not as success', async () => {
    failWith = 401;
    try {
      const out = await makeRunner().runWith('salaan', { signal: new AbortController().signal, onProgress: () => undefined, ask: async () => false, timeoutMs: 120_000, maxApprovals: 1 });
      expect(out.status).toBe('failed');
      expect(out.error).toContain('Furaha API-ga');
    } finally {
      failWith = 0;
    }
  }, 180_000);

  it('runner: asks before a deletion, "no" keeps the file; Somali instructions reach the model', async () => {
    const work = path.join(tmp, 'my work');
    fs.mkdirSync(work, { recursive: true });
    const victim = path.join(work, 'victim.txt');
    fs.writeFileSync(victim, 'keep');
    const settings = defaultSettings();
    settings.agent.enabled = true;
    settings.agent.workDir = work;
    const runner = new OpenInterpreterRunner({
      mgr,
      settings: () => settings,
      secret: () => undefined,
      documentsDir: () => tmp,
      ownerName: () => 'Hassan Mohamed Mohamud',
      log: { info: () => undefined, warn: () => undefined },
      customProvider: { id: 'mock', name: 'Mock', baseUrl: `http://127.0.0.1:${port}/v1`, envKey: 'MOCK_KEY', wireApi: 'chat', apiKey: 'k', model: 'mock-model' },
    });
    script = [{ tool: isWin ? `Remove-Item -LiteralPath '${victim}'` : `rm '${victim}'` }, { text: 'Ma tirtirin, waad diiday.' }];
    const asked: string[] = [];
    const out = await runner.runWith('tirtir victim.txt', { signal: new AbortController().signal, onProgress: () => undefined, ask: async (q) => (asked.push(q.detailEn), false), timeoutMs: 120_000, maxApprovals: 5 });
    expect(out.status).toBe('completed');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('victim.txt');
    expect(fs.existsSync(victim)).toBe(true);
    expect(JSON.stringify(requests[0].messages)).toContain('af-Soomaali');
    // the engine config we generated marks the work folder untrusted and keeps the owner's own config untouched
    const cfg = fs.readFileSync(path.join(mgr.homeDir, 'config.toml'), 'utf8');
    expect(cfg).toContain('trust_level = "untrusted"');
    expect(cfg).not.toMatch(/api[_-]?key\s*=/i);
  }, 180_000);

  const ask = (answer: boolean, log: string[] = []) => async (q: { detailEn: string }) => (log.push(q.detailEn), answer);

  it('runner: "yes" lets the deletion run', async () => {
    const work = path.join(tmp, 'my work');
    const f = path.join(work, 'victim2.txt');
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(f, 'delete me');
    script = [{ tool: isWin ? `Remove-Item -LiteralPath '${f}'` : `rm '${f}'` }, { text: 'Waa la tirtiray.' }];
    const asked: string[] = [];
    const out = await makeRunner().runWith('tirtir victim2.txt', { signal: new AbortController().signal, onProgress: () => undefined, ask: ask(true, asked) as any, timeoutMs: 120_000, maxApprovals: 5 });
    expect(asked).toHaveLength(1);
    expect(fs.existsSync(f)).toBe(false);
    expect(out.stats).toMatchObject({ allowed: 1, denied: 0 });
  }, 180_000);

  it('runner: a read-only listing inside the work folder needs no question', async () => {
    const work = path.join(tmp, 'my work');
    script = [{ tool: isWin ? `Get-ChildItem '${work}'` : `ls '${work}'` }, { text: 'Faylasha waa la arkay.' }];
    const asked: string[] = [];
    const out = await makeRunner().runWith('liis faylasha', { signal: new AbortController().signal, onProgress: () => undefined, ask: ask(false, asked) as any, timeoutMs: 120_000, maxApprovals: 5 });
    expect(asked, 'the engine asked about a plain listing: ' + JSON.stringify(asked)).toHaveLength(0);
    expect(out.stats.autoAllowed).toBe(1);
  }, 180_000);

  it('runner: stopping the task stops the engine', async () => {
    script = [{ tool: isWin ? 'Start-Sleep -Seconds 60' : 'sleep 60' }, { text: 'x' }];
    const ctl = new AbortController();
    const t0 = Date.now();
    const out = await makeRunner().runWith('sug', { signal: ctl.signal, onProgress: () => undefined, ask: (async () => { setTimeout(() => ctl.abort(), 150); await new Promise((r) => setTimeout(r, 300)); return true; }) as any, timeoutMs: 120_000, maxApprovals: 5 });
    expect(out.status).toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 180_000);
});
