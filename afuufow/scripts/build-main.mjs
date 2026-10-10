import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';

const common = { platform: 'node', format: 'cjs', target: 'node22', bundle: true, sourcemap: true, logLevel: 'info', legalComments: 'none' };
const evalOnly = process.argv.includes('--eval');

if (!evalOnly) {
  rmSync('dist/main', { recursive: true, force: true });
  rmSync('dist/ml', { recursive: true, force: true });
  mkdirSync('dist', { recursive: true });
  await build({ ...common, entryPoints: { index: 'src/main/index.ts' }, outdir: 'dist/main', external: ['electron', 'sherpa-onnx-node'] });
  await build({ ...common, entryPoints: { 'preload-ui': 'src/main/preload-ui.ts', 'preload-worker': 'src/main/preload-worker.ts' }, outdir: 'dist/main', external: ['electron'] });
  await build({ ...common, entryPoints: { worker: 'src/ml/worker.ts' }, outdir: 'dist/ml', external: ['sherpa-onnx-node'] });
} else {
  await build({ ...common, entryPoints: { 'eval-speech': 'scripts/eval-speech.ts' }, outdir: 'dist/eval', external: ['sherpa-onnx-node'] });
}
