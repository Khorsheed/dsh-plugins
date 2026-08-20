/**
 * Package-local tsdown config: host-side package (no client half yet — the
 * session tab is M4). The CLI ships as a published artifact (lib/cli.js,
 * wired to the `dsh-mission` bin and the `./cli` export). The Client pass
 * emits nothing for this package.
 */
import { defineConfig } from 'tsdown'

export default defineConfig(({ env }) => {
  const client = env?.DSH_BUILD_FACE === 'client'
  return {
    entry: client ? '' : ['lib/types/{index,invariant,cli}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})
