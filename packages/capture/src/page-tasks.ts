/**
 * The in-page half of a render: the two functions Chrome evaluates against the
 * loaded document.
 *
 * Both are deliberately SELF-CONTAINED: `page.evaluate` stringifies the
 * function and ships it to the page, so a body may reference its own
 * parameters, its own locals, and browser globals — never a module-scope
 * import (only `import type`, which is erased). The same functions run
 * unchanged under jsdom in the unit tests, which is why globals are probed
 * defensively (`matchMedia`, `CSS.supports`): jsdom lacks both, and the
 * fallback there is to include a conditional rule rather than crash.
 *
 * @module @khorsheed/dsh-capture/page-tasks
 */

/** Parameters of the full-page scroll sweep. */
export interface CaptureSweepArgs {
  /** Dwell per viewport step — lazy figures render on IntersectionObserver and need ≥ ~400 ms in view. */
  readonly dwellMs: number
  /** Total sweep budget; a longer page captures as far as the budget reached. */
  readonly maxMs: number
  /** Viewport fraction advanced per step (overlap keeps boundary content in view). */
  readonly stepRatio: number
}

/** What the sweep did. */
export interface CaptureSweepResult {
  /** Viewport steps taken. */
  readonly steps: number
  /** Wall time spent sweeping (ms). */
  readonly elapsedMs: number
  /** Document height at sweep end (px). */
  readonly docHeight: number
}

/**
 * Scroll the page to the bottom in viewport steps, dwelling at each so
 * IntersectionObserver-gated content actually renders. The document height is
 * re-read every step: lazy content that extends the page extends the sweep.
 * The page is NOT scrolled back afterwards — a virtualizing page could drop
 * off-screen content, and the capture wants everything that ever rendered.
 */
export async function scrollSweepPage(args: CaptureSweepArgs): Promise<CaptureSweepResult> {
  const started = Date.now()
  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const docHeight = (): number => Math.max(
    document.documentElement?.scrollHeight ?? 0,
    document.body?.scrollHeight ?? 0,
  )
  let steps = 0
  for (;;) {
    const height = window.innerHeight || document.documentElement.clientHeight || 800
    const y = window.scrollY || window.pageYOffset || 0
    const maxY = Math.max(0, docHeight() - height)
    if (y >= maxY) break
    window.scrollTo(0, Math.min(maxY, y + Math.max(1, Math.floor(height * args.stepRatio))))
    steps += 1
    await delay(args.dwellMs)
    if (Date.now() - started > args.maxMs) break
  }
  // Dwell once at the bottom: the last viewport's observers fire during it.
  await delay(args.dwellMs)
  return { steps, elapsedMs: Date.now() - started, docHeight: docHeight() }
}

/**
 * The init-script half of the interactive-widget probe: tag every Element that
 * receives a listener, so the classify pass can tell a JS-driven widget apart
 * from a static figure. Runs via `evaluateOnNewDocument` BEFORE any page
 * script (the listener may already be attached at parse time). Idempotent: a
 * same-document re-install keeps the tags already collected.
 *
 * Deliberately NOT detected (documented limits): framework root delegation
 * (the listener sits on an ancestor OUTSIDE the figure — inspecting only the
 * figure's own subtree is exactly what keeps a React root from condemning the
 * whole page), and `onclick`-style property handlers. Canvas subtrees cover
 * the script-rendered case those misses leave behind.
 */
export function installListenerProbe(): void {
  const w = window as unknown as { __captureListeners?: WeakSet<Element> }
  if (w.__captureListeners instanceof WeakSet) return
  const tagged = new WeakSet<Element>()
  w.__captureListeners = tagged
  const original = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: unknown[]): void {
    if (this instanceof Element) tagged.add(this)
    return original.apply(this, args as [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions])
  } as typeof EventTarget.prototype.addEventListener
}

/** One qualified widget's identity and the text its snapshot replaces (the img's alt). */
export interface CaptureWidgetMark {
  readonly id: number
  readonly alt: string
}

/** What the classify pass did. */
export interface CaptureMarkResult {
  /** Outermost `figure`/`d-figure` elements inspected. */
  readonly candidates: number
  /** Candidates that are JS-driven widgets (canvas or an in-subtree listener). */
  readonly qualified: number
  /** Widgets stamped `data-capture-widget`, capped at `maxSnapshots` in document order. */
  readonly marked: readonly CaptureWidgetMark[]
  /** Qualified widgets left as DOM because their box exceeded `maxDimension`. */
  readonly skippedOversize: number
  /** Qualified widgets left as DOM because they render to an empty box. */
  readonly skippedHidden: number
}

