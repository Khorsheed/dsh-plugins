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
 * Always generates the full known set in ONE analysis batch: the generator's
 * shared type-declaration metadata depends on the analyzed package set, so
 * per-package invocations would emit divergent artifacts (harness's own
 * workspace build also generates every contributor in a single pass).
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

interface TypertPackage {
  /** This repo's package directory (relative to the repo root). */
  readonly dir: string
  /** The package's @khorsheed name — what the overlay manifest declares. */
  readonly name: string
  /** Aggregate reference targets, relative to the overlay package dir. */
  readonly hostConfigs: readonly string[]
}

/** Packages with ./typert + ./remote exports. */
const TYPERT_PACKAGES: readonly TypertPackage[] = [
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

/** Rebuild the overlay from the harness checkout, plugin packages overlaid. */
async function buildOverlay(): Promise<void> {
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
  for (const pkg of TYPERT_PACKAGES) {
    const target = join(overlay, pkg.dir)
    mkdirSync(target, { recursive: true })
    cpSync(join(repoRoot, pkg.dir, 'src'), join(target, 'src'), { recursive: true })
    cpSync(join(repoRoot, pkg.dir, 'package.json'), join(target, 'package.json'))
    for (const config of pkg.hostConfigs) {
      cpSync(join(repoRoot, pkg.dir, config), join(target, config))
    }
  }
  const aggregatePath = join(overlay, 'tsconfig.host.json')
  const parsed = ts.parseConfigFileTextToJson(aggregatePath, readFileSync(aggregatePath, 'utf8'))
  if (parsed.error !== undefined) {
    throw new Error(`gen-typert: cannot parse harness tsconfig.host.json: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`)
  }
  const aggregate = parsed.config as { references?: Array<{ path: string }> }
  aggregate.references = [
    ...aggregate.references ?? [],
    ...TYPERT_PACKAGES.flatMap(pkg => pkg.hostConfigs.map(config => ({ path: `./${pkg.dir}/${config}` }))),
  ]
  writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`)
}

async function main(): Promise<void> {
  // GEN_TYPERT_ONLY=<name,name> restricts generation to a subset — one
  // package's in-flight remote-surface breakage must not block every other
  // package's build in a multi-agent repo (observed: mission WIP failing
  // message-tools' gen-typert). Default: all registered typert packages.
  const only = process.env['GEN_TYPERT_ONLY']?.split(',').map(s => s.trim()).filter(Boolean)
  const selected = only !== undefined && only.length > 0
    ? TYPERT_PACKAGES.filter(pkg => only.includes(pkg.name))
    : TYPERT_PACKAGES
  if (selected.length === 0) throw new Error(`gen-typert: GEN_TYPERT_ONLY matched no registered package`)
  const generatorModule = join(harness, 'packages/typert/generator/src/workspace.ts')
  if (!existsSync(generatorModule)) {
    throw new Error(`gen-typert: harness checkout not found at ${harness} — set DSH_HARNESS to a deepseek-harness clone`)
  }
  await buildOverlay()
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

await main()
