/**
 * The pure host-half logic: the daily-refresh clock, the payload classifier,
 * the URL policy, the state normalizer, and the ref formatting.
 *
 * None of these need a context, a filesystem or a network, which is exactly why
 * they live outside the service: the parts of the host half that decide
 * *behaviour* are testable without booting anything.
 */
import { describe, expect, it } from 'vitest'
import { classifyPayload, normalizeUrl } from '../src/service.ts'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReaderStore, ReaderStoreError, boundPayloads, emptyStateDoc, normalizeStateDoc, serializeStateDoc } from '../src/store.ts'
import { delayUntilNext, isCatchUpDue, nextOccurrence, parseTimeOfDay, previousOccurrence } from '../src/schedule.ts'
import { formatReaderRef, mergedDraft, provenanceOf, relativeWhen, absoluteDate } from '../src/client/quote.ts'
import { MAX_BODY_CHARS_PER_SOURCE } from '../src/types.ts'

describe('schedule', () => {
  it('parses HH:MM and falls back on anything unusable', () => {
    expect(parseTimeOfDay('07:05', '10:00')).toEqual({ hour: 7, minute: 5 })
    expect(parseTimeOfDay('7:5', '10:00')).toEqual({ hour: 10, minute: 0 })
    expect(parseTimeOfDay('25:00', '10:00')).toEqual({ hour: 10, minute: 0 })
    expect(parseTimeOfDay(undefined, '09:30')).toEqual({ hour: 9, minute: 30 })
    expect(parseTimeOfDay(undefined, undefined as unknown as string)).toEqual({ hour: 10, minute: 0 })
  })

  it('gives the next occurrence later today, else tomorrow', () => {
    const morning = new Date(2026, 8, 17, 8, 0, 0)
    expect(nextOccurrence(morning, '10:00').getDate()).toBe(17)
    expect(nextOccurrence(morning, '10:00').getHours()).toBe(10)
    const evening = new Date(2026, 8, 17, 22, 0, 0)
    expect(nextOccurrence(evening, '10:00').getDate()).toBe(18)
  })

  it('walks across a month end through the local calendar', () => {
    const lastDay = new Date(2026, 8, 30, 23, 0, 0)
    expect(nextOccurrence(lastDay, '10:00').getMonth()).toBe(9)
    expect(nextOccurrence(lastDay, '10:00').getDate()).toBe(1)
  })

  it('gives the most recent occurrence for the catch-up comparison', () => {
    const morning = new Date(2026, 8, 17, 8, 0, 0)
    expect(previousOccurrence(morning, '10:00').getDate()).toBe(16)
    const evening = new Date(2026, 8, 17, 22, 0, 0)
    expect(previousOccurrence(evening, '10:00').getDate()).toBe(17)
  })

  it('catches up only when a slot was missed, and never on a first boot', () => {
    const now = new Date(2026, 8, 17, 22, 0, 0)
    // Never refreshed: the first run belongs to the next slot or a user action.
    expect(isCatchUpDue(undefined, now, '10:00', true)).toBe(false)
    // Ran yesterday before today's slot: today's slot is due.
    expect(isCatchUpDue(new Date(2026, 8, 16, 10, 0, 0), now, '10:00', true)).toBe(true)
    // Already ran after today's slot.
    expect(isCatchUpDue(new Date(2026, 8, 17, 10, 0, 0), now, '10:00', true)).toBe(false)
    // Disabled schedules never catch up.
    expect(isCatchUpDue(new Date(2026, 8, 16, 10, 0, 0), now, '10:00', false)).toBe(false)
  })

  it('caps the timer delay for far-future slots', () => {
    const now = new Date(2026, 8, 17, 9, 59, 0)
    expect(delayUntilNext(now, '10:00')).toBe(60_000)
  })
})

describe('classifyPayload', () => {
  it('recognises the feed documents feeds actually serve', () => {
    expect(classifyPayload('<rss version="2.0"><channel/></rss>')).toBe('feed')
    expect(classifyPayload('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>')).toBe('feed')
    expect(classifyPayload('<rdf:RDF xmlns:rdf="x"><channel/></rdf:RDF>')).toBe('feed')
    expect(classifyPayload('\n  <?xml version="1.0"?>\n<rss><channel/></rss>')).toBe('feed')
  })

  it('treats anything else as a page', () => {
    expect(classifyPayload('<!doctype html><html><body>hi</body></html>')).toBe('page')
    expect(classifyPayload('{"json":true}')).toBe('page')
    expect(classifyPayload('')).toBe('page')
  })
})

