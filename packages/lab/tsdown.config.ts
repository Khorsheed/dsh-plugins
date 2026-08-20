/**
 * Package-local tsdown config: host-side package (no client half, no CLI yet
 * — the CLI is M2, the model tools are M3). The Client pass emits nothing for
 * this package.
 */
import { defineConfig } from 'tsdown'

export default defineConfig(({ env }) => {
  const client = env?.DSH_BUILD_FACE === 'client'
  return {
    entry: client ? '' : ['lib/types/{index,invariant}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})
