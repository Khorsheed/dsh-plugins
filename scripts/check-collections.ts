#!/usr/bin/env node
/**
 * Install-collection checker and README generator.
 *
 * A bundle is a capability unit; a collection is a scene: what an ordinary
 * user installs in one command (basic plus one mode suite). Collections are
 * data, not packages — `collections.json` at the repo root is their single
 * source, and `dsh plugin add` takes several package names at once (the CLI
 * forwards its arguments to pnpm), so a collection needs no meta package and
 * no host support.
 *
 * Checked:
 *
 *   1. shape — unique ids, zh/en titles, a non-empty bundle list without
 *      repeats;
 *   2. membership — every listed name is a repo package declaring
 *      `dsh.bundle.kind` `family` or `mode`, and every mode suite appears in
 *      at least one collection;
 *   3. host range — the bundles' `engines.dsh` ranges intersect, so a
 *      collection never installs a set no host version boots;
 *   3b. held back — a collection marked `"unpublished": true` is a mode suite
 *      not released yet: its own README block is still generated, but the
 *      root README skips it, and no published collection may list a bundle
 *      that appears only in unpublished ones (its install command would fail).
 *   4. generated text — the install commands in README.md / README.en.md and
 *      in each mode suite's README pair are current (between the
 *      `collections:` / `collection:` markers).
 *
 * `pnpm map:collections` (`--write`) regenerates the README blocks;
 * `pnpm check:collections` fails on any finding. The spec re-runs the check
 * against the real tree.
 *
 * Exit code 0 = clean; 1 = findings.
 * @module scripts/check-collections
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface Collection {
  readonly id: string
  readonly title: { readonly zh: string; readonly en: string }
  readonly bundles: readonly string[]
  /** Not released yet: kept out of the root README and out of published collections. */
  readonly unpublished?: boolean
}

export interface Finding {
  readonly path: string
  readonly kind: 'shape' | 'membership' | 'host-range' | 'generated'
  readonly detail: string
}

interface BundlePackage {
  readonly name: string
  readonly dir: string
  readonly kind: string
  readonly engines?: string
}

const BUNDLE_KINDS = new Set(['family', 'mode'])
const INSTALL = 'dsh plugin --profile web add'

/** Read collections.json. */
export function loadCollections(repoRoot: string): Collection[] {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'collections.json'), 'utf8')) as { collections: Collection[] }
  return raw.collections
}

/** Every repo package that declares a family or mode bundle, by npm name. */
function loadBundles(repoRoot: string): Map<string, BundlePackage> {
  const out = new Map<string, BundlePackage>()
  const packagesDir = join(repoRoot, 'packages')
  for (const dir of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const json = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      engines?: { dsh?: string }
      dsh?: { bundle?: { kind?: string } }
    }
    const kind = json.dsh?.bundle?.kind
    if (json.name === undefined || kind === undefined || !BUNDLE_KINDS.has(kind)) continue
    out.set(json.name, { name: json.name, dir, kind, engines: json.engines?.dsh })
  }
  return out
}

/** `x.y.z` or `x.y.z-tag.n` → comparable parts (prerelease sorts before its release). */
function parseVersion(version: string): { core: number[]; pre: Array<string | number> } {
  const [core, pre] = version.split('-', 2) as [string, string | undefined]
  return {
    core: core.split('.').map(Number),
    pre: pre === undefined ? [] : pre.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part)),
  }
}

/** Semver precedence: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const diff = (va.core[i] ?? 0) - (vb.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (va.pre.length === 0 || vb.pre.length === 0) return vb.pre.length - va.pre.length
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i]
    const y = vb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

/**
 * The intersection of `>=lo <hi` ranges (the repo's engines.dsh form), or
 * undefined when it is empty. A range missing a bound leaves that side open.
 */
export function intersectRanges(ranges: readonly string[]): { lo?: string; hi?: string } | undefined {
  let lo: string | undefined
  let hi: string | undefined
  for (const range of ranges) {
    for (const part of range.trim().split(/\s+/)) {
      const ge = /^>=(.+)$/.exec(part)
      const lt = /^<(.+)$/.exec(part)
      if (ge) lo = lo === undefined || compareVersions(ge[1]!, lo) > 0 ? ge[1] : lo
      else if (lt) hi = hi === undefined || compareVersions(lt[1]!, hi) < 0 ? lt[1] : hi
    }
  }
  if (lo !== undefined && hi !== undefined && compareVersions(lo, hi) >= 0) return undefined
  return { lo, hi }
}

/** The one-line install command for a collection. */
export function installCommand(collection: Collection): string {
  return `${INSTALL} ${collection.bundles.join(' ')}`
}

const ROOT_MARK = { start: '<!-- collections:start -->', end: '<!-- collections:end -->' }
const PACK_MARK = { start: '<!-- collection:start -->', end: '<!-- collection:end -->' }

/** The generated root README block, per language. */
export function rootBlock(collections: readonly Collection[], lang: 'zh' | 'en'): string {
  const head = lang === 'zh'
    ? '<!-- 由 pnpm map:collections 依 collections.json 生成，勿手改 -->\n\n| 集合 | 一条命令装齐 |\n| --- | --- |'
    : '<!-- generated by pnpm map:collections from collections.json; do not edit by hand -->\n\n| Collection | One command |\n| --- | --- |'
  const rows = collections.filter(c => !c.unpublished).map(c => `| ${c.title[lang]} | \`${installCommand(c)}\` |`)
  return [ROOT_MARK.start, head, ...rows, ROOT_MARK.end].join('\n')
}

