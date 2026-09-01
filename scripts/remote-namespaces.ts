#!/usr/bin/env node
/**
 * remote-namespaces — the two namespaces every Remote-bearing package carries,
 * extracted from source rather than transcribed.
 *
 * A Remote has a **cordis service key** (how the host addresses it in-process)
 * and a **wire namespace** (what the browser calls: `remote.<wire>.*`). For
 * most packages the two are the same string and the distinction is invisible;
 * `local-files` and `worktrees` split them, and that is exactly where a
 * hand-copied table goes wrong — uniformity is what hides the exception.
 *
 * On 2026-09-01 two agents independently built this table by hand and each
 * caught a different half: one read the constructor's first argument (the
 * service key), the other the `namespace` option (the wire name). Both tables
 * were wrong in a way that fails silently — probing the wrong layer looks
 * exactly like a plugin that unmounted cleanly.
 *
 * **Uninstall verification probes the WIRE column**: it models whether the
 * user can still reach the capability, and it is the stable contract (browser
 * code depends on it), where the service key is refactorable internal naming.
 *
 * Usage: tsx scripts/remote-namespaces.ts [--json]
 * @module scripts/remote-namespaces
 */
import { globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

export interface RemoteNamespace {
  readonly pkg: string
  /** What the browser calls — the column uninstall verification probes. */
  readonly wire: string
  /** How the host addresses the service in-process. */
  readonly serviceKey: string
  readonly split: boolean
}

/** `super(ctx, 'key')` or `super(ctx, 'key', { namespace: 'wire' })`, with the
 * options object allowed to sit on following lines. */
const SUPER_RE = /super\(\s*ctx\s*,\s*'([^']+)'\s*(?:,\s*\{([\s\S]{0,200}?)\})?\s*\)/g
const NAMESPACE_RE = /namespace\s*:\s*'([^']+)'/

export function extract(source: string, pkg: string): RemoteNamespace[] {
  const found: RemoteNamespace[] = []
  for (const [, serviceKey, options] of source.matchAll(SUPER_RE)) {
    const wire = (options === undefined ? undefined : NAMESPACE_RE.exec(options)?.[1]) ?? serviceKey!
    found.push({ pkg, wire, serviceKey: serviceKey!, split: wire !== serviceKey })
  }
  return found
}

export function scan(): RemoteNamespace[] {
  const rows: RemoteNamespace[] = []
  for (const file of globSync('packages/*/src/**/*.ts', { cwd: root })) {
    const pkg = file.split('/')[1]!
    rows.push(...extract(readFileSync(join(root, file), 'utf8'), pkg))
  }
  return rows.sort((a, b) => a.pkg.localeCompare(b.pkg))
}

export function main(): void {
  const rows = scan()
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
    return
  }
  const width = Math.max(...rows.map((r) => r.pkg.length))
  process.stdout.write(`${'package'.padEnd(width)}  wire (probe this)      cordis service key\n`)
  for (const r of rows) {
    process.stdout.write(`${r.pkg.padEnd(width)}  ${r.wire.padEnd(21)}  ${r.serviceKey}${r.split ? '   ← split' : ''}\n`)
  }
  process.stdout.write(`\n${rows.length} Remote(s), ${rows.filter((r) => r.split).length} with a split namespace\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) main()
