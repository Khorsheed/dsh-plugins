#!/usr/bin/env node
/**
 * Plugin independence checker.
 *
 * Enforces the AGENTS.md "Package conventions" that make every plugin in this
 * monorepo install, run, and uninstall alone — so any subset can be composed
 * (the "整合包" story) without cross-interference:
 *
 *   1. self-mounting     every installable package declares `dsh.bundle.patch`,
 *                        the patch file exists and is listed in `files`
 *                        (family-internal row packages are exempt — see
 *                        NO_OWN_PATCH below)
 *   2. identity          cordis.patch.yml `name:` values are quoted and one row
 *                        matches the package name; `src/invariant.ts`'s
 *                        PACKAGE_NAME equals it; browser halves build through
 *                        the shared `clientBundle` helper with the same id —
 *                        never a hand-rolled client bundle
 *   3. no foreign scope  package docs/patches never reference one of THIS
 *                        repo's packages under `@deepseek-ai/` (stale identity
 *                        from the pre-consolidation layout)
 *   4. cross-plugin deps source imports and package.json dependency edges onto
 *                        `@khorsheed/*` are limited to ALLOWED_EDGES (the
 *                        sanctioned local-agent core/companion family and the
 *                        ui-file-preview client/host pair); intra-repo specs
 *                        are always `workspace:*`
 *   5. inject discipline nothing injects a `@khorsheed/*` package; injecting a
 *                        community-provided service (`localAgent`, …) is
 *                        limited to the family that owns it — everyone else
 *                        probes with `ctx.get` and degrades
 *   6. publish metadata  non-private packages point `repository` at this
 *                        monorepo with the right `directory`, and carry
 *                        `dsh-plugin` in `keywords`
 *
 * Run by hand (`pnpm check:plugins`); the vitest spec re-runs it against the
 * real tree so `pnpm test:scripts` keeps the tree conformant.
 *
 * Exit code 0 = clean; 1 = findings (each printed as `<path>: <kind> — detail`).
 * @module scripts/check-plugin-independence
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface Finding {
  readonly path: string
  readonly kind: string
  readonly detail: string
}

/**
 * Packages deliberately NOT self-mounting: family-internal row packages that
 * provider patches mount as config-bearing rows (see AGENTS.md "Package
 * conventions" and the tool-subagent README "Install" section).
 */
export const NO_OWN_PATCH: ReadonlyArray<string> = ['local-agent-tool-subagent']

/**
 * Sanctioned cross-package edges (AGENTS.md: the local-agent core/companion
 * family, and the ui-file-preview client/host pair). Keyed by package
 * directory; values are the allowed `@khorsheed/*` targets. Any new
 * cross-package need must follow the same declare-and-degrade pattern and be
 * added here deliberately.
 */
export const ALLOWED_EDGES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'local-agent-claude-code': ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent-tool-subagent'],
  'local-agent-codex': ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent-tool-subagent'],
  'local-agent-kimi': ['@khorsheed/dsh-local-agent', '@khorsheed/dsh-local-agent-tool-subagent'],
  'local-agent-dsh': [
    '@khorsheed/dsh-local-agent',
    '@khorsheed/dsh-local-agent-tool-subagent',
    '@khorsheed/dsh-local-agent-dsh-headless',
  ],
  'local-agent-tool-subagent': ['@khorsheed/dsh-local-agent'],
  'ui-file-preview': ['@khorsheed/dsh-file-preview'],
  // room consumes the local-agent delegation facade as an OPTIONAL capability:
  // type-only imports, an optional peer dep, a runtime probe, and tested
  // degradation when the family is absent (the room works with the main agent
  // as its only member). Sanctioned per the declare-and-degrade pattern.
  'room': ['@khorsheed/dsh-local-agent'],
}

/**
 * Community-provided cordis services and which package directories may inject
 * them. Anything not listed is assumed to be an official host service.
 */
export const COMMUNITY_SERVICE_INJECTORS: Readonly<Record<string, RegExp>> = {
  localAgent: /^local-agent/,
  localAgentDshHeadlessStartup: /^local-agent-dsh-headless$/,
  shortcuts: /^ui-shortcuts$/,
}

const MONOREPO_URL = 'git+https://github.com/Khorsheed/dsh-plugins.git'