/**
 * Classify the page's figures: a figure whose subtree holds a `<canvas>` or an
 * element the listener probe tagged is a JS-driven WIDGET — the serialized
 * copy can only ever show it broken (canvas pixels do not serialize, and its
 * JS-computed absolute positions assume the capture viewport, so they overlap
 * at the reader's column width). Widgets are stamped `data-capture-widget` for
 * the screenshot pass; everything else keeps the DOM route (static composite
 * figures ride the style inlining, which is the fidelity win there).
 *
 * Only the OUTERMOST figure of a nested cluster is considered, and alt text is
 * the figure's non-caption text (capped): the searchable residue of what the
 * pixels replace.
 */
export function markInteractiveWidgets(args: {
  readonly maxSnapshots: number
  readonly maxDimension: number
  readonly altMaxChars: number
}): CaptureMarkResult {
  const tagged = (window as unknown as { __captureListeners?: WeakSet<Element> }).__captureListeners
  const hasListener = (el: Element): boolean => tagged !== undefined && tagged.has(el)
  const isFigure = (el: Element): boolean => {
    const name = el.localName.toLowerCase()
    return name === 'figure' || name === 'd-figure'
  }
  const candidates = Array.from(document.querySelectorAll('figure, d-figure'))
    .filter((el) => {
      let parent = el.parentElement
      while (parent !== null) {
        if (isFigure(parent)) return false
        parent = parent.parentElement
      }
      return true
    })
  const marked: CaptureWidgetMark[] = []
  let qualified = 0
  let skippedOversize = 0
  let skippedHidden = 0
  for (const el of candidates) {
    const subtree = [el, ...Array.from(el.querySelectorAll('*'))]
    if (el.querySelector('canvas') === null && !subtree.some(hasListener)) continue
    qualified += 1
    if (marked.length >= args.maxSnapshots) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      skippedHidden += 1
      continue
    }
    if (rect.width > args.maxDimension || rect.height > args.maxDimension) {
      skippedOversize += 1
      continue
    }
    const id = marked.length
    el.setAttribute('data-capture-widget', String(id))
    const caption = el.querySelector('figcaption')?.textContent ?? ''
    const alt = (el.textContent ?? '')
      .replace(caption, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, args.altMaxChars)
    marked.push({ id, alt })
  }
  return { candidates: candidates.length, qualified, marked, skippedOversize, skippedHidden }
}

/** A widget's page-coordinate clip for the screenshot pass. */
export interface CaptureWidgetRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Re-read one stamped widget's box (fresh: late reflow shifts figures) in PAGE
 * coordinates, clamped to the document — Chrome refuses an out-of-bounds clip.
 * The clip is the union of the widget's NON-FIGCAPTION children: the caption
 * stays in the DOM as text, so its pixels must not ride the image (it would
 * render twice). A figure with no measurable content child falls back to its
 * own box. Undefined when the widget vanished or renders to nothing; the
 * caller leaves its DOM in place.
 */
export function widgetPageRect(id: number): CaptureWidgetRect | undefined {
  const el = document.querySelector(`[data-capture-widget="${id}"]`)
  if (el === null) return undefined
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let measured = false
  for (const child of Array.from(el.children)) {
    if (child.localName.toLowerCase() === 'figcaption') continue
    const childRect = child.getBoundingClientRect()
    if (childRect.width < 1 || childRect.height < 1) continue
    measured = true
    left = Math.min(left, childRect.left)
    top = Math.min(top, childRect.top)
    right = Math.max(right, childRect.right)
    bottom = Math.max(bottom, childRect.bottom)
  }
  const rect = measured
    ? { left, top, width: right - left, height: bottom - top }
    : el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return undefined
  const scrollX = window.scrollX ?? window.pageXOffset ?? 0
  const scrollY = window.scrollY ?? window.pageYOffset ?? 0
  const docWidth = Math.max(document.documentElement?.scrollWidth ?? 0, document.body?.scrollWidth ?? 0)
  const docHeight = Math.max(document.documentElement?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0)
  const x = Math.max(0, rect.left + scrollX)
  const y = Math.max(0, rect.top + scrollY)
  // A few px of slack: axis labels and shadows regularly overflow the
  // children's boxes by a hair; the caption sits a margin's width away.
  const pad = 8
  return {
    x: Math.max(0, x - pad),
    y: Math.max(0, y - pad),
    width: Math.max(1, Math.min(rect.width + pad * 2, docWidth - Math.max(0, x - pad))),
    height: Math.max(1, Math.min(rect.height + pad * 2, docHeight - Math.max(0, y - pad))),
  }
}

