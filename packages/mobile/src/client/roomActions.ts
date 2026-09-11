/** Relay to the installed Room UI so validation, first-task dispatch, directory
 * picking and structured errors have one owner. Unknown layouts keep their UI. */
export function roomInviteButton(doc: Document): HTMLButtonElement | undefined {
  return [...doc.querySelectorAll<HTMLButtonElement>('[data-slot="main.conversation"] [data-slot="conversation.session.header.actions"] button[aria-label]')]
    .find(button => /^(＋|\+)?\s*(邀请 agent|Invite agent)$/i.test(button.getAttribute('aria-label') ?? ''))
}
export function openRoomInvite(doc: Document): boolean {
  const button = roomInviteButton(doc)
  if (!button || button.disabled || !doc.documentElement.hasAttribute('data-dsh-mobile')) return false
  button.click(); return true
}
export async function openRoomMemberSettings(doc: Document, name: string, stillCurrent: () => boolean): Promise<boolean> {
  const root = doc.querySelector('[data-slot="main.conversation"]')
  const tab = [...root?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []].find(b => /^(成员|Members)$/i.test(b.textContent?.trim() ?? ''))
  if (!root || !tab || tab.disabled || !stillCurrent()) return false
  tab.click()
  return new Promise(resolve => {
    let finished = false
    const finish = (ok: boolean) => { if (finished) return; finished = true; observer.disconnect(); clearTimeout(timer); resolve(ok) }
    const attempt = () => {
      if (!root.isConnected || !stillCurrent() || !doc.documentElement.hasAttribute('data-dsh-mobile')) { finish(false); return }
      const card = [...root.querySelectorAll<HTMLElement>('[data-member]')].find(el => el.dataset.member === name && !el.closest('[role="dialog"]'))
      const button = [...card?.querySelectorAll<HTMLButtonElement>('button') ?? []].find(b => /^(编辑|Edit)$/i.test(b.textContent?.trim() ?? ''))
      if (button && !button.disabled) { finish(true); button.click() }
    }
    const observer = new MutationObserver(attempt)
    const timer = setTimeout(() => finish(false), 3000)
    observer.observe(root, { subtree: true, childList: true }); attempt()
  })
}
