/**
 * The `dsh-eval` version stamp recorded in `run.meta.evalVersion`. It lives at
 * the top of `src/` (not beside the run loop in `run/`) because it locates
 * the package's own `package.json` relative to this module: one level below
 * the package root both here and in the bundled `lib/index.js`.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

let evalVersionCache: string | undefined

/** `dsh-eval` version: package version + repo HEAD short sha (version only when git is unavailable). */
export async function evalVersion(): Promise<string> {
  if (evalVersionCache !== undefined) return evalVersionCache
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
  const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
  const shortSha = await new Promise<string>((resolvePromise) => {
    execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)) }, (error, stdout) => {
      resolvePromise(error === null ? stdout.trim() : '')
    })
  })
  evalVersionCache = shortSha !== '' ? `${version}+${shortSha}` : version
  return evalVersionCache
}
