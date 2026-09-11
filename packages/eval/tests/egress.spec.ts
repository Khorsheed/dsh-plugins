/**
 * The egress self-check as a unit: one declared command, one crude rule.
 * Every branch here answers the same question — when the unit cannot reach
 * its endpoints, does the refusal SAY so, or does it look like the subject
 * had nothing to say (which is what T29c actually saw for 230 seconds).
 */
import { describe, expect, it } from 'vitest'
import { checkUnitEgress, EgressUnavailable, EGRESS_UNAVAILABLE } from '../src/egress.ts'
import { DEFAULT_EGRESS_CHECK_TIMEOUT_MS, egressCheckOf } from '../src/unit.ts'
import type { LabVerifyResult } from '../src/faces.ts'

/** A lab whose `verify` answers with a scripted result (or throws). */
function verifier(result: Partial<LabVerifyResult> | Error, seen: Array<{ unitId: string; options: unknown }> = []) {
  return {
    seen,
    async verify(unitId: string, options: { command: string[]; timeoutMs?: number }): Promise<LabVerifyResult> {
      seen.push({ unitId, options })
      if (result instanceof Error) throw result
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, ...result }
    },
  }
}

const CHECK = { command: ['sh', '-c', 'curl -sSf -m 10 "$HTTPS_PROXY"'] }

describe('checkUnitEgress', () => {
  it('passes on exit 0 and asks the unit exactly what the plan declared', async () => {
    const lab = verifier({ exitCode: 0 })
    await expect(checkUnitEgress(lab, 'unit-1', CHECK, 'cell p0-codex')).resolves.toBeUndefined()
    expect(lab.seen).toEqual([{ unitId: 'unit-1', options: { command: CHECK.command, timeoutMs: DEFAULT_EGRESS_CHECK_TIMEOUT_MS } }])
  })

  it('carries the declared timeout through instead of the default', async () => {
    const lab = verifier({ exitCode: 0 })
    await checkUnitEgress(lab, 'unit-1', { ...CHECK, timeoutMs: 5_000 }, 'cell p0-codex')
    expect((lab.seen[0]?.options as { timeoutMs: number }).timeoutMs).toBe(5_000)
  })

  it('refuses on a non-zero exit, quoting the command and what it said', async () => {
    const lab = verifier({ exitCode: 7, stderr: 'curl: (56) CONNECT tunnel failed, response 503' })
    const error = await checkUnitEgress(lab, 'unit-1', CHECK, 'the probe unit').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EgressUnavailable)
    expect((error as EgressUnavailable).code).toBe(EGRESS_UNAVAILABLE)
    expect((error as Error).message).toContain('the probe unit')
    expect((error as Error).message).toContain('curl -sSf -m 10 "$HTTPS_PROXY"')
    expect((error as Error).message).toContain('CONNECT tunnel failed')
  })

  it('falls back to stdout when the command said nothing on stderr', async () => {
    const lab = verifier({ exitCode: 1, stdout: '000' })
    const error = await checkUnitEgress(lab, 'unit-1', CHECK, 'cell x').catch((e: unknown) => e)
    expect((error as Error).message).toContain(': 000')
  })

  it('treats a timeout as unreachable and names the budget', async () => {
    const lab = verifier({ exitCode: -1, timedOut: true, durationMs: 30_000 })
    const error = await checkUnitEgress(lab, 'unit-1', CHECK, 'cell x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EgressUnavailable)
    expect((error as Error).message).toContain('exceeded 30000ms')
    expect((error as Error).message).toContain('egress sidecar is down')
  })

  it('treats a verify that could not run at all as the same verdict', async () => {
    const lab = verifier(new Error('lab: unit-1 is not running'))
    const error = await checkUnitEgress(lab, 'unit-1', CHECK, 'cell x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EgressUnavailable)
    expect((error as Error).message).toContain('could not be run')
    expect((error as Error).message).toContain('lab: unit-1 is not running')
  })
})

describe('egressCheckOf', () => {
  it('reads a well-formed declaration, copying the argv', () => {
    const source = { command: ['sh', '-c', 'exit 0'], timeoutMs: 900 }
    const decl = egressCheckOf(source)
    expect(decl).toEqual(source)
    source.command.push('mutated')
    expect(decl?.command).toHaveLength(3)
  })

  it('reads nothing usable as absent — the plan schema is what complains', () => {
    for (const bad of [undefined, null, 42, 'curl', {}, { command: [] }, { command: 'curl' }, { command: [''] }, { command: [1] }]) {
      expect(egressCheckOf(bad)).toBeNull()
    }
  })

  it('ignores a timeout that is not a positive number, keeping the default', () => {
    for (const bad of [0, -1, Number.NaN, '900']) {
      expect(egressCheckOf({ command: ['sh'], timeoutMs: bad })?.timeoutMs).toBeUndefined()
    }
  })
})
