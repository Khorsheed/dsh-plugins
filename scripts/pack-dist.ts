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
 * a client package peers on) must be named via
 * `--family <name[=version][,...]>` so peer/dev dependency names, patch rows,
 * and text artifacts all point at the dist scope instead of the unpublished
 * source scope. A member whose name appears in a manifest edge MUST carry its
 * own version (`name=version`): the edge is ranged on the target's version, so
 * a bare name there is an error rather than a silently unsatisfiable range.
 * `--family auto` derives the specs from the package's own manifest plus the
 * workspace's current versions (the same derivation deploy-3080 uses) — the
 * form humans and CI should reach for by default.
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
const STAGED_ROOT_FILES = ['package.json', 'README.md', 'README.zh.md', 'README.en.md', 'README.i18n.yaml', 'CHANGELOG.md', 'cordis.patch.yml']

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
/**
 * The reverse completeness direction (declared ⊆ staging): every `files`
 * entry must name something real. A glob that expands to nothing, or a plain
 * entry whose path does not exist, means the package declares a payload it
 * never stages — the exact shape of the skills-glob loss (the staging copy
 * silently skipped it, and a staging⊆tarball check passes vacuously).
 * `lib/` and the root documents are exempt: lib is asserted present by the
 * build check, and root docs are staged on a when-present basis.
 */
export function assertDeclaredPayloadsExist(files: readonly string[] = [], packageDir: string): void {
  const failures: string[] = []
  for (const entry of files) {
    if (entry === 'lib' || entry.startsWith('lib/')) continue
    if ((STAGED_ROOT_FILES as readonly string[]).includes(entry)) continue
    if (entry.includes('*')) {
      if (expandGlobEntry(packageDir, entry).length === 0) failures.push(`${entry} (glob expands to nothing)`)
      continue
    }
    if (!existsSync(join(packageDir, entry))) failures.push(`${entry} (no such path in the package)`)
  }
  if (failures.length > 0) {
    throw new Error(`pack-dist: files declares payloads that do not exist: ${failures.join(', ')}`)
  }
}

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
  /**
   * Sibling packages in the same dist family: each becomes `<scope>/<basename>`.
   * A spec needs its `targetVersion` whenever a manifest edge points at it —
   * the edge is ranged on THAT version, never on this package's own.
   */
  readonly family?: readonly FamilySpec[]
}

/** A package.json record, loosely typed (the transform preserves every other field). */
export type PackageJson = Record<string, unknown> & {
  name: string
  version: string
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, unknown>
  devDependencies?: Record<string, string>
  dsh?: { references?: string[], runtimeDependencies?: readonly string[] }
}

/**
 * One sibling package in the same dist family: the workspace (source) name and,
 * when the caller knows it, that sibling's own dist version.
 *
 * The version is what a family *manifest edge* must be ranged on. It is
 * deliberately NOT the packed package's version: `pack-dist` used to range
 * every family edge on `--version`, which produced ranges that could not
 * resolve the sibling at all (`datasets-tool@0.1.0` declared
 * `@khorsheed/dsh-datasets@^0.1.0` while the core is `0.1.0-rc.1`, and
 * `worktrees-tool@0.1.0` declared `^0.1.0` while its core is `0.2.0`).
 *
 * A member without a version is still usable as a *rewrite-only* reference
 * (patch rows, string artifacts). A manifest edge on such a member is an error.
 */
export interface FamilyMember {
  readonly sourceName: string
  readonly distName: string
  readonly targetVersion?: string
}

/** `--family` entry: `name` (rewrite-only) or `name=version` (edge-capable). */
export interface FamilySpec {
  readonly sourceName: string
  readonly targetVersion?: string
}

/** Semver, prerelease and build metadata included. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parse the `--family` argument: comma-separated `name` or `name=version`.
 * @param raw - the flag value, or undefined when absent.
 * @returns the parsed specs.
 */
export function parseFamilySpecs(raw: string | undefined): FamilySpec[] {
  if (raw === undefined) return []
  const specs: FamilySpec[] = []
  const seen = new Map<string, string | undefined>()
  for (const entry of raw.split(',').map(part => part.trim()).filter(part => part.length > 0)) {
    const eq = entry.indexOf('=')
    const sourceName = (eq === -1 ? entry : entry.slice(0, eq)).trim()
    const version = eq === -1 ? undefined : entry.slice(eq + 1).trim()
    if (sourceName.length === 0) throw new Error(`pack-dist: empty --family entry in ${JSON.stringify(raw)}`)
    if (eq !== -1 && (version === undefined || version.length === 0)) {
      throw new Error(`pack-dist: --family ${sourceName}= is missing a version (use ${sourceName}=<version> or drop the '=')`)
    }
    if (version !== undefined && !SEMVER.test(version)) {
      throw new Error(`pack-dist: --family ${sourceName}=${version} is not a valid semver version`)
    }
    if (seen.has(sourceName) && seen.get(sourceName) !== version) {
      throw new Error(`pack-dist: --family names ${sourceName} twice with conflicting versions`)
    }
    if (seen.has(sourceName)) continue
    seen.set(sourceName, version)
    specs.push({ sourceName, ...(version === undefined ? {} : { targetVersion: version }) })
  }
  return specs
}

