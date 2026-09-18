// @vitest-environment jsdom
/**
 * The on-device translation module, at the two levels it can be wrong:
 *
 * - **Sentence splitting**, where a wrong split hands the model two broken
 *   half-sentences and one oversized unit only costs granularity. The cases
 *   below are the ones real article prose actually contains: abbreviations,
 *   initials, decimals, "U.S.", Chinese terminators, and a run with no
 *   terminator at all.
 * - **The DOM surgery**, where the promise is that the ORIGINAL document comes
 *   back byte for byte and that a link inside a sentence survives. A translation
 *   that reformats the article would be worse than no translation.
 *
 * The driver's own contract is the third level: a batch whose separator comes
 * back altered must degrade to one unit per request, never to wrong text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TARGET_CANDIDATES,
  UNIT_SEPARATOR,
  applyTranslation,
  buildArticle,
  clearMemory,
  createSession,
  detectLanguageDetector,
  detectSourceLanguage,
  detectTranslator,
  isUnsupported,
  remembered,
  restoreArticle,
  runTranslation,
  segmentAt,
  setView,
  splitSentences,
  toggleSegment,
  type BuiltArticle,
  type TranslateClasses,
  type TranslatorLike,
  type TranslatorSessionLike,
} from '../src/client/translate.ts'

const CLASSES: TranslateClasses = { unit: 'u', reveal: 'r', line: 'l' }

/** A host-like article: prose with an inline link, a list, and a code block. */
function article(): HTMLDivElement {
  const root = document.createElement('div')
  root.innerHTML = [
    '<p>The team built new evaluations. They measure targeting, e.g. drone strikes.</p>',
    '<p>See the <a href="https://example.com/x">best-studied domains</a> of risk from misuse.</p>',
    '<ul><li>First point about models.</li><li>Second point about actors.</li></ul>',
    '<pre><code>const a = 1. Do not translate this sentence.</code></pre>',
  ].join('')
  document.body.append(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
  clearMemory()
  vi.restoreAllMocks()
})

describe('sentence splitting', () => {
  it('splits plain prose and keeps the spacing inside the pieces', () => {
    const pieces = splitSentences('One thing happened. Then another thing happened.')
    expect(pieces.map(piece => piece.core)).toEqual(['One thing happened.', 'Then another thing happened.'])
    // Joining the pieces reproduces the run exactly, which is what the DOM
    // restore path depends on.
    expect(pieces.map(piece => piece.text).join('')).toBe('One thing happened. Then another thing happened.')
  })

  it('refuses to split abbreviations, initials and decimals', () => {
    const cases = [
      'Dr. Smith led the team.',
      'The U.S. and the U.K. disagree.',
      'It grew 3.5 times.',
      'A. B. Jones wrote it.',
      'Use the API, i.e. the wire face.',
    ]
    for (const text of cases) {
      expect(splitSentences(text).length).toBe(1)
    }
  })

  it('splits CJK terminators and question runs', () => {
    expect(splitSentences('第一句。第二句！').map(piece => piece.core)).toEqual(['第一句。', '第二句！'])
    expect(splitSentences('Really?! Yes.').map(piece => piece.core)).toEqual(['Really?!', 'Yes.'])
  })

  it('returns one piece when there is no terminator at all', () => {
    const pieces = splitSentences('a title without a full stop')
    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.core).toBe('a title without a full stop')
  })
})

