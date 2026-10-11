import { createHash } from 'node:crypto';
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AcpTransport } from '../../core/agent/acp';
import { buildEngineConfig } from '../../core/agent/config';
import { explainEngineLog } from '../../core/agent/errors';
import type { AgentRunner } from '../../core/agent/runner';
import { type AgentOutcome, type AgentQuestion, runAgentTask } from '../../core/agent/session';
import type { Settings } from '../../core/config/settings';

/**
 * Open Interpreter (Apache-2.0, https://github.com/openinterpreter/openinterpreter) runs as a separate engine process.
 * Afuufow downloads the official release archive, verifies it against a pinned SHA-256 (taken from the release's
 * own checksum file for this exact tag), and talks to `interpreter acp` over stdio. The engine's source is not copied
 * into Afuufow: it is a ~250 MB Rust program, and running it as a separate process keeps its licence and updates apart.
 */
export const ENGINE = {
  version: '0.0.56',
  tag: 'rust-v0.0.56',
  base: 'https://github.com/openinterpreter/openinterpreter/releases/download',
  assets: {
    'win32-x64': { file: 'open-interpreter-package-x86_64-pc-windows-msvc.tar.gz', sha256: '0e7fd776ffb46cb3821d8acd54c4b45bc13d72110d1dfa0b92903f49fb2bb8a1', bytes: 260_878_051 },
    'win32-arm64': { file: 'open-interpreter-package-aarch64-pc-windows-msvc.tar.gz', sha256: '95f840a83c9c347321b89dec9a4709da790bf0c5d47c9ce959e374b8a20c6257', bytes: 260_000_000 },
    'linux-x64': { file: 'open-interpreter-package-x86_64-unknown-linux-musl.tar.gz', sha256: '9e859353d6e2af28381489570d3ecf02060f7c73df5a652f3ca60c196835ccac', bytes: 250_715_859 },
  } as Record<string, { file: string; sha256: string; bytes: number }>,
} as const;

export function assetKey(platform: string = process.platform, arch: string = process.arch): string | null {
  const k = `${platform}-${arch}`;
  return ENGINE.assets[k] ? k : null;
}

export interface EngineStatus {
  supported: boolean;
  installed: boolean;
  version: string | null;
  pinnedVersion: string;
  sizeMb: number;
  binPath: string | null;
}

export class EngineManager {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  get engineDir() {
    return path.join(this.root, 'engine');
  }
  /** Private INTERPRETER_HOME: the owner's own Open Interpreter settings are never touched. */
  get homeDir() {
    return path.join(this.root, 'home');
  }

