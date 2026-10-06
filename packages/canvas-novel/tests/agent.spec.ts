/**
 * The `./agent` composition entry: the novel tools are granted per session —
 * registered on an agent's own scope only while its session is bound to a
 * 长篇小说 canvas, absent everywhere else — while the pointer FUNCTION
 * section and the `novel` skill register once. Without the core service the
 * entry degrades to a warn-only no-op. The pointer's degrade paths (no
 * agent, no sessionId, no binding) all render '' — never a throw into
 * assembly.
 */
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply as agentApply, NovelToolGrant, novelPointerText, NOVEL_POINTER_ORDER, type NovelAgent } from '../src/agent.ts'
import { NovelService } from '../src/store.ts'
import { novelToolDefinitions } from '../src/tools.ts'
import { FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM } from './seed-dream.ts'

/** An agent whose own scope records the tools registered on it. */
function fakeAgent(sessionId: string): NovelAgent & { live: () => string[] } {
  const live = new Set<ToolDefinition>()
  return {
    session: { id: sessionId },
    ctx: {
      get: (name: string) => name !== 'tools' ? undefined : {
        register: (def: ToolDefinition) => {
          live.add(def)
          return () => { live.delete(def) }
        },
      },
    } as unknown as NovelAgent['ctx'],
    live: () => [...live].map(def => def.name),
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

/** A store over the《梦境监护者》canvas (unbound until a test binds it). */
function storeOver(canvas: FakeCanvas = new FakeCanvas().addBoard({ id: DREAM.workId, title: DREAM.title, workspace: DREAM.workspace })) {
  const ctx = new Context()
  ctx.provide('fs', new FakeFs() as never)
  provideCanvas(ctx, canvas)
  return { store: new NovelService(ctx, { stateRoot: DREAM.stateRoot }), canvas }
}

const tick = () => new Promise(resolve => { setTimeout(resolve, 0) })

describe('the ./agent composition entry', () => {
  it('grants the tools to bound agents only, and follows binding and genre events', async () => {
    const { store, canvas } = storeOver()
    const ctx = new Context()
    const gets = new Map<string, unknown>([['canvasNovel', store]])
    const originalGet = ctx.get.bind(ctx)
    ctx.get = ((key: string) => gets.has(key) ? gets.get(key) : originalGet(key)) as Context['get']
    const prompts = fakePromptSections()
    const skills: Array<{ name: string; content: string; source: string; provider?: string }> = []
    // One agent already lives (and is bound) when the entry mounts: the seed path.
    const early = fakeAgent('s-early')
    canvas.bind('s-early', DREAM.workId)
    ctx.provide('agents' as never, { list: () => [early] } as never)
    agentApply(ctx)
    ctx.provide('systemPrompt', prompts)
    ctx.provide('skills', { register: (skill: (typeof skills)[number]) => { skills.push(skill); return () => undefined } })
    const scopeTools: string[] = []
    ctx.provide('tools', { register: (def: ToolDefinition) => { scopeTools.push(def.name); return () => undefined } })
    await tick()
    // novel_bind sits on the mounting scope (every session of it), never per session.
    expect(scopeTools).toEqual(['novel_bind'])
    expect(early.live()).toEqual(['novel_read', 'novel_write', 'novel_extract'])

    // A new, unbound agent gets nothing — absent, not denied.
    const later = fakeAgent('s-later')
    await ctx.serial('agent/created' as never, { agent: later } as never)
    expect(later.live()).toEqual([])
    // Bind it: the tools appear.
    canvas.bind('s-later', DREAM.workId)
    ctx.emit('canvas/binding-changed' as never, 's-later' as never, DREAM.workId as never)
    await tick()
    expect(later.live()).toHaveLength(3)
    // The canvas's genre cleared: the re-check revokes every session on it.
    canvas.addBoard({ id: DREAM.workId, title: DREAM.title, workspace: DREAM.workspace, genre: null })
    ctx.emit('canvas/genre-changed' as never, DREAM.workId as never, null as never)
    await tick()
    expect(later.live()).toEqual([])
    expect(early.live()).toEqual([])
    // A disposed agent is forgotten: later events never touch it.
    canvas.addBoard({ id: DREAM.workId, title: DREAM.title, workspace: DREAM.workspace })
    ctx.emit('agent/disposed' as never, { agent: later } as never)
    ctx.emit('canvas/genre-changed' as never, DREAM.workId as never, 'novel' as never)
    await tick()
    expect(later.live()).toEqual([])
    expect(early.live()).toHaveLength(3)
    for (const def of novelToolDefinitions(store)) {
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-canvas-novel',
      })
    }

    expect(prompts.sections).toHaveLength(1)
    const section = prompts.sections[0]!
    expect(section.name).toBe('novel:pointer')
    expect(section.order).toBe(NOVEL_POINTER_ORDER)
    // A FUNCTION section: evaluated per assembly.
    expect(typeof section.text).toBe('function')
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'novel', source: 'runtime', provider: '@khorsheed/dsh-canvas-novel' })
    // The skill carries the workflow, not any work content.
    expect(skills[0]!.content).toContain('三条铁律')
    // …and the stage-and-role model (editor at ideation, partner while drafting).
    expect(skills[0]!.content).toContain('阶段与角色')
    // Unbound sessions are steered to the binding chip, not to an improvised fallback.
    expect(skills[0]!.content).toContain('绑定作品')
    expect(skills[0]!.content).not.toContain('梦境监护者')
    expect(skills[0]!.content).not.toContain('赵启明')
  })

  it('registers nothing (and warns) when canvasNovel is absent — degrade, never explode', () => {
    const ctx = new Context()
    const prompts = fakePromptSections()
    const warn = vi.fn()
    ;(ctx as { logger: { warn: typeof warn } }).logger = { ...ctx.logger, warn }
    agentApply(ctx)
    ctx.provide('systemPrompt', prompts)
    expect(prompts.sections).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('the pointer function section', () => {
  it('renders one line in a bound session, and \'\' on every unreadable path', async () => {
    const { store, canvas } = storeOver()
    const grant = new NovelToolGrant(store, novelToolDefinitions(store))
    canvas.bind('s-1', DREAM.workId)
    await grant.track(fakeAgent('s-1'))
    await grant.track(fakeAgent('s-2'))
    const text = novelPointerText(grant)
    const bound = text({ agent: { sessionId: 's-1' } })
    expect(bound).toContain('《梦境监护者》')
    expect(bound).toContain('novel_read(brief)')
    expect(bound).toContain('novel skill')
    expect(bound).toContain('卡片用 canvas_write 落')
    expect(bound).not.toContain('\n')
    // Unbound, but this scope's session: one line pointing at novel_bind.
    expect(text({ agent: { sessionId: 's-2' } })).toContain('novel_bind')
    // A session this scope never composed: '' — costs nothing.
    expect(text({ agent: { sessionId: 's-other' } })).toBe('')
    // No agent on the assemble context (a headless/odd assembly): ''.
    expect(text({})).toBe('')
    expect(text({ agent: {} })).toBe('')
    // A grant whose lookup threw (impossible in practice) still degrades to ''.
    const broken = { titleOf: () => { throw new Error('boom') }, tracks: () => true }
    expect(novelPointerText(broken)({ agent: { sessionId: 's-1' } })).toBe('')
  })

  it('a superseded evaluation never lands (the newest binding wins)', async () => {
    const { store, canvas } = storeOver()
    const grant = new NovelToolGrant(store, novelToolDefinitions(store))
    const agent = fakeAgent('s-1')
    canvas.bind('s-1', DREAM.workId)
    const first = grant.track(agent)
    canvas.bind('s-1', null)
    const second = grant.evaluate('s-1')
    await Promise.all([first, second])
    expect(agent.live()).toEqual([])
    expect(grant.titleOf('s-1')).toBeUndefined()
  })
})
