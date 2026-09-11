/** Last-resort rc1 geometry adapter. No nodes are moved, copied or unmounted.
 * Unknown structures keep their official presentation; dispose releases every mark. */
export class MobileSurface {
  private marks = new Map<HTMLElement, Set<string>>()
  private root: HTMLElement | null | undefined
  private seat: HTMLElement | null | undefined
  private row: HTMLElement | null | undefined
  private composer: HTMLElement | null | undefined
  private resize?: ResizeObserver
  constructor(private readonly doc: Document) {
    if (typeof ResizeObserver !== 'undefined') this.resize = new ResizeObserver(this.measure)
    doc.addEventListener('scroll', this.measure, true)
  }
  private mark(el: HTMLElement, name: string) {
    el.setAttribute(name, '')
    const names = this.marks.get(el) ?? new Set<string>(); names.add(name); this.marks.set(el, names)
  }
  sync(frame?: HTMLElement) {
    this.clearMarks()
    const root = frame?.querySelector<HTMLElement>('[data-slot="main.conversation"] > [data-phase]')
    const seat = root?.querySelector<HTMLElement>('[data-mobile-context-seat]')
    const composer = root?.querySelector<HTMLElement>('[data-composer-seat]')
    const row = root?.querySelector<HTMLElement>('header [data-conversation-header-corner]')?.parentElement
    // Only an ordinary title can be compacted. Preserve ancestor/lineage navigation.
    const ordinary = row?.querySelector('nav > span:only-child > button:disabled + [data-slot="conversation.session.header.lineage"]:empty')
    const dock = !!root && root.dataset.phase === 'active' && !!seat && !!row && !!ordinary
    if (dock) {
      this.mark(root, 'data-mobile-context-layout'); this.mark(row, 'data-mobile-context-row')
      // Only the host-app launch split control is desktop-specific. Sibling utilities survive.
      for (const img of row.querySelectorAll<HTMLImageElement>('img[src^="/open-in-app/icon/"]')) {
        const split = img.closest('button')?.parentElement
        if (split && split.querySelectorAll('button').length === 2) this.mark(split, 'data-mobile-desktop-launch')
      }
    }
    if (root) {
      const tabs = root.querySelector<HTMLElement>('header [role="tablist"]')
      if (tabs) {
        const trajectory = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]')).find(el => /^(轨迹|Trajectory)$/i.test(el.textContent?.trim() ?? ''))
        // A previously selected trajectory retains the official route back to chat.
        if (trajectory && trajectory.getAttribute('aria-selected') !== 'true') {
          this.mark(trajectory, 'data-mobile-hidden-tab')
          if (tabs.querySelectorAll('[role="tab"]').length === 2) this.mark(tabs, 'data-mobile-hidden-tab')
        }
      }
    }
    if (this.root !== root || this.seat !== seat || this.row !== row || this.composer !== composer) {
      this.root?.style.removeProperty('--mobile-context-bottom')
      this.resize?.disconnect(); this.root = root; this.seat = seat; this.row = row; this.composer = composer
      if (root) this.resize?.observe(root)
      if (seat) this.resize?.observe(seat)
      if (row) this.resize?.observe(row)
      if (composer) this.resize?.observe(composer)
    }
    this.measure()
  }
  private readonly measure = () => {
    if (!this.root?.hasAttribute('data-mobile-context-layout') || !this.seat || !this.row) return
    const value = `${Math.round(this.root.getBoundingClientRect().bottom - this.seat.getBoundingClientRect().bottom)}px`
    if (this.root.style.getPropertyValue('--mobile-context-bottom') !== value) this.root.style.setProperty('--mobile-context-bottom', value)
  }
  private clearMarks() {
    for (const [el, names] of this.marks) for (const name of names) el.removeAttribute(name)
    this.marks.clear()
  }
  dispose() { this.clearMarks(); this.resize?.disconnect(); this.doc.removeEventListener('scroll', this.measure, true); this.root?.style.removeProperty('--mobile-context-bottom') }
}
