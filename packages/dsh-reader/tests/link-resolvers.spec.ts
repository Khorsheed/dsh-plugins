/**
 * The paper-link resolvers, against scripted answers rather than a network.
 *
 * The resolver table is the part of the ingest story where a wrong answer is
 * worse than no answer (proposal risk ⑥): a mis-gated candidate files somebody
 * else's paper under the reader's link. So the gate's two factors — title
 * similarity and author overlap — are pinned here case by case, including the
 * measured near-collision ("Deep learning" is two different papers).
 */
import { describe, expect, it } from 'vitest'
import {
  editDistance,
  familyNames,
  gateArxivCandidate,
  LINK_RESOLVERS,
  normalizeTitle,
  parseArxivSearch,
  resolveLink,
  titleQuery,
  titleSimilarity,
  type ResolverFetch,
} from '../src/link-resolvers.ts'

/** A scripted ResolverFetch: exact-substring routing to status+body answers. */
function scriptFetch(routes: Readonly<Record<string, { statusCode: number; body: string }>>): { fetch: ResolverFetch; requested: string[] } {
  const requested: string[] = []
  const fetch: ResolverFetch = async (url) => {
    requested.push(url)
    for (const [needle, answer] of Object.entries(routes)) {
      if (url.includes(needle)) return answer
    }
    return { statusCode: 404, body: 'not found' }
  }
  return { fetch, requested }
}

/** A Crossref filtered-list answer. */
function crossref(title: string, families: readonly string[]): string {
  return JSON.stringify({
    status: 'ok',
    message: {
      items: [{
        DOI: '10.1038/nature16961',
        title: [title],
        author: families.map(family => ({ given: 'X', family })),
      }],
    },
  })
}

/** An arXiv API Atom answer with the given entries. */
function arxivFeed(entries: readonly { id: string; title: string; authors: readonly string[] }[]): string {
  const body = entries.map(entry => `<entry><id>http://arxiv.org/abs/${entry.id}</id>`
    + `<title>${entry.title}</title>${entry.authors.map(author => `<author><name>${author}</name></author>`).join('')}</entry>`).join('')
  return `<?xml version="1.0"?><feed><title>arXiv Query</title>${body}</feed>`
}

const GO = {
  title: 'Mastering the game of Go with deep neural networks and tree search',
  authors: ['Silver', 'Huang', 'Hassabis'],
  hit: { id: '1610.00633v2', title: 'Mastering the game of Go with deep neural networks and tree search', authors: ['David Silver', 'Aja Huang', 'Demis Hassabis'] },
}

describe('normalizeTitle / titleSimilarity / editDistance', () => {
  it('identifies titles up to case, accents and punctuation', () => {
    expect(normalizeTitle('  Attention   Is All You Need! ')).toBe('attention is all you need')
    expect(normalizeTitle('Lévy Processes')).toBe('levy processes')
    expect(titleSimilarity('Attention Is All You Need', 'attention is all you need.')).toBe(1)
  })

  it('scores drift proportionally and empty as zero', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(titleSimilarity('', 'anything')).toBe(0)
    const near = titleSimilarity('Mastering the game of Go', 'Mastering the game of Go with self-play')
    expect(near).toBeGreaterThan(0.6)
    expect(near).toBeLessThan(1)
  })
})

describe('familyNames', () => {
  it('reduces full names to their last token, folded', () => {
    expect([...familyNames(['Nicholas G. Polson', 'Demis Hassabis'])]).toEqual(['polson', 'hassabis'])
    expect([...familyNames(['Élie Cartan'])]).toEqual(['cartan'])
  })
})

describe('gateArxivCandidate', () => {
  it('accepts the same paper', () => {
    expect(gateArxivCandidate(
      { title: GO.hit.title, authors: GO.hit.authors },
      { title: GO.title, authors: GO.authors },
    )).toBe(true)
  })

  it('rejects the measured near-collision: same title, different authors', () => {
    // Crossref's "Deep learning" (LeCun, Bengio, Hinton — Nature 2015) is a
    // PERFECT title match for arXiv 1807.07987 "Deep Learning" (Polson,
    // Sokolov). Title-only matching would file the wrong paper.
    expect(gateArxivCandidate(
      { title: 'Deep Learning', authors: ['Nicholas G. Polson', 'Vadim O. Sokolov'] },
      { title: 'Deep learning', authors: ['LeCun', 'Bengio', 'Hinton'] },
    )).toBe(false)
  })

  it('rises to the strict bar when either side names no authors', () => {
    expect(gateArxivCandidate(
      { title: 'Deep Learning', authors: [] },
      { title: 'Deep learning', authors: ['LeCun'] },
    )).toBe(true)
    expect(gateArxivCandidate(
      { title: 'Deep learning with neural networks: a survey', authors: [] },
      { title: 'Deep learning', authors: ['LeCun'] },
    )).toBe(false)
  })

  it('rejects a low-similarity title even with an author in common', () => {
    expect(gateArxivCandidate(
      { title: 'Mastering the game of Stratego with model-free multiagent reinforcement learning', authors: ['David Silver'] },
      { title: GO.title, authors: GO.authors },
    )).toBe(false)
  })
})

