/**
 * Wire types of the capability catalog: the snapshot the host half collects,
 * the model-facing tool output, and the Remote data contract. The browser
 * card parses the tool's JSON text result or the Remote response back into
 * these shapes, so they stay plain JSON-safe objects with no class identity.
 * @module @khorsheed/dsh-capability-catalog/types
 */

/** Arbitrary JSON value — a locally-declared recursive type the typert Remote
 * boundary accepts (arbitrary tool parameter schemas are unconstrained JSON). */
export type CatalogJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CatalogJsonValue[]
  | { readonly [key: string]: CatalogJsonValue }

/** One skill row in the catalog (summary layer — no body / metadata / rank). */
export interface CatalogSkillRow {  /** Kebab-case skill name. */
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
  /** Last-modified time (epoch ms) of the skill body, when a local bundle exists. */
  readonly updatedAt?: number
  /**
   * sha256 of the skill's SKILL.md body — the one part of a skill that IS a
   * capability (the procedure the model executes), carried so the capability
   * fingerprint can be taken from a snapshot alone. Absent when the body
   * could not be read (a remote/opaque skill, or a registry that declines
   * the load).
   */
  readonly bodySha?: string
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
  /** Model-facing input parameters (JSON value), for the detail view. */
  readonly parameters?: CatalogJsonValue
  /** Registrant package/owner when known. */
  readonly owner?: string
}

/** One MCP server observed in the profile patch layers. */

/** MCP transport kind (matches dsh-mcp-client). */
export type McpTransport = 'stdio' | 'streamable-http'

/** One detected credential declared by an MCP server config (env/header/query). */
export interface CatalogMcpCredentialDecl {
  /** Config key that holds the secret (env var name, header name, or 'query:key'). */
  readonly ref: string
  /** Human label (e.g. the env var / header / query param name). */
  readonly label: string
  /** Whether the credential has been configured (never the value). */
  readonly configured: boolean
}

/** A configured MCP server (the catalog's persisted form). */
export interface CatalogMcpServerConfig {
  readonly serverName: string
  readonly transport: McpTransport
  /** stdio */
  readonly command?: string
  readonly args?: readonly string[]
  readonly cwd?: string
  /** streamable-http */
  readonly url?: string
  readonly headers?: readonly [string, string][]
  /** env (value is a secretRef marker if it came from a secret). */
  readonly env?: readonly [string, string][]
  /** Whether the server is enabled (connected + injected). */
  readonly enabled: boolean
}

/** One discovered tool of an MCP server. */
export interface CatalogMcpTool {
  readonly name: string
  readonly description: string
  readonly parameters?: CatalogJsonValue
  /** Per-tool enable/disable. */
  readonly enabled: boolean
}

/** The catalog's own MCP server management snapshot. */
export interface CatalogMcpSnapshot {
  readonly servers: readonly CatalogMcpServerConfig[]
  readonly tools: Readonly<Record<string, readonly CatalogMcpTool[]>>
  readonly credentials: readonly CatalogMcpCredentialDecl[]
}

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
  /**
   * The capability hash of this snapshot (`hashOf`), filled by the host half.
   * It is NOT part of the canonical form it digests — a snapshot carrying it
   * and the same snapshot without it hash alike.
   */
  readonly sha?: string
  /** The agent preset this snapshot was taken under; absent when none resolved. */
  readonly preset?: string
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
  /** Declared credentials + their configured state (metadata.credentials only). */
  readonly credentials?: readonly CatalogCredentialState[]
  /** Env-var references detected in the skill body (read-only, informational —
   * typically provided by the runtime/caller, NOT user-configurable here). */
  readonly environmentRefs?: readonly string[]
  /** Bundle-relative file paths (SKILL.md + scripts/assets/references) for a directory side. */
  readonly files?: readonly string[]
}

/** One skill bundle file's text content, read on demand. */
export interface CatalogSkillFileRead {
  readonly content: string
}

/** One skill found inside a local skill container dir.
 * `kind:'self'` is the picked directory itself (a single skill bundle), so it is
 * installed with `repo=<dir>` and no `skills`; `'child'` is a sub-directory of a
 * container, installed with `repo=<dir>` + `skills:[name]`. */
export interface CatalogDirSkillInfo {
  readonly name: string
  readonly description: string
  readonly kind?: 'self' | 'child'
}

