import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NavigationCapabilities } from './navigation.ts'
import { mainSessionId } from './navigation.ts'
import { MobileRooms } from './rooms.ts'
import { MobileIcon } from './MobileIcon.tsx'
import { openRoomInvite, openRoomMemberSettings } from './roomActions.ts'

export const openMobileMembers = (sessionId: string, invite = false) => window.dispatchEvent(new CustomEvent('dsh-mobile-members', { detail: { sessionId, invite } }))
type Props = PropsLocale<'mobile'> & { rooms: MobileRooms; navigation: NavigationCapabilities; prepareNavigation: () => void }
/** A read-only roster shortcut. All mutations open the installed Room UI. */
export function MobileRoomNavigation({ rooms, navigation, prepareNavigation, t }: Props) {
  const feed = navigation.sessions.list
  const current = useSyncExternalStore(useCallback(fn => feed.subscribe(fn), [feed]), useCallback(() => mainSessionId(feed.getSnapshot()), [feed]))
  useSyncExternalStore(rooms.subscribe, rooms.getSnapshot)
  const room = current ? rooms.get(current) : undefined
  const [open, setOpen] = useState(false), [error, setError] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), epoch = useRef(0)
  useEffect(() => {
    epoch.current++; setOpen(false); setError(false)
    if (!current) return
    const refresh = () => { if (!document.hidden) void rooms.refresh(current, true) }
    refresh(); const timer = window.setInterval(refresh, 7000)
    return () => { epoch.current++; window.clearInterval(timer) }
  }, [rooms, current])
  const close = () => { dialog.current?.close(); setOpen(false) }
  const invite = () => { close(); if (!openRoomInvite(document)) { setError(true); setOpen(true) } }
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; invite: boolean }>).detail
      if (!current || detail.sessionId !== current || !rooms.available()) return
      if (detail.invite) invite(); else { setOpen(true); setError(false) }
    }
    window.addEventListener('dsh-mobile-members', show)
    return () => window.removeEventListener('dsh-mobile-members', show)
  }, [current, rooms])
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  const edit = async (name: string) => {
    const generation = epoch.current; close()
    const ok = await openRoomMemberSettings(document, name, () => epoch.current === generation)
    if (!ok && epoch.current === generation) { setError(true); setOpen(true) }
  }
  // The official workspace service is the only navigation writer on both host
  // lines (alpha.2 deleted sessions.open); it throws synchronously on failure.
  const openChat = (childSessionId: string) => {
    prepareNavigation()
    try { navigation.workspace.openSession(childSessionId as Parameters<NavigationCapabilities['workspace']['openSession']>[0]); close() }
    catch { setError(true); setOpen(true) }
  }
  return <>
    {room && <button data-mobile-members-open aria-label={t('members')} onClick={() => { setOpen(true); setError(false) }}><MobileIcon name="members"/><small>{room.members.length}</small></button>}
    {createPortal(<dialog ref={dialog} data-mobile-room-dialog data-mobile-tools-dialog aria-label={t('members')} onClose={() => setOpen(false)}>
      <div data-mobile-tools-handle/>
      <header><strong>{t('members')}</strong><button aria-label={t('done')} onClick={close}><MobileIcon name="close"/></button></header>
      {error && <p role="alert">{t('roomActionUnavailable')}</p>}
      <p data-mobile-room-hint>{t('membersHint')}</p>
      {room?.members.map(m => {
        const run = room.runs.find(r => r.member === m.name)
        return <div data-mobile-member-row key={m.name}>
          <button data-mobile-member-chat disabled={!m.childSessionId} onClick={() => { if (m.childSessionId) openChat(m.childSessionId) }}>
            <span data-mobile-avatar><MobileIcon name={m.kind === 'main-agent' ? 'compose' : 'members'} size={20}/></span>
            <span><strong>{m.name}</strong><small>{m.provider ?? t('mainMember')} · {m.kind === 'main-agent' ? t('currentConversation') : run?.state === 'running' ? t('running') : run?.state === 'failed' ? t('memberFailed') : m.childSessionId ? t('openMemberChat') : t('awaitingMember')}</small></span>
          </button>
          {m.kind !== 'main-agent' && <button aria-label={`${t('memberSettings')} ${m.name}`} onClick={() => void edit(m.name)}><MobileIcon name="settings" size={20}/></button>}
        </div>
      })}
      <button data-mobile-room-primary onClick={invite}><MobileIcon name="plus" size={18}/>{t('inviteMember')}</button>
    </dialog>, document.body)}
  </>
}
