/**
 * SKILL.md frontmatter: ONE real-YAML parse shared by every catalog reader.
 *
 * Before this module, each reader carried its own line-based scan: a regex
 * split plus per-key patterns that matched at any indentation, so a nested
 * same-named key could shadow a top-level one and a `presetScope` under an
 * unrelated key still counted. Everything here is derived from a single
 * js-yaml parse of the block (js-yaml is the repo's YAML convention and a
 * shipped runtime dependency), with the scalar semantics mirrored from the
 * host's skill loader (`skill-filesystem`): booleans accept true/false, 1/0,
 * yes/no, on/off.
 *
 * Two deliberate degradations, both pinned by specs:
 *
 * - A malformed `metadata:` block must not take the skill down. A bad metadata
 *   value usually poisons the whole YAML parse, so on a parse failure the
 *   block is retried once with the top-level `metadata:` section stripped:
 *   the skill delivers minus metadata rather than being rejected.
 * - A flag value outside the accepted variants reads as ABSENT (the caller's
 *   default applies) instead of rejecting the skill the way the host loader
 *   does — the catalog is a management/delivery surface, not the loader of
 *   record.
 * @module @khorsheed/dsh-capability-catalog/frontmatter
 */

import yaml from 'js-yaml'

/** Kebab-case skill / preset id grammar (the registry's own). */
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Whether a string is a usable skill / preset id. */
export function isKebabId(value: string): boolean {
  return KEBAB_ID.test(value)
}

/** The frontmatter block split from the body it precedes. */
export interface FrontmatterSplit {
  /** The text between the `---` fences. */
  readonly front: string
  /** Everything after the closing fence. */
  readonly body: string
}

/** Frontmatter block, then the body it precedes (CRLF-tolerant). */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/** Split a SKILL.md into its frontmatter block and body. */
export function splitFrontmatter(content: string): FrontmatterSplit | undefined {
  const match = FRONTMATTER.exec(content)
  if (match === null) return undefined
  return { front: match[1] ?? '', body: match[2] ?? '' }
}

/** A SKILL.md frontmatter block, parsed once with real YAML semantics. */
export interface SkillFrontmatter {
  /** Top-level `name`, when a non-empty string. */
  readonly name?: string
  /** Top-level `description`, when a non-empty string (folded scalars included). */
  readonly description?: string
  /** `when-to-use` / `whenToUse` routing guidance, kebab spelling first. */
  readonly whenToUse?: string
  /** `disable-model-invocation`, inverted; absent/invalid means invocable. */
  readonly modelInvocable: boolean
  /** `user-invocable`; absent/invalid means invocable. */
  readonly userInvocable: boolean
  /**
   * The declared preset ids: the canonical `metadata.presetScope`, falling
   * back to a top-level `presetScope` (a form the line-based reader accepted
   * and hand-edited files may still carry). A `presetScope` nested under any
   * other key is NOT a declaration. `undefined` is absent; `[]` is the
   * explicit every-preset form.
   */
  readonly presetScope?: readonly string[]
  /** The verbatim top-level `metadata` map, when it is a plain object. */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** The body after the closing fence. */
  readonly body: string
}

/**
 * Parse a SKILL.md's frontmatter block once, with js-yaml.
 * @param content - the whole file text.
 * @returns the parsed fields plus the body, or undefined when there is no
 *   frontmatter block or the block is not usable YAML even without its
 *   `metadata:` section.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | undefined {
  const split = splitFrontmatter(content)
  if (split === undefined) return undefined
  const parsed = parseFrontmatterData(split.front)
  if (parsed === undefined) return undefined
  const { data, metadataDropped } = parsed
  const rawMetadata = data['metadata']
  const metadata = !metadataDropped && typeof rawMetadata === 'object' && rawMetadata !== null && !Array.isArray(rawMetadata)
    ? rawMetadata as Record<string, unknown>
    : undefined
  const name = stringField(data, 'name')
  const description = stringField(data, 'description')
  const whenToUse = whenToUseOf(data)
  const presetScope = presetScopeOf(data, metadata)
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...whenToUse === undefined ? {} : { whenToUse },
    modelInvocable: frontmatterBoolean(data, 'disable-model-invocation') !== true,
    userInvocable: frontmatterBoolean(data, 'user-invocable') !== false,
    ...presetScope === undefined ? {} : { presetScope },
    ...metadata === undefined ? {} : { metadata },
    body: split.body,
  }
}

/**
 * A frontmatter boolean with the host skill loader's accepted variants:
 * booleans, 1/0 (number or string), and yes/no/on/off (case-insensitive —
 * js-yaml 4 leaves those as strings, so the string branch carries them).
 * Absent or anything else reads as undefined: the catalog degrades to the
 * caller's default instead of rejecting the skill the way the host loader
 * does (`frontmatter field "<key>" must be a boolean` → file ignored).
 */
export function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  return undefined
}

/** A frontmatter string field: non-empty strings only (the host's stringField). */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The routing guidance, kebab spelling first (the catalog has always accepted both). */
function whenToUseOf(data: Record<string, unknown>): string | undefined {
  return stringField(data, 'when-to-use') ?? stringField(data, 'whenToUse')
}

/** The declared preset scope; the canonical metadata-nested key wins over the legacy top-level one. */
function presetScopeOf(data: Record<string, unknown>, metadata: Record<string, unknown> | undefined): readonly string[] | undefined {
  const nested = metadata === undefined ? undefined : normalizePresetScope(metadata['presetScope'])
  if (nested !== undefined) return nested
  return normalizePresetScope(data['presetScope'])
}

/** Normalize a raw presetScope value: arrays filter to kebab ids, a scalar is a one-item list. */
function normalizePresetScope(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value)) return presetIdsOf(value.map(String))
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return presetIdsOf([String(value)])
  }
  return undefined
}

/** Normalize YAML scalars onto the preset-id grammar (deduped, order preserved). */
function presetIdsOf(values: readonly string[]): readonly string[] {
  const ids: string[] = []
  for (const value of values) {
    const id = value.trim().replace(/^['"]|['"]$/g, '')
    if (id === '' || !KEBAB_ID.test(id)) continue
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Parse the block as a YAML mapping; on a YAML failure retry once without the
 * top-level `metadata:` section (a malformed metadata value degrades to
 * no-metadata instead of rejecting the file). */
function parseFrontmatterData(front: string): { data: Record<string, unknown>; metadataDropped: boolean } | undefined {
  try {
    const data = loadYamlMapping(front)
    return data === undefined ? undefined : { data, metadataDropped: false }
  } catch {
    const stripped = stripTopLevelBlock(front, 'metadata')
    if (stripped === undefined) return undefined
    try {
      const data = loadYamlMapping(stripped)
      return data === undefined ? undefined : { data, metadataDropped: true }
    } catch {
      return undefined
    }
  }
}

/** js-yaml parse of the block; only a plain object is a usable frontmatter map. */
function loadYamlMapping(front: string): Record<string, unknown> | undefined {
  const parsed: unknown = yaml.load(front)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/** Remove a top-level `key:` line and its indented block; undefined when the key is absent. */
function stripTopLevelBlock(front: string, key: string): string | undefined {
  const lines = front.split('\n')
  const start = lines.findIndex(line => new RegExp(`^${key}\\s*:`).test(line))
  if (start < 0) return undefined
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (line.trim() !== '' && !/^\s/.test(line)) break
    end += 1
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}
