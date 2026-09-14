/**
 * The slot heuristic and the role computation (ui-spec §三).
 *
 * The table that matters is the LAYOUT-AGREEMENT one: the protocol's two
 * layouts put the same file in two different display paths — `register` homes
 * P0's rubric at `answers/rubric.yml` (item-relative) while the convention
 * layout homes F2's at `rubric.yml` (layer-relative) — and the tab must call
 * both 评估标准 and mark both «只有判官». One of the two answers comes from the
 * path, the other from the role's fallback; a change that breaks either shows
 * up here as a pair that stopped agreeing.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyFile, DATASET_SLOTS, exposureOfRole, roleOfLayer, slotLayerMap, slotOfPath, slotOfRole,
  type DatasetSlot,
} from '../src/slots.ts'

/** harness-comparison's sensitive layers (dataset.json declares both). */
const SENSITIVE = new Set(['verify', 'grading'])

describe('roleOfLayer', () => {
  it('reads the role off the layer, never off the path', () => {
    expect(roleOfLayer('visible', SENSITIVE)).toBe('player')
    expect(roleOfLayer('grading', SENSITIVE)).toBe('judge')
    expect(roleOfLayer('verify', SENSITIVE)).toBe('probe')
    // A modelFacing:false layer outside the two judging conventions: withheld
    // from the player, and nothing here pretends to know who consumes it.
    expect(roleOfLayer('hidden', new Set(['hidden']))).toBe('withheld')
    // The passthrough zone is in no layer — which is exactly why it is the one
    // unprotected area (protocol §3).
    expect(roleOfLayer(null, SENSITIVE)).toBe('passthrough')
  })

  it('a dataset that declares nothing sensitive puts every layer in front of the player', () => {
    expect(roleOfLayer('grading', new Set())).toBe('player')
  })

  it('collapses the five roles onto the tree’s three colours', () => {
    expect(exposureOfRole('player')).toBe('visible')
    expect(exposureOfRole('passthrough')).toBe('unprotected')
    for (const role of ['judge', 'probe', 'withheld'] as const) {
      expect(exposureOfRole(role)).toBe('withheld')
    }
  })
})

describe('slotOfPath', () => {
  it('names the five slots off the path alone', () => {
    expect(slotOfPath('task.md')).toBe('prompt')
    expect(slotOfPath('prompts/stage1.md')).toBe('prompt')
    expect(slotOfPath('standards.yml')).toBe('standards')
    expect(slotOfPath('rubric.yml')).toBe('rubric')
    expect(slotOfPath('rubric.md')).toBe('rubric')
    expect(slotOfPath('oracle/notes.md')).toBe('oracle')
    expect(slotOfPath('probes/stage1-structure.mjs')).toBe('checks')
    expect(slotOfPath('checks/checklist.yml')).toBe('checks')
  })

  it('standards-notes is grading rationale, not a player-facing standard', () => {
    // The rule order is load-bearing: `standards-notes.yml` starts with
    // `standards`, and calling it 验收标准 would file the judge's private
    // notes under the slot the player reads.
    expect(slotOfPath('standards-notes.yml')).toBe('rubric')
    expect(slotOfPath('answers/standards-notes.yml')).toBe('rubric')
  })

  it('an oracle/ segment wins over every other rule', () => {
    // The answer key is the strongest signal there is: whatever it is named,
    // a file under oracle/ is the 参考答案.
    expect(slotOfPath('answers/oracle/task.md')).toBe('oracle')
    expect(slotOfPath('oracle/standards.yml')).toBe('oracle')
  })

  it('says nothing when the path says nothing', () => {
    expect(slotOfPath('checklist.yml')).toBeUndefined()
    expect(slotOfPath('item.json')).toBeUndefined()
    expect(slotOfPath('helpers/lib/probe-kit.mjs')).toBeUndefined()
  })
})

