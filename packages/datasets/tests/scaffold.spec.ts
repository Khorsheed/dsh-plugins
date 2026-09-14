/**
 * Where a skeleton's placeholder files land.
 *
 * The rule that matters: an item the descriptor's `register` already speaks
 * for gets its files at the REGISTERED paths, and an item it does not gets
 * the convention layout. A skeleton that guessed wrong would drop a rubric
 * outside every layer — into the passthrough zone, readable by every bound
 * session — which is the one accident the visibility discipline exists to
 * prevent, so the placement is pinned here rather than only end-to-end.
 */
import { describe, expect, it } from 'vitest'
import { validateDescriptor } from '../src/dataset.ts'
import { homeForSkeletonFile, newDescriptor, planDatasetSkeleton, planItemSkeleton, PLACEHOLDER_MARKER } from '../src/scaffold.ts'
import { BENCH_DESCRIPTOR } from './helpers.ts'

const BENCH = validateDescriptor(BENCH_DESCRIPTOR, 'fixture')

describe('homeForSkeletonFile', () => {
  it('uses an exact register pattern verbatim', () => {
    expect(homeForSkeletonFile(BENCH, 'R1', 'visible', 'task.md')).toBe('task.md')
    expect(homeForSkeletonFile(BENCH, 'R1', 'visible', 'standards.yml')).toBe('standards.yml')
  })

  it('fills a single-segment glob with the file’s own basename', () => {
    // `answers/*` is how harness-comparison homes its grading material.
    expect(homeForSkeletonFile(BENCH, 'R1', 'grading', 'rubric.yml')).toBe('answers/rubric.yml')
  })

  it('prefers the glob whose directory matches the convention path’s own', () => {
    // Both `checks/*` and `checks/probes/*` could host a README; only the
    // second keeps a probe under a probes/ segment, which is what makes it an
    // executable probe to the run loop (protocol §6.7).
    expect(homeForSkeletonFile(BENCH, 'R1', 'verify', 'probes/README.md')).toBe('checks/probes/README.md')
  })

  it('falls back to the convention layout for an item the register does not name', () => {
    expect(homeForSkeletonFile(BENCH, 'C2', 'visible', 'task.md')).toBe('visible/task.md')
    expect(homeForSkeletonFile(BENCH, 'C2', 'grading', 'rubric.yml')).toBe('grading/rubric.yml')
    expect(homeForSkeletonFile(BENCH, 'C2', 'verify', 'probes/README.md')).toBe('verify/probes/README.md')
  })

  it('honours an exact pattern that renamed the file', () => {
    const renamed = validateDescriptor({
      id: 'x',
      layers: [{ name: 'grading', modelFacing: false }],
      register: [{ item: 'R9', layer: 'grading', files: ['scoring/rubric.yml'] }],
    }, 'fixture')
    expect(homeForSkeletonFile(renamed, 'R9', 'grading', 'rubric.yml')).toBe('scoring/rubric.yml')
  })
})

describe('planItemSkeleton', () => {
  it('plans the four slots into the layers this dataset declares', () => {
    const plan = planItemSkeleton(BENCH, 'C2')
    expect(plan.files.map(file => [file.slot, file.itemPath])).toEqual([
      ['prompt', 'visible/task.md'],
      ['standards', 'visible/standards.yml'],
      ['rubric', 'grading/rubric.yml'],
      ['checks', 'verify/probes/README.md'],
    ])
    expect(plan.notes).toEqual([])
  })

  it('the rubric placeholder is leafless on purpose, so validate names it', () => {
    const rubric = planItemSkeleton(BENCH, 'C2').files.find(file => file.slot === 'rubric')
    expect(rubric?.content).toContain('items: []')
    expect(rubric?.content).toContain(PLACEHOLDER_MARKER)
  })

  it('says WHY a slot got no placeholder instead of inventing a layer', () => {
    const bare = validateDescriptor({ id: 'bare', layers: [{ name: 'visible' }] }, 'fixture')
    const plan = planItemSkeleton(bare, 'i1')
    expect(plan.files.map(file => file.slot)).toEqual(['prompt', 'standards'])
    expect(plan.notes.join('\n')).toContain('no rubric placeholder')
    expect(plan.notes.join('\n')).toContain('no checks placeholder')
  })

  it('a dataset with no modelFacing layer gets no player-facing placeholder', () => {
    const sealed = validateDescriptor({ id: 'sealed', layers: [{ name: 'grading', modelFacing: false }] }, 'fixture')
    const plan = planItemSkeleton(sealed, 'i1')
    expect(plan.files.map(file => file.slot)).toEqual(['rubric'])
    // Three unplanned slots, three reasons: 题干 and 验收标准 need a
    // modelFacing layer, 检查脚本 needs a verify layer.
    expect(plan.notes).toHaveLength(3)
  })
})

describe('planDatasetSkeleton', () => {
  it('writes a descriptor that declares modelFacing per layer', () => {
    const files = planDatasetSkeleton('newset', 'A new set')
    const descriptor = validateDescriptor(
      JSON.parse(files.find(file => file.path === 'dataset.json')?.content ?? '{}'),
      'skeleton',
    )
    expect(descriptor.id).toBe('newset')
    expect(descriptor.name).toBe('A new set')
    // Every layer states its visibility: the mixed-sensitivity warning exists
    // because an undeclared layer defaults to VISIBLE, and a skeleton must not
    // hand the author that trap.
    expect(descriptor.layers.every(layer => layer.modelFacingDeclared)).toBe(true)
    expect(descriptor.layers.map(layer => [layer.name, layer.modelFacing])).toEqual([
      ['visible', true], ['verify', false], ['grading', false],
    ])
  })

  it('puts the shared prompt inside the modelFacing layer and the schema in the passthrough zone', () => {
    expect(planDatasetSkeleton('newset').map(file => file.path)).toEqual([
      'dataset.json',
      'visible/prompts/stage1.md',
      'schemas/stage1.json',
      'items/.gitkeep',
    ])
  })

  it('omits an empty name rather than writing one', () => {
    const descriptor = newDescriptor('newset', '')
    expect('name' in descriptor).toBe(false)
  })
})
