// @vitest-environment jsdom
/**
 * EPUB ingestion: a minimal archive is zipped in-test with fflate (mimetype +
 * container.xml + OPF + NCX + two XHTML chapters), then the failure classes
 * (not a zip, not an EPUB, encrypted, no spine, nothing readable) and the
 * sanitizer's whitelist are pinned.
 */
import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parseEpub } from '../src/client/ingest-epub.ts'
import { sanitizeChapterHtml, chapterHasText } from '../src/client/sanitize.ts'

/** A minimal but real EPUB 2 archive (NCX navigation). */
function minimalEpub(options: { encrypted?: boolean; noSpine?: boolean } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>认知神经科学</dc:title>
    <dc:creator>佚名</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.png" media-type="image/png"/>
  </manifest>
  ${options.noSpine ? '<spine toc="ncx"></spine>' : `<spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>`}
</package>`),
    'OEBPS/toc.ncx': strToU8(`<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>神经系统概论</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>突触传递</text></navLabel><content src="ch2.xhtml#s2"/></navPoint>
  </navMap>
</ncx>`),
    'OEBPS/ch1.xhtml': strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>一</title>
<script>alert(1)</script><style>p{color:red}</style></head>
<body><h1>神经系统概论</h1><p class="lead" onclick="x()">神经系统由<b>神经元</b>与胶质细胞构成。</p>
<iframe src="https://evil.example"></iframe>
<p><a href="javascript:evil()">坏链</a><a href="https://example.com/ref">好链</a></p></body></html>`),
    'OEBPS/ch2.xhtml': strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>突触传递</h2>
<p>Ca²⁺ 内流触发<span>囊泡</span>与突触前膜融合。</p>
<img src="https://example.com/synapse.png" alt="突触" width="300" onerror="x()"/></body></html>`),
  }
  if (options.encrypted) {
    files['META-INF/encryption.xml'] = strToU8('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>')
  }
  return zipSync(files)
}

describe('parseEpub', () => {
  it('splits a real archive into sanitized chapters with NCX titles', () => {
    const result = parseEpub(minimalEpub())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.title).toBe('认知神经科学')
    expect(result.chapters.map(chapter => chapter.title)).toEqual(['神经系统概论', '突触传递'])
    const [first, second] = result.chapters
    // The sanitizer kept the content…
    expect(first!.html).toContain('<h1>神经系统概论</h1>')
    expect(first!.html).toContain('<b>神经元</b>')
    expect(first!.html).toContain('<a href="https://example.com/ref">好链</a>')
    // …and dropped the script/style/iframe, the event handler and the js: link.
    expect(first!.html).not.toContain('script')
    expect(first!.html).not.toContain('alert')
    expect(first!.html).not.toContain('iframe')
    expect(first!.html).not.toContain('onclick')
    expect(first!.html).not.toContain('javascript:')
    expect(first!.html).not.toContain('class=')
    // A span is transparent: the text stays, the tag dissolves.
    expect(second!.html).toContain('囊泡')
    expect(second!.html).not.toContain('<span')
    expect(second!.html).toContain('src="https://example.com/synapse.png"')
    expect(second!.html).not.toContain('onerror')
  })

  it('classifies the honest failures', () => {
    expect(parseEpub(strToU8('not a zip at all'))).toEqual({ ok: false, error: 'not-zip' })
    const noMimetype = zipSync({ 'META-INF/container.xml': strToU8('<container/>') })
    expect(parseEpub(noMimetype)).toEqual({ ok: false, error: 'not-epub' })
    expect(parseEpub(minimalEpub({ encrypted: true }))).toEqual({ ok: false, error: 'encrypted' })
    expect(parseEpub(minimalEpub({ noSpine: true }))).toEqual({ ok: false, error: 'no-spine' })
  })

  it('an archive whose spine holds no readable text is no-chapters', () => {
    const files: Record<string, Uint8Array> = {
      'mimetype': strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>`),
      'c.opf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`),
      'a.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><script>only()</script></body></html>'),
    }
    expect(parseEpub(zipSync(files))).toEqual({ ok: false, error: 'no-chapters' })
  })
})

describe('sanitizeChapterHtml', () => {
  it('unwraps transparent containers and keeps the whitelist', () => {
    const html = sanitizeChapterHtml('<div><section><p>段落<strong>重点</strong></p></section></div>')
    expect(html).toBe('<p>段落<strong>重点</strong></p>')
  })

  it('drops active content whole', () => {
    const html = sanitizeChapterHtml('<p>前</p><script>evil()</script><p>后</p>')
    expect(html).toBe('<p>前</p><p>后</p>')
    expect(chapterHasText(html)).toBe(true)
    // The contract: sanitize FIRST, then ask whether text survived (a
    // script-only page parses to nothing readable).
    expect(chapterHasText(sanitizeChapterHtml('<script>x()</script>'))).toBe(false)
  })
})

describe('the fflate import pin', () => {
  it('imports the browser build — the bare specifier leaks node:module into the client bundle', async () => {
    // tsdown pins platform: 'node' for a CJS-format bundle, so fflate's `node`
    // exports condition (esm/index.mjs, with createRequire('/')) wins over the
    // browser build and the client artifact gains a `require("module")` the
    // host's module table cannot answer (3471 acceptance boot failure). The
    // ingest is browser-only code, so it pins fflate's `./browser` subpath.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'ingest-epub.ts'), 'utf8')
    expect(source).toContain("from 'fflate/browser'")
    expect(source).not.toMatch(/from 'fflate'/)
  })
})