  private readManifest(dir: string): { version?: string; variant?: string; entrypoint?: string } | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'codex-package.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  binPath(): string | null {
    const m = this.readManifest(this.engineDir);
    if (!m || m.variant !== 'open-interpreter' || !m.entrypoint) return null;
    const rel = process.platform === 'win32' && !m.entrypoint.endsWith('.exe') ? m.entrypoint + '.exe' : m.entrypoint;
    const p = path.resolve(this.engineDir, rel);
    return p.startsWith(path.resolve(this.engineDir) + path.sep) && fs.existsSync(p) ? p : null;
  }

  status(): EngineStatus {
    const k = assetKey();
    const bin = this.binPath();
    return {
      supported: !!k,
      installed: !!bin,
      version: this.readManifest(this.engineDir)?.version ?? null,
      pinnedVersion: ENGINE.version,
      sizeMb: k ? Math.round(ENGINE.assets[k]!.bytes / 1e5) / 10 : 0,
      binPath: bin,
    };
  }

  async install(onProgress: (received: number, total: number) => void, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<void> {
    const k = assetKey();
    if (!k) throw new Error(`Open Interpreter has no release for ${process.platform}/${process.arch}`);
    const a = ENGINE.assets[k]!;
    const url = `${ENGINE.base}/${ENGINE.tag}/${a.file}`;
    const tmp = path.join(this.root, '.engine-download.tgz');
    const stage = path.join(this.root, 'engine.new');
    try {
      const res = await fetchFn(url, { signal, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
      const hash = createHash('sha256');
      let received = 0;
      const out = fs.createWriteStream(tmp);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        onProgress(received, a.bytes);
      }
      await new Promise<void>((r, j) => out.end((e: Error | null | undefined) => (e ? j(e) : r())));
      const digest = hash.digest('hex');
      if (digest !== a.sha256) throw new Error(`checksum mismatch (expected ${a.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…); file discarded`);

      fs.rmSync(stage, { recursive: true, force: true });
      fs.mkdirSync(stage, { recursive: true });
      // Windows 10+ ships bsdtar as tar.exe
      await new Promise<void>((resolve, reject) => {
        const p = spawn('tar', ['-xzf', tmp, '-C', stage], { windowsHide: true });
        let err = '';
        p.stderr.on('data', (d) => (err += d));
        p.on('error', (e) => reject(new Error('cannot run tar: ' + e.message)));
        p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`tar failed (${c}): ${err.slice(0, 300)}`))));
      });
      const m = this.readManifest(stage);
      if (!m || m.variant !== 'open-interpreter') throw new Error('the archive is not an Open Interpreter package');
      fs.rmSync(this.engineDir, { recursive: true, force: true });
      fs.renameSync(stage, this.engineDir);
      if (process.platform !== 'win32') {
        const b = this.binPath();
        if (b) fs.chmodSync(b, 0o755);
      }
      if (!this.binPath()) throw new Error('the engine executable was not found after extraction');
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }

  remove() {
    fs.rmSync(this.engineDir, { recursive: true, force: true });
    fs.rmSync(this.homeDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------- process

/** Only what the engine needs: the owner's other environment variables (and any secrets in them) are not passed on. */
const ENV_ALLOW = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'USERNAME', 'COMPUTERNAME', 'OS', 'PROCESSOR_ARCHITECTURE', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'windir', 'HOME', 'LANG', 'SHELL', 'TERM'];

export function engineEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ENV_ALLOW) if (base[k] !== undefined) env[k] = base[k];
  return { ...env, ...extra };
}

