/** Geometry only: keep the official composer mounted and reserve its measured height. */
export class MobileViewport {
  private seat: HTMLElement | undefined
  private root: HTMLElement | undefined
  private readonly observer?: ResizeObserver
  private theme = ''
  constructor(private readonly win: Window) {
    if (typeof ResizeObserver !== 'undefined') this.observer = new ResizeObserver(() => this.measure())
  }
  sync(frame?: HTMLElement) {
    const root = frame?.querySelector<HTMLElement>('[data-slot="main.conversation"] > [data-phase]') ?? undefined
    const seat = root?.querySelector<HTMLElement>('[data-composer-seat]') ?? undefined
    if (seat !== this.seat || root !== this.root) {
      this.observer?.disconnect()
      this.root?.style.removeProperty('--mobile-composer-height')
      this.root = root; this.seat = seat
      if (seat) this.observer?.observe(seat)
    }
    this.measure()
    if (!frame) return
    // Resolve CSS aliases through a color property, not a guessed light/dark palette.
    const background = this.win.getComputedStyle(frame).backgroundColor
    if (background !== this.theme && /^rgba?\([\d.,\s]+\)$/.test(background)) {
      this.theme = background
      this.win.webkit?.messageHandlers?.dshMobile?.postMessage({type:'appearance', bridgeVersion:1, background: background.match(/[\d.]+/g)?.slice(0,3).map(Number)})
    }
  }
  private measure() {
    if (!this.seat || !this.root) return
    const height = `${Math.ceil(this.seat.getBoundingClientRect().height)}px`
    if (this.root.style.getPropertyValue('--mobile-composer-height') !== height) this.root.style.setProperty('--mobile-composer-height', height)
  }
  dispose() { this.observer?.disconnect(); this.root?.style.removeProperty('--mobile-composer-height'); this.root = undefined; this.seat = undefined }
}
