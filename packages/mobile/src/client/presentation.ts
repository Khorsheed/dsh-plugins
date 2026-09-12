import { MobilePickers } from './pickers.ts'
import { MobileViewport } from './viewport.ts'
import { MOBILE_CSS } from './styles.ts'
import { MobileSurface } from './surface.ts'
import { ComposerFocus } from './composerFocus.ts'

export type DisplayMode = 'auto' | 'mobile' | 'desktop'
export interface MobileSnapshot { mode: DisplayMode; active: boolean; drawer: boolean; supported: boolean }
const STORAGE_KEY = 'dsh.mobile.display'

/** Owns only this document's mobile effects. It never writes Host or sibling state. */
export class MobilePresentation {
  private readonly listeners = new Set<() => void>()
  private readonly media: MediaQueryList
  private readonly observer: MutationObserver
  private readonly style: HTMLStyleElement
  private frame: HTMLElement | undefined
  private snapshot: MobileSnapshot
  private disposed = false
  private pending = 0
  private readonly composerFocus: ComposerFocus
  private readonly pickers: MobilePickers
  private readonly viewport: MobileViewport
  readonly surface: MobileSurface

  constructor(private readonly win: Window, private readonly shell: boolean) {
    const query = new URL(win.location.href).searchParams.get('mobile')
    let saved: string | null = null
    try { saved = win.localStorage.getItem(STORAGE_KEY) } catch { /* Storage may be disabled; preferences remain document-local. */ }
    const mode = query === '1' ? 'mobile' : query === '0' ? 'desktop'
      : saved === 'mobile' || saved === 'desktop' ? saved : 'auto'
    this.snapshot = { mode, active: false, drawer: false, supported: false }
    this.surface = new MobileSurface(win.document)
    this.viewport = new MobileViewport(win)
    this.pickers = new MobilePickers(win.document)
    this.composerFocus = new ComposerFocus(win.document, () => this.snapshot.active)
    this.media = win.matchMedia('(max-width: 760px) and (pointer: coarse)')
    this.style = win.document.createElement('style')
    this.style.dataset.mobileOwned = 'styles'
    this.style.textContent = MOBILE_CSS
    win.document.head.append(this.style)
    this.observer = new MutationObserver(this.schedule)
    this.observer.observe(win.document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-phase', 'aria-selected', 'aria-expanded', 'data-ds-dark-theme', 'src'], characterData: true })
    this.media.addEventListener('change', this.schedule)
    win.addEventListener('resize', this.schedule)
    win.addEventListener('dsh-mobile-display', this.display)
    win.document.addEventListener('pointerdown', this.pointer, true)
    win.document.addEventListener('keydown', this.keyboard, true)
    win.visualViewport?.addEventListener('resize', this.schedule)
    win.visualViewport?.addEventListener('scroll', this.schedule)
    this.reconcile()
  }

  readonly getSnapshot = (): MobileSnapshot => this.snapshot
  readonly prepareNavigation = (): void => { this.composerFocus.arm() }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly setMode = (mode: DisplayMode): void => {
    this.snapshot = { ...this.snapshot, mode }
    try { this.win.localStorage.setItem(STORAGE_KEY, mode) } catch { /* Private storage denial does not block the UI. */ }
    this.reconcile(true)
  }

  private readonly display = (event: Event): void => {
    const mode = (event as CustomEvent<{ mode?: unknown }>).detail?.mode
    if (mode === 'auto' || mode === 'mobile' || mode === 'desktop') this.setMode(mode)
  }
  private readonly pointer = (): void => { if (this.snapshot.active) this.win.document.documentElement.dataset.mobileInput = 'pointer' }
  private readonly keyboard = (event: KeyboardEvent): void => { if (this.snapshot.active && event.key === 'Tab') this.win.document.documentElement.dataset.mobileInput = 'keyboard' }

  private readonly schedule = (): void => {
    if (this.disposed || this.pending) return
    this.pending = this.win.requestAnimationFrame(() => { this.pending = 0; this.reconcile() })
  }

  private reconcile(force = false): void {
    if (this.disposed) return
    const doc = this.win.document
    // Root priority alone cannot transfer child-slot render authority. Keep
    // the official frame and require its observed rc1 anchor arrangement.
    const candidate = doc.querySelector<HTMLElement>('[data-slot="root"] > div:has(> [data-shell-overlay])')
    const frame = candidate?.querySelector('[data-slot="main"]') && candidate.querySelector('[data-slot="sidebar"]') ? candidate : undefined
    if (this.frame !== frame) this.frame?.removeAttribute('data-mobile-frame')
    this.frame = frame
    const active = !!frame && (this.snapshot.mode === 'mobile' || (this.snapshot.mode === 'auto' && (this.shell || this.media.matches)))
    doc.documentElement.toggleAttribute('data-dsh-mobile', active)
    frame?.toggleAttribute('data-mobile-frame', active)
    if (active) doc.documentElement.style.setProperty('--mobile-height', `${Math.round(this.win.visualViewport?.height ?? this.win.innerHeight)}px`)
    else doc.documentElement.style.removeProperty('--mobile-height')
    if (active) doc.documentElement.style.setProperty('--mobile-top', `${Math.round(this.win.visualViewport?.offsetTop ?? 0)}px`)
    else doc.documentElement.style.removeProperty('--mobile-top')
    doc.documentElement.toggleAttribute('data-mobile-native-insets', active && this.shell)
    if (active && !doc.documentElement.dataset.mobileInput) doc.documentElement.dataset.mobileInput = 'pointer'
    if (!active) doc.documentElement.removeAttribute('data-mobile-input')
    this.surface.sync(active ? frame : undefined)
    this.viewport.sync(active ? frame : undefined)
    this.pickers.sync(active)
    const drawer = active && !frame?.hasAttribute('data-sidebar-collapsed')
    if (force || active !== this.snapshot.active || drawer !== this.snapshot.drawer || !!frame !== this.snapshot.supported) {
      this.snapshot = { ...this.snapshot, active, drawer, supported: !!frame }
      for (const listener of this.listeners) listener()
    }
  }

  /** Release only owned presentation resources; leave shared streams and drafts intact. */
  dispose(): void {
    this.disposed = true
    this.observer.disconnect()
    this.composerFocus.dispose()
    this.surface.dispose()
    this.viewport.dispose()
    this.pickers.dispose()
    this.win.removeEventListener('dsh-mobile-display', this.display)
    this.win.document.removeEventListener('pointerdown', this.pointer, true)
    this.win.document.removeEventListener('keydown', this.keyboard, true)
    this.win.document.documentElement.removeAttribute('data-mobile-input')
    this.win.document.documentElement.removeAttribute('data-mobile-native-insets')
    this.media.removeEventListener('change', this.schedule)
    this.win.removeEventListener('resize', this.schedule)
    this.win.visualViewport?.removeEventListener('resize', this.schedule)
    this.win.visualViewport?.removeEventListener('scroll', this.schedule)
    if (this.pending) this.win.cancelAnimationFrame(this.pending)
    this.frame?.removeAttribute('data-mobile-frame')
    this.win.document.documentElement.removeAttribute('data-dsh-mobile')
    this.win.document.documentElement.style.removeProperty('--mobile-height')
    this.win.document.documentElement.style.removeProperty('--mobile-top')
    this.style.remove()
    this.listeners.clear()
  }
}
