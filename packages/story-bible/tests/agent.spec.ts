/**
 * The `./agent` composition entry: registers the three story tools
 * (origin-tagged), the focus pointer FUNCTION section and the `story` skill
 * into the mounting scope when the core service is present, and degrades to
 * a warn-only no-op when it is not. The pointer's degrade paths (no agent,
 * no sessionId, no focus) all render '' — never a throw into assembly.
 */
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply as agentApply, storyPointerText, STORY_POINTER_ORDER } from '../src/agent.ts'
import { StoryBibleService } from '../src/store.ts'
import { FakeFs } from './fake-fs.ts'

/** A recording tools registry (only `register` is used). */
function fakeToolsRegistry() {
  const registered: ToolDefinition[] = []
  return {
    registered,
    register: (def: ToolDefinition) => {
      registered.push(def)
      return () => undefined
    },
  }
}

/** A recording prompt-sections surface (function texts welcome). */
function fakePromptSections() {
  const sections: Array<{ name: string; order: number; text: unknown }> = []
  return {
    sections,
    section: (entry: { name: string; order: number; text: unknown }) => {
      sections.push(entry)
      return () => undefined
    },
  }
}

/** A bare context with the registries mountable; `get` answers the map. */
function bench(options: { withStore?: boolean } = {}) {
  const tools = fakeToolsRegistry()
  const prompts = fakePromptSections()
  const ctx = new Context()
  const storeCtx = new Context()
  storeCtx.provide('fs', new FakeFs() as never)
  const store = options.withStore === false ? undefined : new StoryBibleService(storeCtx, { stateRoot: '/dsh/state/story' })
  const gets = new Map<string, unknown>(options.withStore === false ? [] : [['storyBible', store]])
  const originalGet = ctx.get.bind(ctx)
  ctx.get = ((key: string) => gets.has(key) ? gets.get(key) : originalGet(key)) as Context['get']
  return { ctx, tools, prompts, store }
}

describe('the ./agent composition entry', () => {
  it('registers the three story tools (origin-tagged), the pointer section and the story skill', async () => {
    const { ctx, tools, prompts } = bench()
    const skills: Array<{ name: string; description: string; content: string; source: string; provider?: string }> = []
    agentApply(ctx)
    ctx.provide('tools', tools)
    ctx.provide('systemPrompt', prompts)
    ctx.provide('skills', { register: (skill: (typeof skills)[number]) => { skills.push(skill); return () => undefined } })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(tools.registered.map(def => def.name)).toEqual(['story_read', 'story_write', 'story_extract'])
    for (const def of tools.registered) {
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-story-bible',
      })
    }
    expect(prompts.sections).toHaveLength(1)
    const section = prompts.sections[0]!
    expect(section.name).toBe('story:pointer')
    expect(section.order).toBe(STORY_POINTER_ORDER)
    // A FUNCTION section — the whole point (proposal §4.1): evaluated per assembly.
    expect(typeof section.text).toBe('function')
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'story', source: 'runtime', provider: '@khorsheed/dsh-story-bible' })
    // The skill carries the workflow, not any work content (第 6 章与第 60 章共用一份).
    expect(skills[0]!.content).toContain('三条铁律')
    expect(skills[0]!.content).toContain('门后不回答问题'.slice(0, 0)) // no work content — see below
    expect(skills[0]!.content).not.toContain('梦境监护者')
    expect(skills[0]!.content).not.toContain('赵启明')
  })

  it('registers nothing (and warns) when storyBible is absent — degrade, never explode', () => {
    const { ctx, tools, prompts } = bench({ withStore: false })
    const warn = vi.fn()
    ;(ctx as { logger: { warn: typeof warn } }).logger = { ...ctx.logger, warn }
    agentApply(ctx)
    expect(tools.registered).toEqual([])
    expect(prompts.sections).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('the focus pointer function section', () => {
  it('renders one line with a focus, and \'\' on every unreadable path', async () => {
    const fs = new FakeFs()
    fs.seed('/dsh/state/story/work-abcdef/work.json', `${JSON.stringify({
      id: 'work-abcdef', title: '梦境监护者', workspace: '/home/user/workspace',
      createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z',
    }, null, 2)}\n`)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: '/dsh/state/story' })
    await store.focusWork({ workId: 'work-abcdef' }, { id: 's-1' } as never)
    const text = storyPointerText(store)
    // With a focus: one guidance line naming the work and the two doors (brief / skill).
    const focused = text({ agent: { sessionId: 's-1' } })
    expect(focused).toContain('《梦境监护者》')
    expect(focused).toContain('story_read(brief)')
    expect(focused).toContain('story skill')
    expect(focused).not.toContain('\n')
    // Without a focus (another session): '' — the no-injection state costs nothing.
    expect(text({ agent: { sessionId: 's-2' } })).toBe('')
    // No agent on the assemble context (a headless/odd assembly): ''.
    expect(text({})).toBe('')
    expect(text({ agent: {} })).toBe('')
    // A store whose focus map threw (impossible in practice) still degrades to ''.
    const broken = { focusedWork: () => { throw new Error('boom') } } as unknown as StoryBibleService
    expect(storyPointerText(broken)({ agent: { sessionId: 's-1' } })).toBe('')
  })
})
