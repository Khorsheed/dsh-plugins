/**
 * gen-typert: regenerate the Typert face artifacts (lib/typert.host.*,
 * lib/typert.remote-client.*) for the packages in this repo with `./typert`
 * and `./remote` exports.
 *
 * Why the overlay: the published @deepseek-ai/dsh-typert-generator analyzer
 * is monorepo-coupled — its Remote marker detection and merged-interface face
 * attribution require every contributing package (typert-protocol, session,
 * …) to be a registered workspace SOURCE package under the generator root,
 * which npm-installed copies never satisfy (the cascade ends at vendoring the
 * whole dependency graph). The plugin sources moved out of the harness
 * monorepo into this repo (harness commit "remove migrated plugin packages"),
 * so generation runs against a scratch OVERLAY: an APFS clonefile copy of the
 * harness checkout (packages, vendor, native, apps, node_modules, face
 * tsconfigs) with this repo's typert packages copied in as real directories
 * (the analyzer realpaths package roots, so symlinks would be filtered out)
 * and referenced from the overlay's tsconfig.host.json. The overlay root
 * keeps the harness layout, so the harness tsconfig.base.json source-plane
 * paths resolve every @deepseek-ai/* import exactly as the in-tree generation
 * did, and the copied manifests already carry the @khorsheed self-name the
 * generator stamps into identifiers and the manifest owner field.
 *
 * The overlay lives under $DSH_HOME/scratch (default ~/.dsh/scratch), one
 * per process (concurrent `pnpm -r build` invocations must not share mutable
 * scratch), cloned fresh from the current harness checkout (DSH_HARNESS,
 * default ~/code/deepseek-harness) on every run — a stale overlay tests
 * yesterday's API surface — and removed when generation finishes. The
 * harness checkout itself is never modified.
 *
 * Usage: tsx scripts/gen-typert.mts
 *
 * With no filter, generates the full known set in one analysis batch. A
 * `GEN_TYPERT_ONLY` build copies and analyzes only the named plugin packages,
 * so an independently built plugin never reads an unrelated sibling's source.
 * Every selected set still runs as one batch because the generator's shared
 * type-declaration metadata depends on the analyzed set.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The harness's own TypeScript (v5 API surface; this repo's typescript@7 differs). */
interface JsoncParser {
  parseConfigFileTextToJson(fileName: string, text: string): { config?: unknown, error?: { messageText: unknown } }
  flattenDiagnosticMessageText(messageText: unknown, newLine: string): string
}

export interface TypertPackage {
  /** This repo's package directory (relative to the repo root). */
  readonly dir: string
  /** The package's @khorsheed name — what the overlay manifest declares. */
  readonly name: string
  /** Aggregate reference targets, relative to the overlay package dir. */
  readonly hostConfigs: readonly string[]
}

/** Packages with ./typert + ./remote exports. */
export const TYPERT_PACKAGES: readonly TypertPackage[] = [
  {
    dir: 'packages/message-tools',
    name: '@khorsheed/dsh-client-message-tools',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/file-preview',
    name: '@khorsheed/dsh-file-preview',
    hostConfigs: ['tsconfig.json'],
  },
  {
    dir: 'packages/datasets',
    name: '@khorsheed/dsh-datasets',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/mission',
    name: '@khorsheed/dsh-mission',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/local-agent',
    name: '@khorsheed/dsh-local-agent',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/worktrees',
    name: '@khorsheed/dsh-worktrees',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/local-files',
    name: '@khorsheed/dsh-local-files',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/capability-catalog',
    name: '@khorsheed/dsh-capability-catalog',
    hostConfigs: ['tsconfig.host.json'],
  },
  {
    dir: 'packages/room',
    name: '@khorsheed/dsh-room',
    hostConfigs: ['tsconfig.host.json'],
  },
]

interface RemoteArtifact {
  readonly js: string
  readonly dts: string
  readonly dtsMap: string
}

