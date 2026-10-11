/**
 * Integration test against the REAL Open Interpreter engine binary (pinned release), with a scripted fake model server.
 * Skipped unless INTERPRETER_BIN points at the `interpreter` executable. CI runs it on Windows against the pinned release.
 * It proves, with the actual engine: (1) every command waits for Afuufow's decision, (2) "no" really prevents the command,
 * (3) "yes" lets it run, (4) the Somali instructions reach the model, (5) cancellation stops the engine.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AcpTransport } from '../src/core/agent/acp';
import { buildEngineConfig } from '../src/core/agent/config';
import { type AgentQuestion, runAgentTask } from '../src/core/agent/session';

const BIN = process.env.INTERPRETER_BIN;
const isWin = process.platform === 'win32';

type Reply = { tool: string } | { text: string };
let script: Reply[] = [];
let requests: any[] = [];
let server: http.Server;
let port = 0;

function startServer(): Promise<void> {
  server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      const body = b ? JSON.parse(b) : {};
      requests.push(body);
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { port = (server.address() as any).port; resolve(); }));
}

function spawnEngine(home: string, cwd: string): AcpTransport & { proc: ChildProcess } {
  const proc = spawn(BIN!, ['acp'], { cwd, env: { ...process.env, INTERPRETER_HOME: home, MOCK_KEY: 'test-key' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let lineCb: (l: string) => void = () => undefined;
  proc.stdout!.on('data', (d) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lineCb(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
  });
  proc.stderr!.on('data', () => undefined);
  return {
    proc,
    write: (l) => proc.stdin!.write(l + '\n'),
    onLine: (cb) => { lineCb = cb; },
    onExit: (cb) => proc.on('exit', (c) => cb('exit code ' + c)),
    kill: () => proc.kill(),
  };
}

describe.skipIf(!BIN)('real Open Interpreter engine (ACP) driven by Afuufow', () => {
  let tmp: string;
  let work: string;
  let home: string;
  beforeAll(async () => {
    await startServer();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afu-oi-'));
    work = path.join(tmp, 'my work');
    home = path.join(tmp, 'home');
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'config.toml'),
      buildEngineConfig({ provider: 'mock', model: 'mock-model', cwd: work, webSearch: false, custom: { id: 'mock', name: 'Mock', baseUrl: `http://127.0.0.1:${port}/v1`, envKey: 'MOCK_KEY', wireApi: 'chat' } }),
    );
  });
  afterAll(() => { server?.close(); });

  const run = (goal: string, ask: (q: AgentQuestion) => Promise<boolean>, extra: { signal?: AbortSignal } = {}) => {
    requests = [];
    const t = spawnEngine(home, work);
    return runAgentTask({ transport: t, goal, cwd: work, approvedFolders: [work], ownerName: 'Hassan', ask, onProgress: () => undefined, signal: extra.signal ?? new AbortController().signal, timeoutMs: 90_000 });
  };
  const delCmd = (f: string) => (isWin ? `Remove-Item -LiteralPath '${f}'` : `rm '${f}'`);
  const listCmd = isWin ? `Get-ChildItem '${'WORK'}'` : `ls 'WORK'`;

  it('Somali instructions and the request reach the model', async () => {
    script = [{ text: 'Salaan Mudane.' }];
    const out = await run('Salaan, kaaliya faylasha', async () => true);
    expect(out.status).toBe('completed');
    expect(out.text).toContain('Salaan Mudane');
    const flat = JSON.stringify(requests[0].messages);
    expect(flat).toContain('af-Soomaali');
    expect(flat).toContain('Owner');
    expect(flat).toContain('kaaliya faylasha');
  }, 120_000);

  it('a deletion waits for the owner: "no" keeps the file, the engine is told it was declined', async () => {
    const f = path.join(work, 'victim.txt');
    fs.writeFileSync(f, 'keep me');
    script = [{ tool: delCmd(f) }, { text: 'Ma tirtirin.' }];
    const asked: AgentQuestion[] = [];
    const out = await run('tirtir victim.txt', async (q) => (asked.push(q), false));
    expect(asked.length).toBe(1);
    expect(asked[0]!.categories).toContain('delete');
    expect(fs.existsSync(f)).toBe(true);
    expect(out.stats).toMatchObject({ allowed: 0, denied: 1 });
  }, 120_000);

  it('"yes" lets the command run', async () => {
    const f = path.join(work, 'victim2.txt');
    fs.writeFileSync(f, 'delete me');
    script = [{ tool: delCmd(f) }, { text: 'Waa la tirtiray.' }];
    const asked: AgentQuestion[] = [];
    const out = await run('tirtir victim2.txt', async (q) => (asked.push(q), true));
    expect(asked.length).toBe(1);
    expect(fs.existsSync(f)).toBe(false);
    expect(out.stats).toMatchObject({ allowed: 1, denied: 0 });
    expect(out.status).toBe('completed');
  }, 120_000);

  it('a read-only listing inside the approved folder needs no question', async () => {
    script = [{ tool: listCmd.replace('WORK', work) }, { text: 'Faylasha waa la arkay.' }];
    const asked: AgentQuestion[] = [];
    const out = await run('liis faylasha', async (q) => (asked.push(q), false));
    expect(asked).toHaveLength(0);
    expect(out.stats.autoAllowed).toBe(1);
  }, 120_000);

  it('a payment-looking command needs strong verification; refusing keeps it from running', async () => {
    const marker = path.join(work, 'paid.txt');
    script = [{ tool: isWin ? `'paid' | Set-Content '${marker}'; Write-Output checkout` : `echo paid > '${marker}'; echo checkout` }, { text: 'Ma bixin.' }];
    const asked: AgentQuestion[] = [];
    await run('bixi lacagta', async (q) => (asked.push(q), false));
    expect(asked[0]).toMatchObject({ level: 'strong' });
    expect(asked[0]!.categories).toContain('payment');
    expect(fs.existsSync(marker)).toBe(false);
  }, 120_000);

  it('stopping the task stops the engine', async () => {
    script = [{ tool: isWin ? 'Start-Sleep -Seconds 60' : 'sleep 60' }, { text: 'x' }];
    const ctl = new AbortController();
    const started = Date.now();
    const p = run('sug', async () => { setTimeout(() => ctl.abort(), 200); await new Promise((r) => setTimeout(r, 400)); return true; }, { signal: ctl.signal });
    const out = await p;
    expect(out.status).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);
});
