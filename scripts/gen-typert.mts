/**
 * gen-typert: regenerate the Typert face artifacts (lib/typert.host.*,
 * lib/typert.remote-client.*) for the packages in this repo whose upstream
 * sources live in the harness monorepo.
 *
 * Why this reaches into a harness checkout: the published
 * @deepseek-ai/dsh-typert-generator analyzer is monorepo-coupled — its Remote
 * marker detection and merged-interface face attribution require every
 * contributing package (typert-protocol, session, …) to be a registered
 * workspace SOURCE package, which npm-installed copies never satisfy (the
 * cascade ends at vendoring the whole dependency graph). Generation therefore
 * runs against a local harness checkout — a dev-time path dependency,
 * defaulting to ~/code/deepseek-harness and overridable with DSH_HARNESS —
 * and the artifacts are written back into this repo with the package's
 * @khorsheed self-name rewritten in (the generator stamps the source scope
 * into identifiers and the manifest owner field).
 *
 * The harness checkout only needs its sources (this script itself runs under
 * tsx, which also transpiles the generator source it imports — no harness
 * build step required). Sources here are kept identical to the harness copies
 * modulo the scope rename, so generating from the harness side yields this
 * repo's artifacts.
 *
 * Usage: tsx scripts/gen-typert.mts
 *
 * Always generates the full known set in ONE analysis batch: the generator's
 * shared type-declaration metadata depends on the analyzed package set, so
 * per-package invocations would emit divergent artifacts (harness's own
 * workspace build also generates every contributor in a single pass).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

interface TypertPackage {
  /** This repo's package directory (relative to the repo root). */
  readonly dir: string
  /** Upstream harness package directory (relative to the harness root). */
  readonly harnessDir: string
  /** Upstream source-scope package name the generator knows. */
  readonly sourceName: string
  /** This repo's @khorsheed package name. */
  readonly distName: string
}

/** Packages with ./typert + ./remote exports and their upstream counterparts. */
const TYPERT_PACKAGES: readonly TypertPackage[] = [
  {
    dir: 'packages/message-tools',
    harnessDir: 'packages/client/message-tools',
    sourceName: '@deepseek-ai/dsh-client-message-tools',
    distName: '@khorsheed/dsh-client-message-tools',
  },
  {
    dir: 'packages/file-preview',
    harnessDir: 'packages/fs/file-preview',
    sourceName: '@deepseek-ai/dsh-file-preview',
    distName: '@khorsheed/dsh-file-preview',
  },
  {
    dir: 'packages/local-agent',
    harnessDir: 'packages/local-agent/local-agent',
    sourceName: '@deepseek-ai/dsh-local-agent',
    distName: '@khorsheed/dsh-local-agent',
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

function rewrite(text: string, pkg: TypertPackage): string {
  return text.split(pkg.sourceName).join(pkg.distName)
    // The generator mangles the package name into schema identifiers.
    .split(pkg.sourceName.replaceAll(/[@/-]/g, '_')).join(pkg.distName.replaceAll(/[@/-]/g, '_'))
}

async function main(): Promise<void> {
  const selected = TYPERT_PACKAGES
  const generatorModule = join(harness, 'packages/typert/generator/src/workspace.ts')
  if (!existsSync(generatorModule)) {
    throw new Error(`gen-typert: harness checkout not found at ${harness} — set DSH_HARNESS to a deepseek-harness clone`)
  }
  const { WorkspaceTypertGenerator } = await import(pathToFileURL(generatorModule).href) as {
    WorkspaceTypertGenerator: new (root: string) => WorkspaceGenerator
  }
  const generator = new WorkspaceTypertGenerator(harness)
  const artifacts = generator.generate(selected.map(pkg => pkg.sourceName), ['host'])
  for (const pkg of selected) {
    const own = artifacts.filter(artifact => artifact.package === pkg.sourceName)
    if (own.length === 0) throw new Error(`gen-typert: no host artifact generated for ${pkg.sourceName}`)
    const out = join(repoRoot, pkg.dir, 'lib')
    mkdirSync(out, { recursive: true })
    for (const artifact of own) {
      writeFileSync(join(out, `typert.${artifact.face}.js`), rewrite(artifact.js, pkg))
      writeFileSync(join(out, `typert.${artifact.face}.d.ts`), rewrite(artifact.dts, pkg))
      if (artifact.remote !== undefined) {
        writeFileSync(join(out, 'typert.remote-client.js'), rewrite(artifact.remote.js, pkg))
        writeFileSync(join(out, 'typert.remote-client.d.ts'), rewrite(artifact.remote.dts, pkg))
        writeFileSync(join(out, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
      }
    }
    console.log(`gen-typert: ${pkg.distName} <- harness ${pkg.harnessDir}`)
  }
}

await main()
