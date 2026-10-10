import type { Settings } from '../config/settings';
import { floatToInt16, int16ToFloat } from './audio';
import type { SelfSpeechFilter } from './selfecho';
import { matchWakeWord } from './wake';

export interface MlBackend {
  vadAccept(samples: Float32Array): Promise<Array<{ samples: Float32Array }>>;
  vadSpeaking(): Promise<boolean>;
  vadReset(): Promise<void>;
  kwsAccept?(samples: Float32Array): Promise<string | null>;
  /** local transcription used for transcript-based wake detection */
  transcribeLocal?(pcm: Int16Array, language: string): Promise<string>;
  hasLocalAsr(): boolean;
  hasKws(): boolean;
}

export type PipelineMode = 'off' | 'wake' | 'command';

export interface PipelineEvents {
  onMode(mode: PipelineMode): void;
  /** Wake word recognised. `rest` may already contain a spoken command ("Afuufow, Chrome fur"). */
  onWake(rest: string | null): void;
  /** A complete utterance to be transcribed by the primary recogniser. */
  onUtterance(pcm: Int16Array, ctx: { fromWake: boolean; duringSpeech: boolean }): void;
  onNotice(kind: 'no_speech' | 'too_long' | 'ml_error', detail?: string): void;
  onLevel(rms: number): void;
}

/**
 * Turns the stream of 16 kHz microphone frames into utterances.
 *   wake mode    : listen for the wake word (KWS, or short VAD segments transcribed on-device)
 *   command mode : the next speech segment is a command (after wake word, or push-to-talk)
 * Frames are ignored entirely while the microphone is disabled, so pausing stops capture immediately.
 */
export class VoicePipeline {
  private mode: PipelineMode = 'off';
  private micEnabled = false;
  private commandDeadline = 0;
  private armedByKws = false;
  private busy = false;
  private backlog: Float32Array[] = [];
  private ptt = false;
  private pttBuf: Int16Array[] = [];
  private ptsLastWakeTry = 0;

  constructor(
    private ml: MlBackend,
    private settings: () => Settings,
    private echo: SelfSpeechFilter,
    private ev: PipelineEvents,
    private now: () => number = Date.now,
  ) {}

  get currentMode() {
    return this.mode;
  }

  private setMode(m: PipelineMode) {
    if (m !== this.mode) {
      this.mode = m;
      this.ev.onMode(m);
    }
  }

  /** Master switch. false = nothing is processed or retained; the worker also stops capture. */
  setMicEnabled(on: boolean) {
    this.micEnabled = on;
    this.pttBuf = [];
    this.ptt = false;
    this.backlog = [];
    void this.ml.vadReset();
    this.setMode(on ? (this.settings().audio.wakeWordEnabled ? 'wake' : 'off') : 'off');
  }

  /** Wake word setting may change while running. */
  refresh() {
    if (!this.micEnabled) return this.setMode('off');
    if (this.mode === 'off' && this.settings().audio.wakeWordEnabled) this.setMode('wake');
    if (this.mode === 'wake' && !this.settings().audio.wakeWordEnabled) this.setMode('off');
  }

  /** Push-to-talk pressed: capture the next utterance without a wake word. */
  beginPushToTalk() {
    if (!this.micEnabled) return false;
    this.ptt = true;
    this.pttBuf = [];
    this.setMode('command');
    this.commandDeadline = this.now() + 30_000;
    return true;
  }
  /** Push-to-talk released: send what was captured. */
  endPushToTalk() {
    if (!this.ptt) return;
    this.ptt = false;
    const total = this.pttBuf.reduce((a, c) => a + c.length, 0);
    const all = new Int16Array(total);
    let o = 0;
    for (const c of this.pttBuf) {
      all.set(c, o);
      o += c.length;
    }
    this.pttBuf = [];
    this.returnToIdle();
    if (all.length < 16000 * 0.3) return this.ev.onNotice('no_speech');
    this.ev.onUtterance(all, { fromWake: false, duringSpeech: false });
  }

  /** The owner/assistant asked to listen for a command now (after a wake greeting). */
  openCommandWindow() {
    if (!this.micEnabled) return;
    this.setMode('command');
    this.commandDeadline = this.now() + this.settings().audio.commandWindowSec * 1000;
  }

