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
import { basename, dirname, join, relative } from 'node:path'

/** Files copied from the package root into the staging dir when present. */
const STAGED_ROOT_FILES = ['package.json', 'README.md', 'README.zh.md', 'README.en.md', 'README.i18n.yaml', 'cordis.patch.yml']

/**
 * Payload paths from the package's `files` field beyond what staging already
 * copies verbatim (the root documents above and lib/) — e.g. ankh-guard's
 * `scripts/dsh-watchdog.sh` and its supervisor installers, which the watchdog
 * cannot ship without. Glob entries are skipped: the lib globs are covered by
 * the recursive lib/ copy, and no package currently files anything else
 * globbed.
 */
export function filesDeclaredExtras(files: readonly string[] = []): string[] {
  return files.filter(entry =>
    !entry.includes('*')
    && entry !== 'lib'
    && !entry.startsWith('lib/')
    && !(STAGED_ROOT_FILES as readonly string[]).includes(entry))
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
 * releases in lockstep); `dependencies` (bundled into lib output) and
 * repo-only fields (publishConfig, repository) are dropped. Family members
 * (other packages dist'ed under the same scope, e.g. a host package a client
 * package peers on) are renamed to their dist names and ranged on the DIST
 * version — a family name left at the source scope is unresolvable for npm
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
  delete out.dependencies
  delete out['publishConfig']
  delete out['repository']
  // Lifecycle hooks reference the repo build toolchain, which exists neither
  // in the staging dir (pnpm pack would run `prepare` there) nor on
  // consumers' machines — dist manifests carry no scripts.
  delete out.scripts
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
    for (const extra of filesDeclaredExtras(pkg.files)) {
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

    return execFileSync('pnpm', ['pack', '--pack-destination', outDir], { cwd: staging, encoding: 'utf8' }).trim()
  } finally {
    rmSync(staging, { recursive: true, force: true })
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
  const tarball = packDist({ packageDir, scope, version, outDir, ...(family === undefined ? {} : { family }) })
  process.stdout.write(`${tarball}\n`)
}

/* Run only as a CLI, not when imported by the spec. */
if (process.argv[1] !== undefined && process.argv[1].endsWith('pack-dist.ts')) {
  main(process.argv.slice(2))
}
