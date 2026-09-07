/** The mount-time tool group (`tools`): which of the twelve model tools a
 * mount registers, and a `tool:mission` prompt section that describes only
 * the tools actually registered. The service face, slash command, and Remote
 * face are outside the group and stay mounted in every tier. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, MISSION_READ_TOOLS, type MissionConfig } from '../src/index.ts'

const ALL_TOOLS = [
  'mission_run_create', 'mission_run_list', 'mission_run_status', 'mission_create', 'mission_list', 'mission_get',
  'mission_transition', 'mission_submit', 'mission_annotate', 'mission_attest', 'mission_retry',
  'mission_is_releasable',
]
const WRITE_TOOLS = ALL_TOOLS.filter(name => !MISSION_READ_TOOLS.includes(name))

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Mount the plugin over a throwaway data root, recording what it registers. */
function mount(config: Omit<MissionConfig, 'dataDir'>): {
  tools: string[]
  sections: Array<{ name: string; text: string }>
  slash: number
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mission-tools-'))
  roots.push(root)
  const tools: string[] = []
  const sections: Array<{ name: string; text: string }> = []
  let slash = 0
  const ctx = {
    provide: () => {},
    plugin: () => {},
    commands: { register: () => { slash += 1; return () => {} } },
    systemPrompt: { section: (section: { name: string; text: string }) => { sections.push(section) } },
    tools: { register: (definition: { name: string }) => { tools.push(definition.name); return () => {} } },
  }
  apply(ctx as never, { dataDir: root, ...config })
  return { tools, sections, slash }
}

describe('mission tool groups', () => {
  it('registers all twelve tools and the full prompt section by default', () => {
    const { tools, sections } = mount({})
    expect(tools.sort()).toEqual([...ALL_TOOLS].sort())
    expect(sections.map(section => section.name)).toEqual(['tool:mission'])
    for (const name of ['mission_create', 'mission_transition', 'mission_retry', 'mission_is_releasable']) {
      expect(sections[0]?.text).toContain(name)
    }
    expect(mount({ tools: 'all' }).tools.sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('registers only the four queue queries under `read`', () => {
    const { tools, sections } = mount({ tools: 'read' })
    expect(tools.sort()).toEqual([...MISSION_READ_TOOLS].sort())
    expect(tools).toHaveLength(4)
    // `mission_is_releasable` is read-only but belongs to the resource holder.
    expect(tools).not.toContain('mission_is_releasable')
    expect(sections.map(section => section.name)).toEqual(['tool:mission'])
    for (const name of MISSION_READ_TOOLS) expect(sections[0]?.text).toContain(name)
    for (const name of WRITE_TOOLS) expect(sections[0]?.text).not.toContain(name)
  })

  it('registers no tool and no prompt section under `none`', () => {
    const { tools, sections } = mount({ tools: 'none' })
    expect(tools).toEqual([])
    expect(sections).toEqual([])
  })

  it('keeps the service, slash, and Remote faces in every tier', () => {
    for (const tier of ['all', 'read', 'none'] as const) {
      expect(mount({ tools: tier }).slash).toBeGreaterThan(0)
    }
  })
})
