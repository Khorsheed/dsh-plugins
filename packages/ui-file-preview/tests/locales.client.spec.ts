import { describe, expect, it } from 'vitest'
import { en, zh, type FilePreviewKey } from '../src/client/locales.ts'

const EXPECTED_KEYS: readonly FilePreviewKey[] = [
  'open', 'guide.title', 'guide.description',
  'view.search.placeholder', 'view.search.noMatch',
  'list.empty', 'list.error', 'list.loading', 'list.refresh', 'list.outsideWorkspace',
  'history.title', 'history.empty', 'history.selectPrompt',
  'history.step', 'history.step.count', 'history.step.latest', 'history.step.older', 'history.step.newer',
  'turn.summary', 'turn.summaryOne', 'turn.expand', 'turn.collapse',
  'diff.copy', 'diff.copied', 'diff.collapse', 'diff.collapseAria', 'diff.expand', 'diff.expandAria', 'diff.files',
]

describe('file-preview dictionaries', () => {
  it('carry every declared key in both locales with non-empty copy', () => {
    for (const key of EXPECTED_KEYS) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })
})
