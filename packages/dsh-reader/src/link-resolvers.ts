/**
 * Paper-link resolvers: turn a link that NAMES a paper into the paper itself.
 *
 * A DOI or an OpenReview URL is a reference, not a readable page: doi.org
 * answers a cross-origin redirect the host seam refuses by design, and
 * openreview.net cannot be read server-side at all (measured 2026-09-20: the
 * API sits behind a Cloudflare challenge, the forum is a JS SPA whose static
 * title is always "Forum | OpenReview"). For such links the add flow asks this
 * module BEFORE fetching anything.
 *
 * Table-driven: one resolver per source, each answering an arXiv candidate, an
 * honest link-only verdict, or `null` ("not mine — take the ordinary path").
 * New sources (dblp, Semantic Scholar) are new rows, not new plumbing. The
 * network face is injected, so every branch is testable without a socket.
 *
 * The one rule the module exists to enforce: **a resolution is proven or
 * absent, never guessed.** A candidate that fails the gate degrades to the
 * ordinary path — a wrong paper filed under the reader's link is worse than a
 * card that says "open it in a browser".
 *
 * @module @khorsheed/dsh-reader/link-resolvers
 */
import { isArxivId } from './arxiv.ts'
import type { ReaderPreviewFailureCode } from './types.ts'

/** What a resolver makes of a link it owns. */
export type LinkResolution =
  | {
    readonly kind: 'arxiv'
    /** The paper's arXiv id, version included, as the API reported it. */
    readonly id: string
    /** The paper's title on arXiv — the saved card's default label. */
    readonly title: string
  }
  | {
    readonly kind: 'link-only'
    readonly code: ReaderPreviewFailureCode
    /** The classifier's own words, kept for diagnosis (the locale sentence rides the code). */
    readonly message: string
  }

/**
 * The network face a resolver may use: one GET, the status and the decoded
 * body. Injected — in production it is the host's sanctioned `ctx.web` seam;
 * in tests a script.
 */
export type ResolverFetch = (url: string) => Promise<{ readonly statusCode: number; readonly body: string }>

/** One row of the resolver table. */
export interface LinkResolver {
  /** The source's name, for logs and tests. */
  readonly name: string
  /** Whether this URL is the source's. Cheap and total — no network. */
  readonly match: (url: URL) => boolean
  /** Resolve a matched URL, or return null to leave it to the ordinary path. */
  readonly resolve: (url: URL, fetch: ResolverFetch) => Promise<LinkResolution | null>
}

/* ------------------------------------------------------------------ the DOI resolver */

/** The DOI resolver covers the doi.org alias hosts; publisher URLs are out of scope. */
const DOI_HOSTS = new Set(['doi.org', 'www.doi.org', 'dx.doi.org'])

/** A DOI is `10.<registrant>/<suffix>`; the registrant is 4–9 digits. */
const DOI_PATH = /^\/(10\.\d{4,9}\/\S+)/

/** Crossref's filtered list route — see the resolver's doc comment on why not the work route. */
const CROSSREF_SELECT = 'DOI,title,author'

/** The arXiv API phrase search silently answers nothing beyond six terms (measured). */
const TITLE_QUERY_WORDS = 6

/** How many candidates one title search is read for. */
const ARXIV_SEARCH_RESULTS = 5

/**
 * The gate a title-search candidate must pass. Normalized edit similarity ≥ the
 * floor, PLUS one shared author family name when both sides name authors;
 * authorless comparisons rise to the strict bar.
 */
export const TITLE_SIMILARITY_MIN = 0.85
export const TITLE_SIMILARITY_STRICT = 0.95

/** One arXiv search hit, parsed. */
export interface ArxivSearchHit {
  readonly id: string
  readonly title: string
  readonly authors: readonly string[]
}

/**
 * Lowercase, accent-folded, punctuation-to-space — the form two titles are
 * compared in. CJK characters are letters for this purpose (a Japanese paper
 * title must not collapse to nothing).
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Levenshtein distance, two rows, on ALREADY-normalized titles. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]!
}

/**
 * How alike two titles are: 1 for identical after normalization, 0 for nothing
 * in common. Either side empty is a 0 — there is nothing to compare.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a)
  const right = normalizeTitle(b)
  if (left.length === 0 || right.length === 0) return 0
  if (left === right) return 1
  return 1 - editDistance(left, right) / Math.max(left.length, right.length)
}

/**
 * The family-name set of an author list, accent-folded and lowercased.
 *
 * Full names ("Nicholas G. Polson", the arXiv spelling) reduce to their last
 * token; structured records (Crossref's `family`) arrive already reduced.
 */
