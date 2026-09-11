/** A touch presentation of the rendered message's own actions. The source
 * button stays mounted; its plugin still owns edits, confirmations and errors. */
export class MessageMenu {
  private timer: ReturnType<typeof setTimeout> | undefined
  private point: { x: number; y: number; row: HTMLElement } | undefined
  private menu: HTMLDialogElement | undefined
  constructor(private doc: Document) {
    doc.addEventListener('pointerdown', this.down, true)
    doc.addEventListener('pointermove', this.move, true)
    doc.addEventListener('pointerup', this.cancel, true)
    doc.addEventListener('pointercancel', this.cancel, true)
    doc.addEventListener('scroll', this.cancel, true)
    doc.addEventListener('contextmenu', this.context, true)
  }
  private row(target: EventTarget | null) {
    if (!this.doc.documentElement.hasAttribute('data-dsh-mobile') || !(target instanceof Element) || target.closest('button,a,input,textarea,[contenteditable],pre,code,[role=dialog]')) return
    const user = target.closest<HTMLElement>('[data-conversation-scroll] [data-time-hover-root]')
    if (user) return user
    const assistant = target.closest('[data-chat-flow-kind="assistant-step"][data-chat-turn]'), turn = assistant?.getAttribute('data-chat-turn')
    if (turn && /^\d+$/.test(turn)) return assistant?.closest('[data-conversation-scroll]')?.querySelector<HTMLElement>(`[data-turn-tail="${turn}"]`) ?? undefined
    return undefined
  }
  private actions(row: HTMLElement) {
    // An action bar's immediate buttons have accessible labels. Never harvest
    // controls inside the text, tool calls, JSON viewers or nested messages.
    return [...row.querySelectorAll<HTMLButtonElement>(row.hasAttribute('data-turn-tail') ? 'button[aria-label]' : ':scope > div > button[aria-label], :scope > div > span > button[aria-label]')]
      .filter(b => /^(复制|已复制|编辑|撤回|点赞|点踩|不喜欢|分支|好的回答|有问题的回答|在新对话中分支|Copy|Copied|Edit|Withdraw|Like|Dislike|Branch)/i.test(b.getAttribute('aria-label') ?? ''))
  }
  private down = (e: PointerEvent) => {
    this.cancel(); const row = this.row(e.target)
    if (!row || e.pointerType === 'mouse' || !this.actions(row).length) return
    this.point = { x: e.clientX, y: e.clientY, row }
    this.timer = setTimeout(() => { if (this.point) this.open(row, e.clientX, e.clientY) }, 500)
  }
  private move = (e: PointerEvent) => { if (this.point && Math.hypot(e.clientX - this.point.x, e.clientY - this.point.y) > 10) this.cancel() }
  private cancel = () => { clearTimeout(this.timer); this.timer = undefined; this.point = undefined }
  private context = (e: MouseEvent) => {
    const row = this.row(e.target)
    if (row && this.actions(row).length) { e.preventDefault(); this.open(row, e.clientX, e.clientY) }
  }
  private close = () => { this.menu?.close(); this.menu?.remove(); this.menu = undefined }
  private open(row: HTMLElement, x: number, y: number) {
    this.cancel(); this.close()
    const actions = this.actions(row); if (!actions.length) return
    const menu = this.doc.createElement('dialog'); this.menu = menu
    menu.dataset.mobileMessageMenu = ''; menu.setAttribute('aria-label', this.doc.documentElement.lang.startsWith('zh') ? '消息操作' : 'Message actions')
    for (const target of actions) {
      const button = this.doc.createElement('button'); button.type = 'button'; button.disabled = target.disabled
      const icon = target.querySelector('svg')?.cloneNode(true); if (icon) button.append(icon)
      button.append(this.doc.createTextNode(target.getAttribute('aria-label')!))
      button.onclick = () => { this.close(); if (target.isConnected && !target.disabled && this.doc.documentElement.hasAttribute('data-dsh-mobile')) target.click() }
      menu.append(button)
    }
    menu.addEventListener('cancel', this.close)
    menu.addEventListener('click', e => { if (e.target === menu) { const r = menu.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close() } })
    this.doc.body.append(menu); menu.showModal()
    const bounds = menu.getBoundingClientRect(), viewport = this.doc.defaultView?.visualViewport
    const width = viewport?.width ?? this.doc.documentElement.clientWidth, height = viewport?.height ?? this.doc.documentElement.clientHeight
    menu.style.left = `${Math.max(12, Math.min(x - bounds.width / 2, width - bounds.width - 12))}px`
    menu.style.top = `${Math.max(12, Math.min(y + 12, height - bounds.height - 12))}px`
  }
  dispose() {
    this.cancel(); this.close()
    this.doc.removeEventListener('pointerdown', this.down, true); this.doc.removeEventListener('pointermove', this.move, true)
    this.doc.removeEventListener('pointerup', this.cancel, true); this.doc.removeEventListener('pointercancel', this.cancel, true)
    this.doc.removeEventListener('scroll', this.cancel, true); this.doc.removeEventListener('contextmenu', this.context, true)
  }
}