describe('normalizeUrl', () => {
  it('accepts http(s) with a host', () => {
    expect(normalizeUrl(' https://example.com/feed.xml ')).toBe('https://example.com/feed.xml')
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/')
  })

  it('refuses other schemes and credentialed URLs', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeUrl('file:///etc/passwd')).toBeUndefined()
    expect(normalizeUrl('https://user:pw@example.com/feed')).toBeUndefined()
    expect(normalizeUrl('not a url')).toBeUndefined()
    expect(normalizeUrl('')).toBeUndefined()
  })
})

describe('state document', () => {
  it('round-trips through serialization', () => {
    const doc = emptyStateDoc()
    expect(normalizeStateDoc(JSON.parse(serializeStateDoc(doc)))).toEqual(doc)
    expect(serializeStateDoc(doc).endsWith('\n')).toBe(true)
  })

  it('drops sources that are not identifiable, keeps the rest', () => {
    const doc = normalizeStateDoc({
      version: 1,
      sources: [
        { id: 'a', url: 'https://example.com/a', kind: 'rss', addedAt: '2026-09-17T00:00:00.000Z' },
        { url: 'https://example.com/no-id' },
        { id: 'b' },
        'not an object',
      ],
      refresh: { enabled: false, timeOfDay: '07:15' },
      lastRefreshAt: '2026-09-17T10:00:00.000Z',
    })
    expect(doc.sources).toHaveLength(1)
    expect(doc.sources[0]?.id).toBe('a')
    expect(doc.sources[0]?.enabled).toBe(true)
    expect(doc.refresh).toEqual({ enabled: false, timeOfDay: '07:15' })
    expect(doc.lastRefreshAt).toBe('2026-09-17T10:00:00.000Z')
  })

  it('repairs an unusable refresh time instead of throwing', () => {
    const doc = normalizeStateDoc({ sources: [], refresh: { enabled: true, timeOfDay: 'noon-ish' } })
    expect(doc.refresh.timeOfDay).toBe('10:00')
  })

  it('bounds a single oversize payload and flags it', () => {
    const huge = 'x'.repeat(MAX_BODY_CHARS_PER_SOURCE + 5_000)
    const doc = normalizeStateDoc({
      sources: [{ id: 'a', url: 'https://example.com', kind: 'rss', addedAt: '2026-09-17T00:00:00.000Z', raw: huge }],
    })
    const bounded = boundPayloads(doc)
    expect(bounded.changed).toBe(true)
    expect(bounded.doc.sources[0]?.raw?.length).toBe(MAX_BODY_CHARS_PER_SOURCE)
    expect(bounded.doc.sources[0]?.truncated).toBe(true)
  })

  it('drops the oldest payloads first when the document is over budget', () => {
    const each = 'y'.repeat(MAX_BODY_CHARS_PER_SOURCE)
    const older = (day: number): string => `2026-09-${`${day}`.padStart(2, '0')}T00:00:00.000Z`
    const sources = Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`,
      url: `https://example.com/${index}`,
      kind: 'rss' as const,
      addedAt: older(1),
      fetchedAt: older(index + 1),
      raw: each,
    }))
    const bounded = boundPayloads({ ...emptyStateDoc(), sources })
    const kept = bounded.doc.sources.filter(source => source.raw !== undefined)
    const dropped = bounded.doc.sources.filter(source => source.raw === undefined)
    expect(dropped.length).toBeGreaterThan(0)
    // What survives is the most recently fetched material: every evicted
    // payload is older than every surviving one.
    expect(kept.length).toBeLessThan(10)
    const newestDropped = dropped.map(source => source.fetchedAt ?? '').sort().at(-1) ?? ''
    const oldestKept = kept.map(source => source.fetchedAt ?? '').sort()[0] ?? ''
    expect(newestDropped < oldestKept).toBe(true)
    // Every source survives; only the older payloads are evicted.
    expect(bounded.doc.sources).toHaveLength(10)
  })
})

