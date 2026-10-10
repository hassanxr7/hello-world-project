export interface AudioClip {
  data: Buffer;
  mime: 'audio/mpeg' | 'audio/wav';
}

export class TtsError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'network' | 'unsupported_language' | 'cloud_disabled' | 'unavailable' | 'other',
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

export interface TtsProvider {
  readonly id: 'azure' | 'sapi';
  readonly isCloud: boolean;
  supports(lang: 'so' | 'en'): boolean;
  synth(text: string, lang: 'so' | 'en', signal?: AbortSignal): Promise<AudioClip>;
  check(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }>;
}

export interface AudioPlayer {
  /** Resolves when playback has finished or was stopped. */
  play(clip: AudioClip, signal?: AbortSignal): Promise<void>;
  stop(): void;
}
