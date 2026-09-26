/**
 * Inline card renderer: finds the rendered `.md-code-block` whose infostring is
 * `dsh-card` and replaces its visual slot with a sandboxed iframe running the
 * authored HTML, inline in the conversation flow.
 *
 * React owns the markdown tree, so this plugin NEVER removes a node React
 * created — that would make React's reconciliation fight the DOM and could
 * throw or resurrect the block. Instead it inserts the iframe as a SIBLING
 * right after the block and hides the block (`display:none`, a style React
 * does not manage), then re-applies on any mutation. Because React replaces
 * nodes (it does not reuse them across a re-render of changed content), each
 * replacement is detected fresh and re-hidden; the data marker on the *block*
 * keeps one block from being processed twice in a single pass.
 *
 * Streaming gate: while a turn is running, `AssistantMarkdown` sets
 * `data-streaming` on its root and the block content is partial and will be
 * re-rendered. We only swap settled blocks (no `[data-streaming]` ancestor),
 * so a card never mounts on a half-streamed body. On settle, React re-renders
 * the markdown, which removes `data-streaming` and re-creates the block; the
 * observer sees that and swaps then.
 *
 * @module @khorsheed/dsh-inline-html-render
 */

import { buildCardSrcDoc, CARD_CSP } from './srcdoc.ts'
import { attachBridge, type BridgeCapabilities } from './bridge.ts'

/** Info string that marks a fence as an inline card. */
export const CARD_INFO_STRING = 'dsh-card'
/** Marker set on the block once it has been swapped, making a pass idempotent. */
const PROCESSED_ATTR = 'data-dsh-card-processed'
/** The injected iframe's class, for cleanup. */
const FRAME_CLASS = 'dsh-inline-card-frame'
/** Attribute used to find the bridge-ready frame and its disposer. */
const BRIDGE_ATTR = 'data-dsh-bridge'

/**
 * The card document signature for hosts that hide the fence info string.
 * The card protocol (skills/inline-html-card) authors a card as a COMPLETE
 * HTML document, so a settled block whose decoded body is one — doctype or
 * `<html` at the head, `</html>` at the tail — is a card even when the banner
 * shows only the host's generic label. The verbatim strict-CSP meta (the
 * skill's recommended self-describing header) is accepted on its own: no
 * ordinary code listing carries that exact string.
 */
function isCardDocument(body: string): boolean {
  if (body.includes(CARD_CSP)) return true
  const complete = /<\/html>\s*$/i.test(body)
  return (/^\s*<!doctype html[\s>]/i.test(body) || /^\s*<html[\s>]/i.test(body)) && complete
}

/** A mounted card: the block it replaced and the disposer of its bridge. */
interface MountedCard {
  readonly block: HTMLElement
  readonly frame: HTMLIFrameElement
  /** Hides the block and guards duplicate disposal. */
  dispose: () => void
}

/** True when one `.md-code-block` was authored with the `dsh-card` info string.
 *
 * The official `CodeBlock` renders the fence info string in the banner, but the
 * DOM shape is not a stable contract: some builds render a dedicated
 * `.infostring` element, one release flattened the banner wrap
 * (`_bannerWrap_…`) whose leading text is `<info>复制` (info string first, then
 * the localized copy label), and the 0.1.7-rc.1 `CodeToolbar` shows only the
 * host's localized generic label for any language shiki cannot highlight —
 * `dsh-card` never reaches the DOM there at all. So: prefer the explicit
 * `.infostring` element, then the leading-text prefix, and finally fall back
 * to the content signature ({@link isCardDocument}) — the protocol's complete
 * HTML document with its strict CSP is unambiguous regardless of the banner.
 */
function isCardInfoBlock(block: HTMLElement): boolean {
  const explicit = block.querySelector<HTMLElement>('.infostring')
  if (explicit !== null) return explicit.textContent?.trim() === CARD_INFO_STRING
  // `textContent` begins with the info string baked before the copy label.
  if (block.textContent.trimStart().startsWith(CARD_INFO_STRING)) return true
  return isCardDocument(block.querySelector('pre')?.textContent ?? '')
}

/** Find every rendered `dsh-card` block under `root`. */
export function findCardBlocks(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const node of root.querySelectorAll<HTMLElement>('.md-code-block')) {
    if (isCardInfoBlock(node)) out.push(node)
  }
  return out
}

/** True when the block (or an ancestor) is inside a still-streaming message. */
function isStreaming(node: HTMLElement): boolean {
  return node.closest('[data-streaming]') !== null
}

/** Extract the authored HTML from a card block's `<pre>` text body. */
function readCardHtml(block: HTMLElement): string {
  const pre = block.querySelector('pre')
  return (pre?.textContent ?? '').replace(/\n$/, '')
}

/**
 * Render one card block: read the HTML, build a sandboxed srcDoc, insert the
 * iframe after the block, hide the block, and attach the capability bridge.
 * @param block - the rendered `dsh-card` block.
 * @param capabilities - wired host capabilities handed to the bridge.
 * @returns a {@link MountedCard} or null when the block had no content.
 */