describe('ref formatting', () => {
  const provenance = provenanceOf(
    { title: 'A title', author: 'Ada', publishedAt: '2026-09-10T09:00:00.000Z', link: 'https://example.com/a' },
    { label: 'Example' },
  )

  it('quotes the passage and names where it came from', () => {
    const block = formatReaderRef('First line\nSecond line', provenance)
    expect(block).toContain('> First line\n> Second line')
    expect(block).toContain('《A title》')
    expect(block).toContain('Example')
    expect(block).toContain('Ada')
    expect(block).toContain('2026-09-10')
    expect(block).toContain('https://example.com/a')
  })

  it('falls back to the title when the passage is blank', () => {
    expect(formatReaderRef('   ', provenance)).toContain('> A title')
  })

  it('appends with a blank line, and replaces an empty draft outright', () => {
    expect(mergedDraft('', 'BLOCK')).toBe('BLOCK')
    expect(mergedDraft('existing', 'BLOCK')).toBe('existing\n\nBLOCK')
    expect(mergedDraft('existing\n\n', 'BLOCK')).toBe('existing\n\nBLOCK')
  })

  it('formats relative and absolute dates without a clock dependency', () => {
    const now = new Date('2026-09-17T12:00:00.000Z')
    expect(relativeWhen('2026-09-17T11:59:30.000Z', now)).toEqual({ key: 'when.justNow' })
    expect(relativeWhen('2026-09-17T11:30:00.000Z', now)).toEqual({ key: 'when.minutes', count: 30 })
    expect(relativeWhen('2026-09-17T06:00:00.000Z', now)).toEqual({ key: 'when.hours', count: 6 })
    expect(relativeWhen('2026-09-16T06:00:00.000Z', now)).toEqual({ key: 'when.yesterday' })
    expect(relativeWhen('2026-09-10T06:00:00.000Z', now)).toEqual({ key: 'when.days', count: 7 })
    expect(relativeWhen(undefined, now)).toEqual({ key: 'when.justNow' })
    expect(absoluteDate('2026-09-10T09:00:00.000Z')).toBe('2026-09-10')
    expect(absoluteDate('nonsense')).toBeUndefined()
  })
})


