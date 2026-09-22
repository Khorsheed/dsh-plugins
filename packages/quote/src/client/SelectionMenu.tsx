/**
 * The selection quote menu (`shell.overlay`, root scope): select any text
 * anywhere in the app and this small floating card appears beside the
 * selection — 「引用到当前会话」 into the current composer, 「引用到侧边对话」
 * as a side-chat ref, 「复制」. Route items hide by the degrade matrix (no
 * current session, no side-chat); 复制 is always there. Rows contributed by
 * other plugins through the `ctx.quoteActions` registry render after the
 * built-ins, each gated by its own `available`.
 *
 * The menu subscribes to the injected selection source and captures the
 * text/rect at selection time, so a click never races the live selection.
 * An acted-on snapshot is marked consumed: the source re-reports the
 * still-intact selection on the click's own mouseup, and that one echo is
 * ignored so the menu stays closed until the NEXT distinct selection.
 *
 * @module @khorsheed/dsh-quote/client
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  IconCopyOutline16, IconListPenOutline16, IconRightUpOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatQuoteBlock } from '../types.ts'
import type { QuoteMenuProps } from './contract.ts'
import type { QuoteActionTarget } from './registry.ts'
import type { SelectionRect, SelectionSnapshot } from './selection.ts'
import css from './SelectionMenu.module.css'

/** Viewport margin the card clamps to, and its gap from the selection. */
const MARGIN = 8

/** Resolved card position in the viewport (null = measuring). */
interface Placement {
  readonly left: number
  readonly top: number
}

/** Two snapshots address the same selection when text and rect both match. */
function sameRect(a: SelectionRect, b: SelectionRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

/** One action row's descriptor (built-in id or a contributed `<plugin>.<action>`). */
interface MenuAction {
  readonly id: string
  readonly icon: ReactNode
  readonly label: string
  readonly run: () => void
}

/** The floating selection quote menu. */
export function SelectionQuoteMenu(props: QuoteMenuProps): ReactNode {
  const { useSessions, t, selection, sideChatAvailable, insertQuote, addSideChatRef, openSideChat, copyText, actions: actionFeed } = props
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const consumedRef = useRef<SelectionSnapshot | null>(null)
  const current = useSessions(sessions => sessions.current)
  const currentTitle = useSessions(sessions =>
    current === undefined ? undefined : sessions.byId[current]?.displayTitle)
  // Contributed rows: the feed's list reference only changes on register /
  // dispose, so a contribution hot-added while the menu is open appears on
  // the same render pass.
  const contributed = useSyncExternalStore(actionFeed.subscribe, actionFeed.list)

  // Subscribe to the app-level selection seam. The consumed echo (the click's
  // own mouseup re-reporting the acted selection) is filtered here.
  useEffect(() => selection.start((next) => {
    const consumed = consumedRef.current
    if (next !== null && consumed !== null && next.text === consumed.text && sameRect(next.rect, consumed.rect)) return
    if (next === null) consumedRef.current = null
    setSnapshot(next)
    setPlacement(null)
  }), [selection])

  // The own-selection exclusion: the real source accepts the menu root; a
  // test's manual source simply has no attachRoot.
  useEffect(() => {
    if (!('attachRoot' in selection)) return
    const rooted = selection as { attachRoot(element: HTMLElement | null): void }
    rooted.attachRoot(rootRef.current)
    return () => { rooted.attachRoot(null) }
  }, [selection, snapshot])

  // Two-pass placement: render hidden, measure, then clamp beside the
  // selection (above it, flipping below near the viewport top).
  useLayoutEffect(() => {
    const root = rootRef.current
    if (snapshot === null || root === null || placement !== null) return
    const width = root.offsetWidth
    const height = root.offsetHeight
    const center = snapshot.rect.left + snapshot.rect.width / 2
    const left = Math.min(Math.max(MARGIN, center - width / 2), Math.max(MARGIN, window.innerWidth - width - MARGIN))
    const above = snapshot.rect.top - height - MARGIN >= MARGIN
    const top = above ? snapshot.rect.top - height - MARGIN : snapshot.rect.top + snapshot.rect.height + MARGIN
    setPlacement({ left, top })
  }, [snapshot, placement])

  if (snapshot === null) return null
  const label = currentTitle ?? t('source.fallback')
  const close = (): void => {
    consumedRef.current = snapshot
    setSnapshot(null)
    setPlacement(null)
  }
  const actions: MenuAction[] = []
  if (current !== undefined) {
    const sessionId = current
    actions.push({
      id: 'conversation',
      icon: <IconListPenOutline16 />,
      label: t('menu.quoteToConversation'),
      run: () => {
        insertQuote(sessionId, formatQuoteBlock(snapshot.text, t('quote.attribution', { label })))
        close()
      },
    })
    if (sideChatAvailable()) {
      actions.push({
        id: 'sidechat',
        icon: <IconRightUpOutline16 />,
        label: t('menu.quoteToSideChat'),
        run: () => {
          close()
          void addSideChatRef(sessionId, label, snapshot.text).then((ok) => {
            if (ok) openSideChat(sessionId)
          })
        },
      })
    }
  }
  actions.push({
    id: 'copy',
    icon: <IconCopyOutline16 />,
    label: t('menu.copy'),
    run: () => {
      close()
      void copyText(snapshot.text)
    },
  })
  // Contributed rows (the ctx.quoteActions registry): same opaque target the
  // built-ins annotate, each row's own gate, the generic icon as fallback.
  const target: QuoteActionTarget = { text: snapshot.text, label, sessionId: current }
  for (const action of contributed) {
    if (action.available !== undefined && !action.available(target)) continue
    actions.push({
      id: action.id,
      icon: action.icon ?? <IconSparkle16 />,
      label: action.label(),
      run: () => {
        close()
        action.run(target)
      },
    })
  }

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={t('menu.title')}
      className={css.root}
      style={{
        visibility: placement === null ? 'hidden' : 'visible',
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
      }}
    >
      {actions.map(action => (
        <button
          key={action.id}
          type="button"
          className={css.item}
          data-action={action.id}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={action.run}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}
