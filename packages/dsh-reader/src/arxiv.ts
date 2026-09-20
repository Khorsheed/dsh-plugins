/**
 * arXiv link recognition, and the upgrade to the official HTML version.
 *
 * Many papers carry a LaTeXML-built HTML rendering next to the abstract and the
 * PDF (`arxiv.org/html/<id>`): real tables, semantic sections and MathML
 * formulas, where the PDF is a byte stream and the abstract page is a summary.
 * A pasted `/abs` or `/pdf` link therefore upgrades to the HTML version BEFORE
 * the first fetch — the reader who pasted the paper meant the paper.
 *
 * Pure and network-free, so both the add flow and the link resolvers build on
 * it; the fetch policy (try the HTML version, fall back on 404) lives in the
 * service.
 *
 * @module @khorsheed/dsh-reader/arxiv
 */

/** One parsed arXiv article link. */
export interface ArxivLink {
  /** Which of the paper's three faces the link points at. */
  readonly kind: 'abs' | 'pdf' | 'html'
  /** The paper id as the link carries it, version suffix (`v2`) included. */
  readonly id: string
}

/**
 * The id shapes arXiv assigns: new-style `YYMM.NNNNN(vN)` (month-keyed, four or
 * five sequence digits — six from 2027 on), or the archived subject-class form
 * `hep-th/9901001(vN)` / `math.GT/0309136(vN)`.
 */
const ARXIV_ID = /^(?:\d{4}\.\d{4,6}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/

/**
 * Parse an arxiv.org link to one paper.
 *
 * Only the three single-paper paths count: `/abs`, `/pdf`, `/html`. Listing,
 * search and author pages name no paper, so they read as ordinary links.
 *
 * @param url - the URL as pasted (already normalized by the caller).
 * @returns the parsed link, or `undefined`.
 */
export function arxivLink(url: string): ArxivLink | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const host = parsed.hostname.toLowerCase()
  if (host !== 'arxiv.org' && host !== 'www.arxiv.org') return undefined
  // The id itself may carry one slash (the old `archive/YYMMNNN` form), so the
  // capture runs to the query/fragment and the id pattern below is the judge.
  const match = /^\/(abs|pdf|html)\/([^?#]+)/.exec(parsed.pathname)
  const kind = match?.[1] as ArxivLink['kind'] | undefined
  let id = match?.[2]
  if (kind === undefined || id === undefined) return undefined
  // A pdf link may spell the id with its file suffix: `/pdf/1706.03762v7.pdf`.
  if (kind === 'pdf' && /\.pdf$/i.test(id)) id = id.slice(0, -4)
  if (!ARXIV_ID.test(id)) return undefined
  return { kind, id }
}

/**
 * The official HTML version of an `/abs` or `/pdf` link.
 *
 * `undefined` when the link IS already the HTML page (no rewrite, so the add
 * flow can never loop) or is not an arXiv paper link at all. The HTML version
 * is not guaranteed to exist — old papers lack it — so the caller must treat
 * a 404 as "no upgrade", not as a failure of the link.
 *
 * @param url - the pasted arXiv URL.
 * @returns the HTML version's URL, or `undefined`.
 */
export function arxivHtmlUrl(url: string): string | undefined {
  const link = arxivLink(url)
  if (link === undefined || link.kind === 'html') return undefined
  return `https://arxiv.org/html/${link.id}`
}
