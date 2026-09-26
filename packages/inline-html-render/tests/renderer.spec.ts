// @vitest-environment jsdom
// Renderer DOM logic: finds a rendered `dsh-card` block, inserts a sandboxed
// iframe sibling, hides the block; ignores blocks whose info string is not
// `dsh-card`, ignores already-processed blocks, and never mounts while the
// message is streaming (`data-streaming`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installCardRenderer, reconcile } from '../src/client/renderer.ts'

/**
 * Build a fake rendered markdown block shaped like the official CodeBlock.
 * `hashedBanner` mirrors the real render in this release: the banner wrap is a
 * hashed-class div whose leading text is `<infoString>复制` (info string then
 * the localized copy label) with NO `.infostring`/`.banner` element. When
 * false, it uses the explicit `.infostring` element path.
 */
function codeBlock(infoString: string, code: string, streaming = false, hashedBanner = false): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'md-code-block'
  const banner = document.createElement('div')
  if (hashedBanner) {
    banner.className = '_bannerWrap_abc_21'
    // Real render: info string + copy label flattened into the banner text.
    banner.textContent = `${infoString}复制`
  } else {
    banner.className = 'bannerWrap'
    const info = document.createElement('div')
    info.className = 'infostring'
    info.textContent = infoString
    banner.appendChild(info)
  }
  wrap.appendChild(banner)
  const pre = document.createElement('pre')
  const codeEl = document.createElement('code')
  // React renders the mdast code string as literal textContent (the plain
  // CodeBlock path uses `{trimmed}`), so the raw HTML is what `pre.textContent`
  // returns — never an escaped form.
  codeEl.textContent = code
  pre.appendChild(codeEl)
  wrap.appendChild(pre)
  if (streaming) wrap.setAttribute('data-streaming', '')
  return wrap
}

function load(html: string): void {
  document.body.innerHTML = html
}

let cleanup: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanup) fn()
  cleanup = []
  document.body.innerHTML = ''
})

