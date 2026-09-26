#!/usr/bin/env tsx
/**
 * sync-icon-artwork: regenerate each package's self-owned icon module
 * (`packages/<pkg>/src/client/icons.tsx`) from the upstream ui-primitives
 * artwork, so client bundles carry the rc.1 glyphs inline.
 *
 * Why this exists: the 0.1.5 and rc.1 host lines share NO icon export name —
 * 0.1.5 carries pixel suffixes (`IconCheckOutline16`), rc.1 carries weight
 * suffixes (`IconCheckOutlineMedium`) — so an externalized import of the rc.1
 * name resolves to undefined on 0.1.5 and the slot crashes with React #130
 * (observed on session header actions / chat nodes, 2026-09-26). Inlining the
 * artwork is the dsh-client-store answer: pure SVG, no cross-plugin runtime
 * identity, a per-bundle copy is behavior-identical. The npm artifact ships
 * no `src/`, so the `./src/*` subpath cannot supply it at build time; the
 * artwork is instead flattened from the harness checkout (DSH_HARNESS) into a
 * committed per-package module — never hand-edit those files.
 *
 * Usage: tsx scripts/sync-icon-artwork.mts [--check]
 *   (no flag)  rewrite every packages/<pkg>/src/client/icons.tsx in place
 *   --check    verify all generated modules are current; exit 1 on drift
 *
 * DSH_HARNESS (default ~/code/deepseek-harness) locates the upstream source:
 * packages/client/ui-primitives/src/icons/{index.tsx,shared-artwork.tsx}.
 * @module dsh-plugins/scripts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

/* ---------------- upstream parsing ---------------- */

/** One flattened artwork: the svg JSX block plus its own size default. */
export interface ArtworkSource {
  readonly sizeDefault: number
  readonly svg: string
}

/** A weight wrapper: which artwork it renders and with which stroke constant. */
interface WrapperSource {
  readonly artwork: string
  readonly strokeConst: string
}

export interface UpstreamIcons {
  /** Every artwork const across index.tsx and shared-artwork.tsx. */
  readonly artworks: ReadonlyMap<string, ArtworkSource>
  /** Every exported `Icon*` wrapper. */
  readonly wrappers: ReadonlyMap<string, WrapperSource>
  /** Stroke constant values (`ICON_REGULAR_STROKE` → 1, …). */
  readonly strokeValues: ReadonlyMap<string, string>
  /** `SHIELD_OUTLINE_PATH` and similar shared path consts, name → literal. */
  readonly pathConsts: ReadonlyMap<string, string>
  /** Upstream provenance for generated headers (package version + HEAD). */
  readonly origin: string
}

const WRAPPER_RE = /export const (Icon\w+) = \(props: IconProps\) => \(\s*\n\s*<(\w+Artwork) \{\.\.\.props\} strokeWidth=\{(ICON_\w+_STROKE)\} \/>\s*\n\)/g
const ARTWORK_RE = /const (\w+Artwork) = \(\{ size = (\d+), className(?:, strokeWidth)? \}: \w+\) => \(\s*\n([\s\S]*?)\n\)\n/g
const COMPOSITE_RE = /const (\w+Artwork) = \(props: \w+\) => \(\s*\n\s*<(\w+Artwork) \{\.\.\.props\} size=\{props\.size \?\? (\d+)\} \/>\s*\n\)/g
const STROKE_CONST_RE = /export const (ICON_\w+_STROKE) = ([\d.]+)/g
const PATH_CONST_RE = /export const ([A-Z][A-Z0-9_]+_PATH) = ('[^']*')/g

/**
 * Parse the upstream icons module pair into wrappers, artworks, and consts.
 * Throws on an unrecognized shape rather than emitting a partial extraction —
 * the upstream module is uniform by convention, and a silent miss would
 * surface only as a broken bundle.
 * @param indexSource - icons/index.tsx source text.
 * @param sharedSource - icons/shared-artwork.tsx source text.
 * @param origin - provenance string for generated headers.
 * @returns the parsed upstream picture.
 */
