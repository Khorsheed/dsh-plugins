import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import type { LocalAgentModelEntry } from '@khorsheed/dsh-local-agent/types'

type Table = Record<string, unknown>
const table = (value: unknown): Table => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Table : {}
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/**
 * One `[models.*]` table of the scoped config, as the catalog's enrichment
 * layer reads it: the table KEY is the runnable name `-m` resolves against
 * (kimi-cli ≥2.1 requires it — a bare endpoint id without a table is not
 * runnable), and `model` names the upstream model it points at. Every other
 * field is optional metadata the catalog folds in when the endpoint itself
 * does not advertise it.
 */
export interface KimiModelTable {
  readonly key: string
  readonly provider?: string
  readonly model?: string
  readonly displayName?: string
  readonly efforts?: readonly string[]
  readonly defaultEffort?: string
  readonly contextSize?: number
}

/**
 * List the scoped config's `[models.*]` tables (quoted and bare keys alike —
 * smol-toml folds both to the same object keys). An absent, unreadable, or
 * malformed config yields an empty list: the catalog's enrichment layer then
 * simply has nothing to enrich with. Read-only: the config is authoritative.
 * @param home - the `kimi` harness's scoped home.
 * @returns the model tables, in file order.
 */
export async function readKimiModelTables(home: string): Promise<readonly KimiModelTable[]> {
  let text: string
  try { text = await readFile(join(home, 'config.toml'), 'utf8') }
  catch { return [] }
  let config: Table
  try { config = parse(text) }
  catch { return [] }
  const models = table(config['models'])
  return Object.entries(models).map(([key, raw]) => {
    const model = table(raw)
    const provider = string(model['provider'])
    const upstream = string(model['model'])
    const displayName = string(model['display_name'])
    const efforts = model['support_efforts']
    const defaultEffort = string(model['default_effort'])
    const contextSize = model['max_context_size']
    return {
      key,
      ...provider === undefined ? {} : { provider },
      ...upstream === undefined ? {} : { model: upstream },
      ...displayName === undefined ? {} : { displayName },
      ...!Array.isArray(efforts) ? {} : { efforts: efforts.filter((effort): effort is string => typeof effort === 'string' && effort !== '') },
      ...defaultEffort === undefined ? {} : { defaultEffort },
      ...typeof contextSize === 'number' && Number.isFinite(contextSize) ? { contextSize } : {},
    }
  })
}

/** Native configuration metadata only; provider credentials never leave this function. */
export async function readKimiModelConfiguration(home: string, selectedModel?: string): Promise<{
  entries: LocalAgentModelEntry[]
  defaultModel?: string
  effort?: string
  protocol?: string
}> {
  let text: string
  try { text = await readFile(join(home, 'config.toml'), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] }; throw error }
  const config = parse(text)
  const models = table(config['models'])
  const entries: LocalAgentModelEntry[] = Object.entries(models).map(([value, raw]) => {
    const model = table(raw)
    const efforts = model['support_efforts']
    const defaultEffort = string(model['default_effort'])
    return {
      value, label: string(model['display_name']) ?? value, source: 'configuration',
      ...!Array.isArray(efforts) ? {} : { reasoning: {
        options: efforts.flatMap(value => typeof value === 'string' ? [{ value, label: value }] : []),
        ...defaultEffort === undefined ? {} : { default: defaultEffort },
      } },
    }
  })
  const defaultModel = string(config['default_model'])
  const selected = selectedModel ?? defaultModel
  const model = table(selected === undefined ? undefined : models[selected])
  const provider = table(table(config['providers'])[string(model['provider']) ?? ''])
  const protocol = string(model['protocol']) ?? string(provider['type'])
  const thinking = table(config['thinking'])
  const requestedEffort = string(thinking['effort'])
  const options = entries.find(entry => entry.value === selected)?.reasoning?.options
  const effort = thinking['enabled'] === false ? undefined
    : requestedEffort !== undefined && options?.some(option => option.value === requestedEffort) ? requestedEffort : string(model['default_effort'])
  return { entries, ...defaultModel === undefined ? {} : { defaultModel }, ...effort === undefined ? {} : { effort }, ...protocol === undefined ? {} : { protocol } }
}

/** Only the native Kimi protocol advertises a general exec effort override. */
export async function kimiExecConfiguration(home: string, model: string | undefined, effort: string | undefined): Promise<Record<string, string>> {
  if (effort === undefined) return {}
  const config = await readKimiModelConfiguration(home, model)
  const entry = config.entries.find(entry => entry.value === (model ?? config.defaultModel))
  if (!entry?.reasoning?.options.some(option => option.value === effort)) throw new Error('Kimi configuration does not advertise this model/effort combination')
  if (config.protocol !== 'kimi') {
    throw new Error('This Kimi model protocol has no per-invocation exec effort control; use ACP live mode')
  }
  return { KIMI_MODEL_THINKING_EFFORT: effort }
}
