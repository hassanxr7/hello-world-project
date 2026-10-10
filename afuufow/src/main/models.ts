import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModelStatus } from '../shared/ipc';

const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

export interface ModelDef {
  id: string;
  title: string;
  url: string;
  sha256: string;
  bytes: number;
  kind: 'file' | 'tar.bz2';
  /** path (relative to models dir) whose existence means "installed" */
  marker: string;
  dest: string;
  purpose: string;
  needed: string;
}

/** Pinned downloads. Hashes were computed from the actual release files; a mismatch aborts the install. */
export const MODELS: ModelDef[] = [
  { id: 'vad', title: 'Silero VAD', url: `${BASE}/asr-models/silero_vad.onnx`, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', bytes: 643_854, kind: 'file', marker: 'silero_vad.onnx', dest: 'silero_vad.onnx', purpose: 'Detects when someone is speaking (on-device).', needed: 'wake word, voice commands' },
  { id: 'kws', title: 'Wake-word model (English BPE)', url: `${BASE}/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2`, sha256: 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a', bytes: 17_626_723, kind: 'tar.bz2', marker: 'kws/tokens.txt', dest: 'kws', purpose: 'Listens locally for the word "Afuufow" without sending audio anywhere.', needed: 'wake word' },
  { id: 'speaker', title: 'Speaker model (WeSpeaker ResNet34)', url: `${BASE}/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx`, sha256: '5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94', bytes: 26_534_365, kind: 'file', marker: 'speaker/wespeaker_en_voxceleb_resnet34.onnx', dest: 'speaker/wespeaker_en_voxceleb_resnet34.onnx', purpose: 'Optional owner-voice recognition (never authorises sensitive actions).', needed: 'voice recognition' },
  { id: 'whisper-tiny', title: 'Whisper tiny (offline)', url: `${BASE}/asr-models/sherpa-onnx-whisper-tiny.tar.bz2`, sha256: 'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1', bytes: 116_204_861, kind: 'tar.bz2', marker: 'whisper-tiny/tiny-tokens.txt', dest: 'whisper-tiny', purpose: 'Offline recognition. Measured: unusable for Somali.', needed: 'offline recognition' },
  { id: 'whisper-base', title: 'Whisper base (offline)', url: `${BASE}/asr-models/sherpa-onnx-whisper-base.tar.bz2`, sha256: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de', bytes: 207_557_382, kind: 'tar.bz2', marker: 'whisper-base/base-tokens.txt', dest: 'whisper-base', purpose: 'Offline recognition. Measured: unusable for Somali.', needed: 'offline recognition' },
  { id: 'whisper-small', title: 'Whisper small (offline)', url: `${BASE}/asr-models/sherpa-onnx-whisper-small.tar.bz2`, sha256: '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6', bytes: 639_387_718, kind: 'tar.bz2', marker: 'whisper-small/small-tokens.txt', dest: 'whisper-small', purpose: 'Offline recognition (English works; Somali is poor, see SPEECH_EVALUATION).', needed: 'offline recognition, transcript wake word' },
  { id: 'whisper-medium', title: 'Whisper medium (offline)', url: `${BASE}/asr-models/sherpa-onnx-whisper-medium.tar.bz2`, sha256: '614b1172557049069d846c29d9399640bce83a4dd6c580decebd9ce2a4f32c33', bytes: 1_931_372_882, kind: 'tar.bz2', marker: 'whisper-medium/medium-tokens.txt', dest: 'whisper-medium', purpose: 'Largest offline model; needs ~2 GB RAM and a fast CPU.', needed: 'offline recognition' },
];

/** BPE spellings of "Afuufow" for the English keyword model (tokens verified against its bpe.model). */
export const AFUUFOW_KEYWORDS = [
  '▁A F U U F OW :2.0 #0.25 @AFUUFOW',
  '▁A F U F OW :2.0 #0.25 @AFUUFOW',
  '▁A F O O F O :2.0 #0.25 @AFUUFOW',
  '▁A F U F O :2.0 #0.25 @AFUUFOW',
  '▁A ▁F O O ▁F O :2.0 #0.25 @AFUUFOW',
  '▁A H ▁F O O ▁F OW :2.0 #0.25 @AFUUFOW',
].join('\n') + '\n';

export class ModelManager {
  private active = new Map<string, AbortController>();
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  get modelsDir() {
    return this.dir;
  }
  path(rel: string) {
    return path.join(this.dir, rel);
  }
  installed(id: string): boolean {
    const m = MODELS.find((x) => x.id === id);
    return !!m && fs.existsSync(this.path(m.marker));
  }
  status(): ModelStatus[] {
    return MODELS.map((m) => ({ id: m.id, title: m.title, sizeMb: Math.round(m.bytes / 1e5) / 10, installed: this.installed(m.id), purpose: m.purpose, needed: m.needed }));
  }

  async download(id: string, onProgress: (received: number, total: number) => void, fetchFn: typeof fetch = fetch): Promise<void> {
    const m = MODELS.find((x) => x.id === id);
    if (!m) throw new Error('unknown model ' + id);
    if (this.active.has(id)) throw new Error('already downloading');
    const ctl = new AbortController();
    this.active.set(id, ctl);
    const tmp = this.path(`.download-${id}`);
    try {
      const res = await fetchFn(m.url, { signal: ctl.signal, redirect: 'follow' });
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
        onProgress(received, m.bytes);
      }
      await new Promise<void>((r, j) => out.end((e: Error | null | undefined) => (e ? j(e) : r())));
      const digest = hash.digest('hex');
      if (digest !== m.sha256) throw new Error(`checksum mismatch for ${m.title} (expected ${m.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…); file discarded`);
      await this.install(m, tmp);
    } finally {
      this.active.delete(id);
      fs.rmSync(tmp, { force: true });
    }
  }

  cancel(id: string) {
    this.active.get(id)?.abort();
  }

  private async install(m: ModelDef, file: string) {
    const dest = this.path(m.dest);
    if (m.kind === 'file') {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    // Windows 10+ ships bsdtar (tar.exe) which reads .tar.bz2
    await new Promise<void>((resolve, reject) => {
      const p = spawn('tar', ['-xjf', file, '-C', dest, '--strip-components=1'], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => reject(new Error('cannot run tar: ' + e.message)));
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`tar failed (${c}): ${err.slice(0, 300)}`))));
    });
    // keep disk small: drop fp32 duplicates and sample audio
    for (const f of fs.readdirSync(dest)) {
      if (/^(tiny|base|small|medium)-(encoder|decoder)\.onnx$/.test(f) || /^(encoder|decoder|joiner).*\.onnx$/.test(f) && !f.includes('int8') && fs.existsSync(path.join(dest, f.replace('.onnx', '.int8.onnx')))) {
        fs.rmSync(path.join(dest, f), { force: true });
      }
    }
    fs.rmSync(path.join(dest, 'test_wavs'), { recursive: true, force: true });
    if (m.id === 'kws') fs.writeFileSync(path.join(dest, 'afuufow_keywords.txt'), AFUUFOW_KEYWORDS);
  }

  remove(id: string) {
    const m = MODELS.find((x) => x.id === id);
    if (!m) return;
    fs.rmSync(this.path(m.dest), { recursive: true, force: true });
  }
}
