/** Optional public sidebar operations. Bodies and saved layouts stay with their owners. */
interface Feed<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export interface MobilePanelTab { readonly id: string; readonly title: string; readonly kind: string }
export interface MobilePanelService {
  mounted: Feed<string | undefined>
  openTabs?: Feed<readonly unknown[]>
  toggleExpanded(): void
  isExpanded(): boolean
  active(): MobilePanelTab | undefined
  tabsIn?(sessionId: string): readonly MobilePanelTab[]
  focus?(tabId: string): void
  close?(tabId: string): void
  openTab?(kind: string): void
}
export interface MobilePanelSnapshot {
  readonly available: boolean
  readonly managed: boolean
  readonly expanded: boolean
  readonly sessionId: string | undefined
  readonly activeId: string
  readonly tabs: readonly MobilePanelTab[]
  readonly failed: boolean
}
const EMPTY: MobilePanelSnapshot = { available: false, managed: false, expanded: false, sessionId: undefined, activeId: '', tabs: [], failed: false }

/** Public services do actions; checked DOM anchors supply presentation-only change notifications. */
export class MobilePanels {
  private service: MobilePanelService | undefined
  private releases: (() => void)[] = []
  private listeners = new Set<() => void>()
  private snapshot = EMPTY
  private observer: MutationObserver
  private disposed = false
  private scheduled = false
  private failed = false
  constructor(private readonly doc: Document) {
    this.observer = new MutationObserver(records => {
      if (this.scheduled || !records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        return !target?.closest('[data-conversation-scroll] [data-slot="conversation.session"]')
      })) return
      this.scheduled = true
      queueMicrotask(() => { this.scheduled = false; if (!this.disposed) this.sync() })
    })
    this.observer.observe(doc.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-sidebar-right-open', 'data-dockkit-pane-active', 'data-dockkit-float-active', 'aria-selected', 'hidden'] })
  }
  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set(value: unknown): void {
    for (const release of this.releases) release()
    this.releases = []
    const service = value as Partial<MobilePanelService> | undefined
    this.service = service && typeof service.toggleExpanded === 'function' && typeof service.isExpanded === 'function'
      && typeof service.active === 'function' && typeof service.mounted?.subscribe === 'function'
      && typeof service.mounted.getSnapshot === 'function' ? service as MobilePanelService : undefined
    this.failed = false
    if (this.service) {
      this.releases.push(this.service.mounted.subscribe(this.sync))
      if (typeof this.service.openTabs?.subscribe === 'function') this.releases.push(this.service.openTabs.subscribe(this.sync))
    }
    this.sync()
  }
  private readonly sync = () => {
    let next = EMPTY
    try {
      const service = this.service, sessionId = service?.mounted.getSnapshot()
      if (service && sessionId) {
        const panel = Array.from(this.doc.querySelectorAll<HTMLElement>('[data-sidebar-right-panel][data-sidebar-right-session]'))
          .find(element => element.dataset.sidebarRightSession === sessionId)
        const tabs = service.tabsIn?.(sessionId) ?? []
        const active = service.active()
        const managed = !!panel && !!panel.querySelector('[data-dockkit-host]') && tabs.length > 0
          && typeof service.focus === 'function' && typeof service.close === 'function' && typeof service.openTab === 'function'
          && !!active && tabs.some(tab => tab.id === active.id)
        next = { available: true, managed, sessionId, expanded: service.isExpanded(), activeId: active?.id ?? '',
          tabs: tabs.map(({ id, title, kind }) => ({ id, title, kind })), failed: this.failed }
      }
    } catch { /* A newer host can withdraw this optional face during scope teardown. */ }
    if (JSON.stringify(next) !== JSON.stringify(this.snapshot)) {
      this.snapshot = next
      for (const listener of this.listeners) listener()
    }
  }
  private run(action: (service: MobilePanelService) => void): void {
    if (!this.service || !this.snapshot.available) return
    try { action(this.service); this.failed = false } catch { this.failed = true }
    this.sync()
  }
  readonly toggle = () => this.run(service => service.toggleExpanded())
  readonly hide = () => this.run(service => { if (service.isExpanded()) service.toggleExpanded() })
  readonly select = (id: string) => this.run(service => {
    if (this.snapshot.tabs.some(tab => tab.id === id)) service.focus?.(id)
  })
  readonly close = () => this.run(service => { if (this.snapshot.activeId) service.close?.(this.snapshot.activeId) })
  readonly add = () => this.run(service => service.openTab?.('guide'))
  dispose(): void {
    this.disposed = true
    this.observer.disconnect()
    this.set(undefined)
    this.listeners.clear()
  }
}
