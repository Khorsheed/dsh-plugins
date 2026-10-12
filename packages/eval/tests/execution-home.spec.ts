/**
 * The execution-home port: the unit path's three decisions — scoped-home
 * resolution, availability verification, mount planning — answered by the
 * execution target instead of the management host's filesystem.
 *
 * What is pinned here, at the port's own level (the runPlan loop cases live
 * in run.spec.ts beside the container loop they extend): the mount plan
 * flowing into the acquire spec verbatim (volume, source, target — nothing
 * bind-shaped), the coded refusals (unknown identity, unavailable port,
 * invalid answer), the identity pin with the evidence face (both seams
 * mounted: tokens must exist and agree), and the contract diagnostics running
 * FIRST, unchanged (a condition without a reviewed mount point never reaches
 * the port).
 *
 * The default path is pinned by the pre-existing suite: every container and
 * whole-loop spec runs the port-absent path unmodified.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionHomePort, ScopedHomeEvidenceFace, ScopedHomePlan, ScopedHomePlanRequest } from '../src/faces.ts'
import { acquireSpecFor, planScopedHomeMount, resolveCellUnit } from '../src/run/unit.ts'

const PLAN_UNIT = { image: 'eval-env:pinned', network: 'eval-net', user: '1000' } as const

const DSH_CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: '0.1.5', drive: 'exec' },
  model: { declared: 'deepseek-v4', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: ['DEEPSEEK_API_KEY', 'DSH_HOME'] },
  unit: { scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } },
} as const

/** A port that plans one volume-backed home, recording its asks. */
function volumePort(plan: ScopedHomePlan = {
  mount: { source: 'eval-home-dsh-eval-b', type: 'volume' },
  homeIdentity: 'target-1',
}): { port: ExecutionHomePort; asks: ScopedHomePlanRequest[] } {
  const asks: ScopedHomePlanRequest[] = []
  return {
    asks,
    port: {
      planScopedHome: async (request) => {
        asks.push(request)
        return plan
      },
    },
  }
}

const INPUT = {
  planUnit: PLAN_UNIT,
  conditionId: 'dsh-unit',
  condition: DSH_CONDITION,
  harnessName: 'dsh',
  scope: 'eval-b',
  unitUid: 1000,
} as const

describe('the mount plan', () => {
  it('flows into the acquire spec verbatim — source, target, type volume, nothing bind-shaped', async () => {
    const { port, asks } = volumePort()
    const planned = await planScopedHomeMount(port, undefined, { ...INPUT })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    // The port received the REGISTERED identity and the reviewed in-container
    // declaration — no caller-supplied volume name, no local path.
    expect(asks).toEqual([{
      conditionId: 'dsh-unit',
      harness: 'dsh',
      scope: 'eval-b',
      container: '/creds/dsh',
      var: 'DSH_HOME',
      unitUid: 1000,
    }])
    // The mount source is the port's opaque reference, and the plan says volume.
    expect(planned.plan.scopedHome.host).toBe('eval-home-dsh-eval-b')
    expect(planned.plan.mount).toEqual({ type: 'volume' })

    const spec = acquireSpecFor(planned.plan, { missionId: 'm-1', runId: 'r-1' })
    expect(spec.mounts).toEqual([{ source: 'eval-home-dsh-eval-b', target: '/creds/dsh', type: 'volume' }])
    // The in-container side is the condition's reviewed declaration, and the
    // environment is unchanged — dsh's node flag included.
    expect(spec.env).toEqual({ DSH_HOME: '/creds/dsh', NODE_OPTIONS: '--use-env-proxy' })
    expect(spec).toMatchObject({ image: 'eval-env:pinned', network: 'eval-net', user: '1000' })
  })

  it('a bind-shaped port plan is honored too — the port owns the decision', async () => {
    const { port } = volumePort({ mount: { source: '/target-side/homes/dsh', type: 'bind', readonly: true } })
    const planned = await planScopedHomeMount(port, undefined, { ...INPUT })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const spec = acquireSpecFor(planned.plan)
    expect(spec.mounts).toEqual([{ source: '/target-side/homes/dsh', target: '/creds/dsh', type: 'bind', readonly: true }])
  })

  it('the default plan has no mount key, and acquireSpecFor stays byte-identical to before the port', () => {
    const resolved = resolveCellUnit(PLAN_UNIT, 'dsh-unit', DSH_CONDITION, '/host/homes/dsh@eval-b')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.plan).not.toHaveProperty('mount')
    expect(acquireSpecFor(resolved.plan).mounts).toEqual([{ source: '/host/homes/dsh@eval-b', target: '/creds/dsh', type: 'bind' }])
  })
})

