import Human, { type Config } from '@vladmandic/human';
import { bestSimilarity } from '../core/vision/similarity';
import type { FaceObs, FrameObs } from '../core/vision/presence';
import { bridge } from './bridge';

/**
 * Hidden page that owns the camera. Frames are analysed here and only NUMBERS leave the page
 * (similarity scores, quality flags). No frame is recorded or saved. A still image is produced only when main asks
 * for one (visitor snapshot, if the owner enabled and disclosed it).
 */
const video = document.getElementById('v') as HTMLVideoElement;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const lum = document.createElement('canvas');
lum.width = 32;
lum.height = 24;
const lctx = lum.getContext('2d', { willReadFrequently: true })!;

const config: Partial<Config> = {
  backend: 'webgl',
  modelBasePath: new URL('./models/', location.href).href,
  debug: false,
  cacheSensitivity: 0,
  filter: { enabled: false },
  face: {
    enabled: true,
    detector: { rotation: true, maxDetected: 3, minConfidence: 0.5 },
    mesh: { enabled: true },
    iris: { enabled: false },
    description: { enabled: true },
    antispoof: { enabled: true },
    liveness: { enabled: true },
    emotion: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false, rotation: true, maxDetected: 2, minConfidence: 0.4, landmarks: true, detector: { modelPath: 'handtrack.json' }, skeleton: { modelPath: 'handlandmark-lite.json' } },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
};

let human: Human | null = null;
let stream: MediaStream | null = null;
let timer: number | null = null;
let fps = 2;
let busy = false;
let owner: number[][] = [];
let known: Array<{ id: string; templates: number[][] }> = [];
let enroll = false;
// hand tracking (only numbers leave this page: 21 points per hand)
const HAND_FPS = 15;
let handsOn = false;
let handModels = false;
let handTimer: number | null = null;
let lastHandCount = -1;
let lastHandMs = 0;
// read-only diagnostics for tests (nothing here leaves the page)
(window as unknown as Record<string, unknown>).__vision = () => ({ handsOn, handModels, hasHuman: !!human, backend: human?.tf?.getBackend?.(), streaming: !!stream, busy, ready: video.readyState, handTimer: handTimer !== null, lastHandCount, lastHandMs, handCfg: human ? { en: human.config.hand.enabled, face: human.config.face.enabled, cache: human.config.cacheSensitivity } : null });

/** One Human instance does both jobs; the two loops share `busy`, so each detect() runs alone with its own models switched on. */
function mode(m: 'face' | 'hand') {
  if (!human) return;
  human.config.face.enabled = m === 'face';
  human.config.hand.enabled = m === 'hand';
  human.config.cacheSensitivity = m === 'face' ? 0 : 0.7; // hands move continuously: let Human track between detector runs
}

async function ensureHuman() {
  if (human) return human;
  human = new Human(config);
  try {
    await human.load();
    await human.warmup();
  } catch (e) {
    // WebGL unavailable (some VMs / remote desktops): fall back to the slower WASM backend
    human = new Human({ ...config, backend: 'wasm', wasmPath: new URL('./wasm/', location.href).href });
    await human.load();
  }
  return human;
}

