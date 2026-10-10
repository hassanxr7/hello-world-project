import { bridge } from './bridge';

/**
 * Hidden page that owns the microphone and the speaker.
 *  - capture: mic -> 16 kHz mono float frames (100 ms) -> main process. Stopping releases the device immediately.
 *  - playback: decodes synthesised speech, plays it and reports its level so the avatar reflects real output.
 */
const FRAME = 1600;
const WORKLET = `
class Down extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.pos = 0; this.ratio = sampleRate / 16000; this.acc = 0; this.out = new Float32Array(${FRAME}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        this.out[this.n++] = ch[i];
        if (this.n === ${FRAME}) { this.port.postMessage(this.out.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('afu-down', Down);
`;

let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let src: MediaStreamAudioSourceNode | null = null;

async function startCapture(deviceId: string | null) {
  await stopCapture();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'afu-down');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => bridge().send('audio:frame', e.data.buffer as ArrayBuffer);
    src.connect(node);
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      bridge().send('audio:status', { capturing: false, error: 'microphone was disconnected' });
    });
    bridge().send('audio:status', { capturing: true, label: stream.getAudioTracks()[0]?.label ?? '' });
  } catch (e) {
    const err = e as DOMException;
    const kind = err.name === 'NotAllowedError' ? 'blocked' : err.name === 'NotFoundError' ? 'missing' : err.name === 'NotReadableError' ? 'busy' : 'error';
    bridge().send('audio:status', { capturing: false, error: err.message, kind });
  }
}

async function stopCapture() {
  node?.port.close();
  node?.disconnect();
  src?.disconnect();
  stream?.getTracks().forEach((t) => t.stop()); // releases the microphone hardware right now
  if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined);
  stream = null;
  ctx = null;
  node = null;
  src = null;
  bridge().send('audio:status', { capturing: false });
}

// ---------------------------------------------------------------- playback
let play: AudioContext | null = null;
let current: { source: AudioBufferSourceNode; id: number; done: () => void } | null = null;
let levelTimer: number | null = null;

async function playClip(msg: { id: number; mime: string; data: ArrayBuffer; volume: number; sinkId?: string | null }) {
  stopPlayback();
  try {
    play ??= new AudioContext();
    if (msg.sinkId && 'setSinkId' in play) await (play as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(msg.sinkId).catch(() => undefined);
    if (play.state === 'suspended') await play.resume();
    const buf = await play.decodeAudioData(msg.data.slice(0));
    const source = play.createBufferSource();
    const gain = play.createGain();
    gain.gain.value = msg.volume;
    const analyser = play.createAnalyser();
    analyser.fftSize = 512;
    source.buffer = buf;
    source.connect(gain).connect(analyser).connect(play.destination);
    const data = new Uint8Array(analyser.fftSize);
    const done = () => {
      if (levelTimer) clearInterval(levelTimer);
      levelTimer = null;
      bridge().send('audio:level', 0);
      if (current?.id === msg.id) current = null;
      bridge().send('audio:ended', { id: msg.id });
    };
    source.onended = done;
    current = { source, id: msg.id, done };
    levelTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let s = 0;
      for (const v of data) s += ((v - 128) / 128) ** 2;
      bridge().send('audio:level', Math.sqrt(s / data.length));
    }, 50);
    source.start();
  } catch (e) {
    bridge().send('audio:ended', { id: msg.id, error: (e as Error).message });
  }
}

function stopPlayback() {
  const c = current;
  current = null;
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  if (c) {
    c.source.onended = null;
    try {
      c.source.stop();
    } catch {
      /* already stopped */
    }
    bridge().send('audio:level', 0);
    bridge().send('audio:ended', { id: c.id, stopped: true });
  }
}

bridge().on('audio:start', (m: { deviceId: string | null }) => void startCapture(m.deviceId));
bridge().on('audio:stop', () => void stopCapture());
bridge().on('audio:play', (m) => void playClip(m));
bridge().on('audio:stopPlayback', () => stopPlayback());
bridge().on('audio:devices', async () => {
  const d = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  bridge().send('audio:devices', d.filter((x) => x.kind === 'audioinput' || x.kind === 'audiooutput').map((x) => ({ id: x.deviceId, label: x.label, kind: x.kind })));
});
bridge().send('audio:ready');
