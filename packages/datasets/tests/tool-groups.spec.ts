/**
 * The core's faces and the group machinery after the tool-row split (M4'③)
 * and the preset-visibility rollout (A3): the service and the Remote data
 * face stay here; the model tools, the `datasets:tools` prompt section, and
 * the `/datasets` slash registration moved to the companion
 * `@khorsheed/dsh-datasets-tool`. Mounting this core must touch NEITHER the
 * tool registry NOR the system-prompt assembly NOR the command registry —
 * the ctx below supplies none of them, so a stray registration would throw
 * instead of passing silently. What remains testable here is the pure group
 * mapping the companion grants with.
 */
import { describe, expect, it } from 'vitest'
import { apply, Config, inject, toolsOfGroup } from '../src/index.ts'
import { formatBindReceipt } from '../src/format.ts'
import { datasetToolDefinitions } from '../src/tool.ts'

const READ = [
  'datasets_list', 'datasets_show', 'datasets_describe', 'datasets_read', 'datasets_snapshot', 'datasets_validate',
]

/** One recorded slash registration (the fields the composer contract reads). */
interface RecordedCommand {
  name: string
  description: string
  input?: { hint: string }
}

/** Apply the core against a recording context with no model-facing registry. */
function applyCore(): { provided: string[]; commands: RecordedCommand[]; plugins: number } {
  const provided: string[] = []
  const commands: RecordedCommand[] = []
  let plugins = 0
  const ctx = {
    provide: (name: string) => { provided.push(name) },
    plugin: () => { plugins += 1 },
    commands: { register: (command: RecordedCommand) => { commands.push(command); return () => {} } },
  }
  apply(ctx as never, { repo: '', materializedRoot: '' })
  return { provided, commands, plugins }
}

describe('the /datasets bind receipt (I5·T58 · G3)', () => {
  it('names the model-facing default instead of claiming all layers', () => {
    const receipt = formatBindReceipt({ repoPath: '/repo' })
    // The old sentence was "(all layers)", which a person reading it would
    // take to mean the reference answers and the rubric were open to the
    // planning agent. The default is the opposite of that.
    expect(receipt).not.toContain('all layers')
    expect(receipt).toContain('model-facing layers only')
    expect(receipt).toContain('--layers')
  })

  it('names the layers a person opened on purpose, and says they are explicit', () => {
    const receipt = formatBindReceipt({ repoPath: '/repo', layers: ['visible', 'grading'] })
    expect(receipt).toContain('visible, grading')
    expect(receipt).toContain('sensitive ones included')
  })

  it('carries the dataset whitelist when the binding has one', () => {
    expect(formatBindReceipt({ repoPath: '/repo', datasets: ['alpha'] })).toContain('datasets: alpha')
    expect(formatBindReceipt({ repoPath: '/repo' })).not.toContain('datasets:')
  })
})

describe('the datasets core faces', () => {
  it('mounts the service and the Remote face, and registers NO slash command (A3: it moved to the companion row)', () => {
    const { provided, commands, plugins } = applyCore()
    expect(provided).toEqual(['datasets'])
    expect(commands).toEqual([])
    expect(plugins).toBe(1)
  })

  it('injects nothing and takes no tool-group config', () => {
    // The command registry was the slash face's hard inject; with the
    // registration in the companion row the core mounts unconditionally.
    expect(inject).toEqual([])
    expect(new Config({} as never)).toEqual({ repo: '', materializedRoot: '' })
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
