/**
 * T89 — the CLI's mission face reads `dsh-mission get --json`, a
 * schema-versioned document, and names the upgrade when the mission CLI on
 * PATH predates the flag (an older CLI refuses `--json` as a value-less flag).
 */
import { describe, expect, it } from 'vitest'
import { cliMissionFace, MISSION_GET_SCHEMA, parseMissionGet } from '../src/cli-core.ts'
import type { Exec } from '../src/types.ts'

const MISSION = { id: 'm-1', labels: { task: 'P0' }, currentAttempt: 1, attempts: [{ attempt: 1, state: 'running', artifacts: [] }] }

function execOf(result: { exitCode: number; stdout?: string; stderr?: string }, calls: string[][] = []): Exec {
  return async (argv) => {
    calls.push(argv)
    return { exitCode: result.exitCode, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
}

describe('parseMissionGet', () => {
  it('reads the schema-versioned document', () => {
    expect(parseMissionGet(JSON.stringify({ schema: MISSION_GET_SCHEMA, runId: 'r', mission: MISSION })))
      .toEqual({ mission: MISSION })
  })

  it('refuses non-JSON, a missing or foreign schema, and a document without a mission', () => {
    expect(() => parseMissionGet('nope')).toThrow(/did not print JSON/)
    expect(() => parseMissionGet(JSON.stringify({ runId: 'r', mission: MISSION }))).toThrow(/printed schema null/)
    expect(() => parseMissionGet(JSON.stringify({ schema: 'dsh-mission.get/2', mission: MISSION }))).toThrow(/lab reads dsh-mission\.get\/1/)
    expect(() => parseMissionGet(JSON.stringify({ schema: MISSION_GET_SCHEMA }))).toThrow(/carried no mission/)
  })
})

describe('cliMissionFace.get', () => {
  it('passes --json last and returns the mission', async () => {
    const calls: string[][] = []
    const face = cliMissionFace(execOf({ exitCode: 0, stdout: JSON.stringify({ schema: MISSION_GET_SCHEMA, runId: 'r-1', mission: MISSION }) }, calls))
    expect(await face.get('m-1', 'r-1')).toEqual({ mission: MISSION })
    expect(calls[0]).toEqual(['dsh-mission', 'get', 'm-1', '--run', 'r-1', '--json'])
  })

  it('an older dsh-mission without --json gets a sentence naming the upgrade', async () => {
    const face = cliMissionFace(execOf({ exitCode: 2, stderr: '--json requires a value\n\nusage: …' }))
    await expect(face.get('m-1')).rejects.toThrow(/predates `dsh-mission get --json`.*upgrade the dsh-mission CLI/)
  })

  it('any other failure keeps its own stderr', async () => {
    const face = cliMissionFace(execOf({ exitCode: 1, stderr: 'mission m-1 not found' }))
    await expect(face.get('m-1')).rejects.toThrow(/get failed \(exit 1\): mission m-1 not found/)
  })
})
