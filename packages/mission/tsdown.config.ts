/**
 * Package-local tsdown config: host-side package (no client half since the
 * tab/Remote retirement). The Client pass emits nothing for this package.
 */
import { defineConfig } from 'tsdown'

export default defineConfig(({ env }) => {
  const client = env?.DSH_BUILD_FACE === 'client'
  return {
    entry: client ? '' : ['lib/types/{index,cli,tool}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})
