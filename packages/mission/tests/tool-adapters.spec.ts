import { describe, expect, it } from 'vitest'
import { registerMissionTools } from '../src/tools.ts'

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

describe('mission tool adapters', () => {
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
    const registered: RegisteredTool[] = []
    registerMissionTools({
      tools: { register: (definition: RegisteredTool) => { registered.push(definition); return () => {} } },
    } as never, service as never)

    const submit = registered.find(tool => tool.name === 'mission_submit') as RegisteredTool
    await submit.execute(
      { mission_id: 'm', json: { ok: true }, to: 'accepted' },
      { agent: { session: { id: 's1' } } },
    )
    expect(calls[0]).toEqual({
      method: 'submit', missionId: 'm',
      options: { json: { ok: true }, to: 'accepted', by: 'tool:s1' },
    })

    const retry = registered.find(tool => tool.name === 'mission_retry') as RegisteredTool
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
