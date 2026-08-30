/**
 * Catalog data layer: pure functions the Remote service calls. Kept separate
 * from the service so the snapshot/add/detail/credential logic is unit-testable
 * without a Cordis context and stays independent of the typert decorators.
 * @module @khorsheed/dsh-capability-catalog/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  CapabilityCatalogSnapshot,
  CatalogAddSkillRequest,
  CatalogAddSkillResult,
  CatalogCredentialSetRequest,
  CatalogDeleteSkillResult,
  CatalogDirSkillInfo,
  CatalogJsonValue,
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogToolRow,
} from './types.ts'
import {
  collectSkills, loadSkillDetail, readSkillFileContent, deleteSkillDir, resolveServices, CREDENTIAL_REF_NAME, type CredentialsSlice, type RegistrySlice,
} from './skills.ts'
import { attributeToolChannel } from './channels.ts'
import { addSkillFromPayload, commandInstall, listDirSkills, resolveSkillNameFromContent } from './import.ts'
import { OFFICIAL_TOOLS } from './official-tools.ts'

export type { CredentialsSlice, RegistrySlice }

/** Load the cached official-tools names. */
function officialToolsSet(): ReadonlySet<string> {
  return new Set(OFFICIAL_TOOLS)
}

/** Project visible tools onto catalog rows with channel attribution. */
export function projectTools(schemas: readonly ToolSchemaLike[], mcpServers: readonly string[], appearedAfterApply: Set<string>): CatalogToolRow[] {
  const official = officialToolsSet()
  const rows: CatalogToolRow[] = []
  for (const schema of schemas) {
    const attributed = attributeToolChannel(schema.name, official, mcpServers, appearedAfterApply.has(schema.name))
    rows.push({
      name: schema.name,
      description: schema.description ?? '',
      channel: attributed.channel,
      confidence: attributed.confidence,
      ...attributed.serverName !== undefined ? { serverName: attributed.serverName } : {},
      ...attributed.owner !== undefined ? { owner: attributed.owner } : {},
      ...schema.parameters !== undefined ? { parameters: schema.parameters } : {},
    })
  }
  return rows
}

/** Minimal ToolSchema shape (model-facing name/description/parameters). */
interface ToolSchemaLike {
  readonly name: string
  readonly description?: string
  readonly parameters?: CatalogJsonValue
}

/** Build the full catalog snapshot (skills + tools). */
export async function catalogSnapshot(
  workdir: string | undefined,
  registry: RegistrySlice,
  toolsSchemas: readonly ToolSchemaLike[],
  mcpServers: readonly string[],
  appearedAfterApply: ReadonlySet<string>,
  scopes: readonly unknown[] = [undefined],
): Promise<CapabilityCatalogSnapshot> {
  const base = await collectSkills(registry, workdir, scopes)
  const tools = projectTools(toolsSchemas, mcpServers, appearedAfterApply as Set<string>)
  return {
    skills: base.skills,
    tools,
    mcpServers: mcpServers.map(name => ({ name, toolCount: tools.filter(t => t.serverName === name).length })),
    channels: [
      { channel: 'skill', count: base.skills.length },
      { channel: 'tool', count: tools.length },
    ],
  }
}

/** Load one skill detail. */
export async function catalogDetail(
  ctx: Context,
  registry: RegistrySlice,
  name: string,
  workdir: string | undefined,
  scope: unknown = undefined,
): Promise<CatalogSkillDetail | undefined> {
  return loadSkillDetail(ctx, registry, name, workdir, scope)
}

/** Read one skill-bundle file's text content on demand. */
export async function catalogReadSkillFile(
  registry: RegistrySlice,
  name: string,
  filePath: string,
  workdir: string | undefined,
  scope: unknown = undefined,
): Promise<CatalogSkillFileRead | undefined> {
  return readSkillFileContent(registry, name, filePath, workdir, scope)
}

/** Open the host's native directory chooser (the workspace "add" dialog). */
export async function catalogPickDirectory(ctx: Context, signal?: AbortSignal): Promise<string | null> {
  const picker = ctx.get?.('directoryPicker') as
    | { capability?: () => { kind?: string; pick?: (s: AbortSignal) => Promise<string | null> } }
    | undefined
  const cap = picker?.capability?.()
  if (cap?.kind !== 'native' || cap.pick === undefined) return null
  try {
    return await cap.pick(signal ?? new AbortController().signal)
  } catch {
    return null
  }
}

/** Delete a catalog-owned file skill (rejects built-in / plugin-provided). */
export async function catalogDeleteSkill(
  registry: RegistrySlice,
  name: string,
  workdir: string | undefined,
  scope: unknown = undefined,
): Promise<CatalogDeleteSkillResult> {
  const base = workdir === undefined ? {} : { cwd: workdir }
  const lookup = scope === undefined ? base : { ...base, scope }
  const def = await registry.get(name, lookup)
  if (def === undefined) return { ok: false, error: 'skill not found' }
  return deleteSkillDir(def)
}

/** Set one declared credential value (never returned on the wire). */
export async function catalogSetCredential(
  ctx: Context,
  request: CatalogCredentialSetRequest,
): Promise<boolean> {
  const { credentials } = resolveServices(ctx)
  if (credentials === undefined) return false
  try {
    if (!CREDENTIAL_REF_NAME.test(request.key)) return false
    await credentials.set(request.key, request.value)
    return true
  } catch {
    return false
  }
}

/** Add a skill from a raw SKILL.md text payload into the managed root. */
export async function catalogAddSkill(
  ctx: Context,
  request: CatalogAddSkillRequest,
  dshHome: string,
): Promise<CatalogAddSkillResult> {
  const { registry } = resolveServices(ctx)
  if (registry === undefined) return { ok: false, error: 'skills service absent in this composition' }
  if (request.channel === 'zip') {
    return addSkillFromPayload(request, dshHome)
  }
  if (request.channel === 'command') {
    return commandInstall(request, dshHome)
  }
  return { ok: false, error: 'github clone not wired in v1' }
}

/** List the skills inside a local container dir (for the add-skill chooser). */
export async function catalogListDirSkills(dirPath: string): Promise<readonly CatalogDirSkillInfo[]> {
  return listDirSkills(dirPath)
}

export { resolveSkillNameFromContent }