describe('the native state store', () => {
  /** A throwaway state root. */
  const root = (): string => mkdtempSync(join(tmpdir(), 'dsh-reader-store-'))

  it('round-trips a document and leaves no temporary file behind', async () => {
    const dir = root()
    try {
      const store = new ReaderStore({ stateRoot: dir })
      expect(store.available).toBe(true)
      expect((await store.read()).doc.sources).toEqual([])
      const doc = { ...emptyStateDoc(), sources: [{ id: 'a', kind: 'rss' as const, url: 'https://example.com', label: 'a', enabled: true, addedAt: '2026-09-17T00:00:00.000Z', raw: '<rss/>' }] }
      await store.update(() => doc)
      expect((await store.read()).doc.sources).toHaveLength(1)
      // The write is temp+rename, so the state root holds exactly one file.
      expect(readdirSync(dir)).toEqual(['state.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads a missing file as empty and refuses a corrupt one', async () => {
    const dir = root()
    try {
      const store = new ReaderStore({ stateRoot: dir })
      expect((await store.read()).doc.sources).toEqual([])
      writeFileSync(join(dir, 'state.json'), '{ this is not json')
      // Refuse rather than clobber: the file is the user's subscriptions.
      await expect(store.update(doc => doc)).rejects.toBeInstanceOf(ReaderStoreError)
      await expect(store.read()).rejects.toMatchObject({ kind: 'corrupt' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('degrades to memory-only when the state root cannot be created', () => {
    // A file where a directory must be: mkdir fails, and the store must report
    // that instead of throwing through a boot.
    const parent = root()
    try {
      const file = join(parent, 'not-a-dir')
      writeFileSync(file, 'x')
      const store = new ReaderStore({ stateRoot: join(file, 'state') })
      expect(store.available).toBe(false)
      expect(store.unavailableReason).toContain('not-a-dir')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})


describe('the tool row cannot overlap itself', () => {
  it('pins the flex constraints that the search box violated', () => {
    // jsdom has no layout engine, so this asserts the CONSTRAINT instead of a
    // measured rectangle — which is exactly the level both bugs lived at.
    // Without a floor under it, the flexed search box's input refuses to shrink
    // and whatever sits beside it gets pushed out of the row (observed on the
    // acceptance instance: the segmented control covered 全部).
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'ReaderPane.module.css'), 'utf8')
    const search = /\.search\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    // `flex-basis: 0` (not `auto`): the field's width comes from the row's free
    // space, never from its own content, and `min-width` is a real floor rather
    // than 0 so the field cannot collapse into an unreadable sliver either.
    expect(search).toMatch(/flex:\s*1 1 0/)
    expect(search).toMatch(/min-width:\s*44px/)
    const input = /\.search input\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(input).toMatch(/min-width:\s*0/)
    // Both icon tools share one non-shrinking box, so neither can be squeezed
    // out by the other's state.
    const toolWrap = /\.toolWrap\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(toolWrap).toMatch(/flex:\s*none/)
    expect(toolWrap).toMatch(/position:\s*relative/)
    // …and each popover is anchored to the button that opened it. The old panes
    // were positioned at a magic `top: 62px` on the PANE — shorter than the
    // toolbar itself, so opening the filter covered the sort button.
    for (const pane of ['\\.menu', '\\.filterPanel']) {
      const block = new RegExp(`${pane}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
      expect(block).toMatch(/top:\s*calc\(100% \+ 4px\)/)
      expect(block).toMatch(/right:\s*0/)
    }
    // A percentage max-height would resolve against the 26px `.toolWrap` the
    // panel hangs inside rather than against the pane, and the filter panel
    // rendered as a one-row sliver with a scrollbar until this moved to
    // viewport units (observed on the acceptance instance, 2026-09-18).
    const panel = /\.filterPanel\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(panel).toMatch(/max-height:\s*min\(62vh,\s*440px\)/)
    expect(panel).not.toMatch(/max-height:\s*\d+%/)
  })
})

describe('the translated article reads like content', () => {
  it('keeps the English original at body-adjacent size in the secondary ink', () => {
    // The first version set the reveal at 11.5px in the tertiary ink with 5px
    // gaps; the reader reported the English as too small and sparse. These are
    // the constraints that fixed it, and they are easy to undo by accident.
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'ReaderPane.module.css'), 'utf8')
    const line = /\.revealLine\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(line).toMatch(/font-size:\s*13\.5px/)
    expect(line).toMatch(/line-height:\s*1\.62/)
    expect(line).toMatch(/margin:\s*0 0 3px/)
    expect(line).toMatch(/color:\s*var\(--dsw-alias-label-secondary\)/)
    // The reveal hugs the paragraph it belongs to and is separated from the next
    // block: a top margin larger than the bottom one read as "glued to the
    // wrong paragraph".
    const reveal = /\.reveal\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(reveal).toMatch(/margin:\s*-8px 0 14px/)
    // The pairing mark: an opened sentence's original is lit, and the sentence
    // it belongs to is underlined on the translated side.
    expect(css).toMatch(/\.revealLine\[data-open\]/)
    expect(css).toMatch(/\.unit\[data-open\]/)
  })
})

describe('the article body follows the pane', () => {
  it('does not cap prose at a measure the lists ignore', () => {
    // The retired rule was `max-width: min(100%, 46em)` on paragraphs only, so
    // prose stopped short while lists ran the full column: a ragged right edge
    // that read as a layout bug on the acceptance instance. The sidebar IS the
    // measure (decided with the user, 2026-09-18) — if a measure comes back, it
    // has to come back for every block, not just `p`.
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'ReaderPane.module.css'), 'utf8')
    expect(css).not.toMatch(/\.articleZh p\s*\{[^}]*max-width/)
    expect(css).not.toMatch(/\.articleEn p\s*\{[^}]*max-width/)
  })
})

describe('the tag panel is placed from its own box', () => {
  it('keeps the CSS box in step with the placement constants', () => {
    // The panel is `position: fixed` and the pane decides above-vs-below from
    // its size, so the two numbers live in different files on purpose. If they
    // drift, the panel opens off-screen near the bottom of a short sidebar.
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'ReaderPane.module.css'), 'utf8')
    const panel = /\.cardTagPanel\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(panel).toMatch(/width:\s*236px/)
    expect(panel).toMatch(/max-height:\s*296px/)
    const pane = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'ReaderPane.tsx'), 'utf8')
    expect(pane).toMatch(/TAG_PANEL_WIDTH = 236/)
    expect(pane).toMatch(/TAG_PANEL_MAX_HEIGHT = 296/)
  })
})
