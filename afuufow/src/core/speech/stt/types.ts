export interface SttResult {
  text: string;
  /** 0..1 when the provider reports one, otherwise null */
  confidence: number | null;
  provider: string;
  language: string;
  /** wall-clock ms from the end of the audio to the final text */
  latencyMs: number;
  /** provider said "no speech recognised" */
  noMatch?: boolean;
}

export interface SttProvider {
  readonly id: 'azure' | 'openai' | 'local';
  readonly isCloud: boolean;
  /** One utterance of 16 kHz mono PCM -> text. */
  transcribe(pcm: Int16Array, opts: { signal?: AbortSignal; language?: string; prompt?: string }): Promise<SttResult>;
  /** Streaming upload (audio is sent while the user is still speaking). Optional. */
  openStream?(opts: { signal?: AbortSignal; language?: string }): SttStream;
  check(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }>;
}

export interface SttStream {
  push(pcm: Int16Array): void;
  finish(): Promise<SttResult>;
  abort(): void;
}

export class SttError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'network' | 'quota' | 'bad_audio' | 'unavailable' | 'cloud_disabled' | 'other',
  ) {
    super(message);
    this.name = 'SttError';
  }
}