export function familyNames(authors: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const author of authors) {
    const last = normalizeTitle(author).split(' ').filter(part => part.length > 0).at(-1)
    if (last !== undefined) names.add(last)
  }
  return names
}

/**
 * Whether one arXiv hit may stand in for the paper a DOI names.
 *
 * The author factor is what makes "no match → degrade" honest: short generic
 * titles collide across DIFFERENT papers (measured: Crossref's "Deep learning"
 * — LeCun, Bengio, Hinton — is a perfect title match for arXiv's "Deep
 * Learning" — Polson, Sokolov), so title similarity alone guesses.
 *
 * @param candidate - the arXiv hit.
 * @param wanted - the Crossref record's title and authors.
 * @returns true when the candidate is the same paper beyond a title accident.
 */
export function gateArxivCandidate(
  candidate: { readonly title: string; readonly authors: readonly string[] },
  wanted: { readonly title: string; readonly authors: readonly string[] },
): boolean {
  const similarity = titleSimilarity(candidate.title, wanted.title)
  const candidateNames = familyNames(candidate.authors)
  const wantedNames = familyNames(wanted.authors)
  if (candidateNames.size === 0 || wantedNames.size === 0) return similarity >= TITLE_SIMILARITY_STRICT
  const overlap = [...candidateNames].some(name => wantedNames.has(name))
  return similarity >= TITLE_SIMILARITY_MIN && overlap
}