interface FaceArtifact {
  readonly package: string
  readonly face: string
  readonly js: string
  readonly dts: string
  readonly remote?: RemoteArtifact
  readonly packageRoot: string
}

interface WorkspaceGenerator {
  generate(packages?: readonly string[], faces?: readonly string[]): FaceArtifact[]
}

const repoRoot = new URL('..', import.meta.url).pathname
const harness = process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness')
const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
// One overlay per process: `pnpm -r build` invokes this script from several
// package builds concurrently, and a shared directory would race rm/copy.
const overlay = join(dshHome, 'scratch', 'typert-overlay', `${process.pid}-${Date.now()}`)

/** Top-level harness entries the host-face analysis can reach. */
const HARNESS_ENTRIES = [
  'packages',
  'vendor',
  'native',
  'apps',
  'node_modules',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.host.json',
] as const

/** Resolve the plugin packages included in one generation batch. */
export function selectTypertPackages(only: string | undefined): readonly TypertPackage[] {
  const names = only?.split(',').map(name => name.trim()).filter(Boolean)
  const selected = names !== undefined && names.length > 0
    ? TYPERT_PACKAGES.filter(pkg => names.includes(pkg.name))
    : TYPERT_PACKAGES
  if (selected.length === 0) throw new Error('gen-typert: GEN_TYPERT_ONLY matched no registered package')
  return selected
}

/** Copy only the selected plugin sources and compiler inputs into an overlay. */
export function copyTypertPackageSources(
  packages: readonly TypertPackage[],
  sourceRoot: string,
  targetRoot: string,
): void {
  for (const pkg of packages) {
    const target = join(targetRoot, pkg.dir)
    mkdirSync(target, { recursive: true })
    cpSync(join(sourceRoot, pkg.dir, 'src'), join(target, 'src'), { recursive: true })
    cpSync(join(sourceRoot, pkg.dir, 'package.json'), join(target, 'package.json'))
    for (const config of pkg.hostConfigs) {
      cpSync(join(sourceRoot, pkg.dir, config), join(target, config))
    }
  }
}

