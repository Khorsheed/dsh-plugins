/** The definition factory the companion row imports: group selection, the
 * absence of an origin tag (that follows the MOUNTING package), and the
 * adapters' argument forwarding. */
import { describe, expect, it } from 'vitest'
import { MISSION_READ_TOOLS, missionToolDefinitions } from '../src/tool.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

const ALL_TOOLS = [
  'mission_run_create', 'mission_run_list', 'mission_run_status', 'mission_create', 'mission_list', 'mission_get',
  'mission_transition', 'mission_submit', 'mission_annotate', 'mission_attest', 'mission_retry',
  'mission_is_releasable',
]

interface ToolParameters {
  required?: string[]
  properties?: Record<string, { enum?: readonly string[] }>
  enum?: readonly string[]
}

interface RegisteredTool {
  name: string
  parameters: ToolParameters
  execute: (args: Record<string, unknown>, execution: { agent?: { session: { id: string } } }) => Promise<unknown>
}

describe('mission tool definitions', () => {
  it('builds all twelve definitions untagged — the companion owns tagging and registration', () => {
    const definitions = missionToolDefinitions({} as never)
    expect(definitions.map(definition => definition.name).sort()).toEqual([...ALL_TOOLS].sort())
    for (const definition of definitions) {
      expect((definition as Record<symbol, unknown>)[ORIGIN]).toBeUndefined()
    }
  })

  it('builds only the four queue queries under `read`, and none under `none`', () => {
    const read = missionToolDefinitions({} as never, 'read')
    expect(read.map(definition => definition.name).sort()).toEqual([...MISSION_READ_TOOLS].sort())
    expect(missionToolDefinitions({} as never, 'none')).toEqual([])
  })

  it('forwards submit intent and requires retry reason/category with caller attribution', async () => {
    const calls: Array<{ method: string; missionId: string; options: Record<string, unknown> }> = []
    const service = {
      submit: (missionId: string, options: Record<string, unknown>) => {
        calls.push({ method: 'submit', missionId, options })
        return Promise.resolve({ written: [], artifacts: 0, checkpoint: 'submit' })
      },
      retry: (missionId: string, options: Record<string, unknown>) => {
        calls.push({ method: 'retry', missionId, options })
        return Promise.resolve({ attempt: 2 })
      },
    }
    const definitions = missionToolDefinitions(service as never) as unknown as RegisteredTool[]

    const submit = definitions.find(tool => tool.name === 'mission_submit') as RegisteredTool
    await submit.execute(
      { mission_id: 'm', json: { ok: true }, to: 'accepted' },
      { agent: { session: { id: 's1' } } },
    )
    expect(calls[0]).toEqual({
      method: 'submit', missionId: 'm',
      options: { json: { ok: true }, to: 'accepted', by: 'tool:s1' },
    })

    const retry = definitions.find(tool => tool.name === 'mission_retry') as RegisteredTool
    expect(retry.parameters.required).toEqual(expect.arrayContaining(['mission_id', 'reason', 'category']))
    expect(retry.parameters.properties?.category?.enum).toEqual(['infrastructure', 'operator', 'outcome'])
    await expect(retry.execute(
      { mission_id: 'm', category: 'operator' },
      { agent: { session: { id: 's2' } } },
    )).rejects.toThrow(/reason/)
    await retry.execute(
      { mission_id: 'm', reason: 'resource interrupted', category: 'infrastructure' },
      { agent: { session: { id: 's2' } } },
    )
    expect(calls[1]).toEqual({
      method: 'retry', missionId: 'm',
      options: { reason: 'resource interrupted', category: 'infrastructure', by: 'tool:s2' },
    })
  })
})
