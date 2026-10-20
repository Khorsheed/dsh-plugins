/**
 * The harness-card registry behind the「本机 Agent 委派」family card: each
 * delegation companion's client registers one section (its settings card
 * body) through the localAgentUi service's `registerHarnessCard`, and the
 * core's single `plugins.item` entry renders every registered section sorted
 * by order. Sections come from THIS registry, never the gateway roster — a
 * registered harness absent host-side still renders, its body degrading
 * exactly like the retired standalone card did.
 *
 * The registry lives on the cordis service (not a module export) because every
 * plugin's client bundle inlines its own copy of the core's sources: module
 * identity is per bundle, the service is the one shared instance.
 * @module @khorsheed/dsh-local-agent/client — harness card registry
 */

import type { ReactNode } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

/** Render props the family card hands each harness section. */
export interface HarnessCardRenderProps {
  /**
   * Whether the section is currently expanded. The family card requests the
   * body only while the section is open, so a mounted section always reads
   * true; the prop keeps the contract honest for a keep-alive variant.
   */
  readonly active: boolean
  /**
   * The standing root-scope global seat (ui-session's GlobalStandardProps
   * merge), forwarded verbatim from the family card's own plugins.item
   * runtime props — the same seat the retired standalone cards received from
   * the slot renderer.
   */
  readonly useSessions: <T>(select: (state: SessionListState) => T) => T
}

/** One harness's section registration in the family card. */
export interface HarnessCardRegistration {
  /** The harness name the gateway answers for ('kimi', 'codex', …). */
  readonly name: string
  /** Section order — the harness's retired standalone plugins.item order. */
  readonly order: number
  /** The registering companion's locale namespace (mirrors the slot registration vocabulary; the label binding reads it live). */
  readonly locale: string
  /** Section title (the companion's `card.title` copy). */
  readonly label: () => string
  /** The section body (the companion's card body minus its standalone chrome). */
  readonly render: (props: HarnessCardRenderProps) => ReactNode
}

/**
 * In-memory registry with the useSyncExternalStore face the family card
 * subscribes through: a version counter as the snapshot (mutations bump it)
 * and a cached sorted list readers re-read after a bump.
 */
export class HarnessCardRegistry {
  private readonly entries = new Map<string, HarnessCardRegistration>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private sorted: readonly HarnessCardRegistration[] = []

  /**
   * Register one harness's section; re-registering the same name replaces the
   * entry. The returned disposer removes only the entry it registered (a stale
   * disposer never evicts a newer registration of the same name).
   * @param entry - the section registration.
   * @returns the unregister.
   */
  readonly register = (entry: HarnessCardRegistration): (() => void) => {
    this.entries.set(entry.name, entry)
    this.bump()
    return () => {
      if (this.entries.get(entry.name) !== entry) return
      this.entries.delete(entry.name)
      this.bump()
    }
  }

  /** The registered sections in display order (order, then name). */
  readonly cards = (): readonly HarnessCardRegistration[] => this.sorted

  /** The mutation counter — the useSyncExternalStore snapshot. */
  readonly snapshotVersion = (): number => this.version

  /** Subscribe a listener fired after every mutation; returns the unsubscribe. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private bump(): void {
    this.version += 1
    this.sorted = [...this.entries.values()].sort((a, b) =>
      a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const listener of [...this.listeners]) listener()
  }
}
