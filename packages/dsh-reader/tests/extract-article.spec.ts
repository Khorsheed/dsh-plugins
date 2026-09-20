// @vitest-environment jsdom
/**
 * Article extraction and rich-text normalization, tested against two REAL
 * pages rather than invented markup.
 *
 * The fixtures are the whole point: a scorer tuned on English prose rejects
 * Chinese paragraphs (which are short by nature) and then falls back to the
 * page container, so the Chinese case is what proves the language-aware
 * threshold works. Both fixtures were captured with the host's own fetch
 * headers, and both are large enough that the host's 100 000-character body cap
 * would truncate them — the extraction path is exercised on the full text here.
 *
 * To refresh a fixture, fetch the page and slice the article container:
 * `https://www.ruanyifeng.com/blog/2024/06/weekly-issue-305.html` (div
 * `asset-content entry-content` sets a tight body); for the English sample,
 * `https://www.anthropic.com/research/intelligence-targeting-conventional-weapons-capabilities`
 * (the `Body-module` container).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractArticle,
  normalizeInline,
  normalizeRichText,
} from '../src/client/extract-article.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

/** Readable text of a markup string. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Number of block paragraphs in a markup string. */
function paragraphs(html: string): number {
  return (html.match(/<p>/g) ?? []).length
}

