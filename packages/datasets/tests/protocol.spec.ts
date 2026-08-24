/**
 * Protocol-document consistency: every dataset.json example in the authoring
 * protocol (both languages) feeds the real validator, so the doc and the
 * implementation can never drift apart. The doc lives at docs/ (the repo's
 * Chinese-first convention: dataset-authoring-protocol.md + .en.md).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { descriptorWarnings, validateDescriptor } from '../src/dataset.ts'

const DOCS = join(__dirname, '../../../docs')

/** Extract the ```json fenced blocks of a markdown document. */
function jsonBlocks(path: string): unknown[] {
  const text = readFileSync(path, 'utf8')
  const blocks: unknown[] = []
  for (const match of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    blocks.push(JSON.parse(match[1] ?? ''))
  }
  return blocks
}

describe('the authoring protocol document', () => {
  for (const name of ['dataset-authoring-protocol.md', 'dataset-authoring-protocol.en.md']) {
    it(`${name}: the dataset.json example validates and warns about nothing`, () => {
      const descriptor = jsonBlocks(join(DOCS, name))
        .map(value => validateDescriptor(value, name))
        .find(candidate => candidate.register.length > 0)
      expect(descriptor).toBeDefined()
      // Every layer declares modelFacing explicitly (the protocol's own discipline).
      expect(descriptorWarnings(descriptor!)).toEqual([])
      expect(descriptor!.layers.map(layer => layer.name)).toEqual(['visible', 'verify', 'grading'])
      expect(descriptor!.register[0]).toEqual({
        item: 'P0-placeholder',
        layer: 'visible',
        files: ['task.md', 'docs/*.md'],
      })
    })
  }
})
