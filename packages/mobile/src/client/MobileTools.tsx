import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ComposerActions, type ComposerAction } from './composerActions.ts'
import { MobileIcon } from './MobileIcon.tsx'

/** Own only the launcher and grouped navigation; action targets stay host-owned. */
export function MobileTools({ t }: PropsLocale<'mobile'>) {
  const seat = useRef<HTMLSpanElement>(null)
  const [actions, setActions] = useState<ComposerActions>()
  useLayoutEffect(() => {
    if (!seat.current) return
    const controller = new ComposerActions(seat.current); setActions(controller)
    return () => controller.dispose()
  }, [])
  return <span ref={seat} data-mobile-tools-seat>{actions && <Tools actions={actions} t={t}/>}</span>
}
function Tools({ actions, t }: { actions: ComposerActions } & PropsLocale<'mobile'>) {
  const targets = useSyncExternalStore(actions.subscribe, actions.getSnapshot)
  const dialog = useRef<HTMLDialogElement>(null), launcher = useRef<HTMLButtonElement>(null)
  const close = () => { dialog.current?.close(); launcher.current?.setAttribute('aria-expanded', 'false') }
  useLayoutEffect(() => { if (!targets.commands || !targets.attachments) close() }, [targets.commands, targets.attachments])
  if (!targets.commands || !targets.attachments) return null
  const invoke = (action: ComposerAction) => { close(); actions.invoke(action) }
  return <>
    <button ref={launcher} data-mobile-tools-open aria-label={t('inputTools')} aria-haspopup="dialog" aria-expanded="false" onClick={() => { dialog.current?.showModal(); launcher.current?.setAttribute('aria-expanded', 'true') }}><MobileIcon name="plus"/></button>
    <dialog ref={dialog} data-mobile-tools-dialog aria-label={t('inputTools')} onClose={() => launcher.current?.setAttribute('aria-expanded', 'false')} onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientY < r.top || event.clientX < r.left || event.clientX > r.right || event.clientY > r.bottom) close() } }}>
      <div data-mobile-tools-handle/>
      <header><strong>{t('inputTools')}</strong><button aria-label={t('closeTools')} onClick={close}><MobileIcon name="close"/></button></header>
      <div data-mobile-tools-grid>
        <button disabled={targets.attachments.disabled} onClick={() => invoke('attachments')}><MobileIcon name="attachment"/>{t('attachments')}</button>
        <button disabled={targets.commands.disabled} onClick={() => invoke('commands')}><MobileIcon name="commands"/>{t('commands')}</button>
      </div>
      {targets.permissions && <button data-mobile-tools-permission disabled={targets.permissions.disabled} onClick={() => invoke('permissions')}><MobileIcon name="shield"/><span>{t('permissions')}</span><small>{targets.permissions.label}</small><MobileIcon name="right" size={16}/></button>}
    </dialog>
  </>
}