describe('titleQuery', () => {
  it('caps the phrase at six words — the API answers nothing beyond that (measured)', () => {
    expect(titleQuery(GO.title)).toBe('Mastering the game of Go with')
    expect(titleQuery('Attention Is All You Need')).toBe('Attention Is All You Need')
    expect(titleQuery('He said "hello"  twice')).toBe('He said hello twice')
  })
})

describe('parseArxivSearch', () => {
  it('reads entries, unescapes entities, and skips ids that are not arXiv ids', () => {
    const xml = arxivFeed([
      { id: '1706.03762v7', title: 'Attention Is All You &amp; I Need', authors: ['Ashish Vaswani'] },
      { id: 'not-an-id', title: 'Garbage', authors: [] },
    ])
    const hits = parseArxivSearch(xml)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toEqual({ id: '1706.03762v7', title: 'Attention Is All You & I Need', authors: ['Ashish Vaswani'] })
  })
})

describe('the resolver table', () => {
  it('matches only its own sources', () => {
    const doi = LINK_RESOLVERS.find(resolver => resolver.name === 'doi')
    const openreview = LINK_RESOLVERS.find(resolver => resolver.name === 'openreview')
    expect(doi?.match(new URL('https://doi.org/10.1038/nature16961'))).toBe(true)
    expect(doi?.match(new URL('https://dx.doi.org/10.1038/nature16961'))).toBe(true)
    expect(doi?.match(new URL('https://doi.org/about'))).toBe(false)
    expect(doi?.match(new URL('https://example.com/10.1038/nature16961'))).toBe(false)
    expect(openreview?.match(new URL('https://openreview.net/forum?id=1lyagkzogH'))).toBe(true)
    expect(openreview?.match(new URL('https://openreview.net/pdf?id=1lyagkzogH'))).toBe(true)
    expect(openreview?.match(new URL('https://openreview.net/forum'))).toBe(false)
    expect(openreview?.match(new URL('https://openreview.net/'))).toBe(false)
  })

  it('leaves foreign URLs to the ordinary path', async () => {
    const { fetch, requested } = scriptFetch({})
    expect(await resolveLink('https://example.com/story', fetch)).toBeNull()
    expect(requested).toEqual([])
  })

  it('resolves a DOI to the gated arXiv candidate', async () => {
    const { fetch, requested } = scriptFetch({
      'api.crossref.org': { statusCode: 200, body: crossref(GO.title, GO.authors) },
      'export.arxiv.org': { statusCode: 200, body: arxivFeed([GO.hit]) },
    })
    const resolution = await resolveLink('https://doi.org/10.1038/nature16961', fetch)
    expect(resolution).toEqual({ kind: 'arxiv', id: GO.hit.id, title: GO.hit.title })
    expect(requested).toHaveLength(2)
    // Crossref is asked through the FILTERED list route (the single-work route
    // rejects `select`, and a full work record can outgrow the fetch cap).
    expect(requested[0]).toContain('filter=doi%3A10.1038%2Fnature16961')
    expect(requested[0]).toContain('select=')
    // The arXiv phrase is the six-word prefix, not the full title.
    expect(requested[1]).toContain('search_query=ti%3A%22Mastering+the+game+of+Go+with%22')
  })

  it('degrades when the only candidate fails the gate — never a guess', async () => {
    const { fetch } = scriptFetch({
      'api.crossref.org': { statusCode: 200, body: crossref('Deep learning', ['LeCun', 'Bengio', 'Hinton']) },
      'export.arxiv.org': { statusCode: 200, body: arxivFeed([{ id: '1807.07987v2', title: 'Deep Learning', authors: ['Nicholas G. Polson', 'Vadim O. Sokolov'] }]) },
    })
    expect(await resolveLink('https://doi.org/10.1038/nature14539', fetch)).toBeNull()
  })

  it('degrades on an empty search, a Crossref 404, and a truncated record alike', async () => {
    const emptySearch = scriptFetch({
      'api.crossref.org': { statusCode: 200, body: crossref(GO.title, GO.authors) },
      'export.arxiv.org': { statusCode: 200, body: arxivFeed([]) },
    })
    expect(await resolveLink('https://doi.org/10.1038/nature16961', emptySearch.fetch)).toBeNull()

    const unknownDoi = scriptFetch({ 'api.crossref.org': { statusCode: 404, body: 'not found' } })
    expect(await resolveLink('https://doi.org/10.1038/none', unknownDoi.fetch)).toBeNull()
    expect(unknownDoi.requested).toHaveLength(1)

    const truncated = scriptFetch({ 'api.crossref.org': { statusCode: 200, body: '{"message":{"items":[{"title":["Half' } })
    expect(await resolveLink('https://doi.org/10.1038/nature16961', truncated.fetch)).toBeNull()
  })

  it('answers OpenReview link-only, unreadable, without spending a request', async () => {
    const { fetch, requested } = scriptFetch({})
    const resolution = await resolveLink('https://openreview.net/forum?id=1lyagkzogH', fetch)
    expect(resolution).toMatchObject({ kind: 'link-only', code: 'unreadable' })
    expect(requested).toEqual([])
  })
})