describe('extractArticle — English page', () => {
  const page = fixture('article-en.html')

  it('finds the article body and keeps its prose', () => {
    const result = extractArticle(page, 'https://www.anthropic.com/research/example')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = textOf(result.html)
    expect(text).toContain('Anthropic')
    expect(text).toContain('Frontier Red Team')
    expect(paragraphs(result.html)).toBeGreaterThanOrEqual(10)
    expect(text.length).toBeGreaterThan(15_000)
  })

  it('never emits executable or style content', () => {
    const result = extractArticle(page, 'https://example.com/a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).not.toMatch(/<script/i)
    expect(result.html).not.toMatch(/<style/i)
    expect(result.html).not.toMatch(/\son[a-z]+=/i)
  })

  it('keeps links absolute and neutralizes hostile schemes', () => {
    const result = extractArticle(
      '<html><body><article><p>One paragraph long enough to be scored as prose, honestly.</p>'
      + '<p>A second paragraph so the extracted body clears the minimum usable size, which guards '
      + 'against yielding a fragment of navigation instead of an article.</p>'
      + '<p><a href="/relative/page">ok</a> <a href="javascript:alert(1)">bad</a></p></article></body></html>',
      'https://example.com/root/',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain('href="https://example.com/relative/page"')
    expect(result.html).toContain('rel="noopener noreferrer"')
    expect(result.html).not.toContain('javascript:')
    // The text of a neutralized anchor survives even though its href did not.
    expect(textOf(result.html)).toContain('bad')
  })
})

describe('extractArticle — Chinese page', () => {
  const body = fixture('article-zh.html')

  it('finds the article body even though Chinese paragraphs are short', () => {
    const result = extractArticle(body, 'https://www.ruanyifeng.com/blog/2024/06/weekly-issue-305.html')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = textOf(result.html)
    expect(text).toContain('随机数')
    expect(text).toContain('熔岩灯')
    expect(text).toContain('Cloudflare')
    // Chinese prose splits into many short paragraphs; a Latin threshold would
    // reject nearly all of them and the score would collapse.
    expect(paragraphs(result.html)).toBeGreaterThanOrEqual(60)
  })

  it('does not drag in the page-level chrome (previous/next links)', () => {
    const result = extractArticle(body, 'https://www.ruanyifeng.com/blog/2024/06/weekly-issue-305.html')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // "上一篇" ("previous post") exists only in the page's own navigation.
    expect(textOf(result.html)).not.toContain('上一篇')
  })
})

describe('extractArticle — failure modes', () => {
  it('refuses an empty page', () => {
    expect(extractArticle('', 'https://example.com')).toEqual({ ok: false, error: 'empty page' })
  })

  it('refuses a page with no prose at all', () => {
    const result = extractArticle(
      '<html><body><div><a href="/a">one</a><a href="/b">two</a></div></body></html>',
      'https://example.com',
    )
    expect(result.ok).toBe(false)
  })

  it('refuses a body below the minimum usable size', () => {
    const result = extractArticle(
      '<html><body><article><p>Four score and seven years ago, nothing much happened.</p></article></body></html>',
      'https://example.com',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('too small')
  })
})

describe('normalizeRichText', () => {
  it('unwraps unknown elements instead of dropping their text', () => {
    const out = normalizeRichText('<div class="wrap"><span>hello</span> world</div>')
    expect(out).toBe('hello world')
  })

  it('drops script, style and form subtrees entirely', () => {
    const out = normalizeRichText(
      '<p>keep</p><script>steal()</script><style>p{}</style><form><input value="x"></form>',
    )
    expect(out).toBe('<p>keep</p>')
  })

  it('keeps structural tags and drops unknown attributes', () => {
    const out = normalizeRichText('<p class="x" onclick="evil()">hi</p><ul><li>one</li></ul>')
    expect(out).toBe('<p>hi</p><ul><li>one</li></ul>')
  })

  it('absolutizes relative media against the page url', () => {
    const out = normalizeRichText('<p><img src="/img/a.png" alt="A"></p>', 'https://example.com/post/')
    expect(out).toBe('<p><img src="https://example.com/img/a.png" alt="A" referrerpolicy="no-referrer"></p>')
  })

  it('drops Cloudflare email-obfuscation placeholders', () => {
    // The real artifact: a publisher behind Cloudflare ships an anchor whose
    // text a script decodes at runtime. We strip scripts, so the placeholder
    // must not survive into the reader.
    const out = normalizeRichText(
      '<p>Contact <a href="/cdn-cgi/l/email-protection" class="__cf_email__" '
      + 'data-cfemail="671e0e01020900">[email&#160;protected]</a> for details.</p>',
    )
    expect(out).not.toContain('email')
    expect(out).toContain('Contact')
    expect(out).toContain('for details.')
  })

  it('drops an image with no usable source', () => {
    expect(normalizeRichText('<p><img src="data:image/png;base64,AAAA"></p>')).toBe('<p></p>')
  })

  it('drops a noscript whose fallback is not an image', () => {
    // The "please enable JavaScript" sentence a noscript usually carries is
    // chrome, not content — it must not leak into the body.
    const out = normalizeRichText('<p>real text</p><noscript><p>Please enable JavaScript to view this page.</p></noscript>')
    expect(out).toBe('<p>real text</p>')
  })

  it('keeps noscript text out of inline summaries too', () => {
    expect(normalizeInline('<p>real text</p><noscript>Please enable JavaScript.</noscript>')).toBe('real text')
  })

  it('returns empty for empty input', () => {
    expect(normalizeRichText('   ')).toBe('')
  })
})

describe('normalizeInline', () => {
  it('keeps emphasis but flattens blocks and links', () => {
    const out = normalizeInline('<div>a <strong>b</strong> <a href="https://x.test">c</a></div>')
    expect(out).toBe('a <strong>b</strong> c')
  })

  it('drops script content', () => {
    expect(normalizeInline('<p>x</p><script>steal()</script>')).toBe('x')
  })
})

describe('figures the page draws at runtime', () => {
  it('counts a caption-only figure and KEEPS its caption', () => {
    // Measured on transformer-circuits.pub: `<figure data-fignum="2">` holds an
    // empty `<div class='intro-structural'>` and a caption; the illustration is
    // painted by the page's scripts, which a fetch never runs. The caption is
    // text the page published — dropping it (tried, reverted) turns "this
    // picture cannot be fetched" into "this paragraph lost its data".
    const html = `<html><body><article><p>${'text '.repeat(60)}</p>`
      + `<figure data-fignum="2"><div class="intro-structural"></div><figcaption>Figure 2: a picture drawn at runtime.</figcaption></figure>`
      + `<figure><img src="./png/pic.png"><figcaption>Figure 3: a real image.</figcaption></figure>`
      + `</article></body></html>`
    const result = extractArticle(html, 'https://example.com/paper/')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scriptFigures).toBe(1)
    expect(result.html).toContain('a picture drawn at runtime')
    expect(result.html).toContain('a real image')
    expect(result.html).toContain('https://example.com/paper/png/pic.png')
  })

  it('reports nothing when every figure has its picture', () => {
    const html = `<html><body><article><p>${'text '.repeat(60)}</p>`
      + `<figure><img src="https://example.com/a.png"><figcaption>cap</figcaption></figure>`
      + `</article></body></html>`
    const result = extractArticle(html, 'https://example.com/')
    expect(result.ok && result.scriptFigures).toBeUndefined()
  })
})

describe('the page title block does not come along', () => {
  it('drops the repeated title, the masthead and the leading blanks', () => {
    // Measured on transformer-circuits.pub: the extracted body opened with an
    // empty logo link, the site name, the article title TWICE, four <br>s, and
    // only then the byline — while the pane already renders the entry title.
    const title = 'Verbalizable Representations Form a Global Workspace'
    const html = `<html><head><title>${title}</title></head><body>`
      + `<div class="article-header"><a href="https://example.com"><svg></svg></a>`
      + `<a href="https://example.com">Example Thread</a></div>`
      + `<d-article><d-title><h1>${title}</h1><h1>${title}</h1><br><br></d-title>`
      + `<h3>Authors</h3><p>${'prose '.repeat(40)}</p></d-article></body></html>`
    const result = extractArticle(html, 'https://example.com/paper/')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).not.toContain('<h1>')
    expect(result.html).not.toContain('Example Thread')
    expect(result.html.startsWith('<h3>Authors</h3>')).toBe(true)
  })

  it('keeps a leading figure: a picture is content, not chrome', () => {
    const html = `<html><head><title>T</title></head><body><article>`
      + `<figure><img src="https://example.com/hero.png"><figcaption>Hero</figcaption></figure>`
      + `<p>${'prose '.repeat(40)}</p></article></body></html>`
    const result = extractArticle(html, 'https://example.com/')
    expect(result.ok && result.html).toContain('hero.png')
  })
})


/**
 * Lazy-loaded images: the URL is in the static markup, one attribute over.
 *
 * Every case below is a pattern measured on real publishers: the `<img>` the
 * page ships carries a 1px `data:` placeholder (or no `src` at all), and the
 * real URL sits in a `data-*` attribute, a `srcset`, a `<picture>`'s sources,
 * or the `<noscript>` no-JS fallback. A fetch runs no scripts, so what the
 * normalizer recovers here is the ONLY copy the reader can ever get.
 */
describe('lazy-loaded images are recovered', () => {
  /** A body big enough to extract, with the given markup inside it. */
  const pageWith = (markup: string): string =>
    `<html><head><title>T</title></head><body><article><p>${'prose '.repeat(60)}</p>${markup}</article></body></html>`

  it('reads the real URL from the lazy-loading attributes when src is absent', () => {
    expect(normalizeRichText('<p><img data-src="/img/real.png" alt="A"></p>', 'https://example.com/post/'))
      .toBe('<p><img src="https://example.com/img/real.png" alt="A" referrerpolicy="no-referrer"></p>')
    expect(normalizeRichText('<p><img data-original="https://cdn.example.com/b.png"></p>'))
      .toBe('<p><img src="https://cdn.example.com/b.png" referrerpolicy="no-referrer"></p>')
    expect(normalizeRichText('<p><img data-lazy-src="https://cdn.example.com/c.png"></p>'))
      .toBe('<p><img src="https://cdn.example.com/c.png" referrerpolicy="no-referrer"></p>')
    expect(normalizeRichText('<p><img data-url="https://cdn.example.com/d.png"></p>'))
      .toBe('<p><img src="https://cdn.example.com/d.png" referrerpolicy="no-referrer"></p>')
    expect(normalizeRichText('<p><img data-actualsrc="https://cdn.example.com/e.png"></p>'))
      .toBe('<p><img src="https://cdn.example.com/e.png" referrerpolicy="no-referrer"></p>')
  })

  it('treats a data: src as the placeholder it is and falls through to data-src', () => {
    // The classic lazy pattern: a 1px inline gif in `src`, the article's image
    // in `data-src`. A real `src` still wins over the lazy attributes.
    const out = normalizeRichText(
      '<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/real.png"></p>',
      'https://example.com/post/',
    )
    expect(out).toBe('<p><img src="https://example.com/img/real.png" referrerpolicy="no-referrer"></p>')
    const real = normalizeRichText(
      '<p><img src="/img/shown.png" data-src="/img/other.png"></p>',
      'https://example.com/post/',
    )
    expect(real).toBe('<p><img src="https://example.com/img/shown.png" referrerpolicy="no-referrer"></p>')
  })

  it('picks the largest candidate of a srcset, reading both descriptor kinds', () => {
    expect(normalizeRichText('<p><img srcset="/a-400.png 400w, /a-800.png 800w, /a-200.png 200w"></p>', 'https://example.com/'))
      .toBe('<p><img src="https://example.com/a-800.png" referrerpolicy="no-referrer"></p>')
    expect(normalizeRichText('<p><img srcset="/a.png, /a@3x.png 3x, /a@2x.png 2x"></p>', 'https://example.com/'))
      .toBe('<p><img src="https://example.com/a@3x.png" referrerpolicy="no-referrer"></p>')
  })

  it('still drops the image when srcset has no usable candidate either', () => {
    expect(normalizeRichText('<p><img srcset="data:image/png;base64,AAAA 1x"></p>')).toBe('<p></p>')
  })

  it('resolves a picture to one image: the first usable source, else the fallback img', () => {
    const source = normalizeRichText(
      '<p><picture><source srcset="https://cdn.example.com/wide.webp">'
      + '<img src="/img/fallback.png" alt="A"></picture></p>',
      'https://example.com/post/',
    )
    // The fallback's alt survives on whichever candidate wins — it is the same picture.
    expect(source).toBe('<p><img src="https://cdn.example.com/wide.webp" alt="A" referrerpolicy="no-referrer"></p>')
    const fallback = normalizeRichText(
      '<p><picture><source srcset="data:image/webp;base64,AAAA">'
      + '<img src="/img/fallback.png" alt="A"></picture></p>',
      'https://example.com/post/',
    )
    expect(fallback).toBe('<p><img src="https://example.com/img/fallback.png" alt="A" referrerpolicy="no-referrer"></p>')
  })

  it('recovers the no-JS fallback image out of a noscript', () => {
    const result = extractArticle(pageWith('<noscript><img src="/img/nojs.png" alt="N"></noscript>'), 'https://example.com/post/')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain('<img src="https://example.com/img/nojs.png" alt="N" referrerpolicy="no-referrer">')
  })

  it('does not count a figure whose only markup copy lives in a noscript as script-drawn', () => {
    // The page DID ship this picture — behind a script the fetch never runs.
    // Recovering it is what separates "drawn at runtime" from "lazy".
    const html = pageWith('<figure><noscript><img src="/img/lazy.png"></noscript><figcaption>Figure 1: lazy.</figcaption></figure>')
    const result = extractArticle(html, 'https://example.com/post/')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scriptFigures).toBeUndefined()
    expect(result.html).toContain('https://example.com/img/lazy.png')
    expect(result.html).toContain('Figure 1: lazy.')
  })

  it('leaves the script-drawn-figure notice exactly as it was', () => {
    // A figure whose picture exists ONLY at runtime (an empty container and a
    // caption) still produces the notice — nothing here made that recoverable.
    const html = pageWith('<figure data-fignum="2"><div class="intro-structural"></div><figcaption>Figure 2: drawn at runtime.</figcaption></figure>')
    const result = extractArticle(html, 'https://example.com/post/')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scriptFigures).toBe(1)
    expect(result.html).toContain('drawn at runtime')
    expect(result.html).not.toContain('<img')
  })
})