/** One screenshot's swap instruction: the widget's id, its pixels, and its CSS-pixel box. */
export interface CaptureSnapshotReplacement {
  readonly id: number
  readonly dataUri: string
  readonly width: number
  readonly height: number
  readonly alt: string
}

/**
 * Swap each screenshotted widget's subtree for a single `<img>` of its
 * rendered pixels. The `figcaption` survives as TEXT (captions ride the
 * reader's translate/cite pipeline even though the widget's own text became
 * pixels, with the alt holding its searchable residue); width/height carry
 * the aspect ratio. Returns the swaps applied — a widget the screenshot pass
 * could not reach simply never appears in `replacements` and keeps its DOM.
 */
export function replaceWidgetsWithSnapshots(replacements: readonly CaptureSnapshotReplacement[]): number {
  let replaced = 0
  for (const replacement of replacements) {
    const el = document.querySelector(`[data-capture-widget="${replacement.id}"]`)
    if (el === null) continue
    const img = document.createElement('img')
    img.setAttribute('src', replacement.dataUri)
    img.setAttribute('alt', replacement.alt)
    img.setAttribute('width', String(Math.round(replacement.width)))
    img.setAttribute('height', String(Math.round(replacement.height)))
    img.setAttribute('data-capture-snapshot', 'widget')
    let caption: Element | undefined
    for (const child of Array.from(el.children)) {
      if (child.localName.toLowerCase() === 'figcaption') {
        caption ??= child
      }
    }
    for (const node of Array.from(el.childNodes)) {
      if (node !== caption) node.remove()
    }
    el.insertBefore(img, caption ?? null)
    el.removeAttribute('data-capture-widget')
    replaced += 1
  }
  return replaced
}

/** Parameters of the inline-and-serialize pass. */
export interface CaptureSerializeArgs {
  /** Serialized-output cap in characters; the tail is cut and `truncated` set. */
  readonly maxChars: number
}

/** What the serialize pass produced, with the counters a diagnostic wants. */
export interface CaptureSerializeResult {
  /** `<!DOCTYPE html>` + the serialized document. */
  readonly html: string
  /** True when the document was cut at `maxChars`. */
  readonly truncated: boolean
  /** `document.title` at capture time. */
  readonly title: string
  /** `location.href` — where the page actually is, after every redirect. */
  readonly finalUrl: string
  /** Elements that received at least one inlined declaration. */
  readonly inlinedElements: number
  /** Declarations inlined, summed over elements. */
  readonly inlinedDeclarations: number
  /** Pre-existing `var()`-bearing SVG presentation attributes rewritten to their resolved value. */
  readonly resolvedAttributes: number
  /** Stylesheets whose rules could not be read (cross-origin). */
  readonly skippedSheets: number
  /** `<script>` elements removed from the output. */
  readonly removedScripts: number
  /** `<style>` elements removed (their rules were inlined into `style` attributes). */
  readonly removedStyles: number
}

/**
 * Inline every matched CSSOM rule into `style` attributes (resolving `var()`),
 * resolve `var()` left in pre-existing SVG presentation attributes (page
 * scripts write `fill="var(--brand)"` as an ATTRIBUTE — no rule matches it),
 * remove scripts and the now-redundant style sources, then serialize.
 *
 * Why inlining is not optional: a JS-rendered figure's colors live in the
 * document's stylesheets (`fill: var(--brand-clay)` in one of dozens of style
 * blocks); a bare `outerHTML` keeps the structure but renders it black. The
 * cascade here is (important, inline-ness, specificity, document order) —
 * close enough to the real cascade for the class/attribute selectors these
 * pages use, and exact for the declarations that color figures. Custom
 * properties resolve from the readable cascade first, with a
 * `getComputedStyle` fallback for runtime-set or cross-origin-defined ones.
 */
