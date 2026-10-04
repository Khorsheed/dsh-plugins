import { defineConfig } from 'tsdown'

// Host-only: the genre's UI renders inside the canvas through its child
// slots, so this package ships no browser bundle of its own.
export default defineConfig({
  name: '@khorsheed/dsh-canvas-novel',
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/types.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
