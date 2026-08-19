/**
 * Package-local tsdown config: the datasets CLI ships as a published artifact
 * (lib/cli.js, wired to the `dsh-datasets` bin and the `./cli` export), so the
 * host pass emits the three entry points; the client pass emits nothing for
 * this host-side package (the session tab is M2).
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