export function spawnEngine(bin: string, cwd: string, env: NodeJS.ProcessEnv, onStderr?: (l: string) => void): AcpTransport & { proc: ChildProcess } {
  const proc = spawn(bin, ['acp'], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let lineCb: (l: string) => void = () => undefined;
  let exitCb: (r: string) => void = () => undefined;
  let exited: string | null = null;
  proc.stdout!.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lineCb(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
  });
  proc.stderr!.on('data', (d: Buffer) => onStderr?.(d.toString('utf8')));
  proc.on('error', (e) => {
    exited = 'could not start: ' + e.message;
    exitCb(exited);
  });
  proc.on('exit', (code, sig) => {
    exited = `exit code ${code ?? sig}`;
    exitCb(exited);
  });
  proc.stdin!.on('error', () => undefined);
  return {
    proc,
    write: (l) => {
      if (!exited) proc.stdin!.write(l + '\n');
    },
    onLine: (cb) => { lineCb = cb; },
    onExit: (cb) => { exitCb = cb; if (exited) cb(exited); },
    kill: () => {
      try {
        if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true });
        else proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

// ---------------------------------------------------------------------------- runner

export interface RunnerDeps {
  mgr: EngineManager;
  settings: () => Settings;
  secret: (name: string) => string | undefined;
  documentsDir: () => string;
  ownerName: () => string;
  log: { info(m: string): void; warn(m: string): void };
  /** Test hook: use a scripted local model server instead of a cloud provider. */
  customProvider?: { id: string; name: string; baseUrl: string; envKey: string; wireApi: 'chat' | 'responses'; apiKey: string; model: string };
}

const KEY_NAME = { anthropic: 'anthropic.key', openai: 'openai.key' } as const;
const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' } as const;

export class OpenInterpreterRunner implements AgentRunner {
  constructor(private d: RunnerDeps) {}

  workDir(): string {
    const w = this.d.settings().agent.workDir.trim();
    return w || path.join(this.d.documentsDir(), 'Afuufow Workspace');
  }

  async status(): Promise<{ ready: boolean; detail: string }> {
    const st = this.d.mgr.status();
    if (!st.supported) return { ready: false, detail: `Open Interpreter is not available for ${process.platform}/${process.arch}.` };
    if (!st.installed) return { ready: false, detail: 'the engine is not installed (Settings → Agent → Install).' };
    const p = this.d.settings().agent.provider;
    if (!this.d.customProvider && !this.d.secret(KEY_NAME[p])) return { ready: false, detail: `the ${p === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key is missing (Settings → Integrations).` };
    return { ready: true, detail: `engine ${st.version}, ${p} ${this.d.settings().agent.model}` };
  }

  async run(goal: string, o: { signal: AbortSignal; onProgress: (m: string) => void; ask: (q: AgentQuestion, signal: AbortSignal) => Promise<boolean> }): Promise<AgentOutcome> {
    return this.runWith(goal, { ...o, timeoutMs: this.d.settings().agent.maxMinutes * 60_000, maxApprovals: this.d.settings().agent.maxApprovals });
  }

  /** Also used by the "test" button with a tiny goal and `ask` that refuses everything. */
  async runWith(goal: string, o: { signal: AbortSignal; onProgress: (m: string) => void; ask: (q: AgentQuestion, signal: AbortSignal) => Promise<boolean>; timeoutMs: number; maxApprovals: number }): Promise<AgentOutcome> {
    const s = this.d.settings();
    const bin = this.d.mgr.binPath();
    if (!bin) throw new Error('the engine is not installed');
    const cp = this.d.customProvider;
    const key = cp ? cp.apiKey : this.d.secret(KEY_NAME[s.agent.provider]);
    if (!key) throw new Error('API key missing');
    const cwd = this.workDir();
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(this.d.mgr.homeDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.d.mgr.homeDir, 'config.toml'),
      buildEngineConfig({
        provider: s.agent.provider,
        model: cp ? cp.model : s.agent.model,
        cwd,
        webSearch: s.agent.webSearch,
        custom: cp ? { id: cp.id, name: cp.name, baseUrl: cp.baseUrl, envKey: cp.envKey, wireApi: cp.wireApi } : null,
        browser: s.agent.browser ? (process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@0.0.83'] } : { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83'] }) : null,
      }),
    );
    const env = engineEnv(process.env, { INTERPRETER_HOME: this.d.mgr.homeDir, [cp ? cp.envKey : KEY_ENV[s.agent.provider]]: key });
    let errTail = '';
    const transport = spawnEngine(bin, cwd, env, (l) => {
      errTail = (errTail + l).slice(-6000);
      this.d.log.info('engine: ' + l.replace(/(sk-|key[=:]\s*)\S+/gi, '$1***').slice(0, 300));
    });
    const approved = [...s.permissions.approvedFolders.map((f) => f.path), cwd];
    this.d.log.info(`agent task started (${s.agent.provider}/${s.agent.model}), goal length ${goal.length}`);
    const out = await runAgentTask({
      transport,
      goal,
      cwd,
      approvedFolders: approved,
      ownerName: this.d.ownerName(),
      ask: o.ask,
      onProgress: o.onProgress,
      signal: o.signal,
      timeoutMs: o.timeoutMs,
      maxApprovals: o.maxApprovals,
    });
    if (out.status === 'failed' && /no answer/.test(out.error ?? '')) {
      const why = explainEngineLog(errTail);
      if (why) out.error = `${why.so} / ${why.en}`;
    }
    this.d.log.info(`agent task ended: ${out.status} asked=${out.stats.asked} allowed=${out.stats.allowed} denied=${out.stats.denied}`);
    return out;
  }
}

export const defaultDocumentsDir = () => path.join(os.homedir(), 'Documents');
