// @vitest-environment jsdom
/**
 * Truncated-feed salvage.
 *
 * The host's egress seam caps a payload at ~100,000 characters and truncates
 * silently. A cap that lands mid-tag makes the WHOLE document malformed, and a
 * parser that answers "malformed, nothing to show" throws away every entry that
 * closed before the cut. Measured on the acceptance instance: a 646,905-
 * character feed arrived with one complete item and one cut in half, and the
 * wall showed nothing at all.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFeed } from '../src/client/parse-rss.ts'

/** The committed fixture: real namespace declarations, one item cut mid-body. */
const TRUNCATED = readFileSync(join(import.meta.dirname, 'fixtures', 'feed-truncated.xml'), 'utf8')

/** An item with a body big enough to push the cut wherever a test wants it. */
function item(title: string, bodyChars: number): string {
  return `<item><title>${title}</title><link>https://example.com/${title}</link>`
    + `<pubDate>Thu, 10 Sep 2026 00:00:00 +0000</pubDate>`
    + `<description><![CDATA[<p>${'x'.repeat(bodyChars)}</p>]]></description></item>`
}

/** A feed document, optionally cut at a character offset. */
function feed(items: string[], cutAt?: number): string {
  const doc = `<?xml version="1.0"?><rss version="2.0"><channel><title>probe</title>${items.join('')}</channel></rss>`
  return cutAt === undefined ? doc : doc.slice(0, cutAt)
}

describe('a feed the host capped', () => {
  it('keeps every item that closed before the cut', () => {
    // Two small items, then a third whose body pushes the document past the
    // cut — the acceptance instance's exact shape.
    const doc = feed([item('first', 20), item('second', 20), item('third', 5_000)])
    const cut = doc.indexOf('<item><title>third') + 100
    const result = parseFeed(feed([item('first', 20), item('second', 20), item('third', 5_000)], cut), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const titles = result.feed.entries.map(entry => entry.title)
    expect(titles).toEqual(['first', 'second', 'third'])
    expect(result.feed.incomplete).toBe(true)
    // The third entry is the one the cut landed inside: flagged, so the detail
    // view says "content shown in part" instead of presenting half a page as
    // the whole thing.
    expect(result.feed.entries[2]?.partial).toBe(true)
    expect(result.feed.entries[0]?.partial).toBeUndefined()
  })

  it('reports the parser complaint as the reason, not as a failure', () => {
    const doc = feed([item('only', 4_000)])
    const cut = doc.indexOf('x'.repeat(10)) + 50
    const result = parseFeed(doc.slice(0, cut), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.incompleteReason).toMatch(/malformed XML/)
  })

  it('still recovers a title when the repair itself cannot parse', () => {
    // A cut inside the markup the repair cannot save: the reader should still
    // get a card it can open, with the original page as the way to finish.
    const cut = feed([item('recoverable', 30)]).indexOf(']]>')
    const result = parseFeed(feed([item('recoverable', 30)]).slice(0, cut + 2), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.entries.length).toBeGreaterThanOrEqual(1)
    expect(result.feed.entries[0]?.link).toBe('https://example.com/recoverable')
  })

  it('refuses a payload with nothing salvageable rather than pretending', () => {
    const result = parseFeed('<rss version="2.0"><channel><tit', 's1')
    expect(result.ok).toBe(false)
  })

  it('leaves a complete feed exactly as it was', () => {
    const result = parseFeed(feed([item('a', 10), item('b', 10)]), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.incomplete).toBeUndefined()
    expect(result.feed.entries.map(entry => entry.title)).toEqual(['a', 'b'])
    expect(result.feed.entries.every(entry => entry.partial === undefined)).toBe(true)
  })

  it('recovers the real cap shape: a complete item plus a cut-off one', () => {
    // This is the acceptance instance's payload in miniature — prefixed
    // elements (`content:encoded`, `dc:creator`) and a namespace-declaring
    // root, which is what a naive fragment parse cannot handle: without the
    // root's `xmlns:content`, even the COMPLETE item is malformed XML and is
    // lost with the broken one.
    const result = parseFeed(TRUNCATED, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.incomplete).toBe(true)
    const [complete, cutOff] = result.feed.entries
    expect(complete?.title).toBe('Measuring tactical intelligence targeting')
    expect(complete?.partial).toBeUndefined()
    expect(complete?.publishedAt?.slice(0, 10)).toBe('2026-09-10')
    expect(complete?.author).toBe('Frontier Red Team')
    expect(complete?.contentHtml).toContain('unauthorized access during a cyber evaluation')
    expect(cutOff?.title).toBe('An alignment assessment of recent cybersecurity incidents')
    expect(cutOff?.partial).toBe(true)
    // The cut item still shows what arrived, which is the whole point: the
    // reader gets the beginning of the article and the original-page button,
    // instead of an empty card or no card at all.
    expect(cutOff?.contentHtml).toContain('We present an alignment assessment')
    expect(cutOff?.link).toBe('https://example.com/research/alignment-assessment')
  })

  it('salvages an Atom feed the same way', () => {
    const entry = (title: string, pad: number): string =>
      `<entry><title>${title}</title><link href="https://example.com/${title}"/><content>${'y'.repeat(pad)}</content></entry>`
    const doc = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>probe</title>${entry('one', 10)}${entry('two', 4_000)}</feed>`
    const result = parseFeed(doc.slice(0, doc.indexOf('y'.repeat(20)) + 30), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.entries.map(item => item.title)).toContain('one')
    expect(result.feed.incomplete).toBe(true)
  })
})
