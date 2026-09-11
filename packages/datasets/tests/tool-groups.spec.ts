/**
 * The core's faces and the group machinery after the tool-row split (M4'③):
 * the service, the `/datasets` slash command, and the Remote data face stay
 * here; the model tools and the `datasets:tools` prompt section moved to the
 * companion `@khorsheed/dsh-datasets-tool`. Mounting this core must touch
 * NEITHER the tool registry NOR the system-prompt assembly — the ctx below
 * supplies neither, so a stray registration would throw instead of passing
 * silently. What remains testable here is the pure group mapping the companion
 * grants with.
 */
import { describe, expect, it } from 'vitest'
import { apply, Config, inject, toolsOfGroup } from '../src/index.ts'
import { datasetToolDefinitions } from '../src/tool.ts'

const READ = [
  'datasets_list', 'datasets_show', 'datasets_describe', 'datasets_read', 'datasets_snapshot', 'datasets_validate',
]

/** Apply the core against a recording context with no model-facing registry. */
function applyCore(): { provided: string[]; commands: string[]; plugins: number } {
  const provided: string[] = []
  const commands: string[] = []
  let plugins = 0
  const ctx = {
    provide: (name: string) => { provided.push(name) },
    plugin: () => { plugins += 1 },
    commands: { register: (command: { name: string }) => { commands.push(command.name); return () => {} } },
  }
  apply(ctx as never, { repo: '', worktreeRoot: '' })
  return { provided, commands, plugins }
}

describe('the datasets core faces', () => {
  it('mounts the service, the slash command, and the Remote face without a tool registry', () => {
    const { provided, commands, plugins } = applyCore()
    expect(provided).toEqual(['datasets'])
    expect(commands).toEqual(['datasets'])
    expect(plugins).toBe(1)
  })

  it('injects only the command registry and takes no tool-group config', () => {
    expect(inject).toEqual(['commands'])
    expect(new Config({} as never)).toEqual({ repo: '', worktreeRoot: '' })
  })
})

describe('the tool groups the companion grants', () => {
  it('defaults to all eight tools — the dev-domain behavior is unchanged', () => {
    const all = datasetToolDefinitions({} as never, { defaultRepo: '', group: 'all' }).map(definition => definition.name)
    expect(all.sort()).toEqual([...READ, 'datasets_put_item', 'datasets_worktree_path'].sort())
    expect(datasetToolDefinitions({} as never, { defaultRepo: '', group: 'read' }).map(d => d.name).sort())
      .toEqual([...READ].sort())
    expect(datasetToolDefinitions({} as never, { defaultRepo: '', group: 'authoring' }).map(d => d.name).sort())
      .toEqual([...READ, 'datasets_put_item'].sort())
    expect(datasetToolDefinitions({} as never, { defaultRepo: '', group: 'none' })).toEqual([])
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
