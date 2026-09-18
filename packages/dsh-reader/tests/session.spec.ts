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
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  cachedTranslator,
  forgetSession,
  forgetTranslation,
  forgetTranslators,
  patchSession,
  readSession,
  rememberScroll,
  rememberTranslation,
  rememberTranslator,
  translationKey,
} from '../src/client/session.ts'
import type { TranslatorSessionLike } from '../src/client/translate.ts'

afterEach(() => {
  forgetSession('s1')
  forgetSession('s2')
  forgetSession('s3')
  forgetTranslators()
})

describe('the session snapshot', () => {
  it('has nothing to say about a session it has never seen', () => {
    expect(readSession('s1')).toEqual({})
  })

  it('merges one patch at a time instead of replacing the record', () => {
    patchSession('s1', { query: 'attention', sort: 'oldest' })
    patchSession('s1', { query: 'transformer' })
    expect(readSession('s1')).toEqual({ query: 'transformer', sort: 'oldest' })
  })

  it('keeps two sessions apart', () => {
    patchSession('s1', { query: 'one' })
    patchSession('s2', { query: 'two' })
    expect(readSession('s1').query).toBe('one')
    expect(readSession('s2').query).toBe('two')
  })

  it('drops a field patched with undefined rather than storing a hole', () => {
    patchSession('s1', { query: 'attention' })
    patchSession('s1', { query: undefined })
    expect(readSession('s1')).toEqual({})
  })

  it('caps how many sessions are remembered, dropping the least recently touched', () => {
    // The pane is mounted per session and the map lives for the page's whole
    // life, so an unbounded map is a leak in a long-lived tab.
    for (let index = 0; index < 12; index += 1) patchSession(`s-${String(index)}`, { query: `q${String(index)}` })
    patchSession('s-extra', { query: 'extra' })
    expect(readSession('s-0')).toEqual({})
    expect(readSession('s-extra').query).toBe('extra')
    expect(readSession('s-11').query).toBe('q11')
    for (let index = 1; index < 12; index += 1) forgetSession(`s-${String(index)}`)
    forgetSession('s-extra')
  })

  it('remembers a reading position per entry', () => {
    rememberScroll('s1', 'entry-a', 812.4)
    rememberScroll('s1', 'entry-b', 40)
    rememberScroll('s1', 'entry-a', -12)
    expect(readSession('s1').scroll).toEqual({ 'entry-a': 0, 'entry-b': 40 })
  })
})

describe('the translation record', () => {
  it('records the view and the language it was built for', () => {
    rememberTranslation('s1', 'entry-a', 'both', 'en')
    expect(readSession('s1').translationView).toEqual({ 'entry-a': 'both' })
    expect(readSession('s1').translationSource).toEqual({ 'entry-a': 'en' })
  })

  it('treats "original" as the globe being off', () => {
    rememberTranslation('s1', 'entry-a', 'trans', 'en')
    rememberTranslation('s1', 'entry-a', 'orig', 'en')
    // A record that outlived the reader's choice would switch the globe back on
    // over the original text.
    expect(readSession('s1').translationView).toEqual({})
    expect(readSession('s1').translationSource).toEqual({})
  })

  it('forgets one entry without touching the others', () => {
    rememberTranslation('s1', 'entry-a', 'trans', 'en')
    rememberTranslation('s1', 'entry-b', 'trans', 'de')
    forgetTranslation('s1', 'entry-a')
    expect(readSession('s1').translationView).toEqual({ 'entry-b': 'trans' })
    expect(readSession('s1').translationSource).toEqual({ 'entry-b': 'de' })
  })

  it('forgetting an entry with no record is a no-op', () => {
    rememberTranslation('s1', 'entry-b', 'trans', 'en')
    forgetTranslation('s1', 'entry-a')
    expect(readSession('s1').translationView).toEqual({ 'entry-b': 'trans' })
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
