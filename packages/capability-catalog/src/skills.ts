/**
 * Skill collection: project `ctx.skills.snapshot()` output into catalog rows,
 * decode the frontmatter `metadata.credentials` declaration (the plugin's own
 * convention), and load per-skill detail on demand via `ctx.skills.get()`.
 *
 * The registry already performs root discovery, de-duplication, and rank
 * resolution; this module only projects the winning summaries onto wire rows
 * and reads credentials state through the optional `ctx.credentials` service.
 * @module @khorsheed/dsh-capability-catalog/skills
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {
  CapabilityCatalogSnapshot,
  CatalogCredentialDecl,
  CatalogCredentialState,
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogSkillRow,
} from './types.ts'

/** The slice of the credentials service this package reads (optional; ref space). */
export interface CredentialsSlice {
  describe: (ref: unknown) => Promise<{ readonly configured?: boolean; readonly source?: string; readonly writable?: boolean } | undefined>
  set: (ref: unknown, value: string) => Promise<void>
}

/** Minimal SkillSummary shape (invocation-neutral). */
interface SkillSummaryLike {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  readonly source: string
  readonly provider: string
  readonly path?: string
  readonly resourceBase?: { readonly kind: string; readonly path?: string }
}

/** Minimal loaded SkillDefinition (adds content + metadata). */
interface SkillDefinitionLike extends SkillSummaryLike {
  readonly content: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** The slice of the skills service this package consumes (optional). */
export interface RegistrySlice {
  snapshot: (options?: { cwd?: string; scope?: unknown; signal?: AbortSignal }) => Promise<{
    readonly skills: readonly SkillSummaryLike[]
    readonly complete: boolean
  }>
  get: (name: string, options?: { cwd?: string; scope?: unknown; signal?: AbortSignal }) => Promise<SkillDefinitionLike | undefined>
}

/** Decode `metadata.credentials` as an array of { key, label? }. */
export function decodeCredentialDecls(metadata: Readonly<Record<string, unknown>> | undefined): readonly CatalogCredentialDecl[] {
  const raw = metadata?.credentials
  if (!Array.isArray(raw)) return []
  const out: CatalogCredentialDecl[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const key = (item as Record<string, unknown>).key
    if (typeof key !== 'string' || key.length === 0) continue
    const label = (item as Record<string, unknown>).label
    out.push({ key, ...(typeof label === 'string' ? { label } : {}) })
  }
  return out
}

/** Scan a skill body for env-var references (`$X`, `process.env.X`, `env['X']`,
 * `{{env:X}}`) and surface them as generic credential decls — envs are not
 * assumed to be API keys; they may be tokens, ids, or any secret. */
export function decodeEnvDecls(content: string): readonly CatalogCredentialDecl[] {
  const seen = new Set<string>()
  const out: CatalogCredentialDecl[] = []
  const add = (raw: string | undefined): void => {
    if (raw === undefined) return
    const key = raw.replace(/^\$\{?/, '').replace(/\}?$/, '').trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || seen.has(key)) return
    seen.add(key)
    out.push({ key })
  }
  const patterns = [
    /\$\{?([A-Z][A-Z0-9_]*)\}?/g,
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /env\[\s*['"]?([A-Z][A-Z0-9_]+)['"]?\s*\]/g,
    /\{\{\s*env:([A-Z][A-Z0-9_]*)\s*\}\}/g,
  ]
  for (const p of patterns) {
    let m: RegExpExecArray | null
    while ((m = p.exec(content)) !== null) add(m[1])
  }
  return out
}

/** Merge metadata.credentials and env-derived decls, deduped by key. */
export function mergeCredentialDecls(
  metadataDecls: readonly CatalogCredentialDecl[],
  envDecls: readonly CatalogCredentialDecl[],
): readonly CatalogCredentialDecl[] {
  const byKey = new Map<string, CatalogCredentialDecl>()
  for (const decl of [...metadataDecls, ...envDecls]) {
    const existing = byKey.get(decl.key)
    byKey.set(decl.key, existing !== undefined && existing.label !== undefined ? existing : decl)
  }
  return [...byKey.values()]
}

/** Project one summary onto a wire skill row. */
export function skillRowFrom(summary: SkillSummaryLike): CatalogSkillRow {
  return {
    name: summary.name,
    description: summary.description,
    source: summary.source,
    provider: summary.provider,
    modelInvocable: summary.invocation.modelInvocable,
    userInvocable: summary.invocation.userInvocable,
    ...summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {},
  }
}

/** Resolve the optional services on a context. */
export function resolveServices(
  ctx: Context,
): { registry: RegistrySlice | undefined; credentials: CredentialsSlice | undefined } {
  const registry = ctx.get?.('skills') as RegistrySlice | undefined
  const credentials = ctx.get?.('credentials') as CredentialsSlice | undefined
  return { registry, credentials }
}

/** Collect the skills portion of the catalog across the given view scopes. */
export async function collectSkills(
  registry: RegistrySlice,
  workdir: string | undefined,
  scopes: readonly unknown[] = [undefined],
): Promise<CapabilityCatalogSnapshot> {
  const byName = new Map<string, CatalogSkillRow>()
  for (const scope of scopes) {
    const base = workdir === undefined ? {} : { cwd: workdir }
    const options = scope === undefined ? base : { ...base, scope }
    let snapshot
    try {
      snapshot = await registry.snapshot(options)
    } catch {
      // A single scope (e.g. one agent preset) failing must not blank the whole
      // catalog; skip it and keep the rest.
      continue
    }
    for (const summary of snapshot.skills) {
      const row = skillRowFrom(summary)
      if (!byName.has(row.name)) byName.set(row.name, row)
    }
  }
  const skills = [...byName.values()]
  return {
    skills,
    tools: [],
    mcpServers: [],
    channels: [{ channel: 'skill', count: skills.length }],
  }
}

/** Directory names never listed as skill-bundle resources. */
const SKIP_SKILL_DIRS = new Set(['.git', 'node_modules'])

/** Recursively collect a directory's file paths relative to `root`. */
async function collectSkillFiles(
  dir: string,
  root: string,
  out: string[],
  depth: number,
): Promise<void> {
  if (depth > 16 || out.length > 1000) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_SKILL_DIRS.has(entry.name)) continue
      await collectSkillFiles(full, root, out, depth + 1)
    } else if (entry.isFile()) {
      out.push(relative(root, full))
    }
  }
}

