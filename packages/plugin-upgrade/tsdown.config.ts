import { defineConfig } from 'tsdown'

// Host-only package: bundle the tsc emit (index + invariant). There is no
// client face and no typert surface — the whole deliverable besides the two
// entries is the shipped skills/ payload, which `files` carries verbatim.
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