/** The generated block in a mode suite's README, per language. */
export function packBlock(collection: Collection, lang: 'zh' | 'en'): string {
  const lead = lang === 'zh'
    ? `推荐连同基础体验一起装(「${collection.title.zh}」集合,一条命令):`
    : `Recommended: install it together with the basic suite (the ${collection.title.en} collection, one command):`
  return [PACK_MARK.start, lead, '', '```sh', installCommand(collection), '```', PACK_MARK.end].join('\n')
}

/** Replace the marked block; undefined when the markers are absent. */
function replaceBlock(text: string, mark: { start: string; end: string }, block: string): string | undefined {
  const a = text.indexOf(mark.start)
  const b = text.indexOf(mark.end)
  if (a < 0 || b < a) return undefined
  return text.slice(0, a) + block + text.slice(b + mark.end.length)
}

/** The scene collection of a mode suite: the one listing it with basic and nothing else. */
function sceneOf(collections: readonly Collection[], name: string): Collection | undefined {
  return collections.find(c => c.bundles.length === 2 && c.bundles.includes(name))
}

/** Every README the generator owns, with the text it should hold. */
function expectedReadmes(repoRoot: string, collections: readonly Collection[], bundles: Map<string, BundlePackage>):
  Array<{ path: string; mark: typeof ROOT_MARK; block: string }> {
  const out: Array<{ path: string; mark: typeof ROOT_MARK; block: string }> = [
    { path: 'README.md', mark: ROOT_MARK, block: rootBlock(collections, 'zh') },
    { path: 'README.en.md', mark: ROOT_MARK, block: rootBlock(collections, 'en') },
  ]
  for (const bundle of bundles.values()) {
    if (bundle.kind !== 'mode') continue
    const scene = sceneOf(collections, bundle.name)
    if (scene === undefined) continue
    out.push({ path: `packages/${bundle.dir}/README.md`, mark: PACK_MARK, block: packBlock(scene, 'zh') })
    out.push({ path: `packages/${bundle.dir}/README.en.md`, mark: PACK_MARK, block: packBlock(scene, 'en') })
  }
  return out.filter(entry => existsSync(join(repoRoot, entry.path)))
}

/** Run every check; with `write`, regenerate the README blocks first. */
export function checkCollections(repoRoot: string, options: { write?: boolean } = {}): Finding[] {
  const findings: Finding[] = []
  const collections = loadCollections(repoRoot)
  const bundles = loadBundles(repoRoot)
  const ids = new Set<string>()

  for (const c of collections) {
    const where = `collections.json#${c.id}`
    if (ids.has(c.id)) findings.push({ path: where, kind: 'shape', detail: 'duplicate collection id' })
    ids.add(c.id)
    if (!c.title?.zh || !c.title?.en) findings.push({ path: where, kind: 'shape', detail: 'needs both zh and en titles' })
    if (c.bundles.length === 0) findings.push({ path: where, kind: 'shape', detail: 'lists no bundle' })
    if (new Set(c.bundles).size !== c.bundles.length) findings.push({ path: where, kind: 'shape', detail: 'lists a bundle twice' })

    const ranges: string[] = []
    for (const name of c.bundles) {
      const bundle = bundles.get(name)
      if (bundle === undefined) {
        findings.push({ path: where, kind: 'membership', detail: `${name} is not a family or mode bundle in packages/` })
        continue
      }
      if (bundle.engines !== undefined) ranges.push(bundle.engines)
    }
    if (intersectRanges(ranges) === undefined) {
      findings.push({ path: where, kind: 'host-range', detail: `engines.dsh ranges do not intersect: ${ranges.join(' ∩ ')}` })
    }
  }

  // A mode suite whose scene collection is unpublished is held back; a
  // published collection naming it would hand users a failing install.
  const heldBack = new Set(collections.filter(c => c.unpublished)
    .flatMap(c => c.bundles.filter(name => bundles.get(name)?.kind === 'mode')))
  for (const c of collections) {
    if (c.unpublished) continue
    for (const name of c.bundles) {
      if (heldBack.has(name)) {
        findings.push({ path: `collections.json#${c.id}`, kind: 'membership', detail: `${name} is held back (its collection is unpublished) but listed here` })
      }
    }
  }

  for (const bundle of bundles.values()) {
    if (bundle.kind !== 'mode') continue
    if (!collections.some(c => c.bundles.includes(bundle.name))) {
      findings.push({ path: `packages/${bundle.dir}`, kind: 'membership', detail: `mode suite ${bundle.name} is in no collection` })
    }
  }

  for (const entry of expectedReadmes(repoRoot, collections, bundles)) {
    const file = join(repoRoot, entry.path)
    const text = readFileSync(file, 'utf8')
    const next = replaceBlock(text, entry.mark, entry.block)
    if (next === undefined) {
      findings.push({ path: entry.path, kind: 'generated', detail: `missing the ${entry.mark.start} … ${entry.mark.end} block` })
    } else if (next !== text) {
      if (options.write) writeFileSync(file, next)
      else findings.push({ path: entry.path, kind: 'generated', detail: 'install commands are stale — run pnpm map:collections' })
    }
  }
  return findings
}

/** CLI entry: `--write` regenerates; otherwise print findings and exit non-zero on any. */
export function main(repoRoot: string, argv: readonly string[] = []): number {
  const write = argv.includes('--write')
  const findings = checkCollections(repoRoot, { write })
  if (findings.length === 0) {
    process.stdout.write(`check-collections: ${loadCollections(repoRoot).length} collection(s) consistent${write ? ' (READMEs written)' : ''}\n`)
    return 0
  }
  for (const f of findings) process.stderr.write(`${f.path}: ${f.kind} — ${f.detail}\n`)
  process.stderr.write(`check-collections: ${findings.length} finding(s)\n`)
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2)))
}