describe('classifyFile: the two layouts agree', () => {
  /** The same six files, as the register layout and the convention layout display them. */
  const pairs: Array<{
    what: string
    slot: DatasetSlot
    register: { layer: string; path: string }
    convention: { layer: string; path: string }
  }> = [
    {
      what: 'the task statement',
      slot: 'prompt',
      register: { layer: 'visible', path: 'task.md' },
      convention: { layer: 'visible', path: 'task.md' },
    },
    {
      what: 'the acceptance standards',
      slot: 'standards',
      register: { layer: 'visible', path: 'standards.yml' },
      convention: { layer: 'visible', path: 'standards.yml' },
    },
    {
      what: 'the rubric',
      slot: 'rubric',
      register: { layer: 'grading', path: 'answers/rubric.yml' },
      convention: { layer: 'grading', path: 'rubric.yml' },
    },
    {
      what: 'the grading notes',
      slot: 'rubric',
      register: { layer: 'grading', path: 'answers/standards-notes.yml' },
      convention: { layer: 'grading', path: 'standards-notes.yml' },
    },
    {
      what: 'the oracle',
      slot: 'oracle',
      register: { layer: 'grading', path: 'answers/oracle/notes.md' },
      convention: { layer: 'grading', path: 'oracle/notes.md' },
    },
    {
      what: 'a probe',
      slot: 'checks',
      register: { layer: 'verify', path: 'checks/probes/link-check.mjs' },
      convention: { layer: 'verify', path: 'probes/stage1-structure.mjs' },
    },
    {
      what: 'the probe material a path does not name',
      slot: 'checks',
      register: { layer: 'verify', path: 'checks/checklist.yml' },
      // Display path `checklist.yml` matches no rule — the verify layer's own
      // fallback is what makes this pair agree.
      convention: { layer: 'verify', path: 'checklist.yml' },
    },
  ]

  for (const pair of pairs) {
    it(`${pair.what} is ${pair.slot} in both layouts`, () => {
      const registered = classifyFile(pair.register.layer, pair.register.path, SENSITIVE)
      const conventional = classifyFile(pair.convention.layer, pair.convention.path, SENSITIVE)
      expect(registered.slot).toBe(pair.slot)
      expect(conventional.slot).toBe(pair.slot)
      expect(registered.role).toBe(conventional.role)
      expect(registered.exposure).toBe(conventional.exposure)
    })
  }

  it('the roles are the ones the player, the judge and the probe actually get', () => {
    expect(classifyFile('visible', 'task.md', SENSITIVE).role).toBe('player')
    expect(classifyFile('grading', 'answers/rubric.yml', SENSITIVE).role).toBe('judge')
    expect(classifyFile('verify', 'checks/probes/link-check.mjs', SENSITIVE).role).toBe('probe')
  })

  it('the passthrough zone is 其他文件, and it is unprotected', () => {
    for (const path of ['items/P0/item.json', 'schemas/stage1.json', 'plans/pilot-a.json', 'README.md']) {
      expect(classifyFile(null, path, SENSITIVE)).toEqual({ role: 'passthrough', slot: 'other', exposure: 'unprotected' })
    }
  })

  it('an unnamed file the player CAN see is “other”, not silently a 题干', () => {
    // The fallback never upgrades a path into a slot it did not earn: only the
    // probe and judge layers have a primary slot to fall back on.
    expect(slotOfRole('player')).toBe('other')
    expect(slotOfRole('withheld')).toBe('other')
    expect(slotOfRole('passthrough')).toBe('other')
    expect(classifyFile('visible', 'docs/background.md', SENSITIVE).slot).toBe('other')
  })
})

describe('slotLayerMap', () => {
  it('reports which layers carry each slot, passthrough under the reserved name', () => {
    const map = slotLayerMap([
      { layer: 'visible', slot: 'prompt' },
      { layer: 'visible', slot: 'standards' },
      { layer: 'grading', slot: 'rubric' },
      { layer: 'grading', slot: 'oracle' },
      { layer: 'verify', slot: 'checks' },
      { layer: null, slot: 'other' },
      { layer: null, slot: 'other' },
    ])
    expect(map).toEqual({
      prompt: ['visible'],
      standards: ['visible'],
      oracle: ['grading'],
      rubric: ['grading'],
      checks: ['verify'],
      other: ['-'],
    })
  })

  it('omits a slot this dataset has no file for, and keeps the spec’s order', () => {
    const map = slotLayerMap([{ layer: 'visible', slot: 'prompt' }])
    expect(Object.keys(map)).toEqual(['prompt'])
    // The chip row iterates DATASET_SLOTS, so the vocabulary stays the spec's.
    expect(DATASET_SLOTS).toEqual(['prompt', 'standards', 'oracle', 'rubric', 'checks', 'other'])
  })
})
