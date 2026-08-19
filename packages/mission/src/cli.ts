#!/usr/bin/env node
/**
 * The `dsh-mission` bin entry. Run from source: `node --import tsx/esm
 * src/cli.ts <command>`; as a published package: the `dsh-mission` bin or
 * `node lib/cli.js <command>`.
 *
 * This module must stay a THIN entry that nothing else imports: tsdown moves
 * any module shared between entries into a chunk, and an entry guard stranded
 * in a chunk compares the chunk's URL against argv[1] — never equal, so the
 * CLI body would never run (the silent-exit-0 bug the bin smoke test in
 * tests/bin.spec.ts now pins). The implementation lives in `cli-core.ts`.
 */
import { pathToFileURL } from 'node:url'
import { runCli } from './cli-core.ts'

// Direct invocation (`tsx src/cli.ts`, `node lib/cli.js`) vs being imported.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void runCli(process.argv.slice(2), {
    stdout: line => process.stdout.write(line),
    stderr: line => process.stderr.write(line),
  }).then((code) => { process.exitCode = code })
    .catch((error: unknown) => {
      process.stderr.write(`mission: ${String(error)}\n`)
      process.exitCode = 1
    })
}
