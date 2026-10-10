import * as path from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type { LocalAsrBackend } from '../core/speech/stt/local';
import type { MlBackend } from '../core/speech/pipeline';
import type { MlRequest, MlResponse } from '../ml/protocol';
import type { ModelManager } from './models';
import { floatToInt16, int16ToFloat } from '../core/speech/audio';
import type { Logger } from './logger';

type Caps = { vad: boolean; asr: string | null; kws: boolean; speaker: boolean };
type Req<T extends MlRequest['op']> = Omit<Extract<MlRequest, { op: T }>, 'id'>;

/** Parent side of the ML utility process. Restarts it (with backoff) if it crashes. */
export class MlClient implements MlBackend, LocalAsrBackend {
  private proc: UtilityProcess | null = null;
  private seq = 1;
  private pending = new Map<number, { resolve: (r: Extract<MlResponse, { ok: true }>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private caps: Caps = { vad: false, asr: null, kws: false, speaker: false };
  private loadErrors: string[] = [];
  private restarts = 0;
  private stopping = false;
  private initOpts: Req<'init'> | null = null;
  private lastSpeaking = false;

  constructor(
    private models: ModelManager,
    private log: Logger,
    private desiredWhisper: () => 'tiny' | 'base' | 'small' | 'medium',
    private vadThreshold: () => number,
    private onCaps: (c: Caps) => void,
  ) {}

  getCaps() {
    return this.caps;
  }
  getLoadErrors() {
    return this.loadErrors;
  }

  async start(): Promise<void> {
    this.stopping = false;
    const script = path.join(app.getAppPath(), 'dist', 'ml', 'worker.js');
    this.proc = utilityProcess.fork(script, [], { serviceName: 'afuufow-ml', stdio: 'pipe' });
    this.proc.stdout?.on('data', (d) => this.log.info('[ml] ' + String(d).trim()));
    this.proc.stderr?.on('data', (d) => this.log.warn('[ml] ' + String(d).trim()));
    this.proc.on('message', (m: MlResponse) => this.onMessage(m));
    this.proc.on('exit', (code) => {
      this.proc = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('ML process exited'));
      }
      this.pending.clear();
      this.caps = { vad: false, asr: null, kws: false, speaker: false };
      this.onCaps(this.caps);
      if (!this.stopping) {
        this.log.warn(`ML process exited (${code}); restarting`);
        if (this.restarts++ < 5) setTimeout(() => void this.start().then(() => this.init()), Math.min(30_000, 1000 * 2 ** this.restarts));
      }
    });
    await this.init();
  }

  /** (Re)load whatever models are installed. Call again after a model download. */
  async init(): Promise<void> {
    const m = this.models;
    const size = this.desiredWhisper();
    this.initOpts = {
      op: 'init',
      modelsDir: m.modelsDir,
      whisper: m.installed(`whisper-${size}`) ? size : (['small', 'base', 'tiny', 'medium'] as const).find((s) => m.installed(`whisper-${s}`)) ?? null,
      vad: m.installed('vad') ? { model: m.path('silero_vad.onnx'), threshold: this.vadThreshold() } : null,
      kws: m.installed('kws') ? { dir: m.path('kws'), keywords: m.path('kws/afuufow_keywords.txt') } : null,
      speaker: m.installed('speaker') ? m.path('speaker/wespeaker_en_voxceleb_resnet34.onnx') : null,
    };
    try {
      const r = await this.request(this.initOpts, 120_000);
      this.caps = r.caps ?? this.caps;
      this.loadErrors = r.loadErrors ?? [];
      for (const e of this.loadErrors) this.log.warn('ML load: ' + e);
      this.onCaps(this.caps);
      this.restarts = 0;
    } catch (e) {
      this.log.error('ML init failed', e);
    }
  }

  stop() {
    this.stopping = true;
    this.proc?.kill();
  }

  private onMessage(m: MlResponse) {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m);
    else p.reject(new Error(m.error));
  }

  private request<T extends MlRequest['op']>(req: Req<T>, timeoutMs = 30_000): Promise<Extract<MlResponse, { ok: true }>> {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('ML process is not running'));
      const id = this.seq++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ML request ${req.op} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.postMessage({ ...req, id });
    });
  }

  // ---- MlBackend (pipeline)
  async vadAccept(samples: Float32Array) {
    const r = await this.request<'vad'>({ op: 'vad', pcm: samples });
    this.lastSpeaking = !!r.speaking;
    return (r.segments ?? []).map((s) => ({ samples: s }));
  }
  async vadSpeaking() {
    return this.lastSpeaking;
  }
  async vadReset() {
    await this.request<'vadReset'>({ op: 'vadReset' }).catch(() => undefined);
  }
  async kwsAccept(samples: Float32Array) {
    return (await this.request<'kws'>({ op: 'kws', pcm: samples })).hit ?? null;
  }
  async transcribeLocal(pcm: Int16Array, language: string) {
    return (await this.transcribe(pcm, language.split('-')[0]!)).text;
  }
  hasLocalAsr() {
    return !!this.caps.asr;
  }
  hasKws() {
    return this.caps.kws;
  }

  // ---- LocalAsrBackend
  ready() {
    return !!this.caps.asr;
  }
  modelName() {
    return this.caps.asr ? `whisper-${this.caps.asr}` : 'none';
  }
  async transcribe(pcm: Int16Array, language: string): Promise<{ text: string; ms: number }> {
    const r = await this.request<'asr'>({ op: 'asr', pcm: int16ToFloat(pcm), lang: language }, 120_000);
    return { text: r.text ?? '', ms: r.ms ?? 0 };
  }

  // ---- speaker
  async embed(pcm: Int16Array): Promise<number[] | null> {
    if (!this.caps.speaker) return null;
    const r = await this.request<'embed'>({ op: 'embed', pcm: int16ToFloat(pcm) });
    return r.embedding ? Array.from(r.embedding) : null;
  }
}

export { floatToInt16 };
