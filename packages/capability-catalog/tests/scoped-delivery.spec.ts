import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import {
  candidateFor,
  definitionFor,
  detectConflicts,
  managedSkillFrom,
  scanManagedSkills,
  scopedSkillsRoot,
  ScopedSkillDelivery,
  type ScopedDeliveryRegistry,
} from '../src/scoped-delivery.ts'
import type { PresetRosterSlice } from '../src/preset-scope.ts'
import { loadSkillDetail } from '../src/skills.ts'

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

  it('preserves the frontmatter metadata block through parsing and the delivery projection', () => {
    const skill = managedSkillFrom(
      skillText('md-to-wechat', '[dsh-writing]', '  credentials:\n    - key: WEREAD_API_KEY\n      label: WeRead API key'),
      '/managed/md-to-wechat',
      '/managed/md-to-wechat/SKILL.md',
    )!
    // The block survives verbatim, with the normalized scope overlaid on serve.
    expect(skill.metadata).toEqual({
      presetScope: ['dsh-writing'],
      credentials: [{ key: 'WEREAD_API_KEY', label: 'WeRead API key' }],
    })
    expect(candidateFor(skill).metadata).toEqual({
      presetScope: ['dsh-writing'],
      credentials: [{ key: 'WEREAD_API_KEY', label: 'WeRead API key' }],
    })
  })

  it('still delivers when the metadata block is malformed, minus the metadata', () => {
    const skill = managedSkillFrom(
      skillText('md-to-wechat', undefined, 'metadata:\n  credentials: [unclosed'),
      '/managed/md-to-wechat',
      '/managed/md-to-wechat/SKILL.md',
    )
    expect(skill?.name).toBe('md-to-wechat')
    expect(skill?.metadata).toBeUndefined()
  })

  it('accepts the host parser\'s boolean variants for the invocation flags', () => {
    // skill-filesystem's frontmatterBoolean takes 1/0, yes/no, on/off beside
    // true/false (the catalog used to read only true/false).
    for (const truthy of ['1', 'yes', 'on']) {
      const skill = managedSkillFrom(skillText('flag-off', undefined, `disable-model-invocation: ${truthy}`), '/m/flag-off', '/m/flag-off/SKILL.md')
      expect(skill?.modelInvocable, `disable-model-invocation: ${truthy}`).toBe(false)
    }
    for (const falsy of ['0', 'no', 'off']) {
      const skill = managedSkillFrom(skillText('flag-off', undefined, `user-invocable: ${falsy}`), '/m/flag-off', '/m/flag-off/SKILL.md')
      expect(skill?.userInvocable, `user-invocable: ${falsy}`).toBe(false)
    }
  })

  it('reads presetScope only at the top level or under metadata, not nested elsewhere', () => {
    // The any-indent scan used to count a presetScope nested under an unrelated
    // key; real YAML scoping sees only the two meaningful positions.
    const skill = managedSkillFrom(
      skillText('nested-scope', undefined, 'other:\n  presetScope: [dsh-writing]'),
      '/m/nested-scope',
      '/m/nested-scope/SKILL.md',
    )
    expect(skill?.presetScope).toBeUndefined()
  })

  it('reads a top-level scalar even when a nested same-named key appears first', () => {
    // The line-based scalar scan matched in TEXT order, so an indented
    // `name:` under metadata shadowed the real one.
    const skill = managedSkillFrom(
      '---\nmetadata:\n  name: shadow\nname: real-name\ndescription: d\n---\n\n# real\n',
      '/m/real-name',
      '/m/real-name/SKILL.md',
    )
    expect(skill?.name).toBe('real-name')
  })

  it('reads a folded multi-line description as its folded text', () => {
    const skill = managedSkillFrom(
      '---\nname: folded\ndescription: >\n  A longer description\n  over two lines.\n---\n\n# folded\n',
      '/m/folded',
      '/m/folded/SKILL.md',
    )
    // A folded scalar keeps its trailing newline.
    expect(skill?.description).toBe('A longer description over two lines.\n')
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
   * @param rosterFor - roster override (e.g. the rc.1 leased face); the default
   *   stub is the 0.1.5 lease-free `standingKeyFor` face.
   * @returns the context, standing keys, delivery, and temp home.
   */
  async function boot(scope: string, extra: readonly { name: string; scope?: string }[] = [], rosterFor?: (keys: Map<string, ScopeKey>) => PresetRosterSlice) {
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
    const roster: PresetRosterSlice = rosterFor?.(keys) ?? {
      defaultId: 'standard',
      standingKeyFor: vi.fn(async (id?: string) => keys.get(id ?? 'standard')),
    }
    ctx.provide('agentPresets', roster as never)
    const toolsRegister = vi.fn()
    ctx.provide('tools', { register: toolsRegister } as never)
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
    return { ctx, keys, delivery, home, toolsRegister }
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

  it('delivers an unscoped managed skill to every preset and the global layer', async () => {
    const { ctx, keys, delivery } = await boot('')
    expect(await namesIn(ctx, undefined)).toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('standard'))).toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
    expect(delivery.status().enabled).toBe(true)
    expect(delivery.status().skills[0]).toMatchObject({ name: 'md-to-wechat', delivered: true, presets: [] })
  })

  it('withdraws the global delivery once a scope is declared', async () => {
    const { ctx, keys, delivery, home } = await boot('')
    expect(await namesIn(ctx, undefined)).toContain('md-to-wechat')
    await writeFile(join(scopedSkillsRoot(home), 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat', '[dsh-writing]'))
    await delivery.reconcile()
    expect(await namesIn(ctx, undefined)).not.toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('standard'))).not.toContain('md-to-wechat')
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

  it('moves a registration when the policy names a different preset', async () => {
    const { ctx, keys, delivery, home } = await boot('[dsh-writing]')
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
    await writeFile(join(scopedSkillsRoot(home), 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat', '[dev]'))
    await delivery.reconcile()
    expect(await namesIn(ctx, keys.get('dsh-writing'))).not.toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('dev'))).toContain('md-to-wechat')
    expect(delivery.status().presets.map(row => row.presetId)).toEqual(['dev'])
  })

  it('drops every registration on dispose', async () => {
    const { ctx, keys, delivery } = await boot('[dsh-writing]')
    await delivery.dispose()
    expect(await namesIn(ctx, keys.get('dsh-writing'))).not.toContain('md-to-wechat')
  })

  it('carries enough of each managed row for the management grid', async () => {
    const { delivery } = await boot('[dsh-writing]')
    expect(delivery.status().skills[0]).toMatchObject({
      name: 'md-to-wechat',
      description: 'The md-to-wechat skill',
      modelInvocable: true,
      userInvocable: true,
      presets: ['dsh-writing'],
      delivered: true,
    })
    expect(delivery.status().skills[0]?.path.endsWith('md-to-wechat/SKILL.md')).toBe(true)
  })

  it('loads a scoped-away managed skill through the scope-limited detail read fallback', async () => {
    const { ctx, keys } = await boot('[dsh-writing]')
    const managed = managedSkillFrom(
      skillText('md-to-wechat', '[dsh-writing]'),
      '/managed/md-to-wechat',
      '/managed/md-to-wechat/SKILL.md',
    )!
    // The default preset's scope does not carry this skill at all.
    const { registry } = { registry: ctx.get('skills') as unknown as Parameters<typeof loadSkillDetail>[1] }
    expect(await registry.get('md-to-wechat', { scope: keys.get('standard') })).toBeUndefined()
    const detail = await loadSkillDetail(
      ctx, registry, 'md-to-wechat', undefined, keys.get('standard'), definitionFor(managed),
    )
    expect(detail?.content).toContain('# md-to-wechat')
    expect(detail?.provider).toBe('capability-catalog')
  })

  it('keeps a metadata-declared credential out of the read-only env refs', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.provide('credentials', {
      describe: async () => ({ configured: true }),
      set: async () => {},
    } as never)
    ctx.skills.register({
      name: 'weread-skills',
      description: 'WeRead helper',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user-dsh',
      resourceBase: { kind: 'opaque' },
      metadata: { credentials: [{ key: 'WEREAD_API_KEY', label: 'WeRead API key' }] },
      content: 'Send Authorization: Bearer $WEREAD_API_KEY. $DSH_HOME holds the instance home.',
    })
    const { registry } = { registry: ctx.get('skills') as unknown as Parameters<typeof loadSkillDetail>[1] }
    const detail = await loadSkillDetail(ctx, registry, 'weread-skills', undefined)
    expect(detail?.credentials).toEqual([{ key: 'WEREAD_API_KEY', label: 'WeRead API key', configured: true }])
    // The declared key renders in the credential form alone; the undeclared body
    // ref stays a read-only runtime reference.
    expect(detail?.environmentRefs).toEqual(['DSH_HOME'])
  })

  it('carries a managed skill\'s declared credentials through the detail read fallback', async () => {
    const { ctx, keys } = await boot('[dsh-writing]')
    ctx.provide('credentials', {
      describe: async () => ({ configured: true }),
      set: async () => {},
    } as never)
    const managed = managedSkillFrom(
      skillText('md-to-wechat', '[dsh-writing]', '  credentials:\n    - key: WEREAD_API_KEY'),
      '/managed/md-to-wechat',
      '/managed/md-to-wechat/SKILL.md',
    )!
    const { registry } = { registry: ctx.get('skills') as unknown as Parameters<typeof loadSkillDetail>[1] }
    // The default preset's scope does not carry this skill; the managed fallback answers.
    const detail = await loadSkillDetail(
      ctx, registry, 'md-to-wechat', undefined, keys.get('standard'), definitionFor(managed),
    )
    expect(detail?.credentials).toEqual([{ key: 'WEREAD_API_KEY', configured: true }])
  })

  it('registers a read-only bundle-file reader into the preset layer and serves delivered skills only', async () => {
    const { delivery, home, toolsRegister } = await boot('[dsh-writing]')
    const root = scopedSkillsRoot(home)
    await writeFile(join(root, 'md-to-wechat', 'notes.md'), '# notes doc\n')
    await delivery.reconcile()
    const reader = toolsRegister.mock.calls
      .map(call => call[0])
      .find((def: { name?: string }) => def?.name === 'read_skill_file') as
      { execute: (args: { name: string; path?: string }) => Promise<string> } | undefined
    expect(reader).toBeDefined()
    const list = await reader!.execute({ name: 'md-to-wechat' })
    expect(list).toContain('SKILL.md')
    expect(list).toContain('notes.md')
    expect(await reader!.execute({ name: 'md-to-wechat', path: 'notes.md' })).toBe('# notes doc\n')
    expect(await reader!.execute({ name: 'md-to-wechat', path: '../escape.md' })).toContain('refused')
    // A skill not delivered to this preset — and a name nobody manages — read as refused.
    expect(await reader!.execute({ name: 'tech-article-polish' })).toContain('not delivered')
    expect(await reader!.execute({ name: 'ghost' })).toContain('not delivered')
  })

  it('refuses a bundle symlink that escapes the skill directory', async () => {
    const { delivery, home, toolsRegister } = await boot('[dsh-writing]')
    const root = scopedSkillsRoot(home)
    // Outside the bundle but inside the temp home: a symlink to it must not resolve.
    await writeFile(join(home, 'outside-secret.txt'), 'top secret')
    await symlink(join(home, 'outside-secret.txt'), join(root, 'md-to-wechat', 'leak.md'))
    await delivery.reconcile()
    const reader = toolsRegister.mock.calls
      .map(call => call[0])
      .find((def: { name?: string }) => def?.name === 'read_skill_file') as
      { execute: (args: { name: string; path?: string }) => Promise<string> } | undefined
    expect(await reader!.execute({ name: 'md-to-wechat', path: 'leak.md' })).toContain('no such bundle file')
  })

  it('delivers without the tools service, dropping only the reader', async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-notools-'))
    const root = scopedSkillsRoot(home)
    await mkdir(join(root, 'md-to-wechat'), { recursive: true })
    await writeFile(join(root, 'md-to-wechat', 'SKILL.md'), skillText('md-to-wechat', '[dsh-writing]'))
    const keys = new Map<string, ScopeKey>([['dsh-writing', { agentPreset: 'dsh-writing' }]])
    const ctx = new Context()
    ctx.provide('agentPresets', {
      defaultId: 'dsh-writing',
      standingKeyFor: async (id?: string) => keys.get(id ?? 'dsh-writing'),
    } as never)
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
    expect(delivery.status().enabled).toBe(true)
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
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

  it('delivers through the rc.1 leased roster face, releasing the lease after the key read', async () => {
    const release = vi.fn(async () => {})
    const { ctx, keys, delivery } = await boot('[dsh-writing]', [], (standing) => ({
      defaultId: 'standard',
      acquireScope: vi.fn(async (id?: string) => ({
        key: standing.get(id ?? 'standard'),
        [Symbol.asyncDispose]: release,
      })),
    }))
    expect(await namesIn(ctx, keys.get('dsh-writing'))).toContain('md-to-wechat')
    expect(await namesIn(ctx, keys.get('standard'))).not.toContain('md-to-wechat')
    expect(delivery.status().presets.map(row => row.presetId)).toEqual(['dsh-writing'])
    // One named preset resolved once; its lease released exactly once.
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('records an rc.1 broken preset as a preset error, not a delivery failure', async () => {
    const { delivery } = await boot('[dsh-writing]', [], () => ({
      defaultId: 'standard',
      acquireScope: async (): Promise<unknown> => {
        throw new Error('agent-preset/invalid: row "canvas-agent" is waiting for service canvasBoard')
      },
    }))
    expect(delivery.status().enabled).toBe(false)
    const row = delivery.status().presets.find(preset => preset.presetId === 'dsh-writing')
    expect(row?.error).toContain('agent-preset/invalid')
  })

  it('serializes concurrent reconciles: at most one in flight, at most one queued rerun', async () => {
    // A roster whose key reads block until the test releases them, so a
    // reconcile pass can be held open while more triggers arrive.
    let gateOpen = true
    const waiters: Array<() => void> = []
    let running = 0
    let maxRunning = 0
    let reads = 0
    const { delivery } = await boot('[dsh-writing]', [], (keys) => ({
      defaultId: 'standard',
      standingKeyFor: async (id?: string) => {
        reads += 1
        running += 1
        maxRunning = Math.max(maxRunning, running)
        try {
          if (!gateOpen) await new Promise<void>(resolve => waiters.push(resolve))
        } finally {
          running -= 1
        }
        return keys.get(id ?? 'standard')
      },
    }))
    // start()'s own reconcile ran with the gate open; only the gated passes count.
    reads = 0
    maxRunning = 0
    gateOpen = false
    const first = delivery.reconcile()
    const second = delivery.reconcile()
    const third = delivery.reconcile()
    // Wait until the first pass is blocked mid-read; the other two calls must
    // coalesce into ONE queued rerun rather than start passes of their own.
    const deadline = Date.now() + 2000
    while (reads < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    expect(reads).toBe(1)
    expect(maxRunning).toBe(1)
    gateOpen = true
    for (const release of waiters.splice(0)) release()
    await Promise.all([first, second, third])
    // Three triggers, two passes: the in-flight one and the single queued rerun.
    expect(reads).toBe(2)
    expect(maxRunning).toBe(1)
  })
})