describe('article segmentation', () => {
  it('wraps sentences, keeps links and code, and restores the original exactly', () => {
    const root = article()
    const before = root.innerHTML
    const built = buildArticle(root, CLASSES)
    expect(built).not.toBeNull()
    const units = root.querySelectorAll('[data-reader-unit]')
    // 2 + 3 prose units plus the 2 list items; the code block is never touched.
    expect(units.length).toBe(7)
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/x')
    expect(root.querySelector('pre code')?.textContent).toContain('Do not translate this sentence.')
    expect(root.querySelectorAll('[data-reader-unit] pre, pre [data-reader-unit]').length).toBe(0)
    restoreArticle(root)
    expect(root.innerHTML).toBe(before)
  })

  it('segments a body that is bare text, with no wrapping block', () => {
    // extract-article emits this shape for a one-line feed item, and skipping it
    // made a whole article refuse to translate ("nothing in this body").
    const root = document.createElement('div')
    root.innerHTML = 'First sentence here. Second sentence here.'
    document.body.append(root)
    const before = root.innerHTML
    const built = buildArticle(root, CLASSES)
    expect(built).not.toBeNull()
    expect(root.querySelectorAll('[data-reader-unit]').length).toBe(2)
    const seg = built!.blocks[0]!.segments[0]!
    applyTranslation(built!, seg, '译：第一句')
    setView(built!, 'trans', CLASSES)
    toggleSegment(built!, seg, CLASSES)
    // The reveal follows the run it belongs to, still inside the article.
    expect(root.querySelector('[data-reader-reveal]')?.textContent).toBe('First sentence here.')
    expect(root.textContent).toContain('译：第一句')
    restoreArticle(root)
    expect(root.innerHTML).toBe(before)
  })

  it('is idempotent: a second build returns the first segmentation', () => {
    const root = article()
    const first = buildArticle(root, CLASSES)
    const second = buildArticle(root, CLASSES)
    expect(second).toBe(first)
    expect(root.querySelectorAll('[data-reader-unit]').length).toBe(7)
  })

  it('applies a translation, shows the view, and reveals one sentence on click', () => {
    const root = article()
    const built = buildArticle(root, CLASSES) as BuiltArticle
    for (const block of built.blocks) {
      for (const segment of block.segments) applyTranslation(built, segment, `译:${segment.original}`)
    }
    setView(built, 'trans', CLASSES)
    expect(root.textContent).toContain('译:The team built new evaluations.')
    // No reveals while the view is translation-only.
    expect(root.querySelectorAll('[data-reader-reveal]').length).toBe(0)
    const first = built.blocks[0]!.segments[0]!
    expect(segmentAt(built, first.span)).toBe(first)
    toggleSegment(built, first, CLASSES)
    const reveal = root.querySelector('[data-reader-reveal]')
    expect(reveal?.textContent).toBe('The team built new evaluations.')
    expect(first.span.getAttribute('data-open')).toBe('1')
    // …and clicking again takes it away.
    toggleSegment(built, first, CLASSES)
    expect(root.querySelector('[data-reader-reveal]')).toBeNull()
  })

  it('shows every original under its block in the side-by-side view', () => {
    const root = article()
    const built = buildArticle(root, CLASSES) as BuiltArticle
    setView(built, 'both', CLASSES)
    const reveals = root.querySelectorAll('[data-reader-reveal]')
    expect(reveals.length).toBe(4)
    expect(reveals[0]?.textContent).toContain('The team built new evaluations.')
    // The list items open their container instead of a sibling.
    expect(root.querySelector('li [data-reader-reveal]')).not.toBeNull()
  })

  it('puts the original text back in the original-only view', () => {
    const root = article()
    const built = buildArticle(root, CLASSES) as BuiltArticle
    const segment = built.blocks[0]!.segments[0]!
    applyTranslation(built, segment, '译:第一句')
    setView(built, 'trans', CLASSES)
    expect(root.textContent).toContain('译:第一句')
    setView(built, 'orig', CLASSES)
    expect(root.textContent).toContain('The team built new evaluations.')
    expect(root.textContent).not.toContain('译:第一句')
    expect(root.getAttribute('data-reader-translated')).toBe('orig')
  })
})

