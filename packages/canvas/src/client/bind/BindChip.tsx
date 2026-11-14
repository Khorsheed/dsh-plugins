/**
 * The session header's binding chip: which canvas this writing session works
 * on. A bound session's canvas tools act on that canvas whatever the sidebar
 * shows; a genre's own tools still require that genre on the bound canvas.
 * Unbound, the canvas tools follow the sidebar.
 *
 * Every live canvas is a work: a genre adds capabilities, not the right to be
 * bound. The chip renders only where the gate offers it.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BoardBindResult, BoardListResult, CanvasSummary } from '../../types.ts'
import type {} from '../locales.ts'
import { IconChevronDownOutlineMedium } from '../icons.tsx'
import css from './BindChip.module.css'
import { subscribeWrites } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import { CANVAS_KIND } from '../definition.ts'

/** One session's binding face (the header slot injects it per session). */
export interface CanvasBindInjected {
  /** Whether this session gets the chip (gate.ts). */
  offered: () => boolean
  subscribe: (listener: () => void) => () => void
  /** Local binding revision; optional for isolated mounts and specs. */
  revision?: () => number
  boundCanvas: () => Promise<RemoteResult<string | null>>
  bindCanvas: (canvasId: string | null) => Promise<RemoteResult<BoardBindResult>>
  listCanvases: () => Promise<RemoteResult<BoardListResult>>
  /** Show the canvas tab on this canvas. */
  openCanvas: (canvasId: string) => void
}

export interface CanvasBindChipProps extends CanvasBindInjected {
  readonly t: TranslateNS<'canvas'>
}

/** Rows the chip offers: every live canvas, most recently active first. */
function bindable(items: readonly CanvasSummary[]): CanvasSummary[] {
  return items.filter(row => row.archivedAt === null)
}

/** How often the chip re-reads a binding the model may have moved (the board poll's pace). */
const BIND_FALLBACK_MS = 30_000

export function CanvasBindChip(props: CanvasBindChipProps): ReactNode {
  const shown = useSyncExternalStore(props.subscribe, props.offered)
  return shown ? <BindMenu {...props} /> : null
}

function BindMenu({ t, subscribe, boundCanvas, bindCanvas, listCanvases, openCanvas, revision }: CanvasBindChipProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [bound, setBound] = useState<string | null>(null)
  const [rows, setRows] = useState<readonly CanvasSummary[]>([])
  const [failed, setFailed] = useState(false)
  const rev = useSyncExternalStore(subscribe, revision ?? (() => 0))

  const reload = useCallback(async () => {
    const [current, list] = await Promise.all([boundCanvas(), listCanvases()])
    if (current.ok) setBound(current.value)
    if (list.ok) setRows(bindable(list.value.items))
  }, [boundCanvas, listCanvases])

  // Read on mount and after every local binding, so a work created through the
  // sidebar appears at once; opening the menu also refreshes the list below.
  useEffect(() => { void reload().catch(() => {}) }, [reload, rev])

  // The model binds too (canvas_open, a genre's bind tool): a canvas write in
  // the conversation re-reads the binding at once (the destination follower's
  // write signal), a slow re-read while the page is in view catches the rest,
  // and the list is re-read once when the binding names a canvas the chip has
  // not seen (a canvas created since).
  useEffect(() => {
    const read = (): void => {
      void boundCanvas().then((current) => { if (current.ok) setBound(current.value) }).catch(() => {})
    }
    const stop = subscribeWrites(CANVAS_KIND, read)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') read()
    }, BIND_FALLBACK_MS)
    return () => { stop(); clearInterval(timer) }
  }, [boundCanvas])
  const unseen = bound !== null && !rows.some(row => row.id === bound)
  useEffect(() => {
    if (!unseen) return
    void listCanvases().then((list) => { if (list.ok) setRows(bindable(list.value.items)) }).catch(() => {})
  }, [unseen, listCanvases])

  const pick = async (canvasId: string | null): Promise<void> => {
    const result = await bindCanvas(canvasId)
    if (result.ok && result.value.ok) {
      setBound(result.value.canvasId)
      setFailed(false)
    } else {
      setFailed(true)
    }
  }

  const title = bound === null ? undefined : rows.find(row => row.id === bound)?.title
  const items: MenuEntry[] = [
    { type: 'label', id: 'heading', text: t('bind.heading') },
    ...rows.length === 0
      ? [{ id: 'empty', label: t('bind.empty'), disabled: true }]
      : rows.map(row => ({ id: `canvas:${row.id}`, label: row.title })),
    ...bound === null ? [] : [
      { type: 'separator' as const, id: 'sep' },
      { id: 'open', label: t('bind.open') },
      { id: 'unbind', label: t('bind.unbind') },
    ],
  ]

  return (
    <Menu
      open={open}
      portal
      dense
      items={items}
      {...bound === null ? {} : { selectedId: `canvas:${bound}` }}
      onSelect={id => {
        setOpen(false)
        if (id === 'open' && bound !== null) openCanvas(bound)
        else if (id === 'unbind') void pick(null)
        else if (id.startsWith('canvas:')) void pick(id.slice('canvas:'.length))
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button
          type="button"
          className={css.trigger}
          data-bound={bound !== null}
          aria-label={t('bind.aria')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={failed ? t('bind.failed') : undefined}
          onClick={() => {
            if (!open) void reload().catch(() => {})
            setOpen(value => !value)
          }}
        >
          <span className={css.label}>
            {failed ? t('bind.failed') : title === undefined ? t('bind.unbound') : t('bind.bound', { title })}
          </span>
          <IconChevronDownOutlineMedium size={12} />
        </button>
      )}
    />
  )
}
