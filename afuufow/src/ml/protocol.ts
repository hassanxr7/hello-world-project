export type MlRequest =
  | { id: number; op: 'init'; modelsDir: string; whisper: 'tiny' | 'base' | 'small' | 'medium' | null; vad: { model: string; threshold: number } | null; kws: { dir: string; keywords: string } | null; speaker: string | null }
  | { id: number; op: 'vad'; pcm: Float32Array }
  | { id: number; op: 'vadReset' }
  | { id: number; op: 'kws'; pcm: Float32Array }
  | { id: number; op: 'asr'; pcm: Float32Array; lang: string }
  | { id: number; op: 'embed'; pcm: Float32Array }
  | { id: number; op: 'ping' };

export type MlResponse =
  | { id: number; ok: true; caps?: { vad: boolean; asr: string | null; kws: boolean; speaker: boolean }; loadErrors?: string[]; segments?: Float32Array[]; speaking?: boolean; hit?: string | null; text?: string; ms?: number; embedding?: Float32Array }
  | { id: number; ok: false; error: string };
