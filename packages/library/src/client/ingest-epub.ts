/**
 * EPUB ingestion, entirely in the browser (the host has no DOM parser): fflate
 * unzips the archive, `META-INF/container.xml` locates the OPF package
 * document, the OPF's manifest+spine give the reading order, and the NCX (or
 * the NAV document) names the chapters. Every spine document's body is then
 * whitelist-sanitized (`sanitize.ts`) into the normalized chapter HTML the
 * whole library downstream consumes.
 *
 * Failures are honest classes, never silent salvage: not a zip, not an EPUB,
 * DRM-encrypted, no reading order, or nothing readable came out. Fixed-layout
 * and other exotic packaging land in `no-chapters` when nothing readable
 * survives — the error names the class and the drop zone shows it.
 *
 * @module @khorsheed/dsh-library/client/ingest-epub
 */
import { unzipSync } from 'fflate'
import { chapterHasText, sanitizeChapterHtml } from './sanitize.ts'

/** One parsed chapter. */
export interface EpubChapter {
  readonly title: string
  readonly html: string
}

/** The ingestion's outcome. */
export type EpubIngest =
  | { readonly ok: true; readonly title: string; readonly chapters: readonly EpubChapter[] }
  | { readonly ok: false; readonly error: 'not-zip' | 'not-epub' | 'encrypted' | 'no-spine' | 'no-chapters' }

/** One zip entry table, as fflate reports it. */
type ZipEntries = Record<string, Uint8Array>

/** The longest chapter title the TOC carries. */
const TITLE_LIMIT = 200

/** Decode one entry as UTF-8 text. */
function textOf(entry: Uint8Array): string {
  return new TextDecoder('utf-8').decode(entry)
}

/** Join a path against the OPF's directory (zip paths are always `/`-joined). */
function joinZip(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel.slice(1)
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : ''
  const raw = `${dir === '' ? '' : `${dir}/`}${rel}`
  // Normalize ./ and ../ segments (a manifest may carry them).
  const out: string[] = []
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

/** One XML document, parsed for reading (parser errors surface as null). */
function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return doc.querySelector('parsererror') === null ? doc : null
}

/** Read one element's text, namespace-blind (getElementsByTagNameNS('*', …)). */
function firstText(root: Document | Element, tag: string): string | undefined {
  const found = root.getElementsByTagNameNS('*', tag).item(0)
  const text = found?.textContent?.trim()
  return text === undefined || text === '' ? undefined : text
}

/** All matching elements, namespace-blind, as an array. */
function all(root: Document | Element, tag: string): Element[] {
  return [...root.getElementsByTagNameNS('*', tag)]
}

/** The NCX's spine-position → label map (the EPUB 2 navigation). */
function ncxTitles(doc: Document): Map<string, string> {
  const titles = new Map<string, string>()
  for (const point of all(doc, 'navPoint')) {
    const label = firstText(point, 'text')
    const src = point.getElementsByTagNameNS('*', 'content').item(0)?.getAttribute('src')
    if (label !== undefined && src !== null && src !== undefined) {
      titles.set(stripFragment(src), label)
    }
  }
  return titles
}

/** The NAV document's href → label map (the EPUB 3 navigation). */
function navTitles(doc: Document): Map<string, string> {
  const titles = new Map<string, string>()
  // The nav with the toc role; absent one, every nav's links are tried.
  const navs = all(doc, 'nav')
  const tocNav = navs.find(nav => /(^|\s)toc(\s|$)/.test(nav.getAttribute('epub:type') ?? nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? ''))
  for (const nav of tocNav === undefined ? navs : [tocNav]) {
    for (const link of all(nav, 'a')) {
      const href = link.getAttribute('href')
      const label = link.textContent?.trim()
      if (href !== null && label !== undefined && label !== '') titles.set(stripFragment(href), label)
    }
  }
  return titles
}

/** A chapter file name without its `#fragment` (NCX/NAV links carry one). */
function stripFragment(href: string): string {
  const hash = href.indexOf('#')
  return hash === -1 ? href : href.slice(0, hash)
}

