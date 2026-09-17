/** The companion row: which tools each granted group registers, the origin
 * tag (this package, not the core), the `tool:mission` guidance section, the
 * `/mission` slash registration (preset-visibility rollout A3 — registered at
 * every tier, delegated to the core's handler), and the silent degrade when
 * the core service is absent. */
import { describe, expect, it } from 'vitest'
import { apply, type MissionToolConfig } from '../src/index.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

const ALL_TOOLS = [
  'mission_run_create', 'mission_run_list', 'mission_run_status', 'mission_create', 'mission_list', 'mission_get',
  'mission_transition', 'mission_submit', 'mission_annotate', 'mission_attest', 'mission_retry',
  'mission_is_releasable',
]
const READ_TOOLS = ['mission_run_list', 'mission_run_status', 'mission_list', 'mission_get']

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
function mount(service: unknown, config?: MissionToolConfig): {
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
    get: (name: string) => (name === 'mission' ? service : undefined),
    logger: { info: (message: string) => { infos.push(message) } },
    inject: (_names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  }
  if (config === undefined) apply(ctx as never)
  else apply(ctx as never, config)
  return { tools, sections, commands, infos }
}

describe('mission-tool companion row', () => {
  it('grants all twelve tools, tags them by this package, and adds the full section', () => {
    const { tools, sections } = mount({})
    expect(tools.map(tool => tool.name).sort()).toEqual([...ALL_TOOLS].sort())
    for (const tool of tools) {
      expect(tool[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-mission-tool' })
    }
    expect(sections.map(section => section.name)).toEqual(['tool:mission'])
    expect(sections[0]?.order).toBe(113)
    for (const name of ['mission_create', 'mission_transition', 'mission_retry', 'mission_is_releasable']) {
      expect(sections[0]?.text).toContain(name)
    }
  })

  it('grants only the four queue queries under `read`, with the read-only section', () => {
    const { tools, sections } = mount({}, { tools: 'read' })
    expect(tools.map(tool => tool.name).sort()).toEqual([...READ_TOOLS].sort())
    for (const name of READ_TOOLS) expect(sections[0]?.text).toContain(name)
    for (const name of ALL_TOOLS.filter(candidate => !READ_TOOLS.includes(candidate))) {
      expect(sections[0]?.text).not.toContain(name)
    }
  })

  it('grants neither tools nor a section under `none` — but the slash command still registers', () => {
    const { tools, sections, commands } = mount({}, { tools: 'none' })
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    // The human face is not tiered: `tools` gates the model face only.
    expect(commands.map(command => command.name)).toEqual(['mission'])
  })

  it('registers the /mission slash command with its input hint, delegating to the core handler', async () => {
    const { commands } = mount({})
    expect(commands.map(command => command.name)).toEqual(['mission'])
    const [command] = commands
    expect(command?.input?.hint).toContain('queue')
    // The handler is the core's own: a bare invocation answers its usage line
    // (and the grant backstop fails open on this ctx-less invocation).
    const result = await command?.handler({ rawInput: '', agent: { session: { id: 'sess-1' } } })
    expect(result?.kind).toBe('error')
    expect(result?.text).toContain('usage:')
  })

  it('degrades to a logged no-op when the mission service is absent', () => {
    const { tools, sections, commands, infos } = mount(undefined)
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    expect(commands).toEqual([])
    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain('mission service is absent')
  })
})
