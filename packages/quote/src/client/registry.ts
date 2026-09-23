/**
 * The quote action registry (`ctx.quoteActions`): other plugins contribute
 * rows into the selection quote menu. The quote package owns the gesture
 * (the selection overlay), the opaque target payload, and the menu chrome;
 * a contribution owns its label, its visibility gate, and its body — the
 * registry never learns what any action's destination is (the same opacity
 * rule the quote payload itself follows).
 *
 * The provider's three built-in routes (current chat / side chat / copy)
 * are NOT registered through this face: they bind component-level state
 * (the session store, the quote locale namespace), so they stay in the
 * component. Contributed rows always render after the built-ins, in
 * registration order.
 *
 * Consumer pattern (probe at apply; absent = the action simply never
 * appears):
 *
 * ```ts
 * const registry = ctx.get('quoteActions')
 * if (registry !== undefined) {
 *   ctx.effect(() => registry.registerAction({
 *     id: 'my-plugin.save',               // '<plugin>.<action>', unique
 *     label: () => t('menu.save'),        // evaluated fresh per menu open
 *     available: target => target.sessionId !== undefined,
 *     run: target => { void save(target.text) },
 *   }), 'my-plugin: quote action')
 * }
 * ```
 *
 * @module @khorsheed/dsh-quote/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReactNode } from 'react'

/** What a contributed action knows about the quote it was invoked on. */
export interface QuoteActionTarget {
  /** The selected plain text — the opaque quoted chunk. */
  readonly text: string
  /**
   * Best-effort source label (the current session's display title, else the
   * localized generic fallback) — same value the built-in routes annotate.
   */
  readonly label: string
  /** The current session's id, or undefined when no session is selected. */
  readonly sessionId: SessionId | undefined
}

/** One selection-menu action contributed by another plugin. */
export interface QuoteActionContribution {
  /**
   * Unique action id, conventionally `<plugin>.<action>` (the provider's
   * built-ins own the bare ids `conversation` / `sidechat` / `copy`).
   * Duplicate ids throw at registration.
   */
  readonly id: string
  /**
   * Menu row label, evaluated fresh at every menu open — close over your own
   * locale face so a language switch is picked up on the next open.
   */
  readonly label: () => string
  /** Menu row icon; a generic one stands in when absent. */
  readonly icon?: ReactNode
  /**
   * Visibility gate evaluated fresh at every menu open (no caching); the row
   * hides while it returns false. Absent = always visible. A throwing gate
   * hides the row (and is reported).
   */
  readonly available?: (target: QuoteActionTarget) => boolean
  /**
   * The action body; the menu closes before it runs. A throwing body is
   * reported and never takes the menu down.
   */
  readonly run: (target: QuoteActionTarget) => void
}

/**
 * The registry face other plugins probe via `ctx.get('quoteActions')`.
 * Registration is boot-time: the registry is provided at the very top of the
 * quote client apply, so any consumer applying after it probes successfully;
 * a consumer applying before it must retry or stay silent (the degrade).
 */
export interface QuoteActionRegistry {
  /**
   * Contribute one menu action.
   * @param contribution - the action to mount.
   * @returns the disposer removing the row.
   */
  registerAction: (contribution: QuoteActionContribution) => () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The quote action registry, provided by @khorsheed/dsh-quote's browser half. */
    quoteActions: QuoteActionRegistry
  }
}

/**
 * One registered action with its fallible faces wrapped: a throwing `label`
 * degrades to the id, a throwing `available` hides the row, a throwing `run`
 * is swallowed — every failure is reported and none reaches the menu.
 */
export interface ResolvedQuoteAction {
  readonly id: string
  readonly label: () => string
  readonly icon: ReactNode | undefined
  readonly available: ((target: QuoteActionTarget) => boolean) | undefined
  readonly run: (target: QuoteActionTarget) => void
}

/**
 * The read face the menu subscribes to, useSyncExternalStore-shaped:
 * `list()` keeps its reference between mutations so it can serve as the
 * getSnapshot half directly.
 */
export interface QuoteActionFeed {
  readonly subscribe: (listener: () => void) => () => void
  readonly list: () => readonly ResolvedQuoteAction[]
}

/**
 * The registry runtime: registration order is render order, disposal removes
 * the row, and subscribers are notified on either mutation. Instance arrows
 * deliberately — the face crosses the cordis service proxy, and arrows keep
 * `this` bound to the runtime regardless of the caller's context.
 */
export class QuoteActionRegistryRuntime implements QuoteActionRegistry, QuoteActionFeed {
  private entries: readonly ResolvedQuoteAction[] = []
  private readonly listeners = new Set<() => void>()

  /**
   * @param onError - report sink for contribution failures (the provider
   * wires its logger).
   */
  constructor(private readonly onError: (error: unknown) => void) {}

  registerAction = (contribution: QuoteActionContribution): (() => void) => {
    if (this.entries.some(entry => entry.id === contribution.id)) {
      throw new Error(`quote action id already registered: ${contribution.id}`)
    }
    const report = this.onError
    const resolved: ResolvedQuoteAction = {
      id: contribution.id,
      label: () => {
        try {
          return contribution.label()
        } catch (error) {
          report(error)
          return contribution.id
        }
      },
      icon: contribution.icon,
      available: contribution.available === undefined ? undefined : (target) => {
        try {
          return contribution.available?.(target) ?? true
        } catch (error) {
          report(error)
          return false
        }
      },
      run: (target) => {
        try {
          contribution.run(target)
        } catch (error) {
          report(error)
        }
      },
    }
    this.entries = [...this.entries, resolved]
    this.emit()
    let active = true
    return () => {
      if (!active) return
      active = false
      this.entries = this.entries.filter(entry => entry !== resolved)
      this.emit()
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  list = (): readonly ResolvedQuoteAction[] => this.entries

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
