/**
 * Wire types of the capability catalog: the snapshot the host half collects,
 * the model-facing tool output, and the Remote data contract. The browser
 * card parses the tool's JSON text result or the Remote response back into
 * these shapes, so they stay plain JSON-safe objects with no class identity.
 * @module @khorsheed/dsh-capability-catalog/types
 */

/** One skill row in the catalog (summary layer — no body / metadata / rank). */
export interface CatalogSkillRow {
  /** Kebab-case skill name. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Registration source bucket: project-dsh / project-agents / runtime / user-dsh / user-agents / custom / bundled. */
  readonly source: string
  /** Provider that owns the skill body (e.g. `filesystem`, `skill-badge`, plugin name). */
  readonly provider: string
  /** Whether the model may load it (in catalog). */
  readonly modelInvocable: boolean
  /** Whether a user may invoke it via `/name`. */
  readonly userInvocable: boolean
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
}

/** Credential declared by a skill's metadata (the plugin-defined convention). */
export interface CatalogCredentialDecl {
  /** credential key, e.g. `wechat-reading/api-key`. */
  readonly key: string
  /** Human label shown in the config block. */
  readonly label?: string
}

/** Credential config state for one declared credential. */
export interface CatalogCredentialState {
  readonly key: string
  readonly label?: string
  /** Whether a value has been configured (never the value itself). */
  readonly configured: boolean
}

/** Channel attribution for one tool row. */
export type CatalogToolChannel = 'builtin' | 'plugin' | 'mcp' | 'unknown'

/** One tool row in the catalog. */
export interface CatalogToolRow {
  /** Wire tool name as registered. */
  readonly name: string
  /** Model-facing description. */
  readonly description: string
  /** Attribution result. */
  readonly channel: CatalogToolChannel
  /** Attribution confidence: exact for prefix/whitelist hits, inferred for baseline-diff hits. */
  readonly confidence: 'exact' | 'inferred'
  /** MCP server name when channel === 'mcp' (longest-match resolved). */
  readonly serverName?: string
  /** Registrant package/owner when known. */
  readonly owner?: string
}

/** One MCP server observed in the profile patch layers. */
export interface CatalogMcpServerRow {
  readonly name: string
  readonly toolCount: number
}

/** Channel-count summary. */
export interface CatalogChannelSummary {
  readonly channel: string
  readonly count: number
}

/** Full catalog snapshot. */
export interface CapabilityCatalogSnapshot {
  readonly skills: readonly CatalogSkillRow[]
  readonly tools: readonly CatalogToolRow[]
  readonly mcpServers: readonly CatalogMcpServerRow[]
  readonly channels: readonly CatalogChannelSummary[]
}

/** Fresh detail of one skill (body + metadata), loaded on demand. */
export interface CatalogSkillDetail {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly provider: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly path?: string
  readonly whenToUse?: string
  /** Full SKILL.md body. */
  readonly content: string
  /** Parsed frontmatter metadata, serialized to JSON text (typert boundary is strict JSON). */
  readonly metadataText?: string
  /** Declared credentials + their configured state. */
  readonly credentials?: readonly CatalogCredentialState[]
  /** Bundle-relative file paths (SKILL.md + scripts/assets/references) for a directory side. */
  readonly files?: readonly string[]
}

/** One skill bundle file's text content, read on demand. */
export interface CatalogSkillFileRead {
  readonly content: string
}

/** Add-skill channel. */
export type AddSkillChannel = 'zip' | 'github'

/** Request to add a skill (upload a zip or clone a GitHub repo). */
export interface CatalogAddSkillRequest {
  readonly channel: AddSkillChannel
  /** Base64-encoded zip/tgz bytes for `zip`; opaque for `github`. */
  readonly payload: string
  /** owner/repo[/path] for `github`. */
  readonly repo?: string
  /** Whether the added skill is model-invocable (written as disable-model-invocation inversely). */
  readonly modelInvocable: boolean
  /** Target root: user (`$DSH_HOME/skills`) or project (`.agents/skills`). */
  readonly root: 'user' | 'project'
}

/** Add-skill result. */
export interface CatalogAddSkillResult {
  readonly ok: boolean
  readonly error?: string
  readonly name?: string
}

/** Wire form of one credential's configured state. */
export interface CatalogCredentialSetRequest {
  readonly key: string
  readonly value: string
}

/** Remote surface the browser card binds through. */
export interface CapabilityCatalogRemote {
  readonly snapshot: (workdir?: string) => Promise<CapabilityCatalogSnapshot>
  readonly detail: (name: string, workdir?: string) => Promise<CatalogSkillDetail | undefined>
  readonly readSkillFile: (name: string, filePath: string, workdir?: string) => Promise<CatalogSkillFileRead | undefined>
  readonly setCredential: (request: CatalogCredentialSetRequest) => Promise<boolean>
  readonly addSkill: (request: CatalogAddSkillRequest) => Promise<CatalogAddSkillResult>
}
