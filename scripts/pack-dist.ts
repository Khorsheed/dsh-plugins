/**
 * pack-dist: stage a BUILT workspace package into a deployable tarball under
 * a different npm scope. The manual rescope this automates (learned from
 * message-tools 0.4.x deploys): the package.json name/version/deps, the
 * cordis.patch.yml bundle row name, and every self-package reference inside
 * runtime `.js` artifacts (including the typert manifest's owner name) must
 * all carry the dist scope — missing any one either silently drops the plugin
 * from the composition or fails the profile boot.
 *
 * Usage:
 *   pnpm exec tsx scripts/pack-dist.ts --package packages/client/message-tools \
 *     --scope @khorsheed --version 0.4.4 --out /tmp/mt-dist
 *
 * Family packages (siblings dist'ed under the same scope, e.g. a host package
 * a client package peers on) must be named via `--family <name,name,...>` so
 * peer/dev dependency names, patch rows, and text artifacts all point at the
 * dist scope instead of the unpublished source scope.
 *
 * The package must be built first (lib/ present); the script fails loud on a
 * missing build or on stale lib/types files with no backing src file.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

/** Files copied from the package root into the staging dir when present. */
const STAGED_ROOT_FILES = ['package.json', 'README.md', 'README.zh.md', 'README.en.md', 'README.i18n.yaml', 'cordis.patch.yml']

/** Expand a `dir` + double-star + `<pattern>` files glob into the relative
 * paths present in the package, so pack-dist honors the same globs pnpm pack
 * does — e.g. the `skills` glob shipping the 3d-artifact / restart-guard
 * skill files. Supports the two shapes in use: recursive suffix match
 * (`<dir>/**&#47;*.ext`) and every file (`<dir>/**&#47;*`). Returns [] for any
 * other glob shape. */
function expandGlobEntry(packageDir: string, entry: string): string[] {
  const match = /^(.+?)\/\*\*\/(.+)$/.exec(entry)
  if (match === null) return []
  const [, root, rest] = match
  const rootDir = join(packageDir, root)
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) return []
  const suffix = rest === '*' ? '' : rest.replace(/^\*/, '')
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const name of readdirSync(join(packageDir, dir))) {
      const rel = join(dir, name)
      if (statSync(join(packageDir, rel)).isDirectory()) {
        stack.push(rel)
      } else if (suffix === '' || name.endsWith(suffix)) {
        out.push(rel)
      }
    }
  }
  return out
}

/**
 * Payload paths from the package's `files` field beyond what staging already
 * copies verbatim (the root documents above and lib/) — e.g. ankh-guard's
 * `scripts/dsh-watchdog.sh` and its supervisor installers, which the watchdog
 * cannot ship without. Glob entries are skipped unless a `packageDir` is given,
 * in which case `dir` double-star globs (e.g. the `skills` glob) are expanded
 * against it; the lib globs stay covered by the recursive lib/ copy.
 */
export function filesDeclaredExtras(files: readonly string[] = [], packageDir?: string): string[] {
  const out: string[] = []
  for (const entry of files) {
    if (entry === 'lib' || entry.startsWith('lib/') || (STAGED_ROOT_FILES as readonly string[]).includes(entry)) continue
    if (entry.includes('*')) {
      if (packageDir !== undefined) out.push(...expandGlobEntry(packageDir, entry))
      continue
    }
    out.push(entry)
  }
  return out
}

export interface PackDistOptions {
  /** Workspace package directory (must contain src/ and a built lib/). */
  readonly packageDir: string
  /** Dist npm scope, e.g. '@khorsheed'. */
  readonly scope: string
  /** Dist version for the tarball. */
  readonly version: string
  /** Directory receiving the tarball. */
  readonly outDir: string
  /** Source names of sibling packages dist'ed under the same scope (each becomes `<scope>/<basename>`). */
  readonly family?: readonly string[]
}

