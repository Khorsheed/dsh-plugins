/** The companion row: which tools each granted group registers, the origin tag
 * (this package, not the core), the `datasets:tools` guidance section, the
 * `/datasets` slash registration (preset-visibility rollout A3 — registered at
 * every tier, delegated to the core's handler), and the silent degrade when
 * the core service is absent. */
import { describe, expect, it } from 'vitest'
import { apply, type DatasetsToolConfig } from '../src/index.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

const READ = [
  'datasets_list', 'datasets_show', 'datasets_describe', 'datasets_read', 'datasets_snapshot', 'datasets_validate',
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
function mount(service: unknown, config?: DatasetsToolConfig): {
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
    get: (name: string) => (name === 'datasets' ? service : undefined),
    logger: { info: (message: string) => { infos.push(message) } },
    inject: (_names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  }
  if (config === undefined) apply(ctx as never)
  else apply(ctx as never, config)
  return { tools, sections, commands, infos }
}

describe('datasets-tool companion row', () => {
  it('grants all eight tools, tags them by this package, and names both write verbs', () => {
    const { tools, sections } = mount({})
    expect(tools.map(tool => tool.name).sort())
      .toEqual([...READ, 'datasets_put_item', 'datasets_worktree_path'].sort())
    for (const tool of tools) {
      expect(tool[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-datasets-tool' })
    }
    expect(sections.map(section => section.name)).toEqual(['datasets:tools'])
    expect(sections[0]?.order).toBe(150)
    expect(sections[0]?.text).toContain('datasets_worktree_path')
    expect(sections[0]?.text).toContain('datasets_put_item')
  })

  it('grants the read verbs only under `read`, with matching guidance', () => {
    const { tools, sections } = mount({}, { tools: 'read' })
    expect(tools.map(tool => tool.name).sort()).toEqual([...READ].sort())
    expect(sections[0]?.text).toContain('datasets_snapshot')
    expect(sections[0]?.text).not.toContain('datasets_worktree_path')
    expect(sections[0]?.text).not.toContain('datasets_put_item')
  })

  it('grants authoring (put_item, no worktree materialization) under `authoring`', () => {
    const { tools, sections } = mount({}, { tools: 'authoring' })
    expect(tools.map(tool => tool.name).sort()).toEqual([...READ, 'datasets_put_item'].sort())
    expect(sections[0]?.text).toContain('datasets_put_item')
    expect(sections[0]?.text).not.toContain('datasets_worktree_path')
  })

  it('grants neither tools nor a section under `none` — but the slash command still registers', () => {
    const { tools, sections, commands } = mount({}, { tools: 'none' })
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    // The human face is not tiered: `tools` gates the model face only.
    expect(commands.map(command => command.name)).toEqual(['datasets'])
  })

  it('registers the /datasets slash command, declaring its free-form input, delegating to the core handler', async () => {
    const { commands } = mount({})
    expect(commands.map(command => command.name)).toEqual(['datasets'])
    const [command] = commands
    // WITHOUT this descriptor a capable composer has no reason to believe the
    // command takes arguments: picking `/datasets` from the completion strip
    // submits a bare invocation and leaves `bind <path>` in the MESSAGE body
    // (T36's live pass). The hint's content is copy; its PRESENCE is the contract.
    expect(command?.input?.hint).toBeTypeOf('string')
    expect(command?.input?.hint).toContain('bind <repoPath>')
    // The handler is the core's own: a bare invocation answers its usage line
    // (and the grant backstop fails open on this ctx-less invocation).
    const result = await command?.handler({ rawInput: '', agent: { session: { id: 'sess-1' } } })
    expect(result?.kind).toBe('error')
    expect(result?.text).toContain('usage: /datasets list')
  })

  it('degrades to a logged no-op when the datasets service is absent', () => {
    const { tools, sections, commands, infos } = mount(undefined)
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    expect(commands).toEqual([])
    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain('datasets service is absent')
  })
})
