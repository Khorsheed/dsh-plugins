/** The companion row: the six tools (four reads plus the two writes), the
 * origin tag (this package, not the core), the `tool:eval` guidance section,
 * the `none` grant, the `/eval` slash registration (preset-visibility
 * rollout A3 — registered at every tier, delegated to the core's handler),
 * and the silent degrade when the core service is absent. */
import { describe, expect, it } from 'vitest'
import { apply, type EvalToolConfig } from '../src/index.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')
const EVAL_TOOLS = [
  'eval_conditions', 'eval_plan_validate', 'eval_plan_draft', 'eval_repo_write', 'eval_run_status', 'eval_cells',
]

interface RegisteredTool {
  name: string
  [ORIGIN]?: { channel: string; owner: string }
}

interface Section {
  name: string
  order: number
  text: string
}

interface RegisteredCommand {
  name: string
  description: string
  input?: { hint: string }
  handler: (invocation: unknown) => Promise<{ kind: string; text: string }>
}

/** The narrowest ctx the row needs: a probe target, a logger, and `inject`. */
function mount(service: unknown, config?: EvalToolConfig): {
  tools: RegisteredTool[]
  sections: Section[]
  commands: RegisteredCommand[]
  infos: string[]
} {
  const tools: RegisteredTool[] = []
  const sections: Section[] = []
  const commands: RegisteredCommand[] = []
  const infos: string[] = []
  const child = (): Record<string, unknown> => ({
    tools: { register: (definition: RegisteredTool) => { tools.push(definition); return () => {} } },
    commands: { register: (definition: RegisteredCommand) => { commands.push(definition); return () => {} } },
    effect: (fn: () => unknown) => { fn(); return () => {} },
    get: (name: string) => (name === 'systemPrompt'
      ? { section: (section: Section) => { sections.push(section); return () => {} } }
      : undefined),
    inject: (names: readonly string[], cb: (ctx: never) => void) => {
      if (names.includes('systemPrompt')) cb(child() as never)
    },
  })
  const ctx = {
    // The service is `dshEval` — never `eval` (the loader's `with (ctx)` hazard).
    get: (name: string) => (name === 'dshEval' ? service : undefined),
    logger: { info: (message: string) => { infos.push(message) } },
    inject: (_names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  }
  if (config === undefined) apply(ctx as never)
  else apply(ctx as never, config)
  return { tools, sections, commands, infos }
}

describe('eval-tool companion row', () => {
  it('grants the six tools, tags them by this package, and adds the guidance section', () => {
    const { tools, sections } = mount({})
    expect(tools.map(tool => tool.name).sort()).toEqual([...EVAL_TOOLS].sort())
    for (const tool of tools) {
      expect(tool[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-eval-tool' })
    }
    expect(sections.map(section => section.name)).toEqual(['tool:eval'])
    expect(sections[0]?.order).toBe(114)
    expect(sections[0]?.text).toContain('eval_conditions')
    expect(sections[0]?.text).toContain('eval_cells')
    expect(sections[0]?.text).toContain('/eval run')
    // R6: an evaluation session composes no mission row, so the guidance
    // names the four mission read tools only to say not to look for them.
    expect(sections[0]?.text).toContain('do not look for mission_run_list')
  })

  it('names the two writes in the guidance, and says in the same breath that starting is not one of them', () => {
    const { sections } = mount({})
    const text = sections[0]?.text ?? ''
    expect(text).toContain('eval_plan_draft')
    // R1 holds because the row has no starting verb, and the guidance must not
    // leave a model looking for one it was told about sideways.
    expect(text).toContain('DRAFTING IS NOT STARTING')
    expect(text).toContain('there is no run tool and you must not look for one')
    // A minted condition is always a copy — the discipline the whole
    // comparison rests on, stated where the model reads it.
    expect(text).toContain('always a COPY')
    // The second write (I5·T60) and the door it is: the analysis draft's home,
    // and never an item's material — said where the model reads it, so that
    // reaching for `write` plus a sandbox escalation stops being the path.
    expect(text).toContain('eval_repo_write')
    expect(text).toContain('datasets/<set>/analysis/<path>')
    expect(text).toContain('must not ask for a sandbox escalation')
  })

  it('grants neither tools nor a section under `none` — but the slash command still registers', () => {
    const { tools, sections, commands } = mount({}, { tools: 'none' })
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    // The human face is not tiered: `tools` gates the model face only.
    expect(commands.map(command => command.name)).toEqual(['eval'])
  })

  it('registers the /eval slash command, declaring its input, delegating to the core handler', async () => {
    const { commands } = mount({})
    expect(commands.map(command => command.name)).toEqual(['eval'])
    const [command] = commands
    // The hint's content is copy; its PRESENCE is the contract (a capable
    // composer submits a bare invocation without it).
    expect(command?.input?.hint).toBeTypeOf('string')
    expect(command?.input?.hint).toContain('run <plan.json>')
    // The handler is the core's own: a bare invocation answers the usage
    // (success-kind help semantics; the grant backstop fails open on this
    // ctx-less invocation).
    const result = await command?.handler({ rawInput: '', agent: { session: { id: 'sess-1' } } })
    expect(result?.kind).toBe('success')
    expect(result?.text).toContain('usage:')
  })

  it('degrades to a logged no-op when the eval service is absent', () => {
    const { tools, sections, commands, infos } = mount(undefined)
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    expect(commands).toEqual([])
    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain('eval service is absent')
  })
})
