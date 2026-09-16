#!/usr/bin/env node
/**
 * The `dsh-lab` bin entry. Run from source: `node --import tsx/esm
 * src/cli.ts <command>`; as a published package: the `dsh-lab` bin or
 * `node lib/cli.js <command>`.
 *
 * This module must stay a THIN entry that nothing else imports: tsdown moves
 * any module shared between entries into a chunk, and an entry guard stranded
 * in a chunk compares the chunk's URL against argv[1] — never equal, so the
 * CLI body would never run. The implementation lives in `cli-core.ts`.
 */
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runCli } from './cli-core.ts'

// Direct invocation (`tsx src/cli.ts`, `node lib/cli.js`) vs being imported.
// Node resolves an ESM main module to its REAL path, so `import.meta.url` is
// the resolved file while `process.argv[1]` is the path as it was typed.
// Invoked through a symlink — pnpm's `.bin/<name>` link above all — the two
// never match, and the body below silently never runs: exit 0, no output,
// nothing to tell the caller the CLI did nothing. Resolve argv[1] the same
// way before comparing. A path that cannot be resolved keeps its literal
// form, which is exactly what the comparison used before.
let entryPath = process.argv[1]
if (entryPath !== undefined) {
  try { entryPath = realpathSync(entryPath) } catch { /* unresolvable — compare the literal path */ }
}
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code
  })
    .catch((error: unknown) => {
      process.stderr.write(`lab: ${String(error)}\n`)
      process.exitCode = 1
    })
}