describe('the translation driver', () => {
  /** A session whose `translate` is scripted per call. */
  function session(script: (payload: string) => string): TranslatorSessionLike {
    return {
      inputQuota: 10_000,
      measureInputUsage: async (text: string) => text.length,
      translate: async (payload: string) => script(payload),
    }
  }

  it('translates a batch in one request and remembers the result', async () => {
    const root = article()
    const built = buildArticle(root, CLASSES) as BuiltArticle
    const seen: string[] = []
    const result = await runTranslation({
      built,
      session: session(payload => {
        seen.push(payload)
        return payload.split(UNIT_SEPARATOR).map(part => `译:${part}`).join(UNIT_SEPARATOR)
      }),
      cancelled: () => false,
    })
    expect(result.done).toBe(7)
    expect(result.failed).toBe(0)
    // Seven short units fit one batch.
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain(UNIT_SEPARATOR)
    expect(root.textContent).toContain('译:The team built new evaluations.')
    expect(remembered('The team built new evaluations.')).toBe('译:The team built new evaluations.')
  })

  it('falls back to one unit per request when the separator comes back altered', async () => {
    const root = article()
    const built = buildArticle(root, CLASSES) as BuiltArticle
    const calls: string[] = []
    const result = await runTranslation({
      built,
      session: session(payload => {
        calls.push(payload)
        // A model that ate the separator: the batch cannot be split back, so the
        // driver must re-send unit by unit rather than guess an alignment.
        return payload.split(UNIT_SEPARATOR).map(part => `译:${part}`).join(' ')
      }),
      cancelled: () => false,
    })
    expect(result.done).toBe(7)
    expect(result.failed).toBe(0)
    expect(calls).toHaveLength(8) // one batch, then one request per unit
    expect(calls[1]).toBe('The team built new evaluations.')
    expect(root.textContent).toContain('译:See the')
  })

  it('counts a failing unit instead of losing the whole article', async () => {
    const root = article()
    const built = buildArticle(root, CLASSES) as BuiltArticle
    let call = 0
    const result = await runTranslation({
      built,
      session: session(payload => {
        call += 1
        if (call === 1) return payload.split(UNIT_SEPARATOR).map(part => `译:${part}`).join(' ')
        if (payload.startsWith('The team built')) throw new Error('provider said no')
        return `译:${payload}`
      }),
      cancelled: () => false,
    })
    expect(result.failed).toBe(1)
    expect(result.done).toBe(6)
    // The failing sentence keeps its original text: never a hole in the body.
    expect(root.textContent).toContain('The team built new evaluations.')
  })

  it('paints remembered units without another request', async () => {
    const first = article()
    const builtFirst = buildArticle(first, CLASSES) as BuiltArticle
    await runTranslation({
      built: builtFirst,
      session: session(payload => payload.split(UNIT_SEPARATOR).map(part => `译:${part}`).join(UNIT_SEPARATOR)),
      cancelled: () => false,
    })
    const second = article()
    const builtSecond = buildArticle(second, CLASSES) as BuiltArticle
    const translate = vi.fn(async (payload: string) => payload)
    const result = await runTranslation({
      built: builtSecond,
      session: { inputQuota: 10_000, measureInputUsage: async (text: string) => text.length, translate },
      cancelled: () => false,
    })
    expect(translate).not.toHaveBeenCalled()
    expect(result.done).toBe(7)
    expect(second.textContent).toContain('译:The team built new evaluations.')
  })

  it('stops between batches when the reader cancels', async () => {
    // Enough sentences to force two batches (the batch cap is 12 units).
    const root = document.createElement('div')
    root.innerHTML = `<p>${Array.from({ length: 15 }, (_, index) => `Sentence number ${index + 1} is here.`).join(' ')}</p>`
    document.body.append(root)
    const built = buildArticle(root, CLASSES) as BuiltArticle
    expect(built.blocks[0]?.segments).toHaveLength(15)
    let cancelled = false
    const result = await runTranslation({
      built,
      session: session(payload => {
        cancelled = true
        return payload.split(UNIT_SEPARATOR).map(part => `译:${part}`).join(UNIT_SEPARATOR)
      }),
      cancelled: () => cancelled,
    })
    // The first batch lands, the second never leaves the browser.
    expect(result.done).toBe(12)
    expect(root.textContent).toContain('译:Sentence number 12 is here.')
    expect(root.textContent).toContain('Sentence number 15 is here.')
    expect(root.textContent).not.toContain('译:Sentence number 15 is here.')
  })
})

describe('feature detection', () => {
  it('reads the page global, and answers null when it is absent or unusable', () => {
    expect(detectTranslator({})).toBeNull()
    expect(detectTranslator({ Translator: {} })).toBeNull()
    const api = { availability: async () => 'available', create: async () => { throw new Error('unused') } }
    expect(detectTranslator({ Translator: api })).toBe(api)
  })

  it('detects the language detector only when it is usable', () => {
    expect(detectLanguageDetector({})).toBeNull()
    expect(detectLanguageDetector({ LanguageDetector: { availability: async () => 'available' } })).toBeNull()
    const api = { availability: async () => 'available', create: async () => ({ detect: async () => [] }) }
    expect(detectLanguageDetector({ LanguageDetector: api })).toBe(api)
  })
})

