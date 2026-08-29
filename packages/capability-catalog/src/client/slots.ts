/**
 * Slot-facing types of the capability-catalog client half: the settings
 * section (a standalone nav tab) and its injected data face.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-settings' SlotMap merge ('settings.section' + owner props).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the generated Remote namespace merge.
import type {} from '@khorsheed/dsh-capability-catalog/remote'
import type { CapabilityCatalogSnapshot, CatalogAddSkillRequest, CatalogDirSkillInfo, CatalogDeleteSkillResult, CatalogMcpServerConfig, CatalogMcpSnapshot, CatalogMcpTool, CatalogSkillDetail, CatalogSkillFileRead } from '@khorsheed/dsh-capability-catalog/types'

/** A tiny external store holding the last catalog snapshot (re-created on change). */
export interface CatalogHook {
  readonly getSnapshot: () => CapabilityCatalogSnapshot | undefined
  readonly subscribe: (listener: () => void) => () => void
  readonly refresh: () => Promise<void>
}

/** Injected data face of the settings section. */
export interface CapabilityCatalogInjected {
  hooks: {
    /** The catalog snapshot store; the section binds `useCatalog` to it. */
    catalog: CatalogHook
  }
  /** Re-fetch the catalog snapshot after a mutation (e.g. add-skill). */
  refresh: () => Promise<void>
  /** Load one skill's full detail (content + metadata + credentials). */
  detail: (name: string) => Promise<CatalogSkillDetail | undefined>
  /** Read one skill-bundle file's text content on demand. */
  readSkillFile: (name: string, path: string) => Promise<CatalogSkillFileRead | undefined>
  /** List the skills inside a local container dir (add-skill chooser). */
  listDirSkills: (dirPath: string) => Promise<readonly CatalogDirSkillInfo[]>
  /** Set one declared credential value. */
  setCredential: (key: string, value: string) => Promise<boolean>
  /** Add a skill via a full request (upload zip/text or clone-from-source). */
  addSkill: (request: CatalogAddSkillRequest) => Promise<{ ok: boolean; error?: string; name?: string; exists?: boolean }>
  /** Delete a catalog-owned file skill (rejects built-in/plugin-provided). */
  deleteSkill: (name: string) => Promise<CatalogDeleteSkillResult>
  /** Open the host's native directory chooser (the workspace "add" dialog). */
  pickDirectory: () => Promise<string | null>
  /** MCP: full management snapshot (servers + tools + credential state). */
  mcpSnapshot: () => Promise<CatalogMcpSnapshot>
  /** MCP: add/replace a server config. */
  mcpAdd: (config: CatalogMcpServerConfig) => Promise<boolean>
  /** MCP: remove a server. */
  mcpRemove: (serverName: string) => Promise<boolean>
  /** MCP: set server-level enable flag. */
  mcpSetEnabled: (serverName: string, enabled: boolean) => Promise<void>
  /** MCP: set one credential value. */
  mcpSetCredential: (ref: string, value: string) => Promise<boolean>
  /** MCP: set one tool's enable flag. */
  mcpSetToolEnabled: (serverName: string, tool: string, enabled: boolean) => Promise<void>
  /** MCP: connect + discover a server's tools. */
  mcpDiscover: (serverName: string) => Promise<readonly CatalogMcpTool[]>
}

/** Full props of the settings.section entry (a standalone nav tab). */
export type CapabilityCatalogCardProps =
  PropsRuntime<'settings.section'>
  & InjectFace<CapabilityCatalogInjected>
  & PropsLocale<'capability-catalog'>
