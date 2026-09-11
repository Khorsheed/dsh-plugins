/** rc1 has no composer autofocus option. Guard navigation focus through public
 * DOM events; never replace Lexical, its focus method, selection, or draft. */
export class ComposerFocus {
  private waiting = true
  constructor(private readonly doc: Document, private readonly active: () => boolean) {
    doc.addEventListener('focusin', this.focus, true)
    doc.addEventListener('pointerdown', this.pointer, true)
    doc.addEventListener('keydown', this.key, true)
  }
  readonly arm = (): void => {
    this.waiting = true
    const el = this.doc.activeElement
    if (this.active() && el instanceof HTMLElement && this.isEditor(el)) el.blur()
  }
  private isEditor(el: Element): boolean {
    return !!el.closest('[data-mobile-frame] [data-composer-card] [contenteditable="true"]')
  }
  private readonly focus = (event: FocusEvent): void => {
    if (this.active() && this.waiting && event.target instanceof HTMLElement && this.isEditor(event.target)) event.target.blur()
  }
  private readonly pointer = (event: PointerEvent): void => {
    // Explicit composer taps and message actions (e.g. edit) may focus input.
    if (event.target instanceof Element && event.target.closest('[data-mobile-frame] :is([data-composer-card], [data-conversation-scroll])')) this.waiting = false
  }
  private readonly key = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') this.waiting = false
  }
  dispose(): void {
    this.doc.removeEventListener('focusin', this.focus, true)
    this.doc.removeEventListener('pointerdown', this.pointer, true)
    this.doc.removeEventListener('keydown', this.key, true)
  }
}
