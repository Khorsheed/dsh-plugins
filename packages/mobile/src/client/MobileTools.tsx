import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ComposerActions, type ComposerAction } from './composerActions.ts'
import { openMobileMembers } from './MobileRooms.tsx'
import type { MobileRooms } from './rooms.ts'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MobileIcon } from './MobileIcon.tsx'

export interface MobileToolsInjected { rooms: MobileRooms; openCommands: (id: SessionSummary['id'], draft: string, span: TokenSpan) => boolean }

/** Own only the launcher and grouped navigation; action targets stay host-owned. */
export function MobileTools({ t, useSession, useInput, inputActions, rooms, openCommands }: PropsLocale<'mobile'> & PropsRuntime<'conversation.input.left'> & MobileToolsInjected) {
  const sessionId = useSession(s => s.sessionId)
  const draft = useInput(s => s.draft)
  const seat = useRef<HTMLSpanElement>(null)
  const [actions, setActions] = useState<ComposerActions>()
  useLayoutEffect(() => {
    if (!seat.current) return
    const controller = new ComposerActions(seat.current); setActions(controller)
    return () => controller.dispose()
  }, [])
  return <span ref={seat} data-mobile-tools-seat>{actions && <Tools actions={actions} t={t} openCommands={openCommands ? () => openCommands(sessionId, draft, inputActions.captureInsertion()) : undefined} invite={rooms.available() ? () => openMobileMembers(sessionId, true) : undefined}/>}</span>
}
export function Tools({ actions, t, invite, openCommands }: { actions: ComposerActions; openCommands?: (() => boolean) | undefined; invite: (() => void) | undefined } & PropsLocale<'mobile'>) {
  const targets = useSyncExternalStore(actions.subscribe, actions.getSnapshot)
  const dialog = useRef<HTMLDialogElement>(null), launcher = useRef<HTMLButtonElement>(null)
  const close = () => { dialog.current?.close(); launcher.current?.setAttribute('aria-expanded', 'false') }
  useLayoutEffect(() => { if (!targets.commands || !targets.attachments) close() }, [targets.commands, targets.attachments])
  if (!targets.commands || !targets.attachments) return null
  const invoke = (action: ComposerAction) => { close(); actions.invoke(action, openCommands) }
  return <>
    <button ref={launcher} data-mobile-tools-open aria-label={t('inputTools')} aria-haspopup="dialog" aria-expanded="false" onClick={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); launcher.current?.focus({ preventScroll: true }); dialog.current?.showModal(); launcher.current?.setAttribute('aria-expanded', 'true') }}><MobileIcon name="plus"/></button>
    <dialog ref={dialog} data-mobile-tools-dialog aria-label={t('inputTools')} onClose={() => launcher.current?.setAttribute('aria-expanded', 'false')} onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientY < r.top || event.clientX < r.left || event.clientX > r.right || event.clientY > r.bottom) close() } }}>
      <div data-mobile-tools-handle/>
      <header><strong>{t('inputTools')}</strong><button aria-label={t('closeTools')} onClick={close}><MobileIcon name="close"/></button></header>
      <div data-mobile-tools-grid>
        <button disabled={targets.attachments.disabled} onClick={() => invoke('attachments')}><MobileIcon name="attachment"/>{t('attachments')}</button>
        <button disabled={targets.commands.disabled} onClick={() => invoke('commands')}><MobileIcon name="commands"/>{t('commands')}</button>
      </div>
      {targets.permissions && <button data-mobile-tools-permission disabled={targets.permissions.disabled} onClick={() => invoke('permissions')}><MobileIcon name="shield"/><span>{t('permissions')}</span><small>{targets.permissions.label}</small><MobileIcon name="right" size={16}/></button>}
      {invite && <button data-mobile-tools-permission onClick={() => { close(); invite() }}><MobileIcon name="members"/><span>{t('inviteMember')}</span><small/><MobileIcon name="right" size={16}/></button>}
    </dialog>
  </>
}