export function parseUpstreamIcons(indexSource: string, sharedSource: string, origin: string): UpstreamIcons {
  const strokeValues = new Map<string, string>()
  for (const m of indexSource.matchAll(STROKE_CONST_RE)) strokeValues.set(m[1]!, m[2]!)
  if (strokeValues.size === 0) throw new Error('sync-icon-artwork: no ICON_*_STROKE constants found upstream — the module shape changed')
  const pathConsts = new Map<string, string>()
  for (const m of indexSource.matchAll(PATH_CONST_RE)) pathConsts.set(m[1]!, m[2]!)

  const artworks = new Map<string, ArtworkSource>()
  for (const source of [indexSource, sharedSource]) {
    for (const m of source.matchAll(ARTWORK_RE)) {
      artworks.set(m[1]!, { sizeDefault: Number(m[2]), svg: m[3]! })
    }
  }
  // Composite artworks (an artwork rendering another with a size override):
  // flatten eagerly — resolve to the inner artwork carrying the override.
  for (const source of [indexSource, sharedSource]) {
    for (const m of source.matchAll(COMPOSITE_RE)) {
      const inner = artworks.get(m[2]!)
      if (inner === undefined) throw new Error(`sync-icon-artwork: composite artwork ${m[1]} references unknown ${m[2]}`)
      artworks.set(m[1]!, { sizeDefault: Number(m[3]), svg: inner.svg })
    }
  }

  const wrappers = new Map<string, WrapperSource>()
  const expectedArtworks = new Set<string>()
  for (const m of indexSource.matchAll(WRAPPER_RE)) {
    wrappers.set(m[1]!, { artwork: m[2]!, strokeConst: m[3]! })
    expectedArtworks.add(m[2]!)
  }
  if (wrappers.size === 0) throw new Error('sync-icon-artwork: no Icon* wrappers found upstream — the module shape changed')
  for (const name of expectedArtworks) {
    if (!artworks.has(name)) throw new Error(`sync-icon-artwork: wrapper references artwork ${name}, found in neither icons module`)
  }
  return { artworks, wrappers, strokeValues, pathConsts, origin }
}

/* ---------------- rendering ---------------- */

/** The props interface every generated module carries (upstream-aligned). */
const ICON_PROPS = `/** Shared props for every product icon component (mirrors the upstream IconProps). */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}`

/**
 * Flatten one wrapper+artwork pair into a self-contained component: the
 * stroke constant becomes a literal, the artwork's size default survives,
 * and shared path consts are reported back through `usedConsts`.
 * @param upstream - the parsed upstream picture.
 * @param name - the exported icon name (e.g. IconCheckOutlineMedium).
 * @param usedConsts - accumulator for shared path consts the svg references.
 * @returns the component source.
 */
export function renderIconComponent(upstream: UpstreamIcons, name: string, usedConsts: Set<string>): string {
  const wrapper = upstream.wrappers.get(name)
  if (wrapper === undefined) {
    throw new Error(`sync-icon-artwork: no upstream icon named ${name} — the harness checkout's ui-primitives does not export it`)
  }
  const artwork = upstream.artworks.get(wrapper.artwork)!
  const stroke = upstream.strokeValues.get(wrapper.strokeConst)!
  let svg = artwork.svg
  if (svg.includes('strokeWidth={strokeWidth}')) svg = svg.replace('strokeWidth={strokeWidth}', `strokeWidth={${stroke}}`)
  for (const constName of upstream.pathConsts.keys()) {
    if (svg.includes(`{${constName}}`)) usedConsts.add(constName)
  }
  return `export const ${name} = ({ size = ${artwork.sizeDefault}, className }: IconProps) => (\n${svg}\n)`
}

/**
 * Render one package's self-owned icon module.
 * @param upstream - the parsed upstream picture.
 * @param packageName - the owning package (for the header only).
 * @param names - the icon names this package uses.
 * @returns the complete icons.tsx source.
 */
export function renderIconModule(upstream: UpstreamIcons, packageName: string, names: readonly string[]): string {
  const sorted = [...new Set(names)].sort()
  const usedConsts = new Set<string>()
  const components = sorted.map(name => renderIconComponent(upstream, name, usedConsts))
  const consts = [...usedConsts].sort().map(name => `const ${name} = ${upstream.pathConsts.get(name)!}`)
  return [
    '/**',
    ` * Generated by scripts/sync-icon-artwork.mts from @deepseek-ai/dsh-client-ui-primitives`,
    ` * (${upstream.origin}) — do not edit by hand. The 0.1.5 and rc.1 host lines`,
    ` * share no icon export name, so the rc.1 artwork is inlined here: pure SVG,`,
    ` * no host runtime identity, identical on every line. Re-run the generator`,
    ` * after adding an icon import or bumping the harness checkout.`,
    ' *',
    ` * @module ${packageName}/client`,
    ' */',
    '',
    ICON_PROPS,
    '',
    ...consts.flatMap(c => [c, '']),
    ...components.flatMap(c => [c, '']),
  ].join('\n')
}