/** One managed skill's preset-scoped delivery state. */
export interface CatalogScopedSkillRow {
  readonly name: string
  readonly description: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  /** The managed `SKILL.md` path. */
  readonly path: string
  /** The preset ids its frontmatter declares; empty means "every preset". */
  readonly presets: readonly string[]
  /** Whether a delivery provider currently serves it in at least one preset. */
  readonly delivered: boolean
  /** The default-root path already supplying this name, when delivery is refused. */
  readonly conflict?: string
}

/** One preset's scoped-delivery state. */
export interface CatalogScopedPresetRow {
  readonly presetId: string
  readonly skills: readonly string[]
  /** Why this preset's standing scope could not be used. */
  readonly error?: string
}

/** Preset-scoped skill delivery status, as the settings surface reads it.
 * This is a discovery policy for one instance, not an authorization boundary. */
export interface CatalogPresetScopeStatus {
  /** Whether any preset is currently served. */
  readonly enabled: boolean
  /** Why delivery is off, or reduced — absent when fully operational. */
  readonly reason?: string
  /** The plugin-owned root the delivered skills live in. */
  readonly root: string
  /** Whether the managed root is currently watched for changes. */
  readonly watching: boolean
  readonly skills: readonly CatalogScopedSkillRow[]
  readonly presets: readonly CatalogScopedPresetRow[]
  /** True because custom skill roots are configured in host compositions this
   * plugin cannot read: a duplicate there would not be detected. */
  readonly customRootsUnverifiable: boolean
}

/** One preset a scope picker may choose. */
export interface CatalogPresetOption {
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Why this preset cannot compose a session, when it cannot. */
  readonly broken?: string
}

/** Request to declare which presets one skill is delivered to. */
export interface CatalogPresetScopeSetRequest {
  readonly name: string
  readonly presets: readonly string[]
}

/** Request to adopt an installed skill into the managed, preset-scoped root. */
export interface CatalogPresetScopeAdoptRequest {
  readonly name: string
  readonly presets: readonly string[]
  readonly workdir?: string
}

/** Outcome of one preset-scope write; `error` is present exactly when it failed. */
export interface CatalogPresetScopeEditResult {
  readonly ok: boolean
  readonly error?: string
}

/** Add-skill channel. */
export type AddSkillChannel = 'zip' | 'github' | 'command'

/** Request to add a skill (upload a zip or clone a GitHub repo). */
export interface CatalogAddSkillRequest {
  readonly channel: AddSkillChannel
  /** Base64-encoded zip/tgz bytes for `zip`; opaque for `github`. */
  readonly payload: string
  /** owner/repo[/path] or local dir path for `command`. */
  readonly repo?: string
  /** Selected skill sub-directory names when `repo` is a multi-skill container dir. */
  readonly skills?: readonly string[]
  /** Whether the added skill is model-invocable (written as disable-model-invocation inversely). */
  readonly modelInvocable: boolean
  /** Target root: user (`$DSH_HOME/skills`) or project (`.agents/skills`). */
  readonly root: 'user' | 'project'
  /** When true, an existing same-name skill in the target root is replaced instead of prompting. */
  readonly overwrite?: boolean
}

/** Add-skill result. */
export interface CatalogAddSkillResult {
  readonly ok: boolean
  readonly error?: string
  readonly name?: string
  /** Set on a soft "skill already exists" refusal (ok:false) so the UI can offer overwrite. */
  readonly exists?: boolean
}

/** Delete-skill result (delete only applies to catalog-owned file skills). */
export interface CatalogDeleteSkillResult {
  readonly ok: boolean
  readonly error?: string
}

/** Wire form of one credential's configured state. */
export interface CatalogCredentialSetRequest {
  readonly key: string
  readonly value: string
}

/** Remote surface the browser card binds through. */
export interface CapabilityCatalogRemote {
  readonly snapshot: (workdir?: string) => Promise<CapabilityCatalogSnapshot>
  /** The capability face of one preset, with its `sha` (see the host half). */
  readonly snapshotFor: (presetId?: string, workdir?: string) => Promise<CapabilityCatalogSnapshot>
  readonly detail: (name: string, workdir?: string) => Promise<CatalogSkillDetail | undefined>
  readonly readSkillFile: (name: string, filePath: string, workdir?: string) => Promise<CatalogSkillFileRead | undefined>
  readonly listDirSkills: (dirPath: string) => Promise<readonly CatalogDirSkillInfo[]>
  readonly setCredential: (request: CatalogCredentialSetRequest) => Promise<boolean>
  readonly addSkill: (request: CatalogAddSkillRequest) => Promise<CatalogAddSkillResult>
  readonly deleteSkill: (name: string, workdir?: string) => Promise<CatalogDeleteSkillResult>
  readonly pickDirectory: () => Promise<string | null>
}
