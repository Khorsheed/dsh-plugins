/**
 * The page's memory of "where the reader was" (`client/session.ts`).
 *
 * The pane keeps this in module state because the host unmounts the whole right
 * sidebar when another panel takes over, and because the browser's Translator
 * API needs user activation to build a session — so a session that already
 * exists is the only thing that can bring a translation back without a click.
 * Both halves are pure maps, which is exactly why they are worth testing
 * directly: a wrong merge shows up here as a lost reading position rather than
 * as a screenshot somebody has to notice.
 *
 * There is no session id in this API on purpose: the reader is one person
 * reading one wall, and the pane is mounted per dsh session — keying the memory
 * by session made "open it in another conversation" start from scratch. The
 * cross-session case is asserted where it is observable, in the pane's own spec.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  cachedTranslator,
  forgetSession,
  forgetTranslation,
  forgetTranslators,
  patchSession,
  readSession,
  rememberReadingPosition,
  rememberTranslation,
  rememberTranslator,
  translationKey,
} from '../src/client/session.ts'
import type { TranslatorSessionLike } from '../src/client/translate.ts'

afterEach(() => {
  forgetSession()
  forgetTranslators()
})

describe('the page snapshot', () => {
  it('has nothing to say before the reader has done anything', () => {
    expect(readSession()).toEqual({})
  })

  it('merges one patch at a time instead of replacing the record', () => {
    patchSession({ query: 'attention', sort: 'oldest' })
    patchSession({ query: 'transformer' })
    expect(readSession()).toEqual({ query: 'transformer', sort: 'oldest' })
  })

  it('drops a field patched with undefined rather than storing a hole', () => {
    patchSession({ query: 'attention' })
    patchSession({ query: undefined })
    expect(readSession()).toEqual({})
  })

  it('remembers a reading position per entry, as an anchor', () => {
    // Not a bare pixel offset: the body's height is not final while an article's
    // images load, so the place is named as a block plus an offset into it.
    rememberReadingPosition('entry-a', { block: 12, offset: 812.4, top: 5000.6 })
    rememberReadingPosition('entry-b', { block: 0, offset: -40, top: 40 })
    expect(readSession().scroll).toEqual({
      'entry-a': { block: 12, offset: 812, top: 5001 },
      'entry-b': { block: 0, offset: 0, top: 40 },
    })
  })
})

describe('the translation record', () => {
  it('records the view and the language it was built for', () => {
    rememberTranslation('entry-a', 'both', 'en')
    expect(readSession().translationView).toEqual({ 'entry-a': 'both' })
    expect(readSession().translationSource).toEqual({ 'entry-a': 'en' })
  })

  it('treats "original" as the globe being off', () => {
    rememberTranslation('entry-a', 'trans', 'en')
    rememberTranslation('entry-a', 'orig', 'en')
    // A record that outlived the reader's choice would switch the globe back on
    // over the original text.
    expect(readSession().translationView).toEqual({})
    expect(readSession().translationSource).toEqual({})
  })

  it('forgets one entry without touching the others', () => {
    rememberTranslation('entry-a', 'trans', 'en')
    rememberTranslation('entry-b', 'trans', 'de')
    forgetTranslation('entry-a')
    expect(readSession().translationView).toEqual({ 'entry-b': 'trans' })
    expect(readSession().translationSource).toEqual({ 'entry-b': 'de' })
  })

  it('forgetting an entry with no record is a no-op', () => {
    rememberTranslation('entry-b', 'trans', 'en')
    forgetTranslation('entry-a')
    expect(readSession().translationView).toEqual({ 'entry-b': 'trans' })
  })
})

describe('the translator-session cache', () => {
  const fake = (label: string): TranslatorSessionLike => ({ label } as unknown as TranslatorSessionLike)

  it('keys a session by both sides of the pair', () => {
    expect(translationKey(['en'], ['zh', 'zh-Hans'])).toBe('en→zh,zh-Hans')
    expect(translationKey(['de', 'en'], ['zh'])).toBe('de,en→zh')
  })

  it('hands back the session the wall built to whoever asks for the same pair', () => {
    const built = fake('en→zh')
    rememberTranslator(['en'], ['zh'], built)
    // The detail view asks for the target spellings in the same order the wall
    // did; a different request is a different pair and must miss.
    expect(cachedTranslator(['en'], ['zh'])).toBe(built)
    expect(cachedTranslator(['en'], ['zh-Hans'])).toBeUndefined()
    expect(cachedTranslator(['de', 'en'], ['zh'])).toBeUndefined()
  })
})