/**
 * Derive a workspace package's family specs from its manifests, resolving each
 * sibling's own version through the workspace index. Every `@khorsheed/*` name
 * in dependencies / peerDependencies / devDependencies is a member — an edge
 * that survives into the dist manifest needs its target version.
 * @param pkg - the source manifest.
 * @param versions - workspace package name → that package's own version.
 * @returns specs in stable declaration order.
 */
export function familySpecsFor(pkg: PackageJson, versions: ReadonlyMap<string, string>): FamilySpec[] {
  const names = new Set<string>()
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name.startsWith('@khorsheed/')) names.add(name)
    }
  }
  return [...names].map(sourceName => {
    const targetVersion = versions.get(sourceName)
    return { sourceName, ...(targetVersion === undefined ? {} : { targetVersion }) }
  })
}

/** Render specs back into the `--family` argument form. */
export function formatFamilySpecs(specs: readonly FamilySpec[]): string {
  return specs
    .map(spec => (spec.targetVersion === undefined ? spec.sourceName : `${spec.sourceName}=${spec.targetVersion}`))
    .join(',')
}

/**
 * Index every workspace package's own version.
 * @param packagesDir - the workspace `packages/` directory.
 * @returns package name → version.
 */
export function loadWorkspaceVersions(packagesDir: string): Map<string, string> {
  const versions = new Map<string, string>()
  if (!existsSync(packagesDir)) return versions
  for (const entry of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string }
    if (manifest.name !== undefined && manifest.version !== undefined) versions.set(manifest.name, manifest.version)
  }
  return versions
}

/** Build the source-name keyed member map the rescoper consumes. */
export function familyMemberMap(scope: string, specs: readonly FamilySpec[]): ReadonlyMap<string, FamilyMember> {
  return new Map(specs.map(spec => [
    spec.sourceName,
    {
      sourceName: spec.sourceName,
      distName: `${scope}/${basename(spec.sourceName)}`,
      ...(spec.targetVersion === undefined ? {} : { targetVersion: spec.targetVersion }),
    },
  ]))
}

/**
 * The caret range a family manifest edge must carry. A member with no known
 * version cannot be ranged honestly, so this fails instead of guessing the
 * packed package's own version (the bug this exists to prevent).
 */
function familyEdgeRange(member: FamilyMember, dep: string, section: string): string {
  if (member.targetVersion === undefined) {
    throw new Error(
      `pack-dist: ${section} entry ${dep} is a family edge but no version was given for it — `
      + `pass --family ${dep}=<version> (a bare --family name is rewrite-only and cannot range an edge)`,
    )
  }
  return `^${member.targetVersion}`
}

/**
 * Rescope the manifest: new scoped name and dist version; `workspace:^`
 * dependency ranges become caret ranges on the SOURCE version (the workspace
 * releases in lockstep); repo-only fields (publishConfig, repository) are
 * dropped. `dependencies` is dropped too — runtime deps are bundled into lib
 * or provided by the host composition — EXCEPT family edges, which carry the
 * family's runtime/module-resolution contract (keeping a provider's import of
 * its core resolvable): they survive, renamed to their dist names and ranged
 * on the TARGET package's own version — a family name left at the source scope
 * is unresolvable for npm installers (the source scope is not published), and
 * a range built from the wrong version excludes the target entirely. A
 * surviving edge mounts nothing: `dsh plugin add` reconciles only the
 * profile's *direct* dependencies into its bundles layer.
 * @param pkg - the source manifest.
 * @param name - the dist package name.
 * @param version - the dist version of THIS package (self references only).
 * @param family - source-name keyed family members, each with its own dist name and version.
 * @returns the transformed manifest.
 */
