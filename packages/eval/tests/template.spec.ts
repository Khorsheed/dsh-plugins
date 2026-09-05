/**
 * Run-template generation: the generated template must be EQUIVALENT to the
 * I1 hand-written templates/bench-v1.json (states, transitions, guards item
 * for item, key order free) — the generator is the manifest's deterministic
 * function, and the hand-written template is the pinned reference shape.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateTemplate, generateTemplateFromManifest, stageStateName } from '../src/template.ts'
import { loadManifest } from '../src/manifest.ts'
import { jsonEquals } from '../src/schema.ts'

const DATASET_ROOT = join(import.meta.dirname, 'fixtures', 'dataset', 'datasets', 'harness-comparison')
const MANIFEST_PATH = join(DATASET_ROOT, 'manifest.yml')
const BENCH_V1 = JSON.parse(readFileSync(join(DATASET_ROOT, 'templates', 'bench-v1.json'), 'utf8')) as Record<string, unknown>

describe('generateTemplate — equivalence with the I1 hand-written bench-v1.json', () => {
  it('reproduces bench-v1.json exactly when given its stage subset, name, and mission batch', async () => {
    const { manifest } = await loadManifest(MANIFEST_PATH)
    const generated = generateTemplateFromManifest(manifest, {
      stages: ['stage1', 'stage2'],
      missions: BENCH_V1['missions'] as Array<{ id: string; title?: string; labels?: Record<string, string> }>,
      name: 'bench-v1',
    })
    // jsonEquals is object-key-order-insensitive but array-order-sensitive:
    // equality here means every state, every transition (and its guard), and
    // the mission batch match item for item, in order.
    expect(jsonEquals(generated, BENCH_V1)).toBe(true)
  })

  it('the same template comes from generateTemplate(manifestPath) — the file-based verb', async () => {
    const generated = await generateTemplate(MANIFEST_PATH, {
      stages: ['stage1', 'stage2'],
      missions: BENCH_V1['missions'] as Array<{ id: string; title?: string; labels?: Record<string, string> }>,
      name: 'bench-v1',
    })
    expect(jsonEquals(generated, BENCH_V1)).toBe(true)
  })
})

describe('generateTemplate — generation rules', () => {
  it('names stage states by manifest position (stage1 → stage-1)', async () => {
    const { manifest } = await loadManifest(MANIFEST_PATH)
    expect(stageStateName(manifest, 'stage1')).toBe('stage-1')
    expect(stageStateName(manifest, 'stage2')).toBe('stage-2')
    expect(() => stageStateName(manifest, 'no-such-stage')).toThrow('not declared')
  })

  it('the earliest transition carries the run-meta schema-check (datasetId, commit)', async () => {
    const template = await generateTemplate(MANIFEST_PATH, { stages: ['stage1', 'stage2'] })
    const first = template.transitions[0]
    expect(first).toEqual({
      from: 'pending',
      to: 'ws-ready',
      guard: { type: 'schema-check', schemaPath: '../schemas/run-meta.json', inputFrom: 'run-meta' },
    })
  })

  it('every stage exit carries the stage schema-check; the last stage exits to judged', async () => {
    const template = await generateTemplate(MANIFEST_PATH, { stages: ['stage1', 'stage2'] })
    expect(template.transitions.find(t => t.from === 'stage-1' && t.to === 'stage-2')?.guard).toEqual({
      type: 'schema-check',
      schemaPath: '../schemas/stage1.json',
    })
    expect(template.transitions.find(t => t.from === 'stage-2' && t.to === 'judged')?.guard).toEqual({
      type: 'schema-check',
      schemaPath: '../schemas/stage2.json',
    })
  })

  it('a halt_on stage generates the halted edge (const schema by naming convention) after the archive chain', async () => {
    const template = await generateTemplate(MANIFEST_PATH, { stages: ['stage1', 'stage2'] })
    const haltedEdge = template.transitions.find(t => t.to === 'halted')
    expect(haltedEdge).toEqual({
      from: 'stage-2',
      to: 'halted',
      guard: { type: 'schema-check', schemaPath: '../schemas/stage2-halted.json' },
    })
    // The halt edge is emitted last — after releasable → released, matching
    // the hand-written template's order.
    expect(template.transitions[template.transitions.length - 1]).toEqual(haltedEdge)
    expect(template.states).toContain('halted')
    expect(template.transitions.find(t => t.from === 'halted' && t.to === 'archived')).toBeDefined()
  })

  it('entering releasable carries the non-empty-archive file-check (workspace/, verdicts/)', async () => {
    const template = await generateTemplate(MANIFEST_PATH, { stages: ['stage1'] })
    expect(template.transitions.find(t => t.to === 'releasable')?.guard).toEqual({
      type: 'file-check',
      dir: 'archive',
      expectedFiles: ['workspace/', 'verdicts/'],
    })
    expect(template.releasableStates).toEqual(['releasable'])
  })

  it('without any halt_on stage the halted state and edge are absent', async () => {
    // stage1 has no halt_on; a single-stage selection therefore has no halt path.
    const template = await generateTemplate(MANIFEST_PATH, { stages: ['stage1'] })
    expect(template.states).not.toContain('halted')
    expect(template.transitions.find(t => t.to === 'halted')).toBeUndefined()
    // A single-stage chain: ws-ready → stage-1 → judged.
    expect(template.transitions.find(t => t.from === 'stage-1' && t.to === 'judged')).toBeDefined()
  })

  it('a stage whose structured schema is an inline draft (retired notation) is refused', async () => {
    await expect(generateTemplate(MANIFEST_PATH, { stages: ['stage1', 'stage3_4'] }))
      .rejects.toThrow('stage3_4')
    // The full manifest includes stage3/stage4, whose schemas live in the
    // combined inline `stage3_4` draft entry — generation refuses them.
    await expect(generateTemplate(MANIFEST_PATH)).rejects.toThrow('stage3')
  })

  it('an unknown stage id is refused', async () => {
    await expect(generateTemplate(MANIFEST_PATH, { stages: ['stage9'] })).rejects.toThrow('stage9')
  })
})
