import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import {
  detectConflicts,
  managedSkillFrom,
  parsePresetScopeFrontmatter,
  scanManagedSkills,
  scopedSkillsRoot,
  ScopedSkillDelivery,
  type ScopedDeliveryRegistry,
} from '../src/scoped-delivery.ts'
import type { PresetRosterSlice } from '../src/preset-scope.ts'

/** One managed SKILL.md with an optional preset scope. */
function skillText(name: string, scope?: string, extra = ''): string {
  return [
    '---',
    `name: ${name}`,
    `description: The ${name} skill`,
    ...scope === undefined ? [] : ['metadata:', `  presetScope: ${scope}`],
    ...extra === '' ? [] : [extra],
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n')
}

describe('parsePresetScopeFrontmatter', () => {
  it('reads an inline flow list', () => {
    expect(parsePresetScopeFrontmatter('metadata:\n  presetScope: [dsh-writing, dev]'))
      .toEqual(['dsh-writing', 'dev'])
  })

  it('reads a block list', () => {
    expect(parsePresetScopeFrontmatter('metadata:\n  presetScope:\n    - dsh-writing\n    - dev\n  other: 1'))
      .toEqual(['dsh-writing', 'dev'])
  })

  it('reads a bare scalar and drops surrounding quotes', () => {
    expect(parsePresetScopeFrontmatter("presetScope: 'dsh-writing'")).toEqual(['dsh-writing'])
  })

  it('distinguishes an explicit empty list from an absent key', () => {
    expect(parsePresetScopeFrontmatter('presetScope: []')).toEqual([])
    expect(parsePresetScopeFrontmatter('name: x')).toBeUndefined()
  })

  it('drops ids outside the kebab-case grammar and de-duplicates', () => {
    expect(parsePresetScopeFrontmatter('presetScope: [dsh-writing, ../evil, dsh-writing, DEV]'))
      .toEqual(['dsh-writing'])
  })
})

describe('managedSkillFrom', () => {
  it('parses identity, invocation flags and the preset scope', () => {
    const skill = managedSkillFrom(
      skillText('md-to-wechat', '[dsh-writing]', 'disable-model-invocation: true'),
      '/managed/md-to-wechat',
      '/managed/md-to-wechat/SKILL.md',
    )
    expect(skill).toMatchObject({
      name: 'md-to-wechat',
      description: 'The md-to-wechat skill',
      modelInvocable: false,
      userInvocable: true,
      presetScope: ['dsh-writing'],
      dir: '/managed/md-to-wechat',
      path: '/managed/md-to-wechat/SKILL.md',
    })
  })

  it('honours user-invocable: false and leaves presetScope undefined when absent', () => {
    const skill = managedSkillFrom(skillText('plain', undefined, 'user-invocable: false'), '/m/plain', '/m/plain/SKILL.md')
    expect(skill).toMatchObject({ userInvocable: false, modelInvocable: true })
    expect(skill?.presetScope).toBeUndefined()
  })

  it('rejects a skill without usable identity frontmatter', () => {
    expect(managedSkillFrom('# no frontmatter', '/m/x', '/m/x/SKILL.md')).toBeUndefined()
    expect(managedSkillFrom('---\nname: Not Kebab\n---\n', '/m/x', '/m/x/SKILL.md')).toBeUndefined()
  })
})

describe('default roots and duplicates', () => {
  let home: string
  let agentsHome: string

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'catalog-home-'))
    agentsHome = await mkdtemp(join(tmpdir(), 'catalog-agents-'))
    process.env.DSH_AGENTS_HOME = agentsHome
  })

  afterEach(async () => {
    await rm(join(home, 'skills'), { recursive: true, force: true })
    await rm(join(agentsHome, 'skills'), { recursive: true, force: true })
  })

  it('reports the name a default root already supplies', async () => {
    await mkdir(join(home, 'skills', 'md-to-wechat'), { recursive: true })
    await writeFile(join(home, 'skills', 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat'))
    const managed = [
      managedSkillFrom(skillText('md-to-wechat', '[dsh-writing]'), '/managed/md-to-wechat', '/managed/md-to-wechat/SKILL.md')!,
      managedSkillFrom(skillText('tech-article-polish'), '/managed/tap', '/managed/tap/SKILL.md')!,
    ]
    const conflicts = detectConflicts(managed, home)
    expect([...conflicts.keys()]).toEqual(['md-to-wechat'])
    expect(conflicts.get('md-to-wechat')).toBe(join(home, 'skills'))
  })

  it('also detects an agents-home copy and a flat <name>.md file', async () => {
    await mkdir(join(agentsHome, 'skills'), { recursive: true })
    await writeFile(join(agentsHome, 'skills', 'tech-article-polish.md'), skillText('tech-article-polish'))
    const managed = [
      managedSkillFrom(skillText('tech-article-polish', '[dsh-writing]'), '/managed/tap', '/managed/tap/SKILL.md')!,
    ]
    expect([...detectConflicts(managed, home).keys()]).toEqual(['tech-article-polish'])
  })

  it('scans only usable skill directories', async () => {
    const root = scopedSkillsRoot(home)
    await mkdir(join(root, 'md-to-wechat'), { recursive: true })
    await writeFile(join(root, 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat', '[dsh-writing]'))
    await mkdir(join(root, 'not-a-skill'), { recursive: true })
    await writeFile(join(root, 'not-a-skill', 'README.md'), '# nope')
    const found = await scanManagedSkills(root)
    expect(found.map(skill => skill.name)).toEqual(['md-to-wechat'])
  })
})

describe('ScopedSkillDelivery over a real skill registry', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.()
  })

  /**
   * Boot the real composition: a cordis root, the real skill registry, a
   * structural agent-preset roster stub, and managed skills in a temp home.
   * @param scope - the frontmatter scope of the `md-to-wechat` entry.
   * @param extra - further managed entries to create.
   * @returns the context, standing keys, delivery, and temp home.
   */
  async function boot(scope: string, extra: readonly { name: string; scope?: string }[] = []) {
    const home = await mkdtemp(join(tmpdir(), 'catalog-delivery-'))
    const keys = new Map<string, ScopeKey>([
      ['standard', { agentPreset: 'standard' }],
      ['dsh-writing', { agentPreset: 'dsh-writing' }],
      ['dev', { agentPreset: 'dev' }],
    ])
    const root = scopedSkillsRoot(home)
    await mkdir(join(root, 'md-to-wechat'), { recursive: true })
    await writeFile(join(root, 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat', scope))
    for (const entry of extra) {
      await mkdir(join(root, entry.name), { recursive: true })
      await writeFile(join(root, entry.name, 'SKILL.md'), skillText(entry.name, entry.scope))
    }

    const ctx = new Context()
    const roster: PresetRosterSlice = {
      defaultId: 'standard',
      standingKeyFor: vi.fn(async (id?: string) => keys.get(id ?? 'standard')),
    }
    ctx.provide('agentPresets', roster as never)
    await ctx.plugin(SkillRegistry)

    const delivery = new ScopedSkillDelivery(ctx, {
      dshHome: () => home,
      roster: () => ctx.get('agentPresets') as PresetRosterSlice,
      registry: () => ctx.get('skills') as unknown as ScopedDeliveryRegistry,
      log: () => {},
    })
    cleanups.push(async () => {
      await delivery.dispose()
      await rm(home, { recursive: true, force: true })
    })
    await delivery.start()
    return { ctx, keys, delivery, home }
  }

  const namesIn = async (ctx: Context, key: ScopeKey | undefined) =>
    (await ctx.skills.snapshot(key === undefined ? {} : { scope: key })).skills.map(skill => skill.name)

  it('delivers into the named preset layer only', async () => {
    const { ctx, keys, delivery } = await boot('[dsh-writing]')
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('standard'))).not.toContain('md-to-wechat')
    // A read with no scope sees the global layer alone.
    expect(await namesIn(ctx, undefined)).not.toContain('md-to-wechat')
    expect(delivery.status().presets.map(row => row.presetId)).toEqual(['dsh-writing'])
  })

  it('serves each preset exactly its own assignment', async () => {
    const { ctx, keys } = await boot('[dev]', [{ name: 'tech-article-polish', scope: '[dsh-writing]' }])
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('tech-article-polish')
    expect(await namesIn(ctx, keys.get('dsh-writing'))).not.toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('dev'))).toContain('md-to-wechat')
  })

  it('leaves an unscoped skill global (no delivery at all)', async () => {
    const { ctx, delivery } = await boot('')
    expect((await ctx.skills.snapshot({})).skills).toEqual([])
    expect(delivery.status().enabled).toBe(false)
    expect(delivery.status().skills[0]).toMatchObject({ name: 'md-to-wechat', delivered: false, presets: [] })
  })

  it('refuses delivery for a name a default root already supplies', async () => {
    const { ctx, keys, delivery, home } = await boot('[dsh-writing]')
    await mkdir(join(home, 'skills', 'md-to-wechat'), { recursive: true })
    await writeFile(join(home, 'skills', 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat'))
    await delivery.reconcile()
    expect(await namesIn(ctx, keys.get('dsh-writing'))).not.toContain('md-to-wechat')
    const row = delivery.status().skills.find(skill => skill.name === 'md-to-wechat')
    expect(row?.conflict).toBe(join(home, 'skills', 'md-to-wechat'))
  })

  it('loads the body through the provider with the directory as its resource base', async () => {
    const { ctx, keys } = await boot('[dsh-writing]')
    const definition = await ctx.skills.get('md-to-wechat', { scope: keys.get('dsh-writing') })
    expect(definition?.content).toContain('# md-to-wechat')
    expect(definition?.resourceBase).toEqual({ kind: 'directory', path: dirname(definition?.path ?? '') })
  })

  it('withdraws a registration when the policy stops naming the preset', async () => {
    const { ctx, keys, delivery, home } = await boot('[dsh-writing]')
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
    await writeFile(join(scopedSkillsRoot(home), 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat'))
    await delivery.reconcile()
    expect(await namesIn(ctx, keys.get('dsh-writing'))).not.toContain('md-to-wechat')
    expect(delivery.status().presets).toEqual([])
  })

  it('drops every registration on dispose', async () => {
    const { ctx, keys, delivery } = await boot('[dsh-writing]')
    await delivery.dispose()
    expect(await namesIn(ctx, keys.get('dsh-writing'))).not.toContain('md-to-wechat')
  })

  it('degrades without a roster rather than failing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-noroster-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const delivery = new ScopedSkillDelivery(ctx, {
      dshHome: () => home,
      roster: () => undefined,
      registry: () => ctx.get('skills') as unknown as ScopedDeliveryRegistry,
      log: () => {},
    })
    cleanups.push(async () => {
      await delivery.dispose()
      await rm(home, { recursive: true, force: true })
    })
    await delivery.start()
    expect(delivery.status().enabled).toBe(false)
    expect(delivery.status().reason).toContain('roster')
  })
})
