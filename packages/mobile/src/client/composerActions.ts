/** Checked legacy and 0.1.7 composer bridge. The official editor, chooser, permission menu and
 * confirmation remain mounted and retain their callbacks. Unknown markup falls back. */
export type ComposerAction = 'commands' | 'attachments' | 'permissions'
export interface ActionTarget { button: HTMLButtonElement | HTMLInputElement; label: string; disabled: boolean }
export type ComposerActionsSnapshot = Partial<Record<ComposerAction, ActionTarget>>
export class ComposerActions {
  private snapshot: ComposerActionsSnapshot = {}
  private listeners = new Set<() => void>()
  private marked = new Set<HTMLButtonElement>()
  private observer: MutationObserver
  constructor(private readonly seat: HTMLElement) {
    this.observer = new MutationObserver(() => this.sync())
    const card = seat.closest('[data-composer-card]')
    if (card) this.observer.observe(card, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-label', 'contenteditable'] })
    this.sync()
  }
  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private sync() {
    const card = this.seat.closest('[data-composer-card]')
    const file = card?.querySelector<HTMLInputElement>(':scope > div:last-child > div:first-child > input[type=file][hidden]')
    const previous = file?.previousElementSibling
    const unified = previous instanceof HTMLButtonElement && previous.getAttribute('aria-haspopup') === 'listbox'
    const attachments = unified ? file : previous
    const commands = unified ? previous : previous?.previousElementSibling
    const next: ComposerActionsSnapshot = {}
    if (commands instanceof HTMLButtonElement && commands.getAttribute('aria-haspopup') === 'listbox' && (attachments instanceof HTMLButtonElement || attachments instanceof HTMLInputElement)) {
      next.commands = this.target(commands)
      next.attachments = this.target(attachments)
      // The new host retains its file input and onChange validation, but folds
      // its button into commands. Match the owner picker admission: editable
      // composer (live, unlocked, not committing) and input enabled (not child).
      if (unified) next.attachments.disabled ||= commands.disabled || !card?.querySelector('[contenteditable="true"]')
      const modes = file?.nextElementSibling
      const permission = modes?.querySelector<HTMLButtonElement>('[data-slot="conversation.input.permission"] button[aria-label], :scope > span > button[aria-label]')
      // PermissionSelect has a text label between optional glyph and chevron spans.
      if (permission?.querySelector(':scope > span:not([aria-hidden])') && permission.querySelector(':scope > span[aria-hidden] svg')) next.permissions = this.target(permission)
    }
    for (const button of this.marked) if (!Object.values(next).some(value => value.button === button)) { button.removeAttribute('data-mobile-folded-action'); this.marked.delete(button) }
    for (const value of Object.values(next)) if (value.button instanceof HTMLButtonElement && !this.marked.has(value.button)) { value.button.setAttribute('data-mobile-folded-action', ''); this.marked.add(value.button) }
    if ((['commands', 'attachments', 'permissions'] as const).some(key => next[key]?.button !== this.snapshot[key]?.button || next[key]?.label !== this.snapshot[key]?.label || next[key]?.disabled !== this.snapshot[key]?.disabled)) {
      this.snapshot = next; for (const listener of this.listeners) listener()
    }
  }
  private target(button: HTMLButtonElement | HTMLInputElement): ActionTarget {
    return { button, label: button.textContent?.trim() || button.getAttribute('aria-label') || '', disabled: button.disabled }
  }
  invoke(action: ComposerAction, openCommands?: () => boolean): boolean {
    this.sync()
    const target = this.snapshot[action]
    if (!target || target.disabled || !target.button.isConnected) return false
    // Open the public source without focusing Lexical. Older hosts retain
    // their original button behavior when the optional service is absent.
    if (action === 'commands' && openCommands?.()) return true
    if (action === 'commands') this.seat.closest('[data-composer-card]')?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true })
    // Synchronous with the user's click, including the native file-picker gesture.
    target.button.click()
    return true
  }
  dispose() { this.observer.disconnect(); for (const button of this.marked) button.removeAttribute('data-mobile-folded-action'); this.marked.clear(); this.listeners.clear() }
}
