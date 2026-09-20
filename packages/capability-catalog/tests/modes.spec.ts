/**
 * The mode view's host half: the roster a picker offers, and one face per mode.
 *
 * These tests pin the two claims the settings surface rests on: a mode that
 * could not be read keeps its row with a REASON instead of an empty face (so a
 * broken preset never reads as "this mode loads nothing"), and a roster row's
 * order and default marker survive the projection (the picker is a read
 * position, not a re-sorted list).
 */
import { describe, expect, it, vi } from 'vitest'
import { modeOptions, readModeFaces } from '../src/modes.ts'
import type { CapabilityCatalogSnapshot } from '../src/types.ts'
import type { PresetRosterRow } from '../src/preset-scope.ts'

/** A snapshot carrying only what a face read consumes for the comparison. */
function snapshot(skills: readonly string[], tools: readonly string[]): CapabilityCatalogSnapshot {
  return {
    skills: skills.map(name => ({
      name, description: `${name} desc`, source: 'runtime', provider: 'p', modelInvocable: true, userInvocable: true,
    })),
    tools: tools.map(name => ({ name, description: `${name} desc`, channel: 'plugin', confidence: 'exact' })),
    mcpServers: [],
    channels: [],
  }
}

const rows: readonly PresetRosterRow[] = [
  { id: 'standard', name: '标准模式', description: 'full agent' },
  { id: 'minimal', name: '极简模式' },
  { id: 'broken', name: '坏模式', broken: 'not valid YAML' },
]

describe('modeOptions', () => {
  it('keeps roster order and marks the deployment default', () => {
    const options = modeOptions(rows, 'minimal')
    expect(options.map(option => option.id)).toEqual(['standard', 'minimal', 'broken'])
    expect(options[0]?.isDefault).toBeUndefined()
    expect(options[1]?.isDefault).toBe(true)
  })

  it('carries the display text and the broken reason, omitting absent fields', () => {
    const [standard, minimal, broken] = modeOptions(rows, 'standard')
    expect(standard).toEqual({ id: 'standard', name: '标准模式', description: 'full agent', isDefault: true })
    expect(minimal).not.toHaveProperty('description')
    expect(broken?.broken).toBe('not valid YAML')
  })

  it('marks nothing when the roster resolves no default', () => {
    expect(modeOptions(rows, undefined).some(option => option.isDefault === true)).toBe(false)
  })

  it('offers nothing without a roster', () => {
    expect(modeOptions([], 'standard')).toEqual([])
  })
})

describe('readModeFaces', () => {
  it('reads every readable mode in roster order', async () => {
    const options = modeOptions(rows, 'standard').filter(option => option.broken === undefined)
    const order: string[] = []
    const faces = await readModeFaces(options, async (id) => {
      order.push(id)
      return id === 'standard' ? snapshot(['a'], ['t1', 't2']) : snapshot([], [])
    })
    expect(order).toEqual(['standard', 'minimal'])
    expect(faces.map(face => face.preset)).toEqual(['standard', 'minimal'])
    expect(faces[0]?.skills.map(skill => skill.name)).toEqual(['a'])
    expect(faces[0]?.tools.map(tool => tool.name)).toEqual(['t1', 't2'])
    expect(faces[0]?.isDefault).toBe(true)
    expect(faces[1]?.skills).toEqual([])
  })

  it('never reads a broken preset and keeps its row with the reason', async () => {
    const read = vi.fn(async () => snapshot([], []))
    const faces = await readModeFaces(modeOptions(rows, 'standard'), read)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls.map(call => call[0])).not.toContain('broken')
    const broken = faces.find(face => face.preset === 'broken')
    expect(broken?.unavailable).toBe('not valid YAML')
    expect(broken?.skills).toEqual([])
    expect(broken?.name).toBe('坏模式')
  })

  it('reports an unresolved scope as unavailable, not as an empty face', async () => {
    const faces = await readModeFaces(modeOptions(rows.slice(0, 2), undefined), async () => undefined)
    expect(faces.every(face => face.unavailable !== undefined)).toBe(true)
    expect(faces.every(face => face.skills.length === 0 && face.tools.length === 0)).toBe(true)
  })

  it('contains a reader that throws and still reads the modes after it', async () => {
    const faces = await readModeFaces(modeOptions(rows.slice(0, 2), 'standard'), async (id) => {
      if (id === 'standard') throw new Error('mount refused')
      return snapshot(['b'], [])
    })
    expect(faces[0]?.unavailable).toBe('the preset resolved no standing scope')
    expect(faces[1]?.skills.map(skill => skill.name)).toEqual(['b'])
  })
})