/* ---------------- usage collection ---------------- */

const PRIMITIVES_IMPORT_RE = /import\s*(type\s+)?\{([^}]*)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/g

/**
 * Collect the icon names one package's client sources import from the
 * ui-primitives package root. Type-only imports are erased at build time and
 * never reach the bundle, so they are ignored — except the inline
 * `type IconProps` riding a value import, which the generated module exports.
 * @param packageDir - the package directory.
 * @returns the sorted icon names in use.
 */
export function collectIconUsage(packageDir: string): string[] {
  const used = new Set<string>()
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      const text = readFileSync(path, 'utf8')
      for (const m of text.matchAll(PRIMITIVES_IMPORT_RE)) {
        // A whole-statement `import type` is erased at build time — nothing to inline.
        if (m[1] !== undefined) continue
        for (const spec of m[2]!.split(',')) {
          const name = spec.trim().replace(/^type\s+/, '')
          // IconProps is a type the generated module always exports; it needs no artwork.
          if (/^Icon[A-Z]/.test(name) && name !== 'IconProps') used.add(name)
        }
      }
    }
  }
  walk(join(packageDir, 'src', 'client'))
  return [...used].sort()
}

/* ---------------- main ---------------- */

const GENERATED_MARKER = 'Generated by scripts/sync-icon-artwork.mts'

function harnessOrigin(harness: string): string {
  const pkgPath = join(harness, 'packages/client/ui-primitives/package.json')
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version as string
  let head = 'unknown'
  try { head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: harness, encoding: 'utf8' }).trim() } catch { /* provenance only */ }
  return `v${version}, harness ${head}`
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')
  const repoRoot = new URL('..', import.meta.url).pathname
  const harness = process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness')
  const iconsDir = join(harness, 'packages/client/ui-primitives/src/icons')
  if (!existsSync(join(iconsDir, 'index.tsx'))) {
    throw new Error(`sync-icon-artwork: harness checkout not found at ${harness} — set DSH_HARNESS to a deepseek-harness clone`)
  }
  const upstream = parseUpstreamIcons(
    readFileSync(join(iconsDir, 'index.tsx'), 'utf8'),
    readFileSync(join(iconsDir, 'shared-artwork.tsx'), 'utf8'),
    harnessOrigin(harness),
  )

  const packagesRoot = join(repoRoot, 'packages')
  const stale: string[] = []
  for (const dir of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!dir.isDirectory() || !existsSync(join(packagesRoot, dir.name, 'package.json'))) continue
    const packageDir = join(packagesRoot, dir.name)
    const packageName = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).name as string
    const icons = collectIconUsage(packageDir)
    const target = join(packageDir, 'src', 'client', 'icons.tsx')
    if (icons.length === 0) {
      // A package that stopped using icons keeps no generated shell.
      if (existsSync(target) && readFileSync(target, 'utf8').includes(GENERATED_MARKER)) {
        throw new Error(`sync-icon-artwork: ${packageName} no longer imports upstream icons — delete ${relative(repoRoot, target)} by hand`)
      }
      continue
    }
    if (existsSync(target) && !readFileSync(target, 'utf8').includes(GENERATED_MARKER)) {
      throw new Error(`sync-icon-artwork: ${relative(repoRoot, target)} exists without the generated marker — move its hand-written icons first (the canvas icons-local.tsx precedent)`)
    }
    const content = renderIconModule(upstream, packageName, icons)
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== content) stale.push(relative(repoRoot, target))
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target) && readFileSync(target, 'utf8') === content) {
      console.log(`sync-icon-artwork: ${packageName} unchanged (${icons.length} icon(s))`)
      continue
    }
    writeFileSync(target, content)
    console.log(`sync-icon-artwork: ${packageName} ← ${icons.length} icon(s)`)
  }
  if (check && stale.length > 0) {
    console.error(`sync-icon-artwork: ${stale.length} stale generated module(s):\n  ${stale.join('\n  ')}\nrun tsx scripts/sync-icon-artwork.mts to regenerate`)
    process.exitCode = 1
  } else if (check) {
    console.log('sync-icon-artwork: all generated icon modules current')
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop()!)
if (isMain) await main()