export function inlineStylesAndSerialize(args: CaptureSerializeArgs): CaptureSerializeResult {
  // Every value this body reads is declared INSIDE it: the function is
  // stringified into the page, where the module scope does not exist.
  const SVG_PRESENTATION_ATTRIBUTES: readonly string[] = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'opacity', 'color', 'visibility', 'text-anchor',
    'font-family', 'font-size', 'font-style', 'font-weight',
  ]

  type Specificity = readonly [number, number, number]

  interface Declaration {
    readonly prop: string
    readonly value: string
    readonly important: boolean
  }
  interface SelectorPart {
    readonly selector: string
    readonly specificity: Specificity
    /** Rightmost-compound requirements used as a cheap exact prefilter. */
    readonly ids: readonly string[]
    readonly classes: readonly string[]
    readonly tag: string | undefined
  }
  interface CollectedRule {
    readonly parts: readonly SelectorPart[]
    readonly declarations: readonly Declaration[]
    readonly order: number
  }

  const compareSpecificity = (a: Specificity, b: Specificity): number =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

  /** Split a selector list on TOP-LEVEL commas (paren/bracket/string aware). */
  const splitSelectorList = (text: string): string[] => {
    const out: string[] = []
    let depth = 0
    let quote = ''
    let start = 0
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]!
      if (quote !== '') {
        if (ch === '\\') i += 1
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === '"' || ch === "'") quote = ch
      else if (ch === '(' || ch === '[') depth += 1
      else if (ch === ')' || ch === ']') depth -= 1
      else if (ch === ',' && depth === 0) {
        out.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    out.push(text.slice(start).trim())
    return out.filter((part) => part !== '')
  }

  /**
   * Flatten one CSS-NESTING level: `&` substitutes the parent selector (a
   * parent list wraps in `:is()`), and a nested selector without `&` is a
   * descendant of `:is(parent)` — per spec. `specificityOf` already scores
   * `:is()` by its max argument, which is exactly the nested rule's cascade
   * weight.
   */
  const flattenNestedSelector = (parent: string, child: string): string => {
    if (child.includes('&')) {
      const wrapped = parent.includes(',') ? `:is(${parent})` : parent
      return child.replace(/&/g, wrapped)
    }
    return `:is(${parent}) ${child}`
  }

  /** Read past an identifier (with escapes) starting at `i`; returns the end index. */
  const skipIdent = (s: string, i: number): number => {
    while (i < s.length) {
      const ch = s[i]!
      if (ch === '\\') i += 2
      else if (/[\w-]/.test(ch)) i += 1
      else break
    }
    return i
  }

  /** Skip a balanced group whose opener (`(` or `[`) is at `i`; returns the index after the closer. */
  const skipGroup = (s: string, i: number, open: string, close: string): number => {
    let depth = 0
    let quote = ''
    for (; i < s.length; i += 1) {
      const ch = s[i]!
      if (quote !== '') {
        if (ch === '\\') i += 1
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === '"' || ch === "'") quote = ch
      else if (ch === open) depth += 1
      else if (ch === close) {
        depth -= 1
        if (depth === 0) return i + 1
      }
    }
    return i
  }

  /** The text inside a `(...)` group whose opener is at `open`. */
  const groupContent = (s: string, open: number): string => s.slice(open + 1, skipGroup(s, open, '(', ')') - 1)

  /**
   * Approximate selector specificity: ids / classes+attributes+pseudo-classes /
   * elements+pseudo-elements. `:where()` is zero; `:not()/:is()/:has()` take
   * the maximum of their arguments; `::x` and the legacy single-colon
   * pseudo-elements count as elements. Adequate for the class-heavy rule sets
   * figure pages use; not a full CSS parser (a documented fidelity limit).
   */
  const specificityOf = (selector: string): Specificity => {
    let a = 0
    let b = 0
    let c = 0
    const s = selector
    let i = 0
    while (i < s.length) {
      const ch = s[i]!
      if (ch === '#') {
        a += 1
        i = skipIdent(s, i + 1)
      } else if (ch === '.') {
        b += 1
        i = skipIdent(s, i + 1)
      } else if (ch === '[') {
        b += 1
        i = skipGroup(s, i, '[', ']')
      } else if (ch === ':') {
        if (s[i + 1] === ':') {
          c += 1
          i = skipIdent(s, i + 2)
          if (s[i] === '(') i = skipGroup(s, i, '(', ')')
        } else {
          const end = skipIdent(s, i + 1)
          const name = s.slice(i + 1, end).toLowerCase()
          i = end
          if (s[i] === '(') {
            if (name === 'where') {
              i = skipGroup(s, i, '(', ')')
            } else if (name === 'not' || name === 'is' || name === 'has' || name === 'matches') {
              let best: Specificity = [0, 0, 0]
              for (const part of splitSelectorList(groupContent(s, i))) {
                const spec = specificityOf(part)
                if (compareSpecificity(spec, best) > 0) best = spec
              }
              a += best[0]
              b += best[1]
              c += best[2]
              i = skipGroup(s, i, '(', ')')
            } else {
              b += 1
              i = skipGroup(s, i, '(', ')')
            }
          } else if (name === 'before' || name === 'after' || name === 'first-line' || name === 'first-letter') {
            c += 1
          } else {
            b += 1
          }
        }
      } else if (ch === '\\') {
        c += 1
        i += 2
      } else if (/[\w-]/.test(ch)) {
        c += 1
        i = skipIdent(s, i)
      } else {
        // Combinators (whitespace, >, +, ~), the universal *, list commas.
        i += 1
      }
    }
    return [a, b, c] as const
  }

  /** The rightmost compound's prefilter requirements for one selector. */
  const prefilterOf = (selector: string): { ids: string[]; classes: string[]; tag: string | undefined } => {
    // Cut after the last TOP-LEVEL combinator; the subject compound follows it.
    let depth = 0
    let quote = ''
    let cut = 0
    for (let i = 0; i < selector.length; i += 1) {
      const ch = selector[i]!
      if (quote !== '') {
        if (ch === '\\') i += 1
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === '"' || ch === "'") quote = ch
      else if (ch === '(' || ch === '[') depth += 1
      else if (ch === ')' || ch === ']') depth -= 1
      else if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) cut = i + 1
      else if (depth === 0 && /\s/.test(ch) && selector.slice(cut, i).trim() !== '') cut = i + 1
    }
    const subject = selector.slice(cut).trim()
    const ids: string[] = []
    const classes: string[] = []
    let tag: string | undefined
    const tokenRe = /#([\w-]+)|\.([\w-]+)/g
    let m: RegExpExecArray | null
    while ((m = tokenRe.exec(subject)) !== null) {
      if (m[1] !== undefined) ids.push(m[1])
      if (m[2] !== undefined) classes.push(m[2])
    }
    const lead = /^([a-zA-Z][\w-]*)/.exec(subject)
    if (lead !== null) tag = lead[1]!.toLowerCase()
    return { ids, classes, tag }
  }

  /** Collect the readable rules of one rule list, honoring conditional groups. */
  const collectRules = (rules: ArrayLike<CSSRule>, into: CollectedRule[], order: { value: number }, parentSelector?: string): void => {
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i]!
      const kind = rule.constructor?.name ?? ''
      if (rule.type === 1) {
        const styleRule = rule as CSSStyleRule
        const declarations: Declaration[] = []
        const style = styleRule.style
        for (let d = 0; d < style.length; d++) {
          const prop = style.item(d)
          const value = style.getPropertyValue(prop)
          if (value === '') continue
          declarations.push({ prop, value, important: style.getPropertyPriority(prop) === 'important' })
        }
        // CSS nesting: the selector flattens against the enclosing rule's
        // (`& .if-row` under `.intro-functional`). Nested declarations keep
        // document order relative to the parent's own ones by construction.
        const flattened = parentSelector === undefined
          ? styleRule.selectorText
          : flattenNestedSelector(parentSelector, styleRule.selectorText)
        if (declarations.length > 0) {
          const parts = splitSelectorList(flattened).map((selector) => ({
            selector,
            specificity: specificityOf(selector),
            ...prefilterOf(selector),
          }))
          into.push({ parts, declarations, order: order.value })
          order.value += 1
        }
        // Nested rules ride the style rule's cssRules — a type-1 rule is not a
        // leaf when nesting is in play (measured: transformer-circuits lays
        // out its figure grids with `.intro-functional { & .if-row {…} }`).
        const nested = (styleRule as unknown as { cssRules?: ArrayLike<CSSRule> }).cssRules
        if (nested !== undefined && nested.length > 0) {
          collectRules(nested, into, order, flattened)
        }
      } else if (kind === 'CSSNestedDeclarations') {
        // Bare declarations between nested rules apply to the PARENT selector.
        if (parentSelector !== undefined) {
          const style = (rule as unknown as { style: CSSStyleDeclaration }).style
          const declarations: Declaration[] = []
          for (let d = 0; d < style.length; d += 1) {
            const prop = style.item(d)
            const value = style.getPropertyValue(prop)
            if (value === '') continue
            declarations.push({ prop, value, important: style.getPropertyPriority(prop) === 'important' })
          }
          if (declarations.length > 0) {
            const parts = splitSelectorList(parentSelector).map((selector) => ({
              selector,
              specificity: specificityOf(selector),
              ...prefilterOf(selector),
            }))
            into.push({ parts, declarations, order: order.value })
            order.value += 1
          }
        }
      } else if (kind === 'CSSMediaRule' || (rule.type === 4 && 'media' in rule)) {
        const mediaRule = rule as CSSMediaRule
        const text = mediaRule.media?.mediaText ?? ''
        // jsdom has no matchMedia: include rather than drop (test path only;
        // a real browser always evaluates the condition).
        if (text === '' || typeof window.matchMedia !== 'function' || window.matchMedia(text).matches) {
          collectRules(mediaRule.cssRules, into, order, parentSelector)
        }
      } else if (kind === 'CSSSupportsRule') {
        const supportsRule = rule as CSSSupportsRule
        if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports(supportsRule.conditionText)) {
          collectRules(supportsRule.cssRules, into, order, parentSelector)
        }
      } else if (kind === 'CSSImportRule') {
        const styleSheet = (rule as CSSImportRule).styleSheet
        if (styleSheet !== null && styleSheet !== undefined) {
          try {
            collectRules(styleSheet.cssRules, into, order, parentSelector)
          } catch {
            // An imported cross-origin sheet refuses reads; its rules are lost.
          }
        }
      } else if ('cssRules' in rule && kind !== 'CSSFontFaceRule' && kind !== 'CSSKeyframesRule') {
        // Layers, containers, scopes: include the contents (document order is
        // an adequate layer-order approximation for v1).
        collectRules((rule as unknown as { cssRules: ArrayLike<CSSRule> }).cssRules, into, order, parentSelector)
      }
    }
  }

  const collected: CollectedRule[] = []
  let skippedSheets = 0
  const order = { value: 0 }
  for (let s = 0; s < document.styleSheets.length; s += 1) {
    try {
      collectRules(document.styleSheets[s]!.cssRules, collected, order)
    } catch {
      skippedSheets += 1 // a cross-origin sheet refuses cssRules reads
    }
  }

  interface Winner {
    value: string
    important: boolean
    /** null = inline style (beats any selector rule, loses to important rules). */
    specificity: Specificity | null
    order: number
  }

  /** Does the part's rightmost compound allow `el`? (Exact requirements only — never excludes a real match.) */
  const partMightMatch = (el: Element, part: SelectorPart): boolean => {
    if (part.ids.length > 0 && !part.ids.includes(el.id)) return false
    for (const cls of part.classes) {
      if (!el.classList.contains(cls)) return false
    }
    if (part.tag !== undefined && el.localName.toLowerCase() !== part.tag) return false
    return true
  }

  const matchesPart = (el: Element, part: SelectorPart): boolean => {
    if (!partMightMatch(el, part)) return false
    try {
      return el.matches(part.selector)
    } catch {
      return false // a selector this engine cannot parse matches nothing
    }
  }

  /** One element's winning declarations (matched rules + its own inline style). */
  const winnersFor = (el: Element): Map<string, Winner> => {
    const winners = new Map<string, Winner>()
    const consider = (prop: string, value: string, important: boolean, specificity: Specificity | null, at: number): void => {
      const current = winners.get(prop)
      if (current !== undefined) {
        if (current.important !== important) {
          if (!important) return // the important incumbent wins
        } else if ((specificity === null) !== (current.specificity === null)) {
          if (specificity !== null) return // the inline incumbent wins
        } else if (specificity !== null && current.specificity !== null) {
          const cmp = compareSpecificity(specificity, current.specificity)
          if (cmp < 0 || (cmp === 0 && at <= current.order)) return
        } else if (at <= current.order) return
      }
      winners.set(prop, { value, important, specificity, order: at })
    }
    for (const rule of collected) {
      let best: SelectorPart | undefined
      for (const part of rule.parts) {
        if (!matchesPart(el, part)) continue
        if (best === undefined || compareSpecificity(part.specificity, best.specificity) > 0) best = part
      }
      if (best === undefined) continue
      // `at` = rule order scaled, plus the declaration's index INSIDE the rule:
      // two declarations of one property in one rule (vendor-fallback pairs
      // like `display: -webkit-box; display: flex`) resolve to the LAST one,
      // as the real cascade does.
      for (const [d, declaration] of rule.declarations.entries()) {
        consider(declaration.prop, declaration.value, declaration.important, best.specificity, rule.order * 100_000 + d)
      }
    }
    const inline = (el as HTMLElement).style
    if (inline !== undefined && inline !== null) {
      for (let d = 0; d < inline.length; d += 1) {
        const prop = inline.item(d)
        const value = inline.getPropertyValue(prop)
        if (value === '') continue
        consider(prop, value, inline.getPropertyPriority(prop) === 'important', null, d)
      }
    }
    return winners
  }

  /**
   * Resolve `var(--x, fallback)` references against the element's custom
   * properties. The cascade map (readable CSSOM rules + inline `--*`) answers
   * first; on a miss, `getComputedStyle` answers from the FULL cascade — that
   * fallback is what sees custom properties set by the page's own scripts at
   * runtime and those from cross-origin sheets (they apply but refuse reads).
   */
  const resolveVars = (value: string, vars: ReadonlyMap<string, string>, seen: ReadonlySet<string>, depth: number, el?: Element): string => {
    if (depth > 10 || !value.includes('var(')) return value
    let out = ''
    let i = 0
    while (i < value.length) {
      const at = value.indexOf('var(', i)
      if (at === -1) {
        out += value.slice(i)
        break
      }
      out += value.slice(i, at)
      const close = skipGroup(value, at + 3, '(', ')')
      const inner = value.slice(at + 4, close - 1)
      // Split name / fallback on the first top-level comma.
      let comma = -1
      let innerDepth = 0
      for (let j = 0; j < inner.length; j += 1) {
        const ch = inner[j]!
        if (ch === '(') innerDepth += 1
        else if (ch === ')') innerDepth -= 1
        else if (ch === ',' && innerDepth === 0) {
          comma = j
          break
        }
      }
      const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
      const fallback = comma === -1 ? undefined : inner.slice(comma + 1)
      let resolved = vars.get(name)
      if (resolved === undefined && el !== undefined && typeof getComputedStyle === 'function') {
        try {
          const computed = getComputedStyle(el).getPropertyValue(name)
          if (computed !== '') resolved = computed
        } catch {
          // An engine that cannot answer computed custom properties misses here.
        }
      }
      if (resolved !== undefined && !seen.has(name)) {
        out += resolveVars(resolved, vars, new Set([...seen, name]), depth + 1, el)
      } else if (fallback !== undefined) {
        out += resolveVars(fallback, vars, seen, depth + 1, el)
      } else {
        out += 'unset' // unresolved custom property: the declaration computes to invalid/unset
      }
      i = close
    }
    return out
  }

  const SVG_NS = 'http://www.w3.org/2000/svg'
  const varMaps = new Map<Element, ReadonlyMap<string, string>>()
  const EMPTY_VARS: ReadonlyMap<string, string> = new Map()

  /** The element's effective custom properties: the parent's, overridden by its own winners. */
  const effectiveVars = (el: Element, ownWinners: Map<string, Winner>): ReadonlyMap<string, string> => {
    const parentVars = el.parentElement === null ? EMPTY_VARS : varMaps.get(el.parentElement) ?? EMPTY_VARS
    const own = new Map<string, string>()
    for (const [prop, winner] of ownWinners) {
      if (prop.startsWith('--')) own.set(prop, winner.value)
    }
    if (own.size === 0) return parentVars
    const merged = new Map<string, string>(parentVars)
    for (const [prop, value] of own) merged.set(prop, value)
    return merged
  }

  let inlinedElements = 0
  let inlinedDeclarations = 0
  let resolvedAttributes = 0
  const walker = document.createTreeWalker(document.documentElement, 1 /* elements only */)
  let node: Element | null = document.documentElement
  while (node !== null) {
    const el: Element = node
    const winners = winnersFor(el)
    const vars = effectiveVars(el, winners)
    varMaps.set(el, vars) // document order: a child's read always finds its parent
    // Resolve var() in the RAW style attribute text FIRST: a browser decomposes
    // an inline shorthand carrying var() (`background: var(--x)`) into
    // pending-substitution longhands that enumerate with empty values, so the
    // winners walk never sees the declaration — and any setProperty mutation
    // regenerates the attribute from the CSSOM, so this must precede the
    // winners write. (A rule winner for the same property written afterwards
    // then wins over the inline declaration — the one wrong direction, bounded
    // to shorthand-with-var × matching-rule, documented as a fidelity limit.)
    let rawStyle: string | null = null
    try {
      rawStyle = el.getAttribute('style')
    } catch {
      rawStyle = null
    }
    if (rawStyle !== null && rawStyle.includes('var(')) {
      const resolved = resolveVars(rawStyle, vars, new Set(), 0, el)
      if (resolved !== rawStyle && !resolved.includes('unset')) {
        try {
          el.setAttribute('style', resolved)
          resolvedAttributes += 1
        } catch {
          // Best-effort; the raw text stays.
        }
      }
    }
    if (winners.size > 0) {
      const styleEl = el as HTMLElement
      let wrote = false
      for (const [prop, winner] of winners) {
        if (prop.startsWith('--')) continue // custom properties serve resolution; they are not emitted
        const value = winner.value.includes('var(') ? resolveVars(winner.value, vars, new Set(), 0, el) : winner.value
        if (value === '' || value === 'unset') continue
        try {
          styleEl.style.setProperty(prop, value, winner.important ? 'important' : '')
          wrote = true
          inlinedDeclarations += 1
        } catch {
          // A property this engine refuses (vendor syntax) is dropped, not fatal.
        }
        if (el.namespaceURI === SVG_NS && SVG_PRESENTATION_ATTRIBUTES.includes(prop)) {
          try {
            el.setAttribute(prop, value)
          } catch {
            // Attribute writes are best-effort; the style attribute already carries the value.
          }
        }
      }
      if (wrote) inlinedElements += 1
    }
    // Pre-existing var() in PRESENTATION ATTRIBUTES: page scripts write
    // `fill="var(--brand)"` as an attribute (legal; the browser resolves it
    // from the cascade), and no matched rule exists to rewrite it — resolve
    // it here or the serialized document keeps a reference whose definition
    // the removed style blocks used to carry.
    if (el.namespaceURI === SVG_NS) {
      for (const attr of SVG_PRESENTATION_ATTRIBUTES) {
        let raw: string | null = null
        try {
          raw = el.getAttribute(attr)
        } catch {
          continue
        }
        if (raw === null || !raw.includes('var(')) continue
        const resolved = resolveVars(raw, vars, new Set(), 0, el)
        if (resolved === '' || resolved.includes('unset')) continue // keep the raw attribute rather than write a half-resolved one
        try {
          el.setAttribute(attr, resolved)
          resolvedAttributes += 1
        } catch {
          // Best-effort, as above.
        }
      }
    }
    node = walker.nextNode() as Element | null
  }

  let removedScripts = 0
  for (const script of Array.from(document.querySelectorAll('script'))) {
    script.remove()
    removedScripts += 1
  }
  let removedStyles = 0
  for (const styleNode of Array.from(document.querySelectorAll('style'))) {
    styleNode.remove()
    removedStyles += 1
  }
  for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet" i]'))) {
    link.remove()
  }

  const doctype = document.doctype !== null ? `<!DOCTYPE ${document.doctype.name}>\n` : ''
  let html = doctype + document.documentElement.outerHTML
  let truncated = false
  if (html.length > args.maxChars) {
    html = html.slice(0, args.maxChars)
    truncated = true
  }
  return {
    html,
    truncated,
    title: document.title,
    finalUrl: window.location.href,
    inlinedElements,
    inlinedDeclarations,
    resolvedAttributes,
    skippedSheets,
    removedScripts,
    removedStyles,
  }
}
