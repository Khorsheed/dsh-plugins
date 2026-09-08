/**
 * Verify (or re-record) bilingual-pair consistency records for this repo.
 *
 * Every English Markdown doc with a Simplified Chinese counterpart carries a
 * `<name>.i18n.yaml` sidecar holding the git blob hash of each side as of the
 * last confirmed-consistent state. After editing either side, bring the other
 * along and re-record. Semantics mirror the harness repo's
 * verify-translation-pairing, scoped down to this repo's layout.
 *
 * Usage:
 *   tsx scripts/verify-translation-pairing.mts            # verify all sidecars
 *   tsx scripts/verify-translation-pairing.mts --write [--all | <source.md>...]
 *
 * @module dsh-plugins/scripts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** One sidecar record: English path, Chinese path, sidecar path. */
interface Pair {
  source: string
  zh: string
  meta: string
}

const HEADER = (source: string): string =>
  '# Bilingual-pair consistency record: the git blob hash of each side as of the\n' +
  '# last confirmed-consistent state. Both languages carry equal authority; after\n' +
  '# editing either side, bring the other along and re-record with:\n' +
  `#   pnpm run verify-translation-pairing --write ${source}\n`

/** Git blob hash of a worktree file — the same digest `git hash-object` assigns. */
function blobHash(path: string): string {
  return execFileSync('git', ['hash-object', path], { cwd: root, encoding: 'utf8' }).trim()
}

/** Parse a sidecar into its recorded hashes (lines `path: <40-hex>`). */
function parseRecord(meta: string): Map<string, string> {
  const record = new Map<string, string>()
  for (const line of readFileSync(meta, 'utf8').split('\n')) {
    const match = /^([^:#]+\.md): ([0-9a-f]{40})$/.exec(line.trim())
    if (match !== null) record.set(match[1]!, match[2]!)
  }
  return record
}

const pairs: Pair[] = globSync('{packages,profiles,.agents,docs}/**/*.i18n.yaml', { cwd: root })
  .filter((meta) => !meta.includes('/archived/'))
  .map((meta) => {
    const base = meta.replace(/\.i18n\.yaml$/, '')
    // Two layouts: EN-first (X.md + X.zh.md) and ZH-first (X.md is Chinese,
    // X.en.md the English mirror — the repo's README convention).
    if (existsSync(`${base}.zh.md`)) return { meta, source: `${base}.md`, zh: `${base}.zh.md` }
    return { meta, source: `${base}.en.md`, zh: `${base}.md` }
  })

const args = process.argv.slice(2)
const write = args[0] === '--write'
const named = args.slice(1).filter((a) => a !== '--all')
const selected = named.length > 0 && !args.includes('--all')
  ? pairs.filter((p) => named.includes(p.source))
  : pairs

let stale = 0
for (const pair of selected) {
  const record = parseRecord(pair.meta)
  const actual = new Map([[pair.source, blobHash(pair.source)], [pair.zh, blobHash(pair.zh)]])
  const drift = [...actual].filter(([path, hash]) => record.get(path) !== hash)
  if (drift.length === 0) continue
  stale += 1
  if (write) {
    writeFileSync(pair.meta,
      HEADER(pair.source) + [...actual].map(([path, hash]) => `${path}: ${hash}\n`).join(''))
    console.log(`recorded ${pair.meta}`)
  } else {
    console.error(`stale ${pair.meta}: ${drift.map(([path]) => path).join(', ')} changed since last record`)
  }
}
if (!write && stale > 0) {
  console.error(`${stale} pair(s) out of sync — re-record with pnpm run verify-translation-pairing --write --all`)
  process.exit(1)
}
console.log(`${selected.length} pair(s) ${write ? 'recorded' : 'in sync'}`)
