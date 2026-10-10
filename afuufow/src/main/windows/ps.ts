import { spawn } from 'node:child_process';
import { AbortError } from '../../core/util';
import { type RunPowerShell } from '../../core/speech/tts/sapi';

export const POWERSHELL = process.env.AFUUFOW_POWERSHELL || 'powershell.exe';

export function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Run a script in Windows PowerShell 5.1 with no profile and no console window. Output is stdout (UTF-8). */
export const runPowerShell: RunPowerShell = (script, opts = {}) =>
  new Promise<string>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new AbortError());
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(script)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PowerShell timed out after ${opts.timeoutMs ?? 30_000} ms`));
    }, opts.timeoutMs ?? 30_000);
    const onAbort = () => {
      clearTimeout(timer);
      child.kill();
      reject(new AbortError());
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`cannot start PowerShell (${POWERSHELL}): ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve(out);
      else reject(new Error(`PowerShell exited with ${code}: ${cleanPsError(err || out)}`));
    });
  });

export async function runJson<T>(run: RunPowerShell, script: string, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
  const out = (await run(script, opts)).trim();
  if (!out) return null as T;
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new Error('unexpected PowerShell output: ' + out.slice(0, 200));
  }
}

/** Windows PowerShell wraps errors in CLIXML when stderr is redirected; keep only the human-readable messages. */
export function cleanPsError(raw: string): string {
  if (!raw.includes('CLIXML')) return raw.trim().slice(0, 500);
  const msgs = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]!);
  const text = (msgs.length ? msgs.join('') : raw)
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/_x000D_|_x000A_/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').slice(0, 400);
}