export function rescopePackageJson(
  pkg: PackageJson,
  name: string,
  version: string,
  family?: ReadonlyMap<string, FamilyMember>,
): PackageJson {
  const out: PackageJson = { ...pkg, name, version }
  delete out['publishConfig']
  delete out['repository']
  // Lifecycle hooks reference the repo build toolchain, which exists neither
  // in the staging dir (pnpm pack would run `prepare` there) nor on
  // consumers' machines — dist manifests carry no scripts.
  delete out.scripts
  // Runtime deps are bundled into lib or provided by the host composition, so
  // the section goes — EXCEPT family edges: a family companion's runtime
  // import and module resolution depend on them (and the family README's
  // explicit install pairs a core with its provider), so family entries
  // survive, renamed to the dist scope and ranged on the TARGET's own version.
  // They do NOT mount anything: `dsh plugin add` reconciles only the profile's
  // *direct* dependencies into its bundles layer, so a transitive family edge
  // keeps the module resolvable and leaves the row unmounted.
  //
  // Second exception: `dsh.runtimeDependencies` (an explicit opt-in list).
  // A dependency the package deliberately does NOT bundle (capture's
  // puppeteer-core / @puppeteer/browsers, consumed via runtime dynamic import)
  // must still be installed alongside the dist package — name it there and the
  // entry survives verbatim. Naming something absent from `dependencies` fails
  // loud: a kept entry that points nowhere is worse than a dropped one.
  const keepRuntime = new Set(pkg.dsh?.runtimeDependencies ?? [])
  for (const dep of keepRuntime) {
    if (out.dependencies?.[dep] === undefined) {
      throw new Error(`dsh.runtimeDependencies names ${dep}, which is not in dependencies`)
    }
  }
  const deps = Object.fromEntries(
    Object.entries(out.dependencies ?? {}).flatMap(([dep, range]) => {
      const member = family?.get(dep)
      if (member !== undefined) return [[member.distName, familyEdgeRange(member, dep, 'dependencies')]]
      return keepRuntime.has(dep) ? [[dep, range]] : []
    }),
  )
  if (Object.keys(deps).length > 0) out.dependencies = deps
  else delete out.dependencies
  for (const section of ['peerDependencies', 'devDependencies'] as const) {
    const sectionDeps = out[section]
    if (sectionDeps === undefined) continue
    out[section] = Object.fromEntries(
      Object.entries(sectionDeps).map(([dep, range]) => {
        const member = family?.get(dep)
        if (member !== undefined) return [member.distName, familyEdgeRange(member, dep, section)]
        return [dep, range === 'workspace:^' ? `^${pkg.version}` : range]
      }),
    )
  }
  // peerDependenciesMeta is keyed by package name: a rescoped peer whose meta
  // key kept the source name would silently lose its `optional` flag.
  const meta = out.peerDependenciesMeta
  if (meta !== undefined) {
    out.peerDependenciesMeta = Object.fromEntries(
      Object.entries(meta).map(([dep, value]) => [family?.get(dep)?.distName ?? dep, value]),
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
 * Strip build artifacts that are never publishable payload — sourcemaps and
 * TypeScript incremental state — from a staging tree, recursively.
 *
 * Both are emitted next to the code they describe, so a `files: ["lib"]`
 * enumeration ships them by default. They are large, useless to consumers, and
 * the repo's hygiene rule already treats `*.tsbuildinfo` as non-committable
 * state. Pruning here fixes every package at once, and does it at the artifact
 * boundary instead of asking ~25 manifests to enumerate their own payload.
 * @param dir - the staging directory to prune in place.
 * @returns the pruned paths, staging-relative, for logging and assertions.
 */
export function prunePublishArtifacts(dir: string): string[] {
  const pruned: string[] = []
  for (const file of walk(dir)) {
    if (file.endsWith('.map') || file.endsWith('.tsbuildinfo')) {
      rmSync(file, { force: true })
      pruned.push(relative(dir, file))
    }
  }
  return pruned.sort()
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
  assertDeclaredPayloadsExist(pkg.files, packageDir)
  const distName = `${options.scope}/${basename(pkg.name)}`
  // Self first, then family members: cross-references in manifests, patch
  // rows, and every text artifact (js AND d.ts — type consumers resolve them).
  const family = familyMemberMap(options.scope, options.family ?? [])
  const pairs: [string, string][] = [[pkg.name, distName], ...[...family.values()].map(m => [m.sourceName, m.distName] as [string, string])]

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
    // Non-publishable build state leaves staging before anything is packed:
    // sourcemaps and tsbuildinfo are emitted beside every package's output and
    // would otherwise ride a `files: ["lib"]` enumeration into the tarball.
    prunePublishArtifacts(staging)
    const manifest = rescopePackageJson(pkg, distName, options.version, family)
    // pnpm pack filters staging to `files` plus its always-include set
    // (README*, LICENSE, package.json); CHANGELOG.md is not in that set, so
    // a package carrying one must list it explicitly or the tarball drops it.
    if (existsSync(join(staging, 'CHANGELOG.md')) && Array.isArray(manifest.files) && !manifest.files.includes('CHANGELOG.md')) {
      manifest.files = [...manifest.files, 'CHANGELOG.md']
    }
    writeFileSync(join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

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
 *   1. payload hygiene — no sourcemap or tsbuildinfo may reach the tarball
 *      (prunePublishArtifacts strips them from staging; this re-checks the
 *      artifact, so a files-field glob or a late build cannot smuggle them in)
 *   2. completeness — every staged file must be in the tarball (files-field
 *      enumerations, glob gaps, and hashed-chunk misses all surface here;
 *      learned when `skills/**` globs were silently dropped and when a hashed
 *      tsdown chunk no files entry covered)
 *   3. family edges — every `@khorsheed/*` name referenced by lib artifacts or
 *      the bundle patch must have a dependencies/peerDependencies entry in the
 *      staged manifest (the family's runtime/module-resolution contract — not
 *      an activation contract: only a profile's direct dependencies mount), or
 *      be listed in the manifest's `dsh.references` when the mention is DATA,
 *      not a dependency (a preset-visibility probe naming its companion row).
 *      Data mentions must never become manifest edges: a core↔companion pair
 *      declared in both directions forms a cycle that pnpm's build sequencer
 *      schedules into one concurrent chunk, which raced cold builds to death.
 */
export function verifyTarball(tarball: string, staging: string, selfName: string): void {
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  const packed = new Set(listing.split('\n').map(line => line.replace(/^package\//, '').trim()).filter(Boolean))
  // 1. payload hygiene — sourcemaps and incremental build state are never
  // publishable, so their presence means something re-added them after the
  // prune (a files-field glob or a build that writes into staging).
  const forbidden = [...packed].filter(file => file.endsWith('.map') || file.endsWith('.tsbuildinfo'))
  if (forbidden.length > 0) {
    throw new Error(`pack-dist: tarball carries non-publishable build artifacts: ${forbidden.join(', ')}`)
  }
  // 2. completeness — every staged file must be in the tarball (files-field
  // enumerations, glob gaps, and hashed-chunk misses all surface here; learned
  // when `skills/**` globs were silently dropped and when a hashed tsdown chunk
  // no files entry covered). Staging was already pruned, so this compares like
  // for like: anything left in staging is intended payload.
  const missing = walk(staging).filter(file => !packed.has(relative(staging, file)))
  if (missing.length > 0) {
    throw new Error(`pack-dist: staged files missing from the tarball: ${missing.join(', ')}`)
  }

  const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as PackageJson
  // A devDependency counts as a declaration: pack-dist itself renames and ranges
  // family devDependencies into the dist manifest (see the rewrite above), and a
  // source-plane sibling — a helper inlined into this package's bundle at build
  // time — is ONLY ever a devDependency (a runtime dependency on it would be a
  // registry edge nobody installs). Without this, such a package could never
  // pass its own verifier: its emitted type declarations and its dead tsc
  // intermediates mention the sibling by name, while every honest field for the
  // edge is the one this check used to ignore.
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])
  // Data mentions are not edges: `dsh.references` names a sibling the artifacts
  // mention as data (a preset-visibility probe's companion row name) without
  // depending on it — declared here, never in a dependency field (a core and
  // its companion declared in both directions form a pnpm sequencing cycle).
  for (const name of manifest.dsh?.references ?? []) declared.add(name)
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
  const usage = 'usage: pack-dist --package <dir> --scope <scope> --version <version> --out <dir> '
    + '[--family <name[=version][,name[=version]...] | auto>]'
  if (packageDir === undefined || scope === undefined || version === undefined || outDir === undefined) {
    throw new Error(usage)
  }
  // `--family auto`: derive the specs from the package's own manifest plus the
  // workspace's current versions — the same derivation deploy-3080 uses.
  const family = args.get('family') === 'auto'
    ? familySpecsFor(
        JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageJson,
        loadWorkspaceVersions(join(packageDir, '..')),
      )
    : parseFamilySpecs(args.get('family'))
  const tarball = packDist({
    packageDir,
    scope,
    version,
    outDir: resolve(outDir),
    ...(family.length === 0 ? {} : { family }),
  })
  process.stdout.write(`${tarball}\n`)
}

/* Run only as a CLI, not when imported by the spec. */
if (process.argv[1] !== undefined && process.argv[1].endsWith('pack-dist.ts')) {
  main(process.argv.slice(2))
}