function mountCard(block: HTMLElement, capabilities: BridgeCapabilities): MountedCard | null {
  const html = readCardHtml(block)
  if (html.trim() === '') return null
  const frame = document.createElement('iframe')
  frame.className = FRAME_CLASS
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('title', 'inline card')
  // A fresh container each mount: the frame is opaque-origin so nothing can
  // spoof it, and setting srcDoc after insertion is fine (load fires async).
  frame.srcdoc = buildCardSrcDoc(html)
  frame.style.display = 'block'
  frame.style.width = '100%'
  // A small default so an unloaded frame is not collapsed; the bridge inside
  // the frame posts the real content height on load/resize (see srcdoc.ts),
  // because the parent cannot read contentDocument on an opaque-origin frame.
  frame.style.height = 'auto'
  frame.style.border = 'none'

  block.parentNode?.insertBefore(frame, block.nextSibling)
  // Hide the block with a style React does not reconcile (React only manages
  // the class/style it rendered; this element's `style` is set once by us).
  block.style.display = 'none'
  block.setAttribute(PROCESSED_ATTR, '')

  const disposeBridge = attachBridge(frame, capabilities)
  frame.setAttribute(BRIDGE_ATTR, '')
  const dispose = (): void => {
    disposeBridge()
    frame.remove()
    block.removeAttribute(PROCESSED_ATTR)
    // Do NOT clear block.style.display — React may not have re-rendered; a
    // cleared style would flash the code block back. Cleaning up the frame is
    // enough; the block node itself belongs to React.
  }
  return { block, frame, dispose }
}

/**
 * Drop frames whose owning block is gone. React may replace a processed block
 * with a fresh node (a re-render of the settled markdown); the old block's
 * frame then has no matching block before it and would sit orphaned. A frame
 * is owned by the immediately-preceding `.md-code-block` carrying the
 * processed marker that paired with it — so a frame not preceded by exactly
 * that is stale. Reactive re-scanning keeps the two in lockstep.
 */
function collectCardFrames(root: ParentNode): HTMLIFrameElement[] {
  return [...root.querySelectorAll<HTMLIFrameElement>(`.${FRAME_CLASS}`)]
}

/** Remove every card frame whose predecessor block is no longer its partner. */
function dropOrphanFrames(root: ParentNode, mounted: Set<MountedCard>): void {
  for (const frame of collectCardFrames(root)) {
    const prev = frame.previousElementSibling
    const owned = prev instanceof HTMLElement && prev.classList.contains('md-code-block')
      && prev.hasAttribute(PROCESSED_ATTR)
    if (owned) continue
    frame.remove()
    // Best-effort detach from the mounted registry (the handle holds the same
    // node, so a later dispose of the registry still finds it already gone).
    for (const card of mounted) {
      if (card.frame === frame) {
        mounted.delete(card)
        break
      }
    }
  }
}

/** Reconcile: swap every unprocessed, settled `dsh-card` block under `root`, then drop orphans. */
export function reconcile(root: ParentNode, capabilities: BridgeCapabilities = {}): MountedCard[] {
  const mounted: MountedCard[] = []
  for (const block of findCardBlocks(root)) {
    if (block.hasAttribute(PROCESSED_ATTR)) continue
    if (isStreaming(block)) continue
    const card = mountCard(block, capabilities)
    if (card !== null) mounted.push(card)
  }
  return mounted
}

/** A live renderer installation: reconcile on mutation, dispose cleanly. */
export interface CardRenderer {
  /** Manually run a reconcile pass (also fired by the observer). */
  run: () => void
  /** Remove the observer and every mounted card frame. */
  dispose: () => void
}

const CHAT_ROOT = '[data-conversation-scroll]'

/**
 * Install the inline-card renderer over the document.
 * @param capabilities - wired host capabilities handed to every card's bridge.
 * @returns a {@link CardRenderer} whose `dispose` tears everything down.
 */
export function installCardRenderer(capabilities: BridgeCapabilities = {}): CardRenderer {
  // jsdom lacks requestAnimationFrame; fall back to a macrotask so the plugin
  // never throws headless (and tests run synchronously via `run`).
  const nextFrame: (cb: () => void) => void = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: () => void) => { setTimeout(cb, 0) }
  const cancelFrame: (id: number) => void = typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : (id: number) => { clearTimeout(id) }

  // Track mounted cards so dispose can take every frame down. Set keeps one
  // entry per frame; re-runs of reconcile mount new frames and re-insert here.
  const mounted = new Set<MountedCard>()

  const run = (): void => {
    // Scope to the chat pane when present; fall back to the whole document so
    // a not-yet-mounted chat (or headless test) still sees a first pass.
    const root: ParentNode = document.querySelector(CHAT_ROOT) ?? document.body
    for (const card of reconcile(root, capabilities)) mounted.add(card)
    dropOrphanFrames(root, mounted)
  }

  // Re-scan when the observed subtree mutates. Chat is the hot path; the full
  // document observer would be noisy, so a chat bound improves cost — but the
  // chat pane may not be mounted yet, so a document fallback keeps discovery
  // working. Both observers coalesce via `nextFrame`.
  let raf = 0
  const schedule = (): void => {
    if (raf !== 0) return
    raf = nextFrame(() => {
      raf = 0
      run()
    }) as unknown as number
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-streaming'],
  })

  // First pass right away. `nextFrame` so the observer itself is not spammed
  // before the first commit; a settled render only needs a microtask, so a
  // caller wanting deterministic behavior calls `run()` directly.
  schedule()

  return {
    run,
    dispose: () => {
      if (raf !== 0) {
        cancelFrame(raf)
        raf = 0
      }
      observer.disconnect()
      for (const card of mounted) card.dispose()
      mounted.clear()
    },
  }
}
