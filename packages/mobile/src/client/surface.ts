/** Checked rc1 presentation anchors. No nodes move and no action callbacks change.
 * Unknown header contributions retain their official presentation. */
export class MobileSurface {
  private marks = new Map<HTMLElement, Set<string>>()
  private preset = ''
  private listeners = new Set<() => void>()
  constructor(private readonly doc: Document) {}
  readonly getSnapshot = () => this.preset
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(preset: string) { if (preset !== this.preset) { this.preset = preset; for (const listener of this.listeners) listener() } }
  private mark(el: HTMLElement, name: string) {
    el.setAttribute(name, '')
    const names = this.marks.get(el) ?? new Set<string>(); names.add(name); this.marks.set(el, names)
  }
  sync(frame?: HTMLElement) {
    this.clearMarks()
    const root = frame?.querySelector<HTMLElement>('[data-slot="main.conversation"] > [data-phase]')
    const row = root?.querySelector<HTMLElement>('header [data-conversation-header-corner]')?.parentElement
    const ordinary = row?.querySelector('nav > span:only-child > button:disabled + [data-slot="conversation.session.header.lineage"]:empty')
    let preset = ''
    if (row) {
      for (const button of row.querySelectorAll<HTMLElement>('[data-slot="conversation.session.header.actions"] button[aria-label]')) {
        if (/^(重命名会话|Rename session)$/.test(button.getAttribute('aria-label') ?? '')) this.mark(button, 'data-mobile-original-rename')
      }
      for (const input of row.querySelectorAll<HTMLElement>('input[aria-label]')) {
        if (/^(会话标题|Session title)$/.test(input.getAttribute('aria-label') ?? '')) this.mark(input, 'data-mobile-rename-editor')
      }
    }
    if (root?.dataset.phase === 'active' && row && ordinary) {
      const label = row.querySelector<HTMLElement>('[data-slot="conversation.session.header.actions"] > span[title]:has(svg mask[id^="mask0_agent_preset"])')
      if (label) { preset = label.textContent?.trim() ?? ''; this.mark(label, 'data-mobile-header-hidden') }
      for (const img of row.querySelectorAll<HTMLImageElement>('img[src^="/open-in-app/icon/"]')) {
        const split = img.closest('button')?.parentElement
        if (split && split.querySelectorAll('button').length === 2) this.mark(split, 'data-mobile-header-hidden')
      }
      for (const button of row.querySelectorAll<HTMLElement>('[data-sidebar-right-expand], [data-slot="conversation.session.header.utilities"] > span > button[aria-haspopup="menu"][aria-busy]')) {
        if (button.hasAttribute('data-sidebar-right-expand') || /^(更多操作|More actions)$/i.test(button.getAttribute('aria-label') ?? '')) this.mark(button, 'data-mobile-header-hidden')
      }
      if (this.doc.querySelector('[data-mobile-members-open], [data-mobile-tools-open]')) {
        for (const button of row.querySelectorAll<HTMLElement>('[data-slot="conversation.session.header.actions"] button')) {
          if (/^(＋|\+)?\s*(邀请 agent|Invite agent)$/i.test(button.textContent?.trim() ?? '')) this.mark(button, 'data-mobile-header-hidden')
        }
      }
      // Collapse only a fully accounted-for row. Keep any plugin action or unknown text.
      const content = row.cloneNode(true) as HTMLElement
      content.querySelectorAll('[data-mobile-header-hidden], [data-mobile-original-rename], nav, svg').forEach(el => el.remove())
      if (!content.textContent?.trim() && !content.querySelector('button, input, a, img, canvas, video, iframe, [role="button"]')) this.mark(row, 'data-mobile-header-hidden')
    }
    this.publish(preset)
    if (root) {
      const tabs = root.querySelector<HTMLElement>('header [role="tablist"]')
      if (tabs) {
        const trajectory = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]')).find(el => /^(轨迹|Trajectory)$/i.test(el.textContent?.trim() ?? ''))
        if (trajectory && trajectory.getAttribute('aria-selected') !== 'true') {
          this.mark(trajectory, 'data-mobile-hidden-tab')
          if (tabs.querySelectorAll('[role="tab"]').length === 2) this.mark(tabs, 'data-mobile-hidden-tab')
        }
      }
      // Members remains the authoritative settings/removal view, also reachable
      // if the mobile shortcut cannot recognize a future Room action layout.
      const header = row?.parentElement
      if (header && Array.from(header.children).every(child => child.hasAttribute('data-mobile-header-hidden') || child.hasAttribute('data-mobile-hidden-tab'))) this.mark(header, 'data-mobile-header-hidden')
    }
    if (frame) for (const dialog of frame.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')) {
      // Room invite/edit signature: preview member, name dice, advanced cwd.
      // Never style arbitrary host/plugin dialogs based on title text alone.
      if (!dialog.querySelector('[data-member]') || !dialog.querySelector('details input[readonly]') || !dialog.querySelector('button[aria-label]:not([disabled])')) continue
      this.mark(dialog, 'data-mobile-room-form')
      const overlay = dialog.parentElement
      if (overlay?.getAttribute('role') === 'presentation') this.mark(overlay, 'data-mobile-room-overlay')
    }
  }
  private clearMarks() { for (const [el, names] of this.marks) for (const name of names) el.removeAttribute(name); this.marks.clear() }
  dispose() { this.clearMarks(); this.publish(''); this.listeners.clear() }
}
