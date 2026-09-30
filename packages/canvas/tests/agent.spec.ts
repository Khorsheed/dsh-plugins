/**
 * The `./agent` composition entry: registers the two canvas tools and their
 * pointer guidance section into the MOUNTING SCOPE (profile root or a
 * preset's agent-plane) when the core service is present, and degrades to a
 * no-op registration when it is not. Also pins the split: the root apply
 * (`src/index.ts`) registers NEITHER the tools NOR the section anymore.
 */
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply as agentApply } from '../src/agent.ts'
import { apply as rootApply } from '../src/index.ts'
import type { CanvasBoardService } from '../src/store.ts'

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

/** A recording prompt-sections surface (only `section` is used). */
function fakePromptSections() {
  const sections: Array<{ name: string; order: number; text: string }> = []
  return {
    sections,
    section: (entry: { name: string; order: number; text: string }) => {
      sections.push(entry)
      return () => undefined
    },
  }
}

/** A bare context with the two registries mountable; `get` answers the map. */
function bench(options: { withBoard?: boolean } = {}) {
  const tools = fakeToolsRegistry()
  const prompts = fakePromptSections()
  const ctx = new Context()
  const board = options.withBoard === false ? undefined : ({} as CanvasBoardService)
  const gets = new Map<string, unknown>(options.withBoard === false ? [] : [['canvasBoard', board]])
  const originalGet = ctx.get.bind(ctx)
  ctx.get = ((key: string) => gets.has(key) ? gets.get(key) : originalGet(key)) as Context['get']
  return { ctx, tools, prompts, board }
}

describe('the ./agent composition entry', () => {
  it('registers the canvas tools (origin-tagged) and the pointer guidance into the mounting scope', async () => {
    const { ctx, tools, prompts } = bench()
    agentApply(ctx)
    ctx.provide('tools', tools)
    ctx.provide('systemPrompt', prompts)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(tools.registered.map(def => def.name)).toEqual([
      'canvas_read_board', 'canvas_propose_card', 'canvas_comment', 'canvas_read_type', 'canvas_propose_type',
      'canvas_read_manuscript', 'canvas_write_manuscript',
    ])
    for (const def of tools.registered) {
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-canvas',
      })
    }
    expect(prompts.sections).toHaveLength(1)
    const section = prompts.sections[0]!
    expect(section.name).toBe('canvas:tools')
    expect(section.order).toBe(151)
    // One pointer sentence only: the per-tool rules live in the tool
    // descriptions, so the section names no tool and repeats no mechanics.
    expect(section.text).toContain('canvas_*')
    expect(section.text).not.toContain('canvas_propose_card')
    expect(section.text).not.toContain('baseVersion')
    expect(section.text).not.toContain('\n')
  })

  it('registers nothing (and warns) when canvasBoard is absent — degrade, never explode', () => {
    const { ctx, tools, prompts } = bench({ withBoard: false })
    const warn = vi.fn()
    ;(ctx as { logger: { warn: typeof warn } }).logger = { ...ctx.logger, warn }
    agentApply(ctx)
    expect(tools.registered).toEqual([])
    expect(prompts.sections).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('the root apply after the split', () => {
  it('registers NEITHER the tools NOR the guidance section at the profile root', () => {
    const ctx = new Context()
    // A minimal fs so the service cores construct.
    ctx.provide('fs', { sandboxMode: undefined } as never)
    const injected: string[] = []
    const originalInject = ctx.inject.bind(ctx)
    ;(ctx as { inject: typeof ctx.inject }).inject = ((keys: readonly string[], cb: (ctx: Context) => void) => {
      injected.push(...keys)
      return originalInject(keys, cb)
    }) as typeof ctx.inject
    rootApply(ctx)
    expect(ctx.get('canvasStore')).toBeDefined()
    expect(ctx.get('canvasBoard')).toBeDefined()
    expect(injected).not.toContain('tools')
    expect(injected).not.toContain('systemPrompt')
  })
})
