import { useEffect, useRef, useState } from 'react'
import { MobileIcon } from './MobileIcon.tsx'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface MobileQueueInjected { updateQueue?: IConversation['updateQueue'] }
/** Room's takeover hides the official QueueDock. Restore its mutation verbs
 * through the same scoped Conversation API, without touching the Room composer. */
export function MobileQueue({ useSession, updateQueue, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'mobile'> & MobileQueueInjected) {
  const rows = useSession(s => s.queue), running = useSession(s => s.running)
  const pending = useSession(s => s.pendingSubmissions)
  const mutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
  const [seat, setSeat] = useState<HTMLDivElement | null>(null), [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [edit, setEdit] = useState<{ id: string; text: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true)
  useEffect(() => {
    alive.current = true
    if (!updateQueue) return () => { alive.current = false }
    let owned: HTMLDivElement | undefined
    const sync = () => {
      const fallback = document.querySelector<HTMLElement>('[data-mobile-frame] [data-chain-overlay-fallback="conversation.composer"]')
      const root = fallback?.closest('[data-composer-seat]')
      const roomQueue = root?.querySelector('[data-testid="room-queue-strip"]')
      if (document.documentElement.hasAttribute('data-dsh-mobile') && fallback?.style.display === 'none' && roomQueue && root) {
        if (!owned) { owned = document.createElement('div'); owned.dataset.mobileRoomQueue = ''; root.prepend(owned); setSeat(owned) }
      } else if (owned) { owned.remove(); owned = undefined; setSeat(null) }
    }
    const observer = new MutationObserver(sync); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'data-dsh-mobile'] }); sync()
    return () => { alive.current = false; observer.disconnect(); owned?.remove() }
  }, [updateQueue])
  useEffect(() => { if (open && seat) dialog.current?.showModal(); else dialog.current?.close() }, [open, seat])
  const queued = rows.filter(r => r.placement === 'queued')
  useEffect(() => { if (!queued.length) { setOpen(false); setEdit(null) } }, [queued.length])
  const apply = async (id: string, action: Parameters<NonNullable<MobileQueueInjected['updateQueue']>>[1]) => {
    if (!updateQueue || busy) return
    setBusy(true); setError(false)
    try { await updateQueue(id as Parameters<typeof updateQueue>[0], action); if (alive.current) setEdit(null) }
    catch { if (alive.current) setError(true) }
    finally { if (alive.current) setBusy(false) }
  }
  if (!seat || !updateQueue || !queued.length) return null
  return createPortal(<>
    <button data-mobile-queue-pill onClick={() => setOpen(true)}>{t('queued')} · {queued.length}</button>
    <dialog ref={dialog} data-mobile-tools-dialog aria-label={t('queued')} onClose={() => setOpen(false)}>
      <div data-mobile-tools-handle/><header><strong>{t('queued')}</strong><button aria-label={t('done')} onClick={() => dialog.current?.close()}><MobileIcon name="close"/></button></header>
      {error && <p role="alert">{t('queueError')}</p>}
      {queued.map(row => <section data-mobile-queue-row key={row.id}>
        {edit?.id === row.id ? <textarea aria-label={t('editQueued')} value={edit.text} onChange={e => setEdit({ id: row.id, text: e.target.value })}/> : <p>{row.content.map(b => b.type === 'text' ? b.text : `[${t('attachments')}]`).join('')}</p>}
        <div>
          {edit?.id === row.id ? <><button disabled={busy || !edit.text.trim()} onClick={() => void apply(row.id, { kind: 'edit', content: [{ type: 'text', text: edit.text }] })}>{t('save')}</button><button disabled={busy} onClick={() => setEdit(null)}>{t('cancel')}</button></> : <>
            <button disabled={!mutable || busy || !running} onClick={() => void apply(row.id, { kind: 'steer' })}>{t('sendNow')}</button>
            <button disabled={!mutable || busy || row.content.some(b => b.type !== 'text')} onClick={() => setEdit({ id: row.id, text: row.content.map(b => b.type === 'text' ? b.text : '').join('') })}>{t('editQueued')}</button>
            <button disabled={!mutable || busy} onClick={() => void apply(row.id, { kind: 'remove' })}>{t('removeQueued')}</button>
          </>}
        </div>
      </section>)}
      {pending.some(p => p.placement === 'queued') && <p role="status">{t('sendingQueued')}</p>}
    </dialog>
  </>, seat)
}
