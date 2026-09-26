/**
 * Read-side source-form matrix: every message-tools predicate must recognize
 * the producer's events in all three durable forms — the current
 * producer-owned kind (`message-tools`), the V3→V4 migrated kind
 * (`plugin:message-tools`, released V3 files rewritten once by the official
 * migration), and the released V3 wrapper a pre-V4 (0.1.5) host still serves
 * verbatim (`{ kind: 'plugin', plugin: 'message-tools' }`) — and reject
 * every foreign producer in the same forms.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  MESSAGE_TOOLS_PLUGIN,
  isMessageToolsEdit, isMessageToolsReplacement, isMessageToolsRestore,
  isMessageToolsRestoreAssistant, isMessageToolsSource, isMessageToolsTrigger,
} from '../src/marker.ts'

/** One user/message event carrying an arbitrary persisted source. */
function eventWith(source: unknown, surfaceOp: SessionEvent<'user/message'>['surfaceOp'] = 'append'): SessionEvent<'user/message'> {
  return {
    type: 'user/message', seq: 0, time: 1,
    data: { id: 'm0', role: 'user', content: [{ type: 'text', text: 'x' }], source },
    surfaceOp,
  } as unknown as SessionEvent<'user/message'>
}

/** The three durable forms one producer identity can take in a log. */
const PRODUCER_FORMS = [
  ['current producer kind', { kind: MESSAGE_TOOLS_PLUGIN }],
  ['V3→V4 migrated kind', { kind: `plugin:${MESSAGE_TOOLS_PLUGIN}` }],
  ['released V3 wrapper (0.1.5)', { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN }],
] as const

describe('isMessageToolsSource', () => {
  it.each(PRODUCER_FORMS)('accepts the %s form', (_label, source) => {
    expect(isMessageToolsSource(source)).toBe(true)
    expect(isMessageToolsSource({ ...source, op: 'edit' })).toBe(true)
  })

  it('rejects foreign producers in every form, malformed values, and near-miss prefixes', () => {
    expect(isMessageToolsSource({ kind: 'user' })).toBe(false)
    expect(isMessageToolsSource({ kind: 'compact-checkpoint' })).toBe(false)
    expect(isMessageToolsSource({ kind: 'plugin', plugin: 'other-plugin' })).toBe(false)
    expect(isMessageToolsSource({ kind: 'plugin:other-plugin' })).toBe(false)
    // The migrated-form match is exact: a longer kind names another producer.
    expect(isMessageToolsSource({ kind: `plugin:${MESSAGE_TOOLS_PLUGIN}-extra` })).toBe(false)
    expect(isMessageToolsSource(`${MESSAGE_TOOLS_PLUGIN}-extra`)).toBe(false)
    expect(isMessageToolsSource({ kind: '' })).toBe(false)
    expect(isMessageToolsSource({ kind: 'plugin' })).toBe(false)
    expect(isMessageToolsSource({})).toBe(false)
    expect(isMessageToolsSource(null)).toBe(false)
    expect(isMessageToolsSource(undefined)).toBe(false)
    expect(isMessageToolsSource('message-tools')).toBe(false)
  })
})

describe('predicates across durable source forms', () => {
  const replacement = { op: 'replace', startSeq: 0, endSeq: 0 } as const

  it.each(PRODUCER_FORMS)('withdrawal replacement (%s)', (_label, source) => {
    const event = eventWith(source, replacement)
    expect(isMessageToolsReplacement(event)).toBe(true)
    expect(isMessageToolsEdit(event)).toBe(false)
    expect(isMessageToolsRestore(event)).toBe(false)
  })

  it.each(PRODUCER_FORMS)('edit replacement (%s)', (_label, source) => {
    const event = eventWith({ ...source, op: 'edit' }, replacement)
    expect(isMessageToolsEdit(event)).toBe(true)
    expect(isMessageToolsReplacement(event)).toBe(false)
    expect(isMessageToolsRestoreAssistant(event)).toBe(false)
  })

  it.each(PRODUCER_FORMS)('user-message restore replay (%s)', (_label, source) => {
    const event = eventWith(source)
    expect(isMessageToolsRestore(event)).toBe(true)
    expect(isMessageToolsReplacement(event)).toBe(false)
    expect(isMessageToolsTrigger(event)).toBe(false)
  })

  it.each(PRODUCER_FORMS)('edit trigger (%s)', (_label, source) => {
    const event = eventWith({ ...source, op: 'edit-trigger' })
    expect(isMessageToolsTrigger(event)).toBe(true)
    expect(isMessageToolsRestore(event)).toBe(false)
  })

  it.each(PRODUCER_FORMS)('assistant-text restore replay (%s)', (_label, source) => {
    const event = eventWith({ ...source, op: 'restore-assistant' })
    expect(isMessageToolsRestoreAssistant(event)).toBe(true)
    expect(isMessageToolsRestore(event)).toBe(false)
    expect(isMessageToolsTrigger(event)).toBe(false)
  })

  it('rejects foreign-producer events in every form', () => {
    const foreign = [
      { kind: 'plugin', plugin: 'other' },
      { kind: 'plugin:other' },
      { kind: 'compact-checkpoint' },
    ]
    for (const source of foreign) {
      expect(isMessageToolsReplacement(eventWith(source, replacement))).toBe(false)
      expect(isMessageToolsRestore(eventWith(source))).toBe(false)
      expect(isMessageToolsEdit(eventWith({ ...source, op: 'edit' }, replacement))).toBe(false)
    }
  })

  it('still requires the surface shape: a producer source never redeems another event type', () => {
    const turnStart = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as unknown as SessionEvent
    expect(isMessageToolsRestore(turnStart)).toBe(false)
    expect(isMessageToolsReplacement(turnStart)).toBe(false)
    // An append-surface message is not a replacement even with our source.
    expect(isMessageToolsReplacement(eventWith({ kind: MESSAGE_TOOLS_PLUGIN }))).toBe(false)
    // A replace-surface message is not a restore.
    expect(isMessageToolsRestore(eventWith({ kind: MESSAGE_TOOLS_PLUGIN }, replacement))).toBe(false)
  })
})
