/**
 * T102 · 「添加题集 › 让 Agent 整理」 opens the evaluation mode, picked by what
 * its composition grants (the datasets-tool `organize` tier), never by id.
 *
 * The two deployment shapes are tested against their REAL preset bundles: the
 * web-eval pack (`eval`, the pinned default) and the published dsh-presets
 * bundle 3080 runs (`dsh-eval`, beside 开发模式 / 写作模式, default 开发模式). The
 * fake registry answers `list` / `readDocument` the way the host's
 * agent-preset-registry does: rows sorted by `order`, and each document the
 * `plugins:` list dumped in the Loader's YAML dialect (`!!js` included).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import {
  compositionGrantsOrganize, resolveOrganizingPreset, type PresetRegistrySlice,
} from '../src/organizing-preset.ts'
import { DatasetsRemoteService } from '../src/remote.ts'

const REPO = join(import.meta.dirname, '..', '..', '..')

/** The Loader's `!!js` tag, round-tripped as an opaque marker (what the host dumps back). */
class JsExpr {
  constructor(readonly source: string) {}
}
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    instanceOf: JsExpr,
    construct: (source: string) => new JsExpr(source),
    represent: value => (value as JsExpr).source,
  }),
])

interface PresetRow {
  id: string
  name: string
  config: { id: string; order?: number; plugins: unknown[] }
}

/** A registry double over one bundle patch file. */
function registryOf(patchFile: string, defaultId: string, broken: string[] = []): PresetRegistrySlice {
  const doc = yaml.load(readFileSync(join(REPO, patchFile), 'utf8'), { schema: SCHEMA }) as Array<{ insert: PresetRow[] }>
  const presets = doc.flatMap(op => op.insert).filter(row => row.name === '@deepseek-ai/dsh-agent-preset').map(row => row.config)
  const sorted = [...presets].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
  return {
    defaultId,
    list: async () => sorted.map(p => (broken.includes(p.id) ? { id: p.id, broken: 'boom' } : { id: p.id })),
    readDocument: async (id: string) => {
      const preset = presets.find(p => p.id === id)
      if (preset === undefined) throw new Error(`Unknown agent preset: ${id}`)
      return { content: yaml.dump(preset.plugins, { schema: SCHEMA, noRefs: true, lineWidth: -1 }) }
    },
  }
}

describe('the organizing preset is picked by grant (T102)', () => {
  it('web-eval pack: the evaluation mode `eval` (also the pinned default)', async () => {
    expect(await resolveOrganizingPreset(registryOf('profiles/eval/presets/cordis.patch.yml', 'eval'))).toBe('eval')
  })

  it('dsh-presets (3080): `dsh-eval`, although the default is 开发模式', async () => {
    const registry = registryOf('packages/presets/cordis.patch.yml', 'dsh-dev')
    expect(await resolveOrganizingPreset(registry)).toBe('dsh-eval')
    // Neither 开发模式 nor 写作模式 grants it; no 题集整理 preset is left to pick.
    expect(compositionGrantsOrganize((await registry.readDocument!('dsh-dev')).content)).toBe(false)
    expect(compositionGrantsOrganize((await registry.readDocument!('dsh-writing')).content)).toBe(false)
    await expect(registry.readDocument!('dataset-authoring')).rejects.toThrow('Unknown agent preset')
  })

  it('reads the tier, not row presence: a datasets-tool row at another tier does not grant', () => {
    const at = (tools?: string): string => yaml.dump([
      { id: 'persona', name: '@deepseek-ai/dsh-persona' },
      { id: 'datasets-tool', name: '@khorsheed/dsh-datasets/tool', ...(tools === undefined ? {} : { config: { tools } }) },
    ])
    expect(compositionGrantsOrganize(at('organize'))).toBe(true)
    for (const tier of ['authoring', 'all', 'read', 'none', undefined]) expect(compositionGrantsOrganize(at(tier))).toBe(false)
    // Disabled rows grant nothing; grouped rows are found inside their group.
    expect(compositionGrantsOrganize(yaml.dump([
      { id: 'datasets-tool', name: '@khorsheed/dsh-datasets/tool', disabled: true, config: { tools: 'organize' } },
    ]))).toBe(false)
    expect(compositionGrantsOrganize(yaml.dump([
      { id: 'g', name: 'cordis:group', group: true, config: [{ id: 'd', name: '@khorsheed/dsh-datasets/tool', config: { tools: 'organize' } }] },
    ]))).toBe(true)
    expect(compositionGrantsOrganize('{ not: [yaml')).toBe(false)
  })

  it('skips a broken preset and degrades to "" without a registry', async () => {
    expect(await resolveOrganizingPreset(registryOf('packages/presets/cordis.patch.yml', 'dsh-dev', ['dsh-eval']))).toBe('')
    expect(await resolveOrganizingPreset(undefined)).toBe('')
    expect(await resolveOrganizingPreset({ list: async () => { throw new Error('down') }, readDocument: async () => ({ content: '' }) })).toBe('')
  })

  it('the Remote answers a configured id as is, else the pick', async () => {
    const registry = registryOf('packages/presets/cordis.patch.yml', 'dsh-dev')
    const answer = async (preset: string): Promise<unknown> => {
      const ctx = {
        datasets: { organizing: { preset, datasetsHome: '/home/user/.dsh/datasets' } },
        get: vi.fn((name: string) => (name === 'agentPresets' ? registry : undefined)),
      }
      return DatasetsRemoteService.prototype.organizingSetup.call({ ctx, datasets: ctx.datasets } as never)
    }
    expect(await answer('')).toEqual({ preset: 'dsh-eval', datasetsHome: '/home/user/.dsh/datasets' })
    expect(await answer('my-own')).toEqual({ preset: 'my-own', datasetsHome: '/home/user/.dsh/datasets' })
  })
})