describe('the source language probe', () => {
  it('prefers the browser detector when it is confident', async () => {
    const scope = {
      LanguageDetector: {
        availability: async () => 'available',
        create: async () => ({ detect: async () => [{ detectedLanguage: 'de', confidence: 0.93 }] }),
      },
    }
    const previous = (globalThis as { LanguageDetector?: unknown }).LanguageDetector
    ;(globalThis as { LanguageDetector?: unknown }).LanguageDetector = scope.LanguageDetector
    try {
      expect(await detectSourceLanguage('Ein langer deutscher Satz über Modelle und Risiken.', 'en')).toBe('de')
    } finally {
      if (previous === undefined) delete (globalThis as { LanguageDetector?: unknown }).LanguageDetector
      else (globalThis as { LanguageDetector?: unknown }).LanguageDetector = previous
    }
  })

  it('falls back to the caller guess when detection is absent, unsure or failing', async () => {
    expect(await detectSourceLanguage('A long enough English sentence about models.', 'en')).toBe('en')
    const previous = (globalThis as { LanguageDetector?: unknown }).LanguageDetector
    ;(globalThis as { LanguageDetector?: unknown }).LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async () => [{ detectedLanguage: 'fr', confidence: 0.2 }] }),
    }
    try {
      expect(await detectSourceLanguage('A long enough English sentence about models.', 'en')).toBe('en')
    } finally {
      if (previous === undefined) delete (globalThis as { LanguageDetector?: unknown }).LanguageDetector
      else (globalThis as { LanguageDetector?: unknown }).LanguageDetector = previous
    }
  })
})

describe('creating a translator across candidate pairs', () => {
  /** An API whose `create` refuses the pairs in `reject`. */
  function api(reject: string[], options: { availability?: string } = {}): TranslatorLike & { calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      availability: async () => options.availability ?? 'available',
      create: async ({ sourceLanguage, targetLanguage }) => {
        const pair = `${sourceLanguage}→${targetLanguage}`
        calls.push(pair)
        if (reject.includes(pair)) {
          throw new DOMException('Unable to create translator for the given source and target language.', 'NotSupportedError')
        }
        return { inputQuota: 1000, measureInputUsage: async (text: string) => text.length, translate: async (text: string) => text }
      },
    }
  }

  it('falls through to the next target spelling when a pair is rejected', async () => {
    const underTest = api(['en→zh'])
    expect(TARGET_CANDIDATES[1]).toBe('zh-Hans')
    const outcome = await createSession(underTest, { sources: ['en'], targets: TARGET_CANDIDATES })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.targetLanguage).toBe('zh-Hans')
    expect(underTest.calls).toEqual(['en→zh', 'en→zh-Hans'])
  })

  it('tries the detected source before the fallback one', async () => {
    const underTest = api(['de→zh', 'de→zh-Hans'])
    const outcome = await createSession(underTest, { sources: ['de', 'en'], targets: TARGET_CANDIDATES })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.sourceLanguage).toBe('en')
    expect(underTest.calls).toEqual(['de→zh', 'de→zh-Hans', 'en→zh'])
  })

  it('reports an unsupported pair as permanent, with the pairs it tried', async () => {
    const underTest = api(['en→zh', 'en→zh-Hans'])
    const outcome = await createSession(underTest, { sources: ['en'], targets: TARGET_CANDIDATES })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.unsupported).toBe(true)
      expect(outcome.attempts.map(attempt => attempt.targetLanguage)).toEqual(['zh', 'zh-Hans'])
      expect(outcome.attempts[0]?.reason).toContain('NotSupportedError')
    }
  })

  it('does not call a download or quota failure permanent', async () => {
    const failing: TranslatorLike = {
      availability: async () => 'downloadable',
      create: async () => { throw new DOMException('The download failed.', 'NetworkError') },
    }
    const outcome = await createSession(failing, { sources: ['en'], targets: ['zh'] })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.unsupported).toBe(false)
    expect(isUnsupported(new DOMException('nope', 'NetworkError'))).toBe(false)
    expect(isUnsupported(new DOMException('x', 'NotSupportedError'))).toBe(true)
    expect(isUnsupported(new Error('Unable to create translator for the given source and target language.'))).toBe(true)
  })

  it('skips a pair the browser already calls unavailable', async () => {
    const underTest = { calls: [] as string[], availability: async () => 'unavailable', create: async () => { throw new Error('must not run') } }
    const outcome = await createSession(underTest, { sources: ['en'], targets: ['zh'] })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.attempts[0]?.reason).toBe('unavailable')
  })
})
