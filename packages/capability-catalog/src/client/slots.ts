/**
 * Slot-facing types of the capability-catalog client half: the settings
 * section (a standalone nav tab) and its injected data face.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-settings' SlotMap merge ('settings.section' + owner props).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the generated Remote namespace merge.
import type {} from '@khorsheed/dsh-capability-catalog/remote'
import type { CapabilityCatalogSnapshot, CatalogAddSkillRequest, CatalogDirSkillInfo, CatalogDeleteSkillResult, CatalogMcpServerConfig, CatalogMcpSnapshot, CatalogMcpTool, CatalogModeFace, CatalogPresetOption, CatalogPresetScopeEditResult, CatalogPresetScopeStatus, CatalogSkillDetail, CatalogSkillFileRead } from '@khorsheed/dsh-capability-catalog/types'

/** A tiny external store holding the last catalog snapshot (re-created on change). */
export interface CatalogHook {
  readonly getSnapshot: () => CapabilityCatalogSnapshot | undefined
  readonly subscribe: (listener: () => void) => () => void
  /** Re-read one mode's face; `presetId` omitted reads the deployment default. */
  readonly refresh: (presetId?: string) => Promise<void>
}

/** Injected data face of the settings section. */
export interface CapabilityCatalogInjected {
  hooks: {
    /** The catalog snapshot store; the section binds `useCatalog` to it. */
    catalog: CatalogHook
  }
  /**
   * Re-fetch the catalog snapshot after a mutation (e.g. add-skill). `presetId`
   * names the mode the grid is showing, so a mutation never drags the grid back
   * to the default mode's face.
   */
  refresh: (presetId?: string) => Promise<void>
  /**
   * Re-fetch until `settled` accepts the snapshot, on a bounded backoff. Use it
   * for mutations whose visibility depends on the host's skill watcher (adding
   * or deleting a skill): the write lands before the registry is invalidated, so
   * one immediate refresh returns the pre-change snapshot.
   */
  refreshSettled: (settled: (snapshot: CapabilityCatalogSnapshot) => boolean, presetId?: string) => Promise<boolean>
  /** Load one skill's full detail (content + metadata + credentials) at a mode's scope. */
  detail: (name: string, presetId?: string) => Promise<CatalogSkillDetail | undefined>
  /** Read one skill-bundle file's text content on demand. */
  readSkillFile: (name: string, path: string, presetId?: string) => Promise<CatalogSkillFileRead | undefined>
  /** List the skills inside a local container dir (add-skill chooser). */
  listDirSkills: (dirPath: string) => Promise<readonly CatalogDirSkillInfo[]>
  /** Set one declared credential value. */
  setCredential: (key: string, value: string) => Promise<boolean>
  /** Add a skill via a full request (upload zip/text or clone-from-source). */
  addSkill: (request: CatalogAddSkillRequest) => Promise<{ ok: boolean; error?: string; name?: string; exists?: boolean }>
  /** Delete a catalog-owned file skill (rejects built-in/plugin-provided). */
  deleteSkill: (name: string, presetId?: string) => Promise<CatalogDeleteSkillResult>
  /** Open the host's native directory chooser (the workspace "add" dialog). */
  pickDirectory: () => Promise<string | null>
  /** Every mode's capability face, for the cross-mode comparison view. */
  modeFaces: () => Promise<readonly CatalogModeFace[]>
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
  /** Preset-scoped delivery status of the plugin's managed skill root. */
  presetScopeStatus: () => Promise<CatalogPresetScopeStatus | undefined>
  /** Every preset the roster supplies, for the scope picker. */
  presetScopeRoster: () => Promise<readonly CatalogPresetOption[]>
  /** Declare which presets one managed skill is delivered to. */
  presetScopeSet: (name: string, presets: readonly string[]) => Promise<CatalogPresetScopeEditResult>
  /** Move an installed skill into the managed root with a preset scope. */
  presetScopeAdopt: (name: string, presets: readonly string[]) => Promise<CatalogPresetScopeEditResult>
  /** Move a managed skill back to the user skill root. */
  presetScopeRelease: (name: string) => Promise<CatalogPresetScopeEditResult>
}

/** Full props of the settings.section entry (a standalone nav tab). */
export type CapabilityCatalogCardProps =
  PropsRuntime<'settings.section'>
  & InjectFace<CapabilityCatalogInjected>
  & PropsLocale<'capability-catalog'>
