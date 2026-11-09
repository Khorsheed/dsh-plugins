/**
 * Held-report releases (restart-recovery R1): a release still on its way is
 * never queued again, older journals' duplicates are found from the journal
 * alone, and every preview of a release says what it carries.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { pendingHolds, pendingReleaseSeqs, previewOf, redundantReleases } from '../src/dispatch.ts'
import { releasePreview } from '../src/release-preview.ts'
import { replay } from '../src/journal.ts'

let clock = 0
const ev = (seq: number, type: string, data: object) => ({ type, seq, time: ++clock, data }) as unknown as SessionEvent

const COORD = 'm-coord'
const BUILDER = 'm-builder'
const MAPPER = 'm-mapper'

/** A room with a coordinator and two members; each member's round reports back to the coordinator. */
function roster(): SessionEvent[] {
  return [
    ev(1, 'room/member-added', { id: COORD, name: '人物建模大师', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
    ev(2, 'room/member-added', { id: BUILDER, name: '招摇构筑师', kind: 'cli', provider: 'kimi', invitedBy: 'agent' }),
    ev(3, 'room/member-added', { id: MAPPER, name: '地图匠', kind: 'cli', provider: 'codex', invitedBy: 'agent' }),
  ]
}

/** A report from `from` held for the coordinator: the held dispatch and its hold verdict. */
function held(seq: number, from: string, text: string): SessionEvent[] {
  return [
    ev(seq, 'room/dispatch', { id: `held-${seq}`, origin: 'report', targets: ['人物建模大师'], targetIds: [COORD], text, held: true, reportFor: `${seq - 50}:${from}`, hop: 2 }),
    ev(seq + 1, 'room/report-gate', { dispatchSeq: seq, memberId: COORD, member: '人物建模大师', verdict: 'hold', reason: 'model' }),
  ]
}

/** A release round to the coordinator for the given holds. */
const release = (seq: number, releases: readonly number[]) =>
  ev(seq, 'room/dispatch', { id: `release-${seq}`, origin: 'report', targets: ['人物建模大师'], targetIds: [COORD], text: `（以上 ${releases.length} 条回报一直等着交给你。）`, releases, releaseReason: 'restart', hop: 1 })
const edge = (seq: number, dispatchSeq: number, state: string) =>
  ev(seq, 'room/delivery-state', { id: `${dispatchSeq}:${COORD}`, dispatchSeq, memberId: COORD, state })

describe('pendingReleaseSeqs / redundantReleases', () => {
  it('the incident shape: one timeout release ran, five restart releases of the same hold queued after it', () => {
    const events = [
      ...roster(),
      ...held(62, BUILDER, '四地区交付与校验已完成'),
      release(74, [62]),
      release(85, [62]), release(86, [62]), release(96, [62]),
      edge(97, 74, 'running'),
      release(105, [62]), release(108, [62]),
    ]
    // The running one covers the hold: no new release, every queued one is redundant.
    expect([...pendingReleaseSeqs(events, COORD)]).toEqual([62])
    expect(redundantReleases(events, COORD).map(row => row.dispatchSeq)).toEqual([85, 86, 96, 105, 108])
  })

  it('keeps the earliest queued release of an open hold, drops the identical later ones', () => {
    const events = [...roster(), ...held(62, BUILDER, '交付完成'), release(85, [62]), release(86, [62]), release(96, [62])]
    expect(redundantReleases(events, COORD).map(row => row.dispatchSeq)).toEqual([86, 96])
  })

  it('a queued release whose holds a later round already carried is redundant; one with a hold still open is not', () => {
    const events = [
      ...roster(),
      ...held(62, BUILDER, '交付完成'),
      release(70, [62]),
      ...held(72, MAPPER, '地图画好了'),
      release(80, [72]),
      // Another round of the coordinator carried #62.
      ev(81, 'room/report-gate', { dispatchSeq: 62, memberId: COORD, member: '人物建模大师', verdict: 'release', reason: 'carried' }),
    ]
    expect(pendingHolds(events, COORD)).toEqual([72])
    expect(redundantReleases(events, COORD).map(row => row.dispatchSeq)).toEqual([70])
  })

  it('settled releases cover nothing: a hold they did not close gets a release again', () => {
    const events = [...roster(), ...held(62, BUILDER, '交付完成'), release(70, [62]), edge(71, 70, 'running'), edge(72, 70, 'cancelled')]
    expect(pendingReleaseSeqs(events, COORD).size).toBe(0)
    expect(redundantReleases(events, COORD)).toEqual([])
  })
})

describe('what a release previews', () => {
  it('one report: who sent it and how it opens; several: how many and from whom', () => {
    const events = [
      ...roster(),
      ...held(62, BUILDER, '四地区交付与校验已完成，\n  北岭、南湾、东港、西岭全部通过'),
      ...held(72, MAPPER, '地图画好了'),
      release(80, [62]),
      release(81, [62, 72]),
    ]
    const state = replay(events)
    const row = (seq: number) => state.deliveries!.find(entry => entry.dispatchSeq === seq)!
    expect(releasePreview(state, row(80))).toBe('补交回报：招摇构筑师 · 四地区交付与校验已完成， 北岭、南湾、东港、西岭全部通过')
    expect(releasePreview(state, row(81))).toBe('补交 2 条回报：招摇构筑师、地图匠')
    // The core queue row's preview (the members page's 「来自协作间：…」) reads the same.
    expect(previewOf(events, 80, 'fallback')).toBe('补交回报：招摇构筑师 · 四地区交付与校验已完成， 北岭、南湾、东港、西岭全部通过')
    expect(previewOf(events, 81, 'fallback')).toBe('补交 2 条回报：招摇构筑师、地图匠')
    // Any other dispatch keeps its own words.
    expect(previewOf(events, 62, 'fallback')).toBe('四地区交付与校验已完成， 北岭、南湾、东港、西岭全部通过')
  })

  it('a long report opens with its first 80 characters', () => {
    const events = [...roster(), ...held(62, BUILDER, '甲'.repeat(200)), release(80, [62])]
    const state = replay(events)
    expect(releasePreview(state, state.deliveries!.find(entry => entry.dispatchSeq === 80)!)).toBe(`补交回报：招摇构筑师 · ${'甲'.repeat(80)}…`)
  })
})
