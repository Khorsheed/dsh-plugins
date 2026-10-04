/**
 * The content-preview kernel's contract (its README's rule): every
 * PREVIEW_KEYS key the pane can print must resolve in THIS package's own
 * dictionaries — a missing key is a test failure, not an English string in
 * a Chinese UI.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_KEYS } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

/** The zh dictionary's plain interpolation, for key resolution. */
function resolve(dict: Record<string, string>, key: string): string | undefined {
  return dict[key]
}

describe('the preview keys resolve in the story dictionaries', () => {
  it('every PREVIEW_KEYS key resolves in zh and en', () => {
    for (const key of PREVIEW_KEYS) {
      expect(resolve(zh, key), `zh is missing preview key ${key}`).toBeDefined()
      expect(resolve(en, key), `en is missing preview key ${key}`).toBeDefined()
    }
  })
})
