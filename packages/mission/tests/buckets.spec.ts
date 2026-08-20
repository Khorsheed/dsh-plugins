import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bucketOf, currentAttempt } from '../src/projection.ts'
import { MissionService } from '../src/service.ts'
import { SIMPLE_TEMPLATE } from '../src/template.ts'

let dir: string
let service: MissionService
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-buckets-'))
  service = new MissionService(join(dir, 'data'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const NOW = 1_800_000_000_000

describe('five-bucket projection', () => {
  it('terminal (no out-edge) → done; initial (no in-edge) → ready; mid → active', async () => {
    await service.runCreate({ template: SIMPLE_TEMPLATE, runId: 'r1' })
    await service.create({ runId: 'r1', id: 'm' })
    let { run, mission } = service.get('m', 'r1')
    expect(bucketOf(mission, run, NOW).bucket).toBe('ready')
    await service.transition('m', 'active', { runId: 'r1' })
    ;({ run, mission } = service.get('m', 'r1'))
    expect(bucketOf(mission, run, NOW).bucket).toBe('active')
    await service.transition('m', 'failed', { runId: 'r1' })
    ;({ run, mission } = service.get('m', 'r1'))
    // `failed` is a terminal too — same bucket as `done`, raw state name preserved.
    expect(bucketOf(mission, run, NOW).bucket).toBe('done')
    expect(currentAttempt(mission).state).toBe('failed')
  })

  it('dependsOn: blocked until every dependency reaches a terminal state, then ready', async () => {
    await service.runCreate({ template: SIMPLE_TEMPLATE, runId: 'r1' })
    await service.create({ runId: 'r1', id: 'up' })
    await service.create({ runId: 'r1', id: 'down', dependsOn: ['up'] })
    let view = service.list({ runId: 'r1' }, { now: NOW }).find(v => v.id === 'down')
    expect(view?.bucket).toBe('blocked')
    expect(view?.blockedOn).toEqual(['up'])
    await service.transition('up', 'active', { runId: 'r1' })
    view = service.list({ runId: 'r1' }, { now: NOW }).find(v => v.id === 'down')
    expect(view?.bucket).toBe('blocked')
    await service.transition('up', 'done', { runId: 'r1' })
    view = service.list({ runId: 'r1' }, { now: NOW }).find(v => v.id === 'down')
    expect(view?.bucket).toBe('ready')
    // Bucketing is a projection: the dependent mission's stored state never moved.
    expect(currentAttempt(service.get('down', 'r1').mission).state).toBe('queued')
  })

  it('scheduledAt: scheduled before the point in time, ready after', async () => {
    await service.runCreate({ template: SIMPLE_TEMPLATE, runId: 'r1' })
    await service.create({ runId: 'r1', id: 'm', scheduledAt: NOW + 60_000 })
    expect(service.list({ runId: 'r1' }, { now: NOW })[0]?.bucket).toBe('scheduled')
    expect(service.list({ runId: 'r1' }, { now: NOW + 61_000 })[0]?.bucket).toBe('ready')
  })

  it('holds for arbitrary template shapes (custom names, several terminals)', async () => {
    const weird = {
      states: ['start', 'middle', 'end-ok', 'end-bad'],
      transitions: [
        { from: 'start', to: 'middle' },
        { from: 'middle', to: 'end-ok' },
        { from: 'middle', to: 'end-bad' },
      ],
    }
    await service.runCreate({ template: weird, runId: 'w1' })
    await service.create({ runId: 'w1', id: 'm' })
    expect(service.list({ runId: 'w1' }, { now: NOW })[0]?.bucket).toBe('ready')
    await service.transition('m', 'middle', { runId: 'w1' })
    await service.transition('m', 'end-bad', { runId: 'w1' })
    const view = service.list({ runId: 'w1' }, { now: NOW })[0]
    expect(view?.bucket).toBe('done')
    expect(view?.state).toBe('end-bad')
  })
})

describe('DAG composition (layered chain) and retry semantics', () => {
  const CHAIN = {
    name: 'content-pack-daily',
    states: ['queued', 'active', 'done', 'failed'],
    transitions: [
      { from: 'queued', to: 'active' },
      { from: 'active', to: 'done' },
      { from: 'active', to: 'failed' },
    ],
    missions: [
      { id: 'ods-extract', labels: { layer: 'ods' } },
      { id: 'dwd-clean', labels: { layer: 'dwd' }, dependsOn: ['ods-extract'] },
      { id: 'dws-summary', labels: { layer: 'dws' }, dependsOn: ['dwd-clean'] },
      { id: 'app-publish', labels: { layer: 'app' }, dependsOn: ['dws-summary'] },
    ],
  }

  it('a four-node chain aggregates correctly and unblocks layer by layer', async () => {
    await service.runCreate({ template: CHAIN, runId: 'dag' })
    const bucketsOf = () => Object.fromEntries(
      service.runStatus('dag', { now: NOW }).rows.map(r => [r.id, r.bucket]),
    )
    expect(bucketsOf()).toEqual({
      'ods-extract': 'ready', 'dwd-clean': 'blocked', 'dws-summary': 'blocked', 'app-publish': 'blocked',
    })
    expect(service.runStatus('dag', { now: NOW }).buckets['blocked']).toHaveLength(3)

    await service.transition('ods-extract', 'active', { runId: 'dag' })
    await service.transition('ods-extract', 'done', { runId: 'dag' })
    expect(bucketsOf()).toEqual({
      'ods-extract': 'done', 'dwd-clean': 'ready', 'dws-summary': 'blocked', 'app-publish': 'blocked',
    })
    // Label projection: the layer coordinate is queryable without walking directories.
    expect(service.list({ runId: 'dag', labels: { layer: 'dws' } })[0]?.id).toBe('dws-summary')
  })

  it('an upstream retry opens a new attempt and never invalidates downstream records', async () => {
    await service.runCreate({ template: CHAIN, runId: 'dag' })
    await service.transition('ods-extract', 'active', { runId: 'dag' })
    await service.transition('ods-extract', 'done', { runId: 'dag' })
    await service.transition('dwd-clean', 'active', { runId: 'dag' })
    await service.annotate('dwd-clean', 'script', { verdict: 'clean' }, { runId: 'dag' })
    await service.submit('dwd-clean', { runId: 'dag', files: [{ path: 'out.txt', content: 'v1' }] })

    const { attempt } = await service.retry('ods-extract', { runId: 'dag' })
    expect(attempt).toBe(2)
    const upstream = service.get('ods-extract', 'dag').mission
    expect(upstream.attempts).toHaveLength(2)
    // Old attempt immutable: its history and terminal state survive.
    expect(upstream.attempts[0]?.state).toBe('done')
    expect(upstream.attempts[0]?.history).toHaveLength(2)
    // New attempt starts fresh at the initial state.
    expect(currentAttempt(upstream).state).toBe('queued')
    expect(currentAttempt(upstream).history).toEqual([])
    // Downstream records are untouched — a backfill is a human decision.
    const downstream = service.get('dwd-clean', 'dag').mission
    expect(currentAttempt(downstream).state).toBe('active')
    expect(downstream.annotations).toHaveLength(1)
    expect(currentAttempt(downstream).artifacts).toHaveLength(1)
    // The projection re-blocks downstream missions that have not run yet.
    const buckets = Object.fromEntries(service.runStatus('dag', { now: NOW }).rows.map(r => [r.id, r.bucket]))
    expect(buckets['dws-summary']).toBe('blocked')
  })
})
