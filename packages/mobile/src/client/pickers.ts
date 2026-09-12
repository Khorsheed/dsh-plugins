/** Adapt only the next menu opened by a checked official hero trigger.
 * Choices, disabled state, selection, refusal and dismissal remain with its owner. */
export class MobilePickers {
  private pending: { trigger: HTMLButtonElement; kind: 'workspace' | 'preset'; before: Set<Element>; until: number } | undefined
  private menu: HTMLElement | undefined
  private chrome: HTMLElement | undefined
  private shade: HTMLElement | undefined
  private hidden: HTMLElement[] = []
  constructor(private readonly doc: Document) { doc.addEventListener('click', this.click, true) }
  private readonly click = (event: Event) => {
    if (!this.doc.documentElement.hasAttribute('data-dsh-mobile')) return
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>('button[aria-haspopup="menu"]')
    if (!trigger || trigger.getAttribute('aria-expanded') === 'true') return
    const preset = trigger.closest('[data-slot="conversation.hero.agentPreset"]')
    const workspace = trigger.closest('[data-phase="hero"]') && trigger.querySelector('svg') && trigger.parentElement?.querySelector(':scope > [data-slot="conversation.hero.workspace"]')
    if (!preset && !workspace) return
    this.pending = { trigger, kind: preset ? 'preset' : 'workspace', before: new Set(this.doc.querySelectorAll('[role=menu]')), until: Date.now() + 1000 }
  }
  sync(active: boolean) {
    if (!active) { this.clear(); return }
    if (this.menu && !this.menu.isConnected) this.clear()
    const pending = this.pending
    if (!pending) return
    if (Date.now() > pending.until || !pending.trigger.isConnected) { this.pending = undefined; return }
    const menu = Array.from(this.doc.querySelectorAll<HTMLElement>('[role=menu]')).find(el => !pending.before.has(el) && !el.parentElement?.closest('[role=menu]'))
    if (!menu) return
    this.pending = undefined; this.menu = menu
    menu.dataset.mobilePicker = pending.kind
    const zh = /^zh/i.test(this.doc.documentElement.lang || navigator.language)
    const header = this.doc.createElement('div'); header.dataset.mobilePickerChrome = ''
    const title = this.doc.createElement('strong'); title.textContent = pending.kind === 'workspace' ? (zh ? '选择工作区' : 'Choose workspace') : (zh ? '选择模式' : 'Choose mode')
    const close = this.doc.createElement('button'); close.textContent = zh ? '完成' : 'Done'; close.onclick = () => pending.trigger.click()
    header.append(title, close)
    if (pending.kind === 'workspace') {
      const input = this.doc.createElement('input'); input.type = 'search'; input.placeholder = zh ? '搜索工作区' : 'Search workspaces'; input.setAttribute('aria-label', input.placeholder)
      input.oninput = () => {
        for (const el of this.hidden) el.hidden = false
        this.hidden = []
        for (const item of menu.querySelectorAll<HTMLElement>('[role=menuitem]')) {
          // Keep the add-workspace action available when no existing directory matches.
          if (item.parentElement?.parentElement === menu.lastElementChild && menu.children.length > 2) continue
          if (!item.textContent?.toLocaleLowerCase().includes(input.value.toLocaleLowerCase()) && !item.hidden) { item.hidden = true; this.hidden.push(item) }
        }
      }
      header.append(input)
    }
    menu.prepend(header); this.chrome = header
    const shade = this.doc.createElement('div'); shade.dataset.mobilePickerShade = ''; shade.setAttribute('aria-hidden','true')
    // The official outside-pointer handler closes its menu, including focus restoration.
    menu.before(shade); this.shade = shade
  }
  private clear() {
    this.menu?.removeAttribute('data-mobile-picker'); this.chrome?.remove(); this.shade?.remove()
    for (const el of this.hidden) el.hidden = false
    this.hidden = []; this.menu = undefined; this.chrome = undefined; this.shade = undefined; this.pending = undefined
  }
  dispose() { this.doc.removeEventListener('click', this.click, true); this.clear() }
}