/** Rebuild the overlay from the harness checkout, selected plugin packages overlaid. */
async function buildOverlay(packages: readonly TypertPackage[]): Promise<void> {
  const ts = await import(pathToFileURL(join(harness, 'node_modules/typescript/lib/typescript.js')).href) as JsoncParser
  rmSync(overlay, { recursive: true, force: true })
  mkdirSync(overlay, { recursive: true })
  for (const entry of HARNESS_ENTRIES) {
    const source = join(harness, entry)
    if (!existsSync(source)) throw new Error(`gen-typert: harness entry ${source} not found — build a current checkout or set DSH_HARNESS`)
    // APFS clonefile keeps the copy cheap; fall back to a plain copy elsewhere.
    try {
      execFileSync('cp', ['-c', '-R', source, join(overlay, entry)])
    } catch {
      cpSync(source, join(overlay, entry), { recursive: true, verbatimSymlinks: true })
    }
  }
  copyTypertPackageSources(packages, repoRoot, overlay)
  // The harness tsconfig.base.json maps only @deepseek-ai/*; overlaid packages
  // must also resolve each other's @khorsheed/* specifiers (cross-package
  // TYPE-only imports, e.g. room reading the local-agent facade's types).
  // The overlay is scratch, so patching the copied base is safe.
  const basePath = join(overlay, 'tsconfig.base.json')
  const baseParsed = ts.parseConfigFileTextToJson(basePath, readFileSync(basePath, 'utf8'))
  if (baseParsed.error !== undefined) {
    throw new Error(`gen-typert: cannot parse harness tsconfig.base.json: ${ts.flattenDiagnosticMessageText(baseParsed.error.messageText, '\n')}`)
  }
  const base = baseParsed.config as { compilerOptions?: { paths?: Record<string, string[]> } }
  const paths: Record<string, string[]> = { ...base.compilerOptions?.paths }
  for (const pkg of packages) {
    paths[pkg.name] = [`./${pkg.dir}/src/index.ts`]
    paths[`${pkg.name}/*`] = [`./${pkg.dir}/src/*`]
  }
  // Plugins may import a harness package's source files directly through the
  // package's `./src/*` export (e.g. room registering the persistence
  // vocabulary via '@deepseek-ai/dsh-session/src/known-event-types.ts' so the
  // registration lands in the toolchain's module instance rather than a
  // second lib copy). The harness base maps subpaths individually, so derive
  // the `<pkg>/src/*` form from each mapped subpath's directory.
  for (const [key, targets] of Object.entries(paths)) {
    const match = /^(@deepseek-ai\/[^/]+)\//.exec(key)
    if (match === null || `${match[1]}/src/*` in paths) continue
    const dir = /^\.\/(.+\/src)\//.exec(targets[0] ?? '')
    if (dir !== null) paths[`${match[1]}/src/*`] = [`./${dir[1]}/*`]
  }
  base.compilerOptions = { ...base.compilerOptions, paths }
  writeFileSync(basePath, `${JSON.stringify(base, null, 2)}\n`)
  const aggregatePath = join(overlay, 'tsconfig.host.json')
  const parsed = ts.parseConfigFileTextToJson(aggregatePath, readFileSync(aggregatePath, 'utf8'))
  if (parsed.error !== undefined) {
    throw new Error(`gen-typert: cannot parse harness tsconfig.host.json: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`)
  }
  const aggregate = parsed.config as { references?: Array<{ path: string }> }
  aggregate.references = [
    ...aggregate.references ?? [],
    ...packages.flatMap(pkg => pkg.hostConfigs.map(config => ({ path: `./${pkg.dir}/${config}` }))),
  ]
  writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`)
}

async function main(): Promise<void> {
  // GEN_TYPERT_ONLY=<name,name> restricts generation to a subset — one
  // package's in-flight remote-surface breakage must not block every other
  // package's build in a multi-agent repo (observed: mission WIP failing
  // message-tools' gen-typert). Default: all registered typert packages.
  const selected = selectTypertPackages(process.env['GEN_TYPERT_ONLY'])
  const generatorModule = join(harness, 'packages/typert/generator/src/workspace.ts')
  if (!existsSync(generatorModule)) {
    throw new Error(`gen-typert: harness checkout not found at ${harness} — set DSH_HARNESS to a deepseek-harness clone`)
  }
  await buildOverlay(selected)
  try {
    const { WorkspaceTypertGenerator } = await import(pathToFileURL(generatorModule).href) as {
      WorkspaceTypertGenerator: new (root: string) => WorkspaceGenerator
    }
    const generator = new WorkspaceTypertGenerator(overlay)
    const artifacts = generator.generate(selected.map(pkg => pkg.name), ['host'])
    for (const pkg of selected) {
      const own = artifacts.filter(artifact => artifact.package === pkg.name)
      if (own.length === 0) throw new Error(`gen-typert: no host artifact generated for ${pkg.name}`)
      const out = join(repoRoot, pkg.dir, 'lib')
      mkdirSync(out, { recursive: true })
      for (const artifact of own) {
        writeFileSync(join(out, `typert.${artifact.face}.js`), artifact.js)
        writeFileSync(join(out, `typert.${artifact.face}.d.ts`), artifact.dts)
        if (artifact.remote !== undefined) {
          writeFileSync(join(out, 'typert.remote-client.js'), artifact.remote.js)
          writeFileSync(join(out, 'typert.remote-client.d.ts'), artifact.remote.dts)
          writeFileSync(join(out, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
        }
      }
      console.log(`gen-typert: ${pkg.name} generated from overlay ${overlay}`)
    }
  } finally {
    rmSync(overlay, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
