/**
 * The capability FINGERPRINT: a canonical form of a catalog snapshot, and the
 * sha256 over it.
 *
 * A catalog snapshot is a listing — ordered by registration, worded for a
 * human, stamped with file mtimes. None of that is the capability face. Two
 * instances that register the same tools in a different order have the same
 * capabilities; an instance whose tool description was reworded has the same
 * capabilities; an instance whose tool gained a parameter does NOT. This
 * module decides which of those differences count, so a condition document
 * can claim `preset: X` and something can check the claim instead of
 * believing it.
 *
 * What enters the fingerprint, and why:
 *
 * | Row | Fields | Left out |
 * |---|---|---|
 * | skill | `name`, `source`, `body` (sha256 of SKILL.md) | `description`, `whenToUse`, `provider`, `updatedAt` |
 * | tool | `name`, `channel`, `parameters` | `description`, `confidence`, `owner` |
 * | mcpServer | `name`, `tools` (its tool names) | tool count (derived) |
 * | channel | the names | the counts (derived from the rows) |
 *
 * The exclusions are deliberate and each one is a claim: **prose is not a
 * capability**. Rewording a tool description, or a skill's routing blurb,
 * changes what the model reads but not what it can do — and a factor that
 * moves when someone fixes a typo is a factor nobody can hold still across a
 * run. A skill's BODY is the opposite: it is the procedure the model
 * executes, so it enters as a sha. `updatedAt` is a filesystem fact, not a
 * capability: touching a file must not mint a new subject.
 *
 * Determinism is the whole product. Every list is sorted by name, and the
 * digest is taken over canonical JSON (sorted keys, no whitespace), so the
 * same capability face hashes the same on two machines and in two processes.
 * @module @khorsheed/dsh-capability-catalog/capabilities
 */

import { createHash } from 'node:crypto'
import type { CapabilityCatalogSnapshot, CatalogJsonValue } from './types.ts'

/** Prefix of the human-facing capability tag (`caps:<sha256>`). */
export const CAPS_TAG_PREFIX = 'caps:'

/** One skill as the fingerprint sees it. */
export interface CanonicalSkill {
  readonly name: string
  readonly source: string
  /** sha256 of the SKILL.md body, or null when the skill has no readable body. */
  readonly body: string | null
}

/** One tool as the fingerprint sees it. */
export interface CanonicalTool {
  readonly name: string
  readonly channel: string
  /** The model-facing parameter schema, or null when the tool declares none. */
  readonly parameters: CatalogJsonValue | null
}

/** One MCP server as the fingerprint sees it. */
export interface CanonicalMcpServer {
  readonly name: string
  /** The server's tool names, sorted. */
  readonly tools: readonly string[]
}

/** The canonical capability face of one snapshot. */
export interface CanonicalCapabilities {
  readonly skills: readonly CanonicalSkill[]
  readonly tools: readonly CanonicalTool[]
  readonly mcpServers: readonly CanonicalMcpServer[]
  readonly channels: readonly string[]
}

/**
 * Canonical JSON: object keys sorted (code-unit order), no whitespace, arrays
 * in document order. Two documents differing only in key order canonicalize
 * alike.
 *
 * Deliberately duplicated rather than imported from `@khorsheed/dsh-eval`:
 * community plugins never depend on siblings, and the two copies are pinned
 * against each other by the eval contract tests that consume a `caps:` tag.
 * @param value - any JSON value.
 * @returns its canonical serialization.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`
}

/** Sort by `name`, code-unit order (the one ordering rule of this module). */
function byName<T extends { readonly name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Project a snapshot onto its canonical capability face.
 *
 * Pure and total: it reads nothing but the snapshot, and a row missing an
 * optional field contributes `null` rather than disappearing — a tool with no
 * parameter schema is a different capability from one whose schema is `{}`,
 * and both are different from the tool being absent.
 * @param snapshot - a catalog snapshot (its own `sha` field, if any, is ignored).
 * @returns the canonical form the digest is taken over.
 */
export function canonicalCapabilities(snapshot: CapabilityCatalogSnapshot): CanonicalCapabilities {
  const tools = byName(snapshot.tools)
  return {
    skills: byName(snapshot.skills).map(skill => ({
      name: skill.name,
      source: skill.source,
      body: skill.bodySha ?? null,
    })),
    tools: tools.map(tool => ({
      name: tool.name,
      channel: tool.channel,
      parameters: tool.parameters ?? null,
    })),
    // The server's tool NAMES, not its tool count: a server that swapped one
    // tool for another keeps its count and changes its capability face.
    mcpServers: byName(snapshot.mcpServers).map(server => ({
      name: server.name,
      tools: tools.filter(tool => tool.serverName === server.name).map(tool => tool.name),
    })),
    // Names only — the counts are derived from the rows above, and a summary
    // that disagreed with them would make the digest depend on which of the
    // two was right.
    channels: [...snapshot.channels].map(channel => channel.channel).sort(),
  }
}

/**
 * The capability hash: sha256 hex of the canonical form's canonical JSON.
 * @param snapshot - a catalog snapshot.
 * @returns the 64-hex digest.
 */
export function hashOf(snapshot: CapabilityCatalogSnapshot): string {
  return createHash('sha256').update(canonicalJson(canonicalCapabilities(snapshot))).digest('hex')
}

/**
 * The human-facing tag form of a capability hash.
 * @param sha - a sha256 hex digest (or the hash of a snapshot).
 * @returns `caps:<sha>`.
 */
export function capsTag(sha: string): string {
  return `${CAPS_TAG_PREFIX}${sha}`
}

/** sha256 hex of a skill body, the form {@link CanonicalSkill.body} carries. */
export function hashSkillBody(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
