/**
 * T102 · which agent preset 「添加题集 › 让 Agent 整理」 opens: the one whose
 * composition grants the datasets-tool row's `organize` tier — chosen by what
 * it grants, never by its id.
 *
 * Organizing folded into the evaluation mode, and that mode has a different
 * id per deployment (`eval` in the web-eval pack, `dsh-eval` in the eval mode
 * pack 3080 runs). A hardcoded default would be wrong on one of
 * them, so the door asks the host's preset registry instead, with the same
 * rule the eval panel's session door uses for the eval row (T97): keep the
 * deployment default when it grants, else the first listed, unbroken preset
 * that does.
 *
 * Why the host reads it and not the browser (where the eval door decides):
 * the official `pluginInventory` lists each preset's rows by module name only,
 * with no config, and the eval door's criterion is row presence. This one is a
 * TIER — every preset that mounts `@khorsheed/dsh-datasets/tool` names the same
 * module, and only its `tools:` config says whether it can organize. The
 * registry's own `readDocument` returns that config as the Loader's YAML, and
 * this package already parses YAML on the host side.
 * @module @khorsheed/dsh-datasets
 */
import yaml from 'js-yaml'

/** The datasets-tool composition entry, as preset rows name it. */
export const DATASETS_TOOL_MODULE = '@khorsheed/dsh-datasets/tool'

/** The tier that grants organizing (the proposal verb and the dataset-authoring skill). */
export const ORGANIZE_TIER = 'organize'

/**
 * The slice of the host's `agentPresets` registry this needs, structurally
 * (host-version tolerant: an extra member never breaks it, a missing one
 * degrades to "no preset found").
 */
export interface PresetRegistrySlice {
  /** Every declared preset, sorted by `order`, with `broken` when it cannot activate. */
  list?: () => Promise<ReadonlyArray<{ readonly id: string; readonly broken?: string }>>
  /** One preset's `plugins:` list as the Loader's YAML. */
  readDocument?: (id: string) => Promise<{ readonly content: string }>
  /** The deployment default preset id. */
  readonly defaultId?: string
}

/**
 * The Loader dialect's `!!js` tag (cordis-plugin-include's `entryListSchema`):
 * read as an opaque marker. A row whose `disabled` is an expression is decided
 * per Loader context, which this read does not have; it counts as enabled.
 */
const JS_EXPR = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (source: string) => ({ jsExpression: source }),
})
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([JS_EXPR])

/** One composition entry, structurally. */
interface Entry {
  name?: unknown
  disabled?: unknown
  config?: unknown
}

/**
 * Whether one entry list (recursing into `cordis:group` rows, whose `config`
 * is a child list) mounts the datasets-tool row at the organize tier.
 * @param entries - a parsed entry list.
 * @returns true when some enabled row grants the tier.
 */
function listGrants(entries: unknown): boolean {
  if (!Array.isArray(entries)) return false
  for (const raw of entries) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Entry
    if (entry.disabled === true) continue
    if (entry.name === DATASETS_TOOL_MODULE) {
      const tier = (entry.config as { tools?: unknown } | undefined)?.tools
      if (tier === ORGANIZE_TIER) return true
      continue
    }
    if (Array.isArray(entry.config) && listGrants(entry.config)) return true
  }
  return false
}

/**
 * Whether a preset document (the registry's `readDocument` content) grants
 * the organize tier.
 * @param content - the `plugins:` list as YAML.
 * @returns true / false; false when the YAML cannot be read.
 */
export function compositionGrantsOrganize(content: string): boolean {
  try {
    return listGrants(yaml.load(content, { schema: SCHEMA }))
  } catch {
    return false
  }
}

/**
 * Pick the organizing preset: the default when it grants the organize tier,
 * else the first listed, unbroken preset that does.
 * @param registry - the host's preset registry (undefined on a host without one).
 * @returns the preset id, or '' when no preset grants it (or nothing can be
 *   read) — the session then keeps the default and the request names the skill.
 */
export async function resolveOrganizingPreset(registry: PresetRegistrySlice | undefined): Promise<string> {
  if (registry?.list === undefined || registry.readDocument === undefined) return ''
  let rows: ReadonlyArray<{ readonly id: string; readonly broken?: string }>
  try {
    rows = (await registry.list()).filter(row => row.broken === undefined)
  } catch {
    return ''
  }
  const grants = async (id: string): Promise<boolean> => {
    try {
      return compositionGrantsOrganize((await registry.readDocument!(id)).content)
    } catch {
      return false
    }
  }
  const fallback = rows.find(row => row.id === registry.defaultId)
  if (fallback !== undefined && await grants(fallback.id)) return fallback.id
  for (const row of rows) {
    if (row === fallback) continue
    if (await grants(row.id)) return row.id
  }
  return ''
}
