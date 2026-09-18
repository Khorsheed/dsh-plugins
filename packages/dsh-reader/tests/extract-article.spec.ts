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
    expect(out).toBe('<p><img src="https://example.com/img/a.png" alt="A"></p>')
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
