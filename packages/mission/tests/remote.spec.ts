/**
 * The mission Remote service: queue scoping by caller session, detail/retry/
 * release-check pass-through to the SAME service core, and the export gate —
 * a stale or missing confirmation never authorizes guarded layers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MissionRemoteService } from '../src/remote.ts'
import { MissionService } from '../src/service.ts'

let dir: string
let ctx: Context
let service: MissionService
let remote: MissionRemoteService

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mission-remote-'))
  ctx = new Context()
  service = new MissionService(dir)
  ctx.provide('mission', service)
  const fiber = ctx.plugin(MissionRemoteService)
  await fiber.await()
  remote = ctx.get('missionRemote') as MissionRemoteService
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function agentOf(sessionId: string): Agent {
  return { session: { id: sessionId } } as unknown as Agent
}

async function seed(): Promise<void> {
  // s1's implicit run with one mission; another run owned by s2.
  await service.create({ id: 'mine', originSession: 's1', title: 'mine' })
  await service.create({ id: 'dep', originSession: 's1' })
  await service.create({ id: 'chained', originSession: 's1', dependsOn: ['dep'] })
  await service.runCreate({
    template: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }] },
    runId: 'other',
    originSession: 's2',
  })
}

describe('MissionRemoteService', () => {
  it('queue defaults to the caller session\'s runs; all widens; buckets filter', async () => {
    await seed()
    const mine = remote.queue(agentOf('s1'), {})
    expect(mine.sessionId).toBe('s1')
    expect(mine.runs.map(s => s.run.id)).toEqual(['session-s1'])
    const rows = mine.runs[0]?.rows ?? []
    expect(rows.find(r => r.id === 'chained')?.bucket).toBe('blocked')

    const all = remote.queue(agentOf('s1'), { all: true })
    expect(all.runs.map(s => s.run.id).sort()).toEqual(['other', 'session-s1'])

    const blocked = remote.queue(agentOf('s1'), { buckets: ['blocked'] })
    expect(blocked.runs[0]?.rows.map(r => r.id)).toEqual(['chained'])

    const one = remote.queue(agentOf('s1'), { runId: 'other' })
    expect(one.runs.map(s => s.run.id)).toEqual(['other'])
  })

  it('get returns the detail; retry opens a new attempt attributed to the tab', async () => {
    await seed()
    const detail = remote.get(agentOf('s1'), { missionId: 'mine' })
    expect(detail.runId).toBe('session-s1')
    expect(detail.attempts).toHaveLength(1)
    const { attempt } = await remote.retry(agentOf('s1'), { missionId: 'mine' })
    expect(attempt).toBe(2)
    expect(service.get('mine', 'session-s1').mission.currentAttempt).toBe(2)
  })

  it('isReleasable mirrors the service verdict', async () => {
    await seed()
    expect(remote.isReleasable(agentOf('s1'), { missionId: 'mine' })).toEqual({ releasable: false })
  })

  it('exportRun re-checks confirmed against a fresh plan — unconfirmed guarded layers refuse', async () => {
    await seed()
    const outDir = join(dir, 'exports')
    const snap = join(dir, 'snap')
    mkdirSync(join(snap, 'answers'), { recursive: true })
    writeFileSync(join(snap, 'answers', 'a.md'), 'x\n')
    const request = {
      runId: 'session-s1', outDir, layers: ['answers'], snapshotDir: snap, guarded: ['answers'],
    }
    const plan = await remote.exportPlan(agentOf('s1'), request)
    expect(plan.guardedLayers).toEqual(['answers'])
    await expect(remote.exportRun(agentOf('s1'), { ...request, confirmed: [] })).rejects.toThrow(/not confirmed/)
    const result = await remote.exportRun(agentOf('s1'), { ...request, confirmed: ['answers'] })
    expect(result.files).toBeGreaterThan(0)
  })

  it('the datasets probe supplies guarded layers when mounted', async () => {
    await seed()
    ctx.provide('datasets', {
      list: () => Promise.resolve({ kind: 'items', dataset: { nonModelFacingLayers: ['answers'] } }),
    })
    mkdirSync(join(dir, 'snap2', 'answers'), { recursive: true })
    const plan = await remote.exportPlan(agentOf('s1'), {
      runId: 'session-s1', outDir: join(dir, 'e'), layers: ['answers'], snapshotDir: join(dir, 'snap2'),
      snapshot: { repo: '/repo', commit: 'abc', dataset: 'suite-a' },
    })
    expect(plan.guardedLayers).toEqual(['answers'])
  })
})
