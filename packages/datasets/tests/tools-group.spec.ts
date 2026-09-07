/**
 * The `tools` group config: which model tools each tier registers, and the
 * prompt section that describes exactly those. A preset cannot deselect a
 * tool the profile registered, so the group is the only boundary that exists
 * — these tests are what keep it honest.
 */
import { describe, expect, it } from 'vitest'
import { apply, toolsOfGroup, type DatasetsPluginConfig } from '../src/index.ts'

/** What one `apply` did to its context, minus the service internals. */
interface Applied {
  tools: string[]
  commands: string[]
  provided: string[]
  /** The `datasets:tools` prompt section text, absent when none was contributed. */
  prompt?: string
}

/** Apply the plugin against a recording context (no service method runs). */
function applyWith(config: Partial<DatasetsPluginConfig>): Applied {
  const tools: string[] = []
  const commands: string[] = []
  const provided: string[] = []
  let prompt: string | undefined
  const ctx = {
    provide: (name: string) => { provided.push(name) },
    plugin: () => {},
    get: (name: string) => (name === 'systemPrompt'
      ? { section: (section: { text: string }) => { prompt = section.text; return () => {} } }
      : undefined),
    commands: { register: (command: { name: string }) => { commands.push(command.name); return () => {} } },
    tools: { register: (definition: { name: string }) => { tools.push(definition.name); return () => {} } },
  }
  apply(ctx as never, { repo: '', worktreeRoot: '', ...config })
  return { tools, commands, provided, ...(prompt !== undefined ? { prompt } : {}) }
}

const READ = [
  'datasets_list', 'datasets_show', 'datasets_describe', 'datasets_read', 'datasets_snapshot', 'datasets_validate',
]

describe('the tools group config', () => {
  it('defaults to all eight tools — the dev-domain behavior is unchanged', () => {
    const bare = applyWith({})
    expect(bare.tools).toEqual([...READ.slice(0, 5), 'datasets_worktree_path', 'datasets_put_item', 'datasets_validate'])
    expect(applyWith({ tools: 'all' }).tools).toEqual(bare.tools)
    // The prompt keeps naming both write verbs when both exist.
    expect(bare.prompt).toContain('datasets_worktree_path')
    expect(bare.prompt).toContain('datasets_put_item')
  })

  it('read registers the read verbs only', () => {
    const applied = applyWith({ tools: 'read' })
    expect(applied.tools.sort()).toEqual([...READ].sort())
    expect(applied.prompt).toContain('datasets_snapshot')
    expect(applied.prompt).not.toContain('datasets_worktree_path')
    expect(applied.prompt).not.toContain('datasets_put_item')
  })

  it('authoring adds put_item and stops short of worktree materialization', () => {
    const applied = applyWith({ tools: 'authoring' })
    expect(applied.tools.sort()).toEqual([...READ, 'datasets_put_item'].sort())
    expect(applied.prompt).toContain('datasets_put_item')
    expect(applied.prompt).not.toContain('datasets_worktree_path')
  })

  it('none registers no model tool and no prompt section, keeping the human faces', () => {
    const applied = applyWith({ tools: 'none' })
    expect(applied.tools).toEqual([])
    expect(applied.prompt).toBeUndefined()
    // The service, the slash command and (through it) the CLI and tab are the
    // human's faces — no group setting touches them.
    expect(applied.provided).toEqual(['datasets'])
    expect(applied.commands).toEqual(['datasets'])
  })

  it('every group is a subset chain: none ⊂ read ⊂ authoring ⊂ all', () => {
    const chain = (['none', 'read', 'authoring', 'all'] as const).map(group => toolsOfGroup(group))
    for (let i = 1; i < chain.length; i++) {
      const [narrow = [], wide = []] = [chain[i - 1], chain[i]]
      expect(wide.length).toBeGreaterThan(narrow.length)
      for (const tool of narrow) expect(wide).toContain(tool)
    }
  })
})