describe('reconcile', () => {
  it('swaps a settled dsh-card block: iframe inserted, block hidden', () => {
    load('')
    const block = codeBlock('dsh-card', '<div>hello</div>')
    document.body.appendChild(block)
    const mounted = reconcile(document.body)
    expect(mounted).toHaveLength(1)
    const frame = document.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.srcdoc).toContain('<div>hello</div>')
    expect(frame?.srcdoc).toContain('window.dshBridge')
    expect(block.style.display).toBe('none')
    expect(block.hasAttribute('data-dsh-card-processed')).toBe(true)
    // The frame is a sibling placed after the block.
    expect(block.nextElementSibling).toBe(frame)
  })

  it('ignores a non-dsh-card block', () => {
    load('')
    document.body.appendChild(codeBlock('python', 'print(1)'))
    expect(reconcile(document.body)).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('ignores an already-processed block', () => {
    load('')
    const a = codeBlock('dsh-card', '<b>x</b>')
    const b = codeBlock('dsh-card', '<i>y</i>')
    a.setAttribute('data-dsh-card-processed', '')
    document.body.appendChild(a)
    document.body.appendChild(b)
    const mounted = reconcile(document.body)
    expect(mounted).toHaveLength(1)
    // Only the unprocessed block got a frame, sitting right after it.
    expect(b.nextElementSibling?.tagName).toBe('IFRAME')
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('does not mount a streaming block', () => {
    load('')
    const block = codeBlock('dsh-card', '<div>partial</div>', true)
    document.body.appendChild(block)
    expect(reconcile(document.body)).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('does not escape the authored html back into text', () => {
    // The code block's textContent is the *decoded* HTML string; the frame must
    // receive the raw markup, not the escaped form.
    load('')
    const block = codeBlock('dsh-card', '<h1>title</h1>')
    document.body.appendChild(block)
    reconcile(document.body)
    const frame = document.querySelector('iframe')
    expect(frame?.srcdoc).toContain('<h1>title</h1>')
    expect(frame?.srcdoc).not.toContain('&lt;h1&gt;')
  })
})

describe('reconcile — real (hashed) renderer DOM shape', () => {
  // The official CodeBlock in this release renders a hashed banner wrap whose
  // leading text is `<infoString>复制`, with NO `.infostring`/`.banner`
  // sub-element. The renderer must detect the card from this shape.
  it('swaps a dsh-card block with no .infostring element', () => {
    load('')
    const block = codeBlock('dsh-card', '<div class="gcard">hello</div>', false, true)
    expect(block.querySelector('.infostring')).toBeNull()
    document.body.appendChild(block)
    const mounted = reconcile(document.body)
    expect(mounted).toHaveLength(1)
    const frame = document.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.srcdoc).toContain('<div class="gcard">hello</div>')
    expect(block.style.display).toBe('none')
    expect(block.hasAttribute('data-dsh-card-processed')).toBe(true)
  })

  it('ignores a non-dsh-card block in the hashed shape', () => {
    load('')
    document.body.appendChild(codeBlock('python', 'print(1)', false, true))
    expect(reconcile(document.body)).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('does not treat a code block whose content starts with dsh-card as a card when it has a different info string', () => {
    load('')
    // A python block whose code body happens to begin with the text "dsh-card"
    // must not be matched: the info string is the real discriminator.
    const block = codeBlock('python', 'dsh-card is not a card', false, true)
    document.body.appendChild(block)
    expect(reconcile(document.body)).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('reconcile — generic-label toolbar shape (0.1.7-rc.1 CodeToolbar)', () => {
  // CodeToolbar shows the host's localized generic label (代码块) for any
  // language shiki cannot highlight: the `dsh-card` info string never reaches
  // the DOM. Detection falls to the content signature.
  function toolbarBlock(code: string): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-code-block'
    const banner = document.createElement('div')
    banner.className = '_bannerWrap_abc_21'
    banner.textContent = '代码块' // the generic localized label, no info string
    wrap.appendChild(banner)
    const pre = document.createElement('pre')
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    pre.appendChild(codeEl)
    wrap.appendChild(pre)
    return wrap
  }

  it('swaps a complete HTML document whose banner shows only the generic label', () => {
    load('')
    const doc = '<!doctype html>\n<meta charset="utf-8">\n<html><body><h1>card</h1></body></html>'
    document.body.appendChild(toolbarBlock(doc))
    const mounted = reconcile(document.body)
    expect(mounted).toHaveLength(1)
    expect(document.querySelector('iframe')?.srcdoc).toContain('<h1>card</h1>')
  })

  it('swaps a fragment that carries the verbatim strict-CSP meta', () => {
    load('')
    const frag = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; worker-src blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n<div>frag</div>'
    document.body.appendChild(toolbarBlock(frag))
    expect(reconcile(document.body)).toHaveLength(1)
  })

  it('leaves an ordinary code listing and an html fragment alone', () => {
    load('')
    document.body.appendChild(toolbarBlock('print(1)'))
    // A fragment with no CSP meta: nothing marks it as a card.
    document.body.appendChild(toolbarBlock('<div>just a fragment</div>'))
    // A complete document that is truncated (no </html> tail): not settled protocol shape.
    document.body.appendChild(toolbarBlock('<!doctype html>\n<html><body>partial'))
    expect(reconcile(document.body)).toHaveLength(0)
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('installCardRenderer', () => {
  beforeEach(() => {
    load('')
  })

  it('mounts on install and tears down on dispose', () => {
    const renderer = installCardRenderer()
    cleanup.push(() => renderer.dispose())

    document.body.appendChild(codeBlock('dsh-card', '<div>hi</div>'))
    // The observer schedules through nextFrame; drive it directly.
    renderer.run()
    const frame = document.querySelector('iframe')
    expect(frame).not.toBeNull()
    const frameEl = frame as HTMLIFrameElement

    renderer.dispose()
    expect(document.querySelector('iframe')).toBeNull()
    // The block is React-owned; its processed marker is cleared on dispose.
    const block = document.querySelector('.md-code-block') as HTMLElement
    expect(block.hasAttribute('data-dsh-card-processed')).toBe(false)
    // The frame node itself is gone (frameEl detached).
    expect(frameEl.parentNode).toBeNull()
  })
})
