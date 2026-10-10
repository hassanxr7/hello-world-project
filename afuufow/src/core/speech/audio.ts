/** PCM helpers. All speech paths use 16 kHz mono signed 16-bit little-endian PCM. */

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToFloat(i: Int16Array): Float32Array {
  const out = new Float32Array(i.length);
  for (let k = 0; k < i.length; k++) out[k] = i[k]! / 0x8000;
  return out;
}

export function concatInt16(chunks: Int16Array[]): Int16Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** 44-byte RIFF/WAVE header. `dataBytes` may be 0xFFFFFFFF for unbounded streams. */
export function wavHeader(dataBytes: number, sampleRate = 16000, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(dataBytes === 0xffffffff ? 0xffffffff : 36 + dataBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

export function pcmToWav(pcm: Int16Array, sampleRate = 16000): Buffer {
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.concat([wavHeader(body.length, sampleRate), body]);
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += (pcm[i]! / 32768) ** 2;
  return Math.sqrt(s / pcm.length);
}

export function durationSec(pcm: Int16Array, rate = 16000): number {
  return pcm.length / rate;
}