/**
 * Parse one EPUB's bytes.
 * @param bytes - the file's raw bytes.
 * @returns the book's title and its chapters, or the honest failure class.
 */
export function parseEpub(bytes: Uint8Array): EpubIngest {
  let entries: ZipEntries
  try {
    entries = unzipSync(bytes)
  } catch {
    return { ok: false, error: 'not-zip' }
  }
  if (entries['mimetype'] === undefined || !textOf(entries['mimetype']).includes('epub')) {
    return { ok: false, error: 'not-epub' }
  }
  if (entries['META-INF/encryption.xml'] !== undefined) {
    return { ok: false, error: 'encrypted' }
  }
  const container = entries['META-INF/container.xml']
  if (container === undefined) return { ok: false, error: 'not-epub' }
  const containerDoc = parseXml(textOf(container))
  const opfPath = containerDoc?.getElementsByTagNameNS('*', 'rootfile').item(0)?.getAttribute('full-path')
  if (opfPath === null || opfPath === undefined || opfPath === '' || entries[opfPath] === undefined) {
    return { ok: false, error: 'not-epub' }
  }
  const opf = parseXml(textOf(entries[opfPath]))
  if (opf === null) return { ok: false, error: 'not-epub' }

  const title = firstText(opf, 'title') ?? '未命名'
  // manifest: id → { href, mediaType, properties }
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>()
  for (const item of all(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id === null || href === null) continue
    manifest.set(id, {
      href: joinZip(opfPath, href),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    })
  }
  // The reading order.
  const spine: string[] = []
  for (const ref of all(opf, 'itemref')) {
    const idref = ref.getAttribute('idref')
    if (idref !== null && ref.getAttribute('linear') !== 'no') spine.push(idref)
  }
  if (spine.length === 0) return { ok: false, error: 'no-spine' }

  // Chapter titles: the NAV document first (EPUB 3), then the NCX (EPUB 2).
  const titles = new Map<string, string>()
  const navItem = [...manifest.values()].find(item => /(^|\s)nav(\s|$)/.test(item.properties))
  const navEntry = navItem === undefined ? undefined : entries[navItem.href]
  if (navEntry !== undefined) {
    const nav = parseXml(textOf(navEntry))
    if (nav !== null) for (const [href, label] of navTitles(nav)) titles.set(href, label)
  }
  const ncxItem = [...manifest.values()].find(item => item.mediaType === 'application/x-dtbncx+xml')
  const ncxEntry = ncxItem === undefined ? undefined : entries[ncxItem.href]
  if (ncxEntry !== undefined) {
    const ncx = parseXml(textOf(ncxEntry))
    if (ncx !== null) for (const [href, label] of ncxTitles(ncx)) titles.set(href, label)
  }

  const chapters: EpubChapter[] = []
  for (const idref of spine) {
    const item = manifest.get(idref)
    if (item === undefined || !/^(?:application\/xhtml\+xml|text\/html)$/.test(item.mediaType)) continue
    const entry = entries[item.href]
    if (entry === undefined) continue
    const page = new DOMParser().parseFromString(textOf(entry), 'application/xhtml+xml')
    if (page.querySelector('parsererror') !== null) continue
    const body = page.querySelector('body')
    if (body === null) continue
    const html = sanitizeChapterHtml(body.innerHTML)
    if (!chapterHasText(html)) continue
    const heading = page.querySelector('h1, h2, h3')?.textContent?.trim()
    const label = titles.get(item.href) ?? titles.get(stripFragment(item.href))
    const chapterTitle = (label ?? heading ?? '').trim()
    chapters.push({
      title: (chapterTitle === '' ? `第 ${chapters.length + 1} 章` : chapterTitle).slice(0, TITLE_LIMIT),
      html,
    })
  }
  if (chapters.length === 0) return { ok: false, error: 'no-chapters' }
  return { ok: true, title: title.slice(0, TITLE_LIMIT), chapters }
}
