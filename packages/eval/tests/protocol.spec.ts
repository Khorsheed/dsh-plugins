import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONDITION_SCHEMA,
  CONDITION_SCHEMA_ID,
  LOCK_SCHEMA,
  LOCK_SCHEMA_ID,
  PLAN_SCHEMA,
  PLAN_SCHEMA_ID,
  VERDICT_SCHEMA,
  VERDICT_SCHEMA_ID,
  jsonEquals,
  validateJson,
} from '../src/schema.ts'

/**
 * The dataset-authoring protocol is the schema publication of record: its §6
 * JSON blocks must equal the code constants (no drift), and its examples must
 * pass the validator they document. Both language editions are checked.
 */

const PACKAGE_ROOT = join(import.meta.dirname, '..')
const PROTOCOLS = [
  join(PACKAGE_ROOT, '../../docs/dataset-authoring-protocol.md'),
  join(PACKAGE_ROOT, '../../docs/dataset-authoring-protocol.en.md'),
]
const FIXTURE_DATASET_PLAN = join(PACKAGE_ROOT, 'tests/fixtures/dataset/datasets/harness-comparison/plans/i1-walk.json')

interface Block {
  schema?: unknown
  title?: unknown
  value: Record<string, unknown>
}

/** All ```json fenced blocks after the §6 heading (the eval contract chapter). */
function extractSectionSix(protocolPath: string): Block[] {
  const text = readFileSync(protocolPath, 'utf8')
  const start = text.search(/^## 6\./m)
  expect(start, `protocol ${protocolPath} has no §6`).toBeGreaterThanOrEqual(0)
  const section = text.slice(start)
  const blocks: Block[] = []
  for (const match of section.matchAll(/```json\n([\s\S]*?)```/g)) {
    blocks.push({ value: JSON.parse(match[1] as string) as Record<string, unknown> })
  }
  return blocks
}

const SCHEMA_BY_TITLE: Record<string, Record<string, unknown>> = {
  [CONDITION_SCHEMA_ID]: CONDITION_SCHEMA,
  [PLAN_SCHEMA_ID]: PLAN_SCHEMA,
  [VERDICT_SCHEMA_ID]: VERDICT_SCHEMA,
  [LOCK_SCHEMA_ID]: LOCK_SCHEMA,
}

/**
 * Example fixtures per schema, in the order the examples appear in §6. A
 * schema may publish several — the verdict chapter shows the plain boolean
 * verdict and the proportional one (`ratio`) — and each example is pinned to
 * its own fixture.
 */
const FIXTURES_BY_SCHEMA: Record<string, string[]> = {
  [CONDITION_SCHEMA_ID]: ['condition.example.json'],
  [LOCK_SCHEMA_ID]: ['lock.example.json'],
  [PLAN_SCHEMA_ID]: ['plan.example.json'],
  [VERDICT_SCHEMA_ID]: ['verdict.example.json', 'verdict-ratio.example.json'],
}

const EXAMPLE_COUNT = Object.values(FIXTURES_BY_SCHEMA).reduce((sum, list) => sum + list.length, 0)

describe('dataset-authoring protocol §6 — no drift between doc and code', () => {
  for (const protocolPath of PROTOCOLS) {
    it(`schema blocks equal the code constants and examples validate (${protocolPath.split('/').pop()})`, () => {
      const blocks = extractSectionSix(protocolPath)
      const schemaBlocks = blocks.filter(b => typeof b.value['title'] === 'string')
      const instanceBlocks = blocks.filter(b => typeof b.value['schema'] === 'string')

      // Four schema documents, verbatim.
      expect(schemaBlocks).toHaveLength(4)
      for (const block of schemaBlocks) {
        const title = block.value['title'] as string
        const code = SCHEMA_BY_TITLE[title]
        expect(code, `no code schema titled ${title}`).toBeDefined()
        expect(jsonEquals(block.value, code), `§6 ${title} drifted from the code schema`).toBe(true)
      }

      // Every example valid against its schema and identical to its fixture.
      expect(instanceBlocks).toHaveLength(EXAMPLE_COUNT)
      const seen: Record<string, number> = {}
      for (const block of instanceBlocks) {
        const schemaId = block.value['schema'] as string
        const schema = SCHEMA_BY_TITLE[schemaId]
        expect(schema, `no schema for ${schemaId}`).toBeDefined()
        expect(validateJson(schema, block.value), `§6 ${schemaId} example must validate`).toEqual([])
        const index = seen[schemaId] ?? 0
        seen[schemaId] = index + 1
        const fixture = FIXTURES_BY_SCHEMA[schemaId]?.[index]
        expect(fixture, `§6 publishes more ${schemaId} examples than there are fixtures`).toBeDefined()
        const fixturePath = join(PACKAGE_ROOT, 'tests/fixtures/protocol', fixture as string)
        expect(jsonEquals(block.value, JSON.parse(readFileSync(fixturePath, 'utf8'))), `${schemaId} example drifted from ${fixture as string}`).toBe(true)
      }
      // Every fixture is published; an orphan fixture is drift too.
      for (const [schemaId, fixtures] of Object.entries(FIXTURES_BY_SCHEMA)) {
        expect(seen[schemaId] ?? 0, `§6 publishes fewer ${schemaId} examples than there are fixtures`).toBe(fixtures.length)
      }
    })
  }

  it('both language editions carry identical §6 JSON blocks', () => {
    const [zh, en] = PROTOCOLS.map(extractSectionSix)
    expect(en).toHaveLength(zh.length)
    for (const [i, block] of zh.entries()) {
      expect(jsonEquals(block.value, en[i]?.value)).toBe(true)
    }
  })
})

describe('the T1 walk examples live in the fixtures verbatim', () => {
  const repo = join(homedir(), '.dsh/scratch/dataseek-eval')
  const repoCondition = join(repo, 'datasets/harness-comparison/conditions/dsh-exec.json')
  const fixtureCondition = join(PACKAGE_ROOT, 'tests/fixtures/dataset/datasets/harness-comparison/conditions/dsh-exec.json')

  it('the condition fixture equals the repo file (the repo is available when the walk ran here)', () => {
    if (!existsSync(repoCondition)) return // CI has no dataset repo checkout
    expect(jsonEquals(JSON.parse(readFileSync(fixtureCondition, 'utf8')), JSON.parse(readFileSync(repoCondition, 'utf8')))).toBe(true)
  })

  it('the plan fixture equals the repo file except the hermetic repo path', () => {
    const repoPlan = join(repo, 'datasets/harness-comparison/plans/i1-walk.json')
    if (!existsSync(repoPlan)) return
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DATASET_PLAN), 'utf8')) as Record<string, unknown>
    const original = JSON.parse(readFileSync(repoPlan, 'utf8')) as Record<string, unknown>
    const datasetFixture = fixture['dataset'] as Record<string, unknown>
    const datasetOriginal = original['dataset'] as Record<string, unknown>
    expect(datasetFixture['repo']).toBe('~/dsh-eval-t1-fixture-repo-absent')
    for (const key of Object.keys(datasetOriginal)) {
      if (key === 'repo') continue
      expect(datasetFixture[key]).toEqual(datasetOriginal[key])
    }
    delete fixture['dataset']
    delete original['dataset']
    expect(jsonEquals(fixture, original)).toBe(true)
  })
})

