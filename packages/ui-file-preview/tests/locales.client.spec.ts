import { describe, expect, it } from 'vitest'
import { en, zh, type FilePreviewKey } from '../src/client/locales.ts'

const EXPECTED_KEYS: readonly FilePreviewKey[] = [
  'open', 'drawer.empty', 'drawer.listError', 'drawer.count',
  'drawer.op.read', 'drawer.op.write', 'drawer.op.edit', 'drawer.step',
  'drawer.previewEmpty', 'drawer.loading', 'drawer.kind.binary', 'drawer.kind.missing',
  'drawer.kind.tooLarge', 'drawer.kind.error', 'drawer.truncated',
  'drawer.tab.diff', 'drawer.tab.content', 'drawer.missingPath',
]

describe('file-preview dictionaries', () => {
  it('carry every declared key in both locales with non-empty copy', () => {
    for (const key of EXPECTED_KEYS) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })
})