  private returnToIdle() {
    this.setMode(this.micEnabled && this.settings().audio.wakeWordEnabled ? 'wake' : 'off');
  }

  /** One frame of 16 kHz mono float samples from the audio worker. */
  async onFrame(frame: Float32Array): Promise<void> {
    if (!this.micEnabled) return;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
    this.ev.onLevel(Math.sqrt(sum / Math.max(1, frame.length)));

    if (this.ptt) {
      this.pttBuf.push(floatToInt16(frame));
      return;
    }
    if (this.mode === 'off') return;
    // process frames strictly in order; keep a short backlog instead of dropping audio while a segment is handled
    if (this.busy) {
      if (this.backlog.length < 150) this.backlog.push(frame);
      return;
    }
    this.busy = true;
    try {
      let f: Float32Array | undefined = frame;
      while (f) {
        if (!this.micEnabled || (this.mode as PipelineMode) === 'off') {
          this.backlog = [];
          break;
        }
        await this.processFrame(f);
        f = this.backlog.shift();
      }
    } finally {
      this.busy = false;
    }
  }

  private async processFrame(frame: Float32Array): Promise<void> {
    try {
      // a command window never times out while the assistant itself is talking (e.g. the greeting)
      if (this.mode === 'command' && this.echo.isSpeaking()) this.commandDeadline = Math.max(this.commandDeadline, this.now() + 3000);
      if (this.mode === 'wake' && this.ml.hasKws() && this.ml.kwsAccept && !this.echo.isSpeaking()) {
        const hit = await this.ml.kwsAccept(frame);
        if (hit) {
          this.armedByKws = true;
          this.ev.onWake(null);
          this.openCommandWindow();
        }
      }
      const segments = await this.ml.vadAccept(frame);
      for (const seg of segments) await this.onSegment(seg.samples);
      if (this.mode === 'command' && !this.ptt && !(await this.ml.vadSpeaking()) && this.now() > this.commandDeadline && segments.length === 0) {
        this.returnToIdle();
        this.ev.onNotice('no_speech');
      }
    } catch (e) {
      this.ev.onNotice('ml_error', (e as Error).message);
    }
  }

  private async onSegment(samples: Float32Array) {
    const sec = samples.length / 16000;
    const pcm = floatToInt16(samples);
    const speakingNow = this.echo.isSpeaking();

    if (this.mode === 'command') {
      const fromWake = this.armedByKws;
      this.armedByKws = false;
      this.returnToIdle();
      this.ev.onUtterance(pcm, { fromWake, duringSpeech: speakingNow });
      return;
    }

    if (this.mode === 'wake') {
      // KWS handles wake detection when available; without it, transcribe short segments on-device
      if (this.ml.hasKws()) {
        if (this.armedByKws) {
          // wake word + command in one breath: this segment IS the command (wake word is stripped later)
          this.armedByKws = false;
          this.ev.onUtterance(pcm, { fromWake: true, duringSpeech: speakingNow });
        }
        return;
      }
      if (speakingNow) {
        // while we talk, only short segments are considered (barge-in "Jooji"), checked after recognition
        if (sec <= 3) this.ev.onUtterance(pcm, { fromWake: false, duringSpeech: true });
        return;
      }
      if (!this.ml.hasLocalAsr() || !this.ml.transcribeLocal) {
        this.ev.onNotice('ml_error', 'wake word needs the local speech model (Settings → Integrations)');
        return;
      }
      if (sec > 6) return; // wake phrases are short; long speech is ordinary conversation
      const s = this.settings();
      // wake detection transcribes in English mode: "Afuufow" comes out in Latin letters that fuzzy matching can use
      const text = await this.ml.transcribeLocal(pcm, 'en');
      const m = matchWakeWord(text, s.audio.wakeWord, s.audio.wakeAliases);
      if (m.matched) {
        this.ev.onWake(m.rest || null);
        if (m.rest) {
          // the command followed the wake word in the same breath: let the primary recogniser transcribe the whole segment
          this.ev.onUtterance(pcm, { fromWake: true, duringSpeech: false });
          return;
        }
        this.openCommandWindow();
      }
    }
  }
}

export { int16ToFloat };