describe('the coded refusals', () => {
  it('an unknown identity is refused EXECUTION_HOME_UNKNOWN — never planned from a local guess', async () => {
    const planned = await planScopedHomeMount({ planScopedHome: async () => undefined }, undefined, { ...INPUT })
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_UNKNOWN'])
  })

  it('a port that cannot verify is EXECUTION_HOME_UNAVAILABLE, with its reason', async () => {
    const planned = await planScopedHomeMount(
      { planScopedHome: async () => { throw new Error('target docker daemon is down') } },
      undefined,
      { ...INPUT },
    )
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_UNAVAILABLE'])
    expect(planned.diagnostics[0]?.message).toContain('target docker daemon is down')
  })

  it('a port without the verb is EXECUTION_HOME_UNAVAILABLE naming it', async () => {
    const planned = await planScopedHomeMount({}, undefined, { ...INPUT })
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_UNAVAILABLE'])
    expect(planned.diagnostics[0]?.message).toContain('planScopedHome')
  })

  it('an answer that is not a mount plan is EXECUTION_HOME_INVALID', async () => {
    for (const bad of [
      {},
      { mount: { source: '', type: 'volume' } },
      { mount: { source: 'x', type: 'bindfs' } },
    ]) {
      const planned = await planScopedHomeMount({ planScopedHome: async () => bad as never }, undefined, { ...INPUT })
      expect(planned.ok).toBe(false)
      if (planned.ok) continue
      expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_INVALID'])
    }
  })

  it('the contract diagnostics run FIRST — a condition without a reviewed mount point never reaches the port', async () => {
    const spy = vi.fn()
    const { unit: _dropped, ...noUnit } = DSH_CONDITION
    const planned = await planScopedHomeMount(
      { planScopedHome: spy },
      undefined,
      { ...INPUT, condition: noUnit },
    )
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.diagnostics.map(d => d.code)).toEqual(['UNIT_SCOPED_HOME_MISSING'])
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the identity pin with the evidence face', () => {
  const face = (homeIdentity: string | undefined): ScopedHomeEvidenceFace => ({
    homeHash: async () => ({
      homeDir: '/target-side/homes/dsh@eval-b',
      sha: 'b'.repeat(64),
      files: 2,
      denied: 1,
      ...(homeIdentity === undefined ? {} : { homeIdentity }),
    }),
  })

  it('equal tokens pass, and the plan flows', async () => {
    const { port } = volumePort()
    const planned = await planScopedHomeMount(port, face('target-1'), { ...INPUT })
    expect(planned.ok).toBe(true)
  })

  it('mismatching tokens refuse EXECUTION_HOME_IDENTITY_MISMATCH before anything is planned', async () => {
    const { port } = volumePort({ mount: { source: 'eval-home-dsh-eval-b', type: 'volume' }, homeIdentity: 'target-2' })
    const planned = await planScopedHomeMount(port, face('target-1'), { ...INPUT })
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_IDENTITY_MISMATCH'])
    expect(planned.diagnostics[0]?.message).toContain('target-1')
    expect(planned.diagnostics[0]?.message).toContain('target-2')
  })

  it('a port answer without the token refuses as a mismatch — unpinnable is not pinnable', async () => {
    const { port } = volumePort({ mount: { source: 'eval-home-dsh-eval-b', type: 'volume' } })
    const planned = await planScopedHomeMount(port, face('target-1'), { ...INPUT })
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_IDENTITY_MISMATCH'])
  })

  it('an evidence face that cannot answer (or has no homeHash) refuses EXECUTION_HOME_EVIDENCE_MISSING', async () => {
    const { port } = volumePort()
    const noVerb = await planScopedHomeMount(port, {}, { ...INPUT })
    expect(noVerb.ok).toBe(false)
    if (!noVerb.ok) expect(noVerb.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_EVIDENCE_MISSING'])
    const noAnswer = await planScopedHomeMount(port, { homeHash: async () => undefined }, { ...INPUT })
    expect(noAnswer.ok).toBe(false)
    if (!noAnswer.ok) expect(noAnswer.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_EVIDENCE_MISSING'])
    const noToken = await planScopedHomeMount(port, face(undefined), { ...INPUT })
    expect(noToken.ok).toBe(false)
    if (!noToken.ok) expect(noToken.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_EVIDENCE_MISSING'])
  })
})