const CROSS_IMPORT_RE = /(?:from|import|require(?:\.resolve)?)\s*\(?\s*['"](@khorsheed\/[a-z0-9-]+)/g
const INJECT_RE = /export const inject = \[([^\]]*)\]/g

interface Pkg {
  readonly dir: string
  readonly path: string
  readonly json: {
    readonly name: string
    readonly private?: boolean
    readonly files?: readonly string[]
    readonly keywords?: readonly string[]
    readonly repository?: { readonly url?: string; readonly directory?: string }
    readonly dsh?: {
      readonly bundle?: { readonly patch?: string }
      readonly client?: { readonly inject?: readonly string[] }
    }
    readonly dependencies?: Record<string, string>
    readonly devDependencies?: Record<string, string>
    readonly peerDependencies?: Record<string, string>
  }
}

function listPackages(packagesRoot: string): Pkg[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packagesRoot, e.name, 'package.json')))
    .map((e) => ({
      dir: e.name,
      path: join(packagesRoot, e.name),
      json: JSON.parse(readFileSync(join(packagesRoot, e.name, 'package.json'), 'utf8')),
    }))
}

function listSources(dir: string): string[] {
  const src = join(dir, 'src')
  if (!existsSync(src)) return []
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
  }
  walk(src)
  return out
}

/** `@khorsheed/<pkg>` specifiers a source text imports (self-references excluded by caller). */
export function findCrossImports(source: string): string[] {
  const out = new Set<string>()
  const re = new RegExp(CROSS_IMPORT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    out.add(m[1])
  }
  return [...out]
}

/** Service/package names listed in `export const inject = [...]` blocks. */
export function findInjects(source: string): string[] {
  const out: string[] = []
  const re = new RegExp(INJECT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '')
      if (name) out.push(name)
    }
  }
  return out
}

/** `name:` values in a bundle patch, plus whether each was quoted. */
export function parsePatchNames(patch: string): Array<{ readonly name: string; readonly quoted: boolean }> {
  const out: Array<{ name: string; quoted: boolean }> = []
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\s*name:\s*(\S.*)$/.exec(line)
    if (!m) continue
    const raw = m[1].trim()
    const quoted = /^['"].*['"]$/.test(raw)
    out.push({ name: raw.replace(/^['"]|['"]$/g, ''), quoted })
  }
  return out
}

/** Bare service names in inline `inject: [a, b]` rows of a bundle patch. */
export function parsePatchInjects(patch: string): string[] {
  const out: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\s*inject:\s*\[([^\]]*)\]/.exec(line)
    if (!m) continue
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '')
      if (name) out.push(name)
    }
  }
  return out
}

export function checkInjectName(dir: string, name: string): string | null {
  if (name.startsWith('@khorsheed/')) {
    return `injects community package ${name} — probe with ctx.get and degrade, or use the sanctioned family pattern`
  }
  const owner = COMMUNITY_SERVICE_INJECTORS[name]
  if (owner && !owner.test(dir)) {
    return `injects community service '${name}' outside its owning family — probe with ctx.get and degrade instead`
  }
  return null
}

export function isAllowedEdge(dir: string, target: string): boolean {
  return (ALLOWED_EDGES[dir] ?? []).includes(target)
}

