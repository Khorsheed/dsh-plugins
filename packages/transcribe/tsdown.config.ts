import { defineConfig } from 'tsdown'

// The speech worker is its own entry: the service forks it as a separate
// Node process (`lib/speech-worker.js`), so it must not be inlined.
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/types.js', 'lib/types/speech-worker.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
