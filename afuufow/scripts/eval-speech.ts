/**
 * Speech recognition evaluation on YOUR audio.
 *
 *   npm run eval:speech -- --manifest path/to/manifest.jsonl --provider azure --limit 100
 *
 * manifest.jsonl: one JSON object per line: {"wav": "C:\\path\\clip.wav", "ref": "reference transcript"}
 *   (16 kHz mono 16-bit WAV; FLEURS Somali "so_so" test split works directly, see docs/SPEECH_EVALUATION.md)
 * Providers: azure (AFUUFOW_AZURE_KEY, --region), openai (AFUUFOW_OPENAI_KEY, --base-url, --model), local (needs an installed model)
 * Prints WER/CER/latency and writes <manifest>.<provider>.result.json. Nothing is invented: failures count as 100% errors.
 */
import * as fs from 'node:fs';
import { AzureSttProvider } from '../src/core/speech/stt/azure';
import { OpenAISttProvider } from '../src/core/speech/stt/openai';
import { summarise } from '../src/core/speech/metrics';
import type { SttProvider } from '../src/core/speech/stt/types';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : d;
};

function readWav16k(path: string): { pcm: Int16Array; seconds: number } {
  const b = fs.readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a WAV file: ' + path);
  let pos = 12;
  let fmt: { rate: number; ch: number; bits: number; fmt: number } | null = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { fmt: b.readUInt16LE(pos + 8), ch: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') {
      if (!fmt || fmt.rate !== 16000 || fmt.ch !== 1 || fmt.bits !== 16 || fmt.fmt !== 1) throw new Error(`${path}: need 16 kHz mono 16-bit PCM (got ${JSON.stringify(fmt)}); convert with: ffmpeg -i in.wav -ac 1 -ar 16000 -c:a pcm_s16le out.wav`);
      const end = Math.min(b.length, pos + 8 + size);
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset + pos + 8, b.byteOffset + end - ((end - pos - 8) % 2)));
      return { pcm, seconds: pcm.length / 16000 };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in ' + path);
}

async function main() {
  const manifest = arg('manifest');
  const provider = arg('provider', 'azure')!;
  if (!manifest) throw new Error('usage: --manifest file.jsonl --provider azure|openai [--limit N] [--lang so-SO]');
  const limit = Number(arg('limit', '0')) || Infinity;
  const lang = arg('lang', 'so-SO')!;
  let p: SttProvider;
  if (provider === 'azure') {
    const key = process.env.AFUUFOW_AZURE_KEY;
    if (!key) throw new Error('set AFUUFOW_AZURE_KEY');
    p = new AzureSttProvider(arg('region', 'eastus')!, () => key, lang);
  } else if (provider === 'openai') {
    const key = process.env.AFUUFOW_OPENAI_KEY ?? null;
    p = new OpenAISttProvider(arg('base-url', 'https://api.openai.com/v1')!, arg('model', 'gpt-4o-transcribe')!, () => key);
  } else throw new Error('unsupported provider ' + provider);

  const lines = fs.readFileSync(manifest, 'utf8').split('\n').filter(Boolean).slice(0, limit);
  const rows: Array<{ wav: string; ref: string; hyp: string; ms: number; seconds: number; failed?: boolean; error?: string }> = [];
  let i = 0;
  for (const line of lines) {
    const m = JSON.parse(line) as { wav: string; ref?: string; ref_norm?: string; ref_raw?: string };
    const ref = m.ref ?? m.ref_norm ?? m.ref_raw ?? '';
    try {
      const { pcm, seconds } = readWav16k(m.wav);
      const t0 = Date.now();
      const r = await p.transcribe(pcm, { language: lang });
      rows.push({ wav: m.wav, ref, hyp: r.text, ms: Date.now() - t0, seconds });
    } catch (e) {
      rows.push({ wav: m.wav, ref, hyp: '', ms: 0, seconds: 0, failed: true, error: (e as Error).message });
    }
    if (++i % 10 === 0) console.log(`${i}/${lines.length}`);
  }
  const summary = summarise(rows);
  const out = `${manifest}.${provider}.result.json`;
  fs.writeFileSync(out, JSON.stringify({ provider, lang, when: new Date().toISOString(), summary, rows }, null, 1));
  console.log(JSON.stringify(summary, null, 2));
  console.log('wrote', out);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