export function scanPackage(pkg: Pkg, allNames: ReadonlyArray<string>): Finding[] {
  const findings: Finding[] = []
  const { dir, path, json } = pkg
  const add = (file: string, kind: string, detail: string): void => {
    findings.push({ path: join(path, file), kind, detail })
  }

  // 1. self-mounting
  const patchRel = json.dsh?.bundle?.patch
  if (!patchRel) {
    if (!NO_OWN_PATCH.includes(dir)) {
      add('package.json', 'self-mounting', 'no dsh.bundle.patch — every installable plugin self-mounts (or is a documented family-internal row)')
    }
  } else {
    const patchPath = join(path, patchRel)
    if (!existsSync(patchPath)) {
      add('package.json', 'self-mounting', `dsh.bundle.patch ${patchRel} does not exist`)
    }
    if (!(json.files ?? []).some((f) => f === patchRel || f === patchRel.replace(/^\.\//, ''))) {
      add('package.json', 'self-mounting', `dsh.bundle.patch ${patchRel} is not listed in files — the published tarball would not self-mount`)
    }
  }

  // 2. identity
  if (patchRel && existsSync(join(path, patchRel))) {
    const patch = readFileSync(join(path, patchRel), 'utf8')
    const names = parsePatchNames(patch)
    for (const n of names) {
      if (!n.quoted) add(patchRel, 'identity', `name: ${n.name} is unquoted (@ is YAML-reserved)`)
    }
    if (!NO_OWN_PATCH.includes(dir) && !names.some((n) => n.name === json.name)) {
      add(patchRel, 'identity', `no row named ${json.name} — patch id, invariant PACKAGE_NAME and tsdown id must move together`)
    }
    for (const svc of parsePatchInjects(patch)) {
      const why = checkInjectName(dir, svc)
      if (why) add(patchRel, 'inject', why)
    }
  }
  const invariantPath = join(path, 'src/invariant.ts')
  if (existsSync(invariantPath)) {
    const text = readFileSync(invariantPath, 'utf8')
    if (!text.includes(`'${json.name}'`) && !text.includes(`"${json.name}"`)) {
      add('src/invariant.ts', 'identity', `PACKAGE_NAME does not equal the package name ${json.name}`)
    }
  }
  if (json.dsh?.client) {
    const tsdownPath = join(path, 'tsdown.config.ts')
    const tsdown = existsSync(tsdownPath) ? readFileSync(tsdownPath, 'utf8') : ''
    const m = /clientBundle\(\s*['"]([^'"]+)['"]/.exec(tsdown)
    if (!m) {
      add('tsdown.config.ts', 'identity', 'browser half must build through the shared clientBundle helper — never hand-roll a client bundle')
    } else if (m[1] !== json.name) {
      add('tsdown.config.ts', 'identity', `clientBundle id ${m[1]} does not equal the package name ${json.name}`)
    }
    for (const svc of json.dsh.client.inject ?? []) {
      const why = checkInjectName(dir, svc)
      if (why) add('package.json', 'inject', why)
    }
  }

  // 3./4. cross-plugin imports and dependency edges
  for (const src of listSources(path)) {
    const text = readFileSync(src, 'utf8')
    for (const target of findCrossImports(text)) {
      if (target === json.name) continue
      if (!allNames.includes(target)) continue // not one of ours — nothing to police
      if (!isAllowedEdge(dir, target)) {
        add(src.slice(path.length + 1), 'cross-plugin import', `imports ${target} — no inter-plugin dependencies outside the sanctioned pairs`)
      }
    }
    for (const svc of findInjects(text)) {
      const why = checkInjectName(dir, svc)
      if (why) add(src.slice(path.length + 1), 'inject', why)
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    for (const [name, spec] of Object.entries(json[field] ?? {})) {
      if (!name.startsWith('@khorsheed/')) continue
      if (!isAllowedEdge(dir, name)) {
        add('package.json', 'cross-plugin dependency', `${field}.${name} — not one of the sanctioned pairs`)
      }
      if (spec.startsWith('workspace:') && spec !== 'workspace:*') {
        add('package.json', 'cross-plugin dependency', `${field}.${name} is ${spec} — intra-repo deps use workspace:*`)
      }
    }
  }

  // 5. foreign-scope self references in docs/patches
  for (const doc of ['README.md', 'README.zh.md', 'cordis.patch.yml']) {
    const docPath = join(path, doc)
    if (!existsSync(docPath)) continue
    const text = readFileSync(docPath, 'utf8')
    for (const name of allNames) {
      const foreign = name.replace('@khorsheed/', '@deepseek-ai/')
      if (text.includes(foreign)) {
        add(doc, 'foreign scope', `references ${foreign} — this repo's packages are @khorsheed/*`)
      }
    }
  }

  // 6. publish metadata (private packages are deliberately not published)
  if (!json.private) {
    if (json.repository?.url !== MONOREPO_URL || json.repository?.directory !== `packages/${dir}`) {
      add('package.json', 'publish metadata', `repository must point at this monorepo with directory packages/${dir}`)
    }
    if (!(json.keywords ?? []).includes('dsh-plugin')) {
      add('package.json', 'publish metadata', `keywords must include 'dsh-plugin'`)
    }
    // Payload directories the runtime reads must be covered by `files` —
    // a missing entry means the tarball ships without them (the skills loss
    // reached prod because nothing checked this at commit time).
    for (const payloadDir of ['scripts', 'skills', 'assets']) {
      const dirPath = join(path, payloadDir)
      if (!existsSync(dirPath)) continue
      const covered = (json.files ?? []).some(f => f === payloadDir || f.startsWith(`${payloadDir}/`))
      if (!covered) {
        add('package.json', 'publish metadata', `${payloadDir}/ exists but is not covered by files — the tarball would ship without it`)
      }
    }
  }

  return findings
}

/** Scan every package under a packages/ root. */
export function scanTree(packagesRoot: string): { readonly count: number; readonly findings: Finding[] } {
  const pkgs = listPackages(packagesRoot)
  const allNames = pkgs.map((p) => p.json.name)
  return { count: pkgs.length, findings: pkgs.flatMap((p) => scanPackage(p, allNames)) }
}

function main(): void {
  const { count, findings } = scanTree(join(import.meta.dirname!, '..', 'packages'))
  for (const f of findings) {
    process.stderr.write(`independence: ${f.path}: ${f.kind} — ${f.detail}\n`)
  }
  process.stdout.write(`independence: scanned ${count} package(s), ${findings.length} finding(s)\n`)
  process.exit(findings.length > 0 ? 1 : 0)
}

// Only run the CLI when invoked directly; importing (e.g. from the spec)
// must not exit the host process.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
