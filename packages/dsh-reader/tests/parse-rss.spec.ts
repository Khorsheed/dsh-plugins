// @vitest-environment jsdom
/**
 * Feed parsing (RSS 2.0 / Atom) against hand-written payloads that mirror what
 * real feeds actually contain, including the shapes that break naive readers:
 * namespace prefixes on one feed and not the other, CDATA bodies, HTML bodies
 * that arrive double-escaped, a body-less feed, and a document cut off mid-tag
 * (what a size cap or a dropped connection produces).
 */
import { describe, expect, it } from 'vitest'
import { decodeEntities, parseFeed } from '../src/client/parse-rss.ts'

/** An RSS 2.0 document with one item, parameterized for the case under test. */
function rss(itemXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com/</link>
    <image><url>https://example.com/icon.png</url></image>
    ${itemXml}
  </channel>
</rss>`
}

/** An Atom document with one entry, parameterized for the case under test. */
function atom(entryXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <icon>https://example.com/atom-icon.png</icon>
  ${entryXml}
</feed>`
}

describe('parseFeed — RSS 2.0', () => {
  it('reads the feed title and icon', () => {
    const result = parseFeed(rss('<item><title>x</title><link>https://example.com/1</link></item>'), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.title).toBe('Example Feed')
    expect(result.feed.icon).toBe('https://example.com/icon.png')
  })

  it('maps an item to an entry with link, date, author and tags', () => {
    const result = parseFeed(rss(`
      <item>
        <title>Hello world</title>
        <link>https://example.com/post</link>
        <guid isPermaLink="false">tag:example.com,2026:1</guid>
        <pubDate>Wed, 10 Sep 2026 09:00:00 GMT</pubDate>
        <dc:creator>Ada</dc:creator>
        <category>tech</category>
        <category>reading</category>
        <description>First &amp; foremost a &lt;em&gt;test&lt;/em&gt;.</description>
      </item>`), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [entry] = result.feed.entries
    expect(entry).toBeDefined()
    expect(entry?.title).toBe('Hello world')
    expect(entry?.link).toBe('https://example.com/post')
    expect(entry?.author).toBe('Ada')
    expect(entry?.publishedAt).toBe('2026-09-10T09:00:00.000Z')
    expect(entry?.tags).toEqual(['tech', 'reading'])
    expect(entry?.sourceId).toBe('s1')
  })

  it('prefers content:encoded over description for the detail body', () => {
    const result = parseFeed(rss(`
      <item>
        <title>Full text</title>
        <link>https://example.com/full</link>
        <description>Short blurb.</description>
        <content:encoded><![CDATA[<p>The <strong>whole</strong> article.</p><p>Second paragraph.</p>]]></content:encoded>
      </item>`), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [entry] = result.feed.entries
    expect(entry?.contentHtml).toContain('<strong>whole</strong>')
    expect(entry?.contentHtml).toContain('Second')
  })

  it('decodes a double-escaped body into real markup', () => {
    const result = parseFeed(rss(`
      <item>
        <title>Escaped</title>
        <link>https://example.com/esc</link>
        <description>&lt;p&gt;Escaped &lt;em&gt;markup&lt;/em&gt;.&lt;/p&gt;</description>
      </item>`), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [entry] = result.feed.entries
    expect(entry?.contentHtml).toContain('<em>markup</em>')
  })

  it('strips markup out of the card summary', () => {
    const result = parseFeed(rss(`
      <item>
        <title>Summary</title>
        <link>https://example.com/s</link>
        <description>Some &lt;b&gt;bold&lt;/b&gt; words here.</description>
      </item>`), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.entries[0]?.summary).toBe('Some bold words here.')
  })

  it('falls back to the link when an item carries no title', () => {
    const result = parseFeed(rss('<item><link>https://example.com/untitled</link></item>'), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.entries[0]?.title).toBe('https://example.com/untitled')
  })

  it('skips an item with neither title nor link', () => {
    const result = parseFeed(rss('<item><guid isPermaLink="false">x</guid></item>'), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.entries).toHaveLength(0)
  })
})

describe('parseFeed — Atom', () => {
  it('reads an entry with alternate link, author name and content', () => {
    const result = parseFeed(atom(`
      <entry>
        <title>Atom entry</title>
        <id>tag:example.com,2026:2</id>
        <link rel="alternate" href="https://example.com/atom-post"/>
        <author><name>Grace</name></author>
        <published>2026-09-11T10:30:00Z</published>
        <category term="atom"/>
        <content type="html">&lt;p&gt;Atom body &lt;code&gt;here&lt;/code&gt;.&lt;/p&gt;</content>
      </entry>`), 's2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [entry] = result.feed.entries
    expect(result.feed.title).toBe('Example Atom')
    expect(result.feed.icon).toBe('https://example.com/atom-icon.png')
    expect(entry?.title).toBe('Atom entry')
    expect(entry?.link).toBe('https://example.com/atom-post')
    expect(entry?.author).toBe('Grace')
    expect(entry?.tags).toEqual(['atom'])
    expect(entry?.contentHtml).toContain('<code>here</code>')
  })

  it('falls back from <content> to <summary> for the card text', () => {
    const result = parseFeed(atom(`
      <entry>
        <title>Summary only</title>
        <id>tag:example.com,2026:3</id>
        <link href="https://example.com/sum"/>
        <summary>Just a summary.</summary>
      </entry>`), 's2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.entries[0]?.summary).toBe('Just a summary.')
  })
})

describe('parseFeed — entry identity is stable across refreshes', () => {
  it('uses the guid when the feed declares one', () => {
    const payload = rss('<item><title>T</title><link>https://example.com/a</link><guid isPermaLink="false">abc</guid></item>')
    const first = parseFeed(payload, 's1')
    const second = parseFeed(payload, 's1')
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.feed.entries[0]?.id).toBe(second.feed.entries[0]?.id)
    // A later edit to the title must not mint a new id when the guid is present.
    const edited = parseFeed(rss('<item><title>Renamed</title><link>https://example.com/a</link><guid isPermaLink="false">abc</guid></item>'), 's1')
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.feed.entries[0]?.id).toBe(first.feed.entries[0]?.id)
  })

  it('falls back to the link, then to a title+link hash', () => {
    const byLink = parseFeed(rss('<item><title>T</title><link>https://example.com/a</link></item>'), 's1')
    const byHash = parseFeed(rss('<item><title>T</title></item>'), 's1')
    const byHashAgain = parseFeed(rss('<item><title>T</title></item>'), 's1')
    expect(byLink.ok && byHash.ok && byHashAgain.ok).toBe(true)
    if (!byLink.ok || !byHash.ok || !byHashAgain.ok) return
    expect(byLink.feed.entries[0]?.id).toContain('https://example.com/a')
    expect(byHash.feed.entries[0]?.id).toMatch(/^h:/)
    expect(byHashAgain.feed.entries[0]?.id).toBe(byHash.feed.entries[0]?.id)
  })
})

describe('parseFeed — malformed input', () => {
  it('rejects an empty payload', () => {
    expect(parseFeed('   ', 's1')).toEqual({ ok: false, error: 'empty payload' })
  })

  it('rejects a document cut off mid-tag (the truncation case)', () => {
    const full = rss('<item><title>Cut</title><link>https://example.com/cut</link></item>')
    const truncated = full.slice(0, Math.floor(full.length * 0.7))
    const result = parseFeed(truncated, 's1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/malformed XML|unsupported root/)
  })

  it('rejects an HTML error page', () => {
    const result = parseFeed('<html><body><h1>403 Forbidden</h1></body></html>', 's1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('unsupported root element')
  })
})

describe('decodeEntities', () => {
  it('decodes the named subset and numeric references', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &quot;q&quot; &#39;s&#39; &#x41;')).toBe('<a> & "q" \'s\' A')
  })

  it('applies a second pass only to a fully double-escaped body', () => {
    // A complete escaped element means the publisher escaped the whole body
    // twice, so the tags are the intended output.
    expect(decodeEntities('&amp;lt;p&amp;gt;hi&amp;lt;/p&amp;gt;')).toBe('<p>hi</p>')
    // `&amp;lt;` is the literal text `&lt;`, escaped on purpose — one pass.
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
    // A single escaped tag is text, not a double-escaped element.
    expect(decodeEntities('&lt;b&gt;')).toBe('<b>')
    expect(decodeEntities('plain &amp; text')).toBe('plain & text')
  })

  it('ignores invalid and surrogate code points', () => {
    // Each dropped code point leaves its separating space behind; the point of
    // the assertion is that neither produces a surrogate or an exception.
    expect(decodeEntities('&#xD800; &#1114112; ok').trim()).toBe('ok')
    expect(decodeEntities('&#xD800;x')).toBe('x')
  })
})

describe('a feed that publishes only a summary', () => {
  const feedWith = (itemInner: string): string =>
    `<rss version="2.0"><channel><title>c</title><item>${itemInner}</item></channel></rss>`

  it('marks the description-derived body as summary-only', () => {
    // A description IS rendered in the detail view (an empty page would be
    // worse), but it is not the article: without the flag the entry looks
    // complete and nothing ever fetches the page behind it.
    const result = parseFeed(feedWith('<title>t</title><link>https://example.com/a</link><description>Only a summary here.</description>'), 's1')
    expect(result.ok).toBe(true)
    const entry = result.ok ? result.feed.entries[0] : undefined
    expect(entry?.contentHtml).toContain('Only a summary here.')
    expect(entry?.summaryOnly).toBe(true)
  })

  it('does not mark a real content body', () => {
    const withNs = (inner: string): string =>
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>c</title><item>${inner}</item></channel></rss>`
    const result = parseFeed(withNs('<title>t</title><link>https://example.com/a</link><content:encoded><![CDATA[<p>The whole article.</p>]]></content:encoded>'), 's1')
    expect(result.ok).toBe(true)
    const entry = result.ok ? result.feed.entries[0] : undefined
    expect(entry?.contentHtml).toContain('The whole article.')
    expect(entry?.summaryOnly).toBeUndefined()
  })
})