/** Reject unsafe bundle-relative paths (absolute, drive-letter, or `..`). */
function sanitizeBundlePath(path: string): string | undefined {
  if (path === '' || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return undefined
  const safe: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return undefined
    safe.push(segment)
  }
  return safe.length === 0 ? undefined : safe.join('/')
}

/** Read one skill-bundle file's text content, on demand. */
export async function readSkillFileContent(
  registry: RegistrySlice,
  name: string,
  filePath: string,
  workdir: string | undefined,
  scope: unknown = undefined,
): Promise<CatalogSkillFileRead | undefined> {
  const base = workdir === undefined ? {} : { cwd: workdir }
  const lookup = scope === undefined ? base : { ...base, scope }
  const def = await registry.get(name, lookup)
  if (def === undefined) return undefined
  const resourceBase = def.resourceBase
  const bundleDir = resourceBase?.kind === 'directory' ? resourceBase.path : undefined
  if (bundleDir === undefined) return undefined
  const safe = sanitizeBundlePath(filePath)
  if (safe === undefined) return undefined
  const full = join(bundleDir, safe)
  if (!full.startsWith(bundleDir)) return undefined
  try {
    const buf = await readFile(full)
    return { content: buf.toString('utf8') }
  } catch {
    return undefined
  }
}

/** Load one skill's full detail (content + metadata + credentials state). */
export async function loadSkillDetail(
  ctx: Context,
  registry: RegistrySlice,
  name: string,
  workdir: string | undefined,
  scope: unknown = undefined,
): Promise<CatalogSkillDetail | undefined> {
  const base = workdir === undefined ? {} : { cwd: workdir }
  const lookup = scope === undefined ? base : { ...base, scope }
  const def = await registry.get(name, lookup)
  if (def === undefined) return undefined
  const decls = mergeCredentialDecls(decodeCredentialDecls(def.metadata), decodeEnvDecls(def.content))
  const { credentials } = resolveServices(ctx)
  let credentialStates: readonly CatalogCredentialState[] = []
  if (decls.length > 0 && credentials !== undefined) {
    credentialStates = await Promise.all(decls.map(async (decl) => {
      const configured = isCredentialRefName(decl.key)
        ? (await credentials.describe(credentialRef(decl.key)).catch(() => undefined))?.configured === true
        : false
      return {
        key: decl.key,
        ...decl.label !== undefined ? { label: decl.label } : {},
        configured,
      }
    }))
  }
  // Bundle-relative file list for a directory skill (SKILL.md + scripts/assets).
  const resourceBase = def.resourceBase
  const bundleDir = resourceBase?.kind === 'directory' ? resourceBase.path : undefined
  let files: readonly string[] = []
  if (bundleDir !== undefined) {
    const collected: string[] = []
    await collectSkillFiles(bundleDir, bundleDir, collected, 0)
    files = collected.sort()
  }
  return {
    name: def.name,
    description: def.description,
    source: def.source,
    provider: def.provider,
    modelInvocable: def.invocation.modelInvocable,
    userInvocable: def.invocation.userInvocable,
    ...def.path !== undefined ? { path: def.path } : {},
    ...def.whenToUse !== undefined ? { whenToUse: def.whenToUse } : {},
    content: def.content,
    ...def.metadata !== undefined ? { metadataText: JSON.stringify(def.metadata) } : {},
    ...credentialStates.length > 0 ? { credentials: credentialStates } : {},
    ...files.length > 0 ? { files } : {},
  }
}
