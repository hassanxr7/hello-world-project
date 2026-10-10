import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Ship the face-detection models with the app so nothing is downloaded at run time. */
function copyAssets(): Plugin {
  return {
    name: 'afuufow-copy-assets',
    closeBundle() {
      const out = resolve(__dirname, 'dist/renderer/workers');
      mkdirSync(out, { recursive: true });
      const models = resolve(__dirname, 'node_modules/@vladmandic/human/models');
      const need = ['blazeface', 'facemesh', 'faceres', 'antispoof', 'liveness', 'iris'];
      mkdirSync(resolve(out, 'models'), { recursive: true });
      for (const n of need) for (const ext of ['json', 'bin']) cpSync(resolve(models, `${n}.${ext}`), resolve(out, 'models', `${n}.${ext}`));
      const wasm = resolve(__dirname, 'node_modules/@tensorflow/tfjs-backend-wasm/dist');
      if (existsSync(wasm)) cpSync(wasm, resolve(out, 'wasm'), { recursive: true, filter: (s) => !s.endsWith('.map') });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [react(), copyAssets()],
  // never pick up a PostCSS/Tailwind config from a parent folder (this app lives inside another repository)
  css: { postcss: {} },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
        'workers/audio': resolve(__dirname, 'src/workers/audio.html'),
        'workers/vision': resolve(__dirname, 'src/workers/vision.html'),
      },
    },
  },
});
