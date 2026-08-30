// @vitest-environment jsdom
/**
 * The timeline node-kind classification: the single source of truth for which
 * store kinds become rows and which carry a hidden span, shared by the rail
 * projection, the DOM reading-position tracker, and the hidden-span fold. If a
 * new timeline kind is added here, the renderer and tracker agree by
 * construction.
 */
import { describe, expect, it } from 'vitest'
import { isHiddenSpanCarrierKind, isTimelineRowKind } from '../src/client/timeline-kinds.ts'

describe('isTimelineRowKind', () => {
  it('accepts user rows always and steering only when includeSteering', () => {
    expect(isTimelineRowKind('user', false)).toBe(true)
    expect(isTimelineRowKind('user', true)).toBe(true)
    expect(isTimelineRowKind('steering', true)).toBe(true)
    expect(isTimelineRowKind('steering', false)).toBe(false)
  })

  it('accepts the message-tools edited/restored bubbles regardless of includeSteering', () => {
    expect(isTimelineRowKind('message-tools-edited', false)).toBe(true)
    expect(isTimelineRowKind('message-tools-restored', false)).toBe(true)
    expect(isTimelineRowKind('message-tools-edited', true)).toBe(true)
  })

  it('rejects non-timeline kinds', () => {
    expect(isTimelineRowKind('assistant', true)).toBe(false)
    expect(isTimelineRowKind('assistant-step', true)).toBe(false)
    expect(isTimelineRowKind('tool-call', true)).toBe(false)
    expect(isTimelineRowKind('message-tools-withdrawn', true)).toBe(false)
    expect(isTimelineRowKind('context', true)).toBe(false)
  })
})

describe('isHiddenSpanCarrierKind', () => {
  it('accepts the withdrawal divider and the edited bubble', () => {
    expect(isHiddenSpanCarrierKind('message-tools-withdrawn')).toBe(true)
    expect(isHiddenSpanCarrierKind('message-tools-edited')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isHiddenSpanCarrierKind('message-tools-restored')).toBe(false)
    expect(isHiddenSpanCarrierKind('user')).toBe(false)
    expect(isHiddenSpanCarrierKind('steering')).toBe(false)
  })
})