/** A package.json record, loosely typed (the transform preserves every other field). */
export type PackageJson = Record<string, unknown> & {
  name: string
  version: string
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Rescope the manifest: new scoped name and dist version; `workspace:^`
 * dependency ranges become caret ranges on the SOURCE version (the workspace
 * releases in lockstep); repo-only fields (publishConfig, repository) are
 * dropped. `dependencies` is dropped too — runtime deps are bundled into lib
 * or provided by the host composition — EXCEPT family edges, which are the
 * loader-level core/companion contract (`dsh plugin add` reconciles direct
 * dependencies into the profile's bundles layer): they survive, renamed to
 * their dist names and ranged on the DIST version, like every other family
 * reference — a family name left at the source scope is unresolvable for npm
 * installers (the source scope is not published).
 * @param pkg - the source manifest.
 * @param name - the dist package name.
 * @param version - the dist version.
 * @param family - source-name → dist-name map for sibling packages in the same dist family.
 * @returns the transformed manifest.
 */
export function rescopePackageJson(
  pkg: PackageJson,
  name: string,
  version: string,
  family?: ReadonlyMap<string, string>,
): PackageJson {
  const out: PackageJson = { ...pkg, name, version }
  delete out['publishConfig']
  delete out['repository']
  // Lifecycle hooks reference the repo build toolchain, which exists neither
  // in the staging dir (pnpm pack would run `prepare` there) nor on
  // consumers' machines — dist manifests carry no scripts.
  delete out.scripts
  // Runtime deps are bundled into lib or provided by the host composition, so
  // the section goes — EXCEPT family edges: they are the loader-level
  // core/companion contract (`dsh plugin add` reconciles *direct* dependencies
  // into the profile's bundles layer, which is how installing a provider
  // auto-mounts the core), so family entries survive, renamed to the dist
  // scope and ranged on the dist version.
  const deps = Object.fromEntries(
    Object.entries(out.dependencies ?? {}).flatMap(([dep]) => {
      const target = family?.get(dep)
      return target !== undefined ? [[target, `^${version}`]] : []
    }),
  )
  if (Object.keys(deps).length > 0) out.dependencies = deps
  else delete out.dependencies
  for (const section of ['peerDependencies', 'devDependencies'] as const) {
    const deps = out[section]
    if (deps === undefined) continue
    out[section] = Object.fromEntries(
      Object.entries(deps).map(([dep, range]) => family?.has(dep)
        ? [family.get(dep) as string, `^${version}`]
        : [dep, range === 'workspace:^' ? `^${pkg.version}` : range]),
    )
  }
  return out
}

/**
 * Rewrite package-name occurrences in one text artifact. Every pair applies
 * in order; the self name is simply the first pair.
 * @param text - artifact content.
 * @param pairs - [from, to] name pairs (self, then family members).
 * @returns the rewritten content.
 */
export function rewriteNames(text: string, pairs: readonly (readonly [string, string])[]): string {
  let out = text
  for (const [from, to] of pairs) out = out.split(from).join(to)
  return out
}

/** Recursively list files under a directory. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

/**
 * Fail loud on stale build artifacts: every `lib/types/**.js` must trace to a
 * current `src/**` module (a deleted source whose emit lingers would ship in
 * the tarball otherwise — the edit-resend.js incident).
 * @param packageDir - the workspace package directory.
 */
export function assertNoStaleTypes(packageDir: string): void {
  const typesDir = join(packageDir, 'lib/types')
  if (!existsSync(typesDir)) return
  const stale = walk(typesDir)
    .filter(file => file.endsWith('.js'))
    .map(file => relative(typesDir, file).replace(/\.js$/, ''))
    .filter(module =>
      !existsSync(join(packageDir, 'src', `${module}.ts`))
      && !existsSync(join(packageDir, 'src', `${module}.tsx`)))
  if (stale.length > 0) {
    throw new Error(`pack-dist: stale lib/types emits with no backing src module: ${stale.join(', ')} — rebuild the package`)
  }
}

/**
 * Stage, rescope, verify, and pack the package.
 * @param options - pack options.
 * @returns the produced tarball path.
 */
export function packDist(options: PackDistOptions): string {
  const { packageDir, outDir } = options
  const pkgPath = join(packageDir, 'package.json')
  if (!existsSync(join(packageDir, 'lib'))) {
    throw new Error(`pack-dist: ${packageDir} has no lib/ — build the package first`)
  }
  assertNoStaleTypes(packageDir)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
  const distName = `${options.scope}/${basename(pkg.name)}`
  // Self first, then family members: cross-references in manifests, patch
  // rows, and every text artifact (js AND d.ts — type consumers resolve them).
  const family = new Map((options.family ?? []).map(source => [source, `${options.scope}/${basename(source)}`]))
  const pairs: [string, string][] = [[pkg.name, distName], ...family]

  const staging = mkdtempSync(join(tmpdir(), 'pack-dist-'))
  try {
    for (const file of STAGED_ROOT_FILES) {
      if (existsSync(join(packageDir, file))) cpSync(join(packageDir, file), join(staging, file))
    }
    cpSync(join(packageDir, 'lib'), join(staging, 'lib'), { recursive: true })
    // Every other path the manifest's `files` declares (scripts/, assets, …)
    // must ship too — staging only root docs + lib once dropped ankh-guard's
    // watchdog script from the tarball it was about to publish.
    for (const extra of filesDeclaredExtras(pkg.files, packageDir)) {
      const source = join(packageDir, extra)
      if (!existsSync(source)) continue
      const dest = join(staging, extra)
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(source, dest, { recursive: true })
    }
    writeFileSync(join(staging, 'package.json'), `${JSON.stringify(rescopePackageJson(pkg, distName, options.version, family), null, 2)}\n`)

    const patchPath = join(staging, 'cordis.patch.yml')
    if (existsSync(patchPath)) {
      writeFileSync(patchPath, rewriteNames(readFileSync(patchPath, 'utf8'), pairs))
    }
    for (const file of walk(join(staging, 'lib')).filter(file => file.endsWith('.js') || file.endsWith('.d.ts'))) {
      writeFileSync(file, rewriteNames(readFileSync(file, 'utf8'), pairs))
    }

    // Verify before packing: leftover source-scope self/family names are the
    // failure modes that cost a boot loop or an unresolvable peer install.
    const leftovers: string[] = []
    const stagedTexts = [
      join(staging, 'package.json'),
      ...(existsSync(patchPath) ? [patchPath] : []),
      ...walk(join(staging, 'lib')).filter(file => file.endsWith('.js') || file.endsWith('.d.ts')),
    ]
    for (const file of stagedTexts) {
      const text = readFileSync(file, 'utf8')
      for (const [source, target] of pairs) {
        // A package already published under its source name (the post-migration
        // state of this repo) rewrites to itself — nothing can be left over.
        if (source === target) continue
        if (text.includes(source)) leftovers.push(`${relative(staging, file)}: ${source}`)
      }
    }
    if (leftovers.length > 0) {
      throw new Error(`pack-dist: source-scope names survived the rewrite: ${leftovers.join(', ')}`)
    }

    const packOut = execFileSync('pnpm', ['pack', '--pack-destination', outDir], { cwd: staging, encoding: 'utf8' }).trim()
    // pnpm pack prints a "Tarball Details" block; the path is the .tgz line.
    const tarball = packOut.split('\n').map(line => line.trim()).find(line => line.endsWith('.tgz'))
    if (tarball === undefined) throw new Error(`pack-dist: pnpm pack output carried no .tgz path: ${packOut}`)
    verifyTarball(tarball, staging, distName)
    return tarball
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Post-pack verification. The tarball — not the staging dir — is what consumers
 * boot, so the artifact itself is checked:
 *
 *   1. completeness — every staged file must be in the tarball (files-field
 *      enumerations, glob gaps, and hashed-chunk misses all surface here;
 *      learned when `skills/**` globs were silently dropped and when a hashed
 *      tsdown chunk no files entry covered)
 *   2. family edges — every `@khorsheed/*` name referenced by lib artifacts or
 *      the bundle patch must have a dependencies/peerDependencies entry in the
 *      staged manifest (the core/companion auto-mount contract)
 */
export function verifyTarball(tarball: string, staging: string, selfName: string): void {
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  const packed = new Set(listing.split('\n').map(line => line.replace(/^package\//, '').trim()).filter(Boolean))
  // Sourcemaps and incremental state are optional artifacts — not shipping
  // them is correct, so they are outside the must-ship set.
  const optional = (file: string): boolean => file.endsWith('.map') || file.endsWith('.tsbuildinfo')
  const missing = walk(staging).filter(file => !optional(file) && !packed.has(relative(staging, file)))
  if (missing.length > 0) {
    throw new Error(`pack-dist: staged files missing from the tarball: ${missing.join(', ')}`)
  }

  const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as PackageJson
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
  const referenced = new Set<string>()
  for (const file of walk(staging).filter(f => f.endsWith('.js') || f.endsWith('.d.ts') || f.endsWith('.yml'))) {
    const text = readFileSync(file, 'utf8')
    // Comments are not edges: a patch or artifact may mention a companion by
    // name without depending on it (the host/client pair documents each other).
    const effective = file.endsWith('.yml')
      ? text.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n')
      : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
    for (const m of effective.matchAll(/@khorsheed\/[a-z0-9-]+/g)) referenced.add(m[0])
  }
  const undeclared = [...referenced].filter(name => name !== selfName && !declared.has(name))
  if (undeclared.length > 0) {
    throw new Error(`pack-dist: family references without manifest edges: ${undeclared.join(', ')}`)
  }
}

/** CLI entry: parse argv and pack. */
function main(argv: readonly string[]): void {
  const args = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error('usage: pack-dist --package <dir> --scope <scope> --version <version> --out <dir>')
    }
    args.set(flag.slice(2), value)
  }
  const packageDir = args.get('package')
  const scope = args.get('scope')
  const version = args.get('version')
  const outDir = args.get('out')
  const family = args.get('family')?.split(',').map(name => name.trim()).filter(name => name.length > 0)
  if (packageDir === undefined || scope === undefined || version === undefined || outDir === undefined) {
    throw new Error('usage: pack-dist --package <dir> --scope <scope> --version <version> --out <dir> [--family <comma-separated source package names>]')
  }
  const tarball = packDist({ packageDir, scope, version, outDir: resolve(outDir), ...(family === undefined ? {} : { family }) })
  process.stdout.write(`${tarball}\n`)
}

/* Run only as a CLI, not when imported by the spec. */
if (process.argv[1] !== undefined && process.argv[1].endsWith('pack-dist.ts')) {
  main(process.argv.slice(2))
}