/**
 * MathML passthrough: arXiv's HTML papers (LaTeXML) carry formulas as
 * `<math alttext="…">`, and the pane's render target (Chromium ≥ 153) renders
 * the presentation subset natively. Dropping it was measured as "the paper's
 * formulas are gone"; keeping it must not open an injection path, so the
 * dangerous members (`annotation-xml`, any script) are pinned GONE here.
 */
describe('MathML formulas survive the whitelist', () => {
  const page = fixture('arxiv-math.html')

  it('keeps the safe presentation subset with alttext and display', () => {
    const result = extractArticle(page, 'https://arxiv.org/html/1706.03762v7')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain('<math alttext="a_{ij}">')
    expect(result.html).toContain('<msub><mi>a</mi><mi>ij</mi></msub>')
    expect(result.html).toContain('<math alttext="\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(\\frac{QK^T}{\\sqrt{d_k}})V" display="block">')
    expect(result.html).toContain('<mfrac>')
    expect(result.html).toContain('<msqrt><mi>d</mi></msqrt>')
    // The TeX source inside <semantics><annotation> is markup-invisible data —
    // it survives (its encoding attribute is stripped), and the visible
    // presentation before it is intact.
    expect(result.html).toContain('<semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation>E=mc^2</annotation></semantics>')
  })

  it('drops annotation-xml and every nested script — the injection vector', () => {
    const result = extractArticle(page, 'https://arxiv.org/html/1706.03762v7')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).not.toContain('annotation-xml')
    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('onerror')
    expect(result.html).not.toContain('alert')
    // The math around the dropped subtree survives on its own terms.
    expect(result.html).toContain('<math alttext="evil"><mtext>safe text</mtext></math>')
  })

  it('does not count a formula-only figure as script-drawn', () => {
    // The figure's content IS the markup (a formula), so the scriptFigures
    // notice must not fire for it.
    const result = extractArticle(page, 'https://arxiv.org/html/1706.03762v7')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scriptFigures).toBeUndefined()
    expect(result.html).toContain('Figure 1: a formula')
  })

  it('keeps math through the feed-body path (normalizeRichText) too', () => {
    const out = normalizeRichText('<p>inline <math alttext="x+y"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></math></p>')
    expect(out).toBe('<p>inline <math alttext="x+y"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></math></p>')
    expect(normalizeRichText('<math><annotation-xml encoding="text/html"><img src="x" onerror="alert(1)"></annotation-xml><mi>x</mi></math>'))
      .toBe('<math><mi>x</mi></math>')
  })

  it('flattens math to its text in an inline summary', () => {
    expect(normalizeInline('<p>a <math><mi>x</mi></math> b</p>')).toBe('a x b')
  })
})