function luminance(): number {
  lctx.drawImage(video, 0, 0, lum.width, lum.height);
  const d = lctx.getImageData(0, 0, lum.width, lum.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  return s / (d.length / 4) / 255;
}

async function tick() {
  if (busy || !human || video.readyState < 2) return;
  busy = true;
  try {
    const lm = luminance();
    mode('face');
    const res = await human.detect(video);
    const faces: FaceObs[] = [];
    const samples: unknown[] = [];
    for (const f of res.face) {
      const emb = f.embedding as number[] | undefined;
      const w = f.box?.[2] ?? 0;
      const yawDeg = ((f.rotation?.angle?.yaw ?? 0) * 180) / Math.PI;
      const real = f.real as number | undefined;
      const live = f.live as number | undefined;
      const liveness = real !== undefined && live !== undefined ? Math.min(real, live) : (real ?? live ?? null);
      const small = w < video.videoWidth * 0.12;
      const qualityReason = lm < 0.1 ? 'dark' : lm > 0.92 ? 'bright' : small ? 'small' : (f.score ?? 0) < 0.6 ? 'blur' : Math.abs(yawDeg) > 45 ? 'angle' : undefined;
      const qualityOk = !qualityReason && !!emb && emb.length > 64;
      const ownerSimilarity = emb ? bestSimilarity(emb, owner) : null;
      let knownSimilarity: number | null = null;
      let knownId: string | undefined;
      if (emb) {
        for (const k of known) {
          const s = bestSimilarity(emb, k.templates);
          if (s !== null && (knownSimilarity === null || s > knownSimilarity)) {
            knownSimilarity = s;
            knownId = k.id;
          }
        }
      }
      faces.push({ ownerSimilarity, knownSimilarity, knownId, liveness, qualityOk, qualityReason });
      if (enroll && emb) samples.push({ embedding: emb, luminance: lm, yaw: yawDeg, qualityOk, qualityReason, liveness });
    }
    const frame: FrameObs = { ts: Date.now(), faces, luminance: lm };
    bridge().send('vision:frame', frame);
    if (enroll) bridge().send('vision:enrollSamples', { samples, luminance: lm, faceVisible: res.face.length > 0 });
  } catch (e) {
    bridge().send('vision:status', { capturing: true, error: (e as Error).message });
  } finally {
    busy = false;
  }
}

async function startHands() {
  if (!handsOn || !human || !stream) return;
  if (!handModels) {
    human.config.hand.enabled = true; // load() only fetches the models that are enabled
    try {
      await human.load();
      handModels = true;
    } catch (e) {
      handsOn = false;
      bridge().send('vision:status', { capturing: true, error: 'hand tracking could not load: ' + (e as Error).message });
      return;
    } finally {
      human.config.hand.enabled = false;
    }
  }
  if (handTimer === null) handTimer = window.setTimeout(() => void handTick(), 0);
}

function stopHands() {
  if (handTimer !== null) clearTimeout(handTimer);
  handTimer = null;
  bridge().send('vision:hands', { ts: Date.now(), width: video.videoWidth || 640, height: video.videoHeight || 480, hands: [] });
}

async function handTick() {
  handTimer = null;
  if (!handsOn || !human || !stream) return;
  if (!busy && video.readyState >= 2) {
    busy = true;
    try {
      mode('hand');
      const t0 = performance.now();
      const res = await human.detect(video);
      lastHandMs = Math.round(performance.now() - t0);
      lastHandCount = res.hand.length;
      bridge().send('vision:hands', {
        ts: Date.now(),
        width: video.videoWidth,
        height: video.videoHeight,
        hands: res.hand.map((h) => ({ label: h.label, score: h.score, keypoints: h.keypoints })),
      });
    } catch (e) {
      handsOn = false;
      bridge().send('vision:status', { capturing: true, error: 'hand tracking stopped: ' + (e as Error).message });
    } finally {
      busy = false;
    }
  }
  // scheduled after the work finishes, so a slow machine simply runs at a lower frame rate
  if (handsOn && stream) handTimer = window.setTimeout(() => void handTick(), 1000 / HAND_FPS);
}

async function start(m: { deviceId: string | null; fps: number }) {
  await stop();
  fps = m.fps;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: m.deviceId ? { exact: m.deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } } });
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0]?.addEventListener('ended', () => bridge().send('vision:status', { capturing: false, error: 'camera was disconnected' }));
    bridge().send('vision:status', { capturing: true, loading: true });
    await ensureHuman();
    bridge().send('vision:status', { capturing: true, loading: false, backend: human!.tf.getBackend() });
    timer = window.setInterval(() => void tick(), Math.round(1000 / fps));
    void startHands();
  } catch (e) {
    const err = e as DOMException;
    const kind = err.name === 'NotAllowedError' ? 'blocked' : err.name === 'NotFoundError' ? 'missing' : err.name === 'NotReadableError' ? 'busy' : 'error';
    await stop();
    bridge().send('vision:status', { capturing: false, error: err.message, kind });
  }
}

async function stop() {
  stopHands();
  if (timer) clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((t) => t.stop()); // releases the camera: its hardware LED turns off
  stream = null;
  video.srcObject = null;
  bridge().send('vision:status', { capturing: false });
}

bridge().on('vision:start', (m) => void start(m));
bridge().on('vision:stop', () => void stop());
bridge().on('vision:handsSet', (m: { on: boolean }) => {
  handsOn = m.on;
  if (m.on) void startHands();
  else stopHands();
});
bridge().on('vision:templates', (m: { owner: number[][]; known: Array<{ id: string; templates: number[][] }> }) => {
  owner = m.owner;
  known = m.known;
});
bridge().on('vision:enroll', (m: { on: boolean }) => {
  enroll = m.on;
});
bridge().on('vision:snapshot', (m: { id: number }) => {
  if (!stream || video.readyState < 2) return bridge().send('vision:snapshot', { id: m.id, data: null });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  bridge().send('vision:snapshot', { id: m.id, data: canvas.toDataURL('image/jpeg', 0.8) });
});
bridge().on('vision:devices', async () => {
  const d = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  bridge().send('vision:devices', d.filter((x) => x.kind === 'videoinput').map((x) => ({ id: x.deviceId, label: x.label })));
});
bridge().send('vision:ready');
