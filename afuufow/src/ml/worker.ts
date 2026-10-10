/**
 * Utility process: all on-device ML runs here, isolated from the UI and main process.
 * If a model crashes the process, the main process restarts it and the app keeps working.
 */
import { MlEngine } from './engine';
import type { MlRequest, MlResponse } from './protocol';

const port = (process as unknown as { parentPort: { on(e: 'message', cb: (m: { data: MlRequest }) => void): void; postMessage(m: MlResponse): void } }).parentPort;
let engine: MlEngine | null = null;

function reply(r: MlResponse) {
  port.postMessage(r);
}

port.on('message', ({ data: req }) => {
  try {
    switch (req.op) {
      case 'ping':
        return reply({ id: req.id, ok: true });
      case 'init': {
        engine = new MlEngine();
        const loadErrors: string[] = [];
        const tryLoad = (name: string, fn: () => void) => {
          try {
            fn();
          } catch (e) {
            loadErrors.push(`${name}: ${(e as Error).message}`);
          }
        };
        if (req.vad) tryLoad('vad', () => engine!.loadVad(req.vad!.model, { threshold: req.vad!.threshold }));
        if (req.whisper) tryLoad('whisper', () => engine!.loadWhisper(req.modelsDir, req.whisper!));
        if (req.kws) tryLoad('kws', () => engine!.loadKws(req.kws!.dir, req.kws!.keywords));
        if (req.speaker) tryLoad('speaker', () => engine!.loadSpeaker(req.speaker!));
        return reply({ id: req.id, ok: true, caps: engine.caps(), loadErrors });
      }
      case 'vad': {
        if (!engine) throw new Error('not initialised');
        const segs = engine.vadAccept(req.pcm);
        return reply({ id: req.id, ok: true, segments: segs.map((s) => s.samples), speaking: engine.vadSpeaking() });
      }
      case 'vadReset':
        engine?.vadReset();
        return reply({ id: req.id, ok: true });
      case 'kws':
        return reply({ id: req.id, ok: true, hit: engine?.kwsAccept(req.pcm) ?? null });
      case 'asr': {
        if (!engine) throw new Error('not initialised');
        const r = engine.transcribe(req.pcm, req.lang);
        return reply({ id: req.id, ok: true, text: r.text, ms: r.ms });
      }
      case 'embed': {
        if (!engine) throw new Error('not initialised');
        return reply({ id: req.id, ok: true, embedding: engine.embed(req.pcm) });
      }
    }
  } catch (e) {
    reply({ id: req.id, ok: false, error: (e as Error).message });
  }
});