/**
 * LaTeXML embeds vector figures as `<object type="image/svg+xml" data="…">`
 * (measured on arxiv.org/html/2604.03147): the whitelist had no `object`, so
 * the figure vanished and its caption stayed behind, reading as "the plugin
 * lost the image". An image-typed object IS an image for the reader's
 * purposes; every other object keeps being dropped.
 */
describe('an image-typed <object> becomes an <img>', () => {
  const page = fixture('arxiv-object-figure.html')

  it('converts the SVG object figure, absolutized, with its dimensions', () => {
    const result = extractArticle(page, 'https://arxiv.org/html/2604.03147v3')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain(
      '<img src="https://arxiv.org/html/2604.03147v3/circumplex.svg" width="443" height="290" referrerpolicy="no-referrer">',
    )
    expect(result.html).toContain('Figure 1: the circumplex')
    // A figure whose picture is markup (now an img) is not script-drawn.
    expect(result.scriptFigures).toBeUndefined()
  })

  it('still drops a non-image object whole', () => {
    const result = extractArticle(page, 'https://arxiv.org/html/2604.03147v3')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).not.toContain('appendix.pdf')
    expect(result.html).not.toContain('<object')
    // The prose around it is untouched.
    expect(result.html).toContain('embedded file')
  })

  it('applies the same rule through the feed-body path', () => {
    expect(normalizeRichText(
      '<p>x</p><object type="image/svg+xml" data="/fig.svg"></object>',
      'https://example.com/post/',
    )).toBe('<p>x</p><img src="https://example.com/fig.svg" referrerpolicy="no-referrer">')
    expect(normalizeRichText('<p>x</p><object data="/movie.mp4" type="video/mp4"></object>')).toBe('<p>x</p>')
    // An image-typed object with no usable address is nothing.
    expect(normalizeRichText('<p>x</p><object type="image/png"></object>')).toBe('<p>x</p>')
    // A data: address is not a fetchable image here.
    expect(normalizeRichText('<p>x</p><object type="image/png" data="data:image/png;base64,AAAA"></object>')).toBe('<p>x</p>')
  })
})