/** The title phrase the arXiv API is asked for: the title's first words, quote-safe. */
export function titleQuery(title: string): string {
  const words = title.replace(/\s+/g, ' ').trim().split(' ')
  return words.slice(0, TITLE_QUERY_WORDS).join(' ').replace(/"+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The entries of an arXiv API Atom answer. A deliberately narrow read — the
 * host runtime has no XML parser, and this document's shape is fixed: each
 * `<entry>` carries its `<id>` (the abs URL) and `<title>` first.
 */
export function parseArxivSearch(xml: string): ArxivSearchHit[] {
  const hits: ArxivSearchHit[] = []
  for (const block of xml.split('<entry>').slice(1)) {
    const id = /<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/.exec(block)?.[1]?.trim()
    const rawTitle = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1]
    if (id === undefined || rawTitle === undefined || !isArxivId(id)) continue
    hits.push({
      id,
      title: unescapeXml(rawTitle).replace(/\s+/g, ' ').trim(),
      authors: [...block.matchAll(/<name>([^<]+)<\/name>/g)].map(match => unescapeXml(match[1]!).trim()),
    })
  }
  return hits
}

/** The few entities an API title can carry. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/**
 * Ask the arXiv API for papers titled like `title`.
 *
 * The phrase search accepts at most {@link TITLE_QUERY_WORDS} terms (measured:
 * a 7-word phrase answers an empty feed where its 6-word prefix finds the
 * paper), so the query is the title's prefix, and precision is the gate's job,
 * not the query's.
 */
async function searchArxiv(title: string, fetch: ResolverFetch): Promise<readonly ArxivSearchHit[]> {
  const phrase = titleQuery(title)
  if (phrase.length === 0) return []
  const url = `https://export.arxiv.org/api/query?${new URLSearchParams({
    search_query: `ti:"${phrase}"`,
    max_results: String(ARXIV_SEARCH_RESULTS),
  }).toString()}`
  let body: string
  try {
    const response = await fetch(url)
    if (response.statusCode !== 200) return []
    body = response.body
  } catch {
    return []
  }
  return parseArxivSearch(body)
}

/**
 * The title and authors Crossref has for one DOI, or `null`.
 *
 * The LIST route with a `doi:` filter is used, not `/works/<doi>`: the
 * single-work route rejects `select` (measured: `parameter-not-allowed`), and
 * an unfiltered work record can carry hundreds of references — past the fetch
 * seam's body cap, which truncates JSON into something unparseable. The
 * filtered route answers a few hundred bytes. A DOI Crossref does not know
 * (404, empty items) is not an error here: it is the ordinary path's business.
 */
async function crossrefWork(
  doi: string,
  fetch: ResolverFetch,
): Promise<{ readonly title: string; readonly authors: readonly string[] } | null> {
  const url = `https://api.crossref.org/works?${new URLSearchParams({
    filter: `doi:${doi}`,
    select: CROSSREF_SELECT,
  }).toString()}`
  let parsed: unknown
  try {
    const response = await fetch(url)
    if (response.statusCode !== 200) return null
    parsed = JSON.parse(response.body)
  } catch {
    // A truncated or malformed record is "no answer", never a crash.
    return null
  }
  const items = (parsed as { message?: { items?: unknown } })?.message?.items
  const work = Array.isArray(items) ? items[0] : undefined
  if (typeof work !== 'object' || work === null) return null
  const record = work as { title?: unknown; author?: unknown }
  const title = Array.isArray(record.title) ? record.title.find(item => typeof item === 'string' && item.length > 0) : undefined
  if (typeof title !== 'string') return null
  const authors = Array.isArray(record.author)
    ? record.author.flatMap((author: unknown) => {
      const family = (author as { family?: unknown } | null)?.family
      return typeof family === 'string' && family.length > 0 ? [family] : []
    })
    : []
  return { title, authors }
}

/** doi.org/<doi> → Crossref → gated arXiv candidate. */
const doiResolver: LinkResolver = {
  name: 'doi',
  match: url => DOI_HOSTS.has(url.hostname.toLowerCase()) && DOI_PATH.test(url.pathname),
  resolve: async (url, fetch) => {
    const doi = decodeURIComponent(DOI_PATH.exec(url.pathname)?.[1] ?? '')
    if (doi.length === 0) return null
    const work = await crossrefWork(doi, fetch)
    if (work === null) return null
    const hits = await searchArxiv(work.title, fetch)
    let best: { readonly hit: ArxivSearchHit; readonly similarity: number } | undefined
    for (const hit of hits) {
      const similarity = titleSimilarity(hit.title, work.title)
      if (best === undefined || similarity > best.similarity) best = { hit, similarity }
    }
    if (best === undefined || !gateArxivCandidate(best.hit, work)) return null
    return { kind: 'arxiv', id: best.hit.id, title: best.hit.title }
  },
}

/* ----------------------------------------------------------- the OpenReview resolver */

/**
 * OpenReview cannot be read server-side, and that is KNOWN without a request:
 * the forum is a JS SPA behind an anti-bot wall (measured 2026-09-20: the API
 * 403s with a Cloudflare challenge; the forum's static HTML always titles
 * itself "Forum | OpenReview"). The resolver answers the honest card instead
 * of spending a fetch to learn it again. A future capture backend (the ingest
 * proposal's M1) is where a rendered read of the forum belongs.
 */
const openReviewResolver: LinkResolver = {
  name: 'openreview',
  match: url => {
    const host = url.hostname.toLowerCase()
    if (host !== 'openreview.net' && host !== 'www.openreview.net') return false
    return (url.pathname === '/forum' || url.pathname === '/pdf') && (url.searchParams.get('id') ?? '').length > 0
  },
  resolve: () => Promise.resolve({
    kind: 'link-only',
    code: 'unreadable',
    message: 'OpenReview pages are script-rendered behind an anti-bot wall, so the server side cannot read them — if the paper has an arXiv version, paste that link instead',
  }),
}

/** The resolver table, in match order. */
export const LINK_RESOLVERS: readonly LinkResolver[] = [doiResolver, openReviewResolver]

/**
 * Resolve a pasted link through the table.
 *
 * `null` — not an answer, but the ABSENCE of one — sends the URL down the
 * ordinary fetch-and-classify path. A resolver's own failure is caught by the
 * caller (the service): a DOI lookup that throws must not break an add.
 *
 * @param url - the normalized pasted URL.
 * @param fetch - the injected GET face.
 * @returns the resolution, or `null`.
 */
export async function resolveLink(url: string, fetch: ResolverFetch): Promise<LinkResolution | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  for (const resolver of LINK_RESOLVERS) {
    if (resolver.match(parsed)) return resolver.resolve(parsed, fetch)
  }
  return null
}
