import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NavigationCapabilities } from './navigation.ts'
import { MobileRooms, RoomFailure, type MobileMember, type ProviderList } from './rooms.ts'
import { MobileIcon } from './MobileIcon.tsx'

export const openMobileMembers = (sessionId: string, invite = false) => window.dispatchEvent(new CustomEvent('dsh-mobile-members', { detail: { sessionId, invite } }))
type Props = PropsLocale<'mobile'> & { rooms: MobileRooms; navigation: NavigationCapabilities; prepareNavigation: () => void }
/** Roster UI calls only the installed Room Remote. Child chats stay with Sessions. */
export function MobileRoomNavigation({ rooms, navigation, prepareNavigation, t }: Props) {
  const feed = navigation.sessions.list
  const current = useSyncExternalStore(useCallback(fn => feed.subscribe(fn), [feed]), useCallback(() => feed.getSnapshot().current, [feed]))
  useSyncExternalStore(rooms.subscribe, rooms.getSnapshot)
  const room = current ? rooms.get(current) : undefined
  const [page, setPage] = useState<'members' | 'invite' | 'edit' | null>(null)
  const [member, setMember] = useState<MobileMember | null>(null)
  const [providers, setProviders] = useState<ProviderList | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [name, setName] = useState(''), [role, setRole] = useState(''), [provider, setProvider] = useState('')
  const [confirm, setConfirm] = useState<'removeMember' | 'cancel' | null>(null)
  const dialog = useRef<HTMLDialogElement>(null), epoch = useRef(0)
  const errorText = (e: unknown) => t(e instanceof RoomFailure && e.code === 'duplicate-name' ? 'duplicateMember' : e instanceof RoomFailure && e.code === 'invalid-name' ? 'invalidMember' : 'roomError')
  useEffect(() => {
    epoch.current++; setPage(null); setError(''); setBusy(false); setConfirm(null)
    if (!current) return
    const refresh = () => { if (!document.hidden) void rooms.refresh(current, true) }
    refresh(); const timer = window.setInterval(refresh, 7000)
    return () => { epoch.current++; window.clearInterval(timer) }
  }, [rooms, current])
  const invite = () => {
    setName(''); setRole(''); setProvider(''); setPage('invite'); setError(''); setConfirm(null)
    const generation = epoch.current
    setProviders(null)
    void rooms.providers().then(value => { if (epoch.current === generation) { setProviders(value); setProvider(value.providers.find(p => p.authenticated)?.provider ?? '') } }).catch(e => { if (epoch.current === generation) setError(errorText(e)) })
  }
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; invite: boolean }>).detail
      if (!current || detail.sessionId !== current || !rooms.available()) return
      if (detail.invite) invite(); else { setPage('members'); setError('') }
    }
    window.addEventListener('dsh-mobile-members', open)
    return () => window.removeEventListener('dsh-mobile-members', open)
  }, [current, rooms])
  useEffect(() => { if (page) dialog.current?.showModal(); else dialog.current?.close() }, [page])
  const mutate = async (method: string, fields: Record<string, unknown>, next: 'members' | 'edit' = 'members') => {
    if (!current || busy) return
    const generation = epoch.current; setBusy(true); setError('')
    try {
      await rooms.mutate(method, { sessionId: current, ...fields }); await rooms.refresh(current, true)
      if (generation === epoch.current) { setPage(next); setConfirm(null) }
    } catch (e) { if (generation === epoch.current) setError(errorText(e)) }
    finally { if (generation === epoch.current) setBusy(false) }
  }
  const running = (m: MobileMember) => room?.runs.some(run => run.member === m.name && run.state === 'running') ?? false
  const close = () => { if (!busy) { setPage(null); setConfirm(null) } }
  return <>
    {room && <button data-mobile-members-open aria-label={t('members')} onClick={() => { setPage('members'); setError('') }}><MobileIcon name="members"/><small>{room.members.length}</small></button>}
    {createPortal(<dialog ref={dialog} data-mobile-room-dialog data-mobile-tools-dialog aria-label={t(page === 'invite' ? 'inviteMember' : page === 'edit' ? 'memberSettings' : 'members')} onCancel={e => { if (busy) e.preventDefault() }} onClose={close}>
      <div data-mobile-tools-handle/>
      <header><strong>{t(page === 'invite' ? 'inviteMember' : page === 'edit' ? 'memberSettings' : 'members')}</strong><button disabled={busy} aria-label={t('done')} onClick={close}><MobileIcon name="close"/></button></header>
      {error && <p role="alert">{error}</p>}
      {page === 'members' && <>
        <p data-mobile-room-hint>{t('membersHint')}</p>
        {room?.members.map(m => <div data-mobile-member-row key={m.name}>
          <button data-mobile-member-chat disabled={!m.childSessionId} onClick={() => { if (m.childSessionId) { prepareNavigation(); navigation.sessions.open(m.childSessionId as Parameters<typeof navigation.sessions.open>[0]); close() } }}>
            <span data-mobile-avatar><MobileIcon name={m.kind === 'main-agent' ? 'compose' : 'members'} size={20}/></span>
            <span><strong>{m.name}</strong><small>{m.provider ?? t('mainMember')} · {m.kind === 'main-agent' ? t('currentConversation') : running(m) ? t('running') : m.childSessionId ? t('openMemberChat') : t('awaitingMember')}</small></span>
          </button>
          {m.kind !== 'main-agent' && <button aria-label={`${t('memberSettings')} ${m.name}`} onClick={() => { setMember(m); setName(m.name); setRole(m.instructions ?? ''); setPage('edit'); setError(''); setConfirm(null) }}><MobileIcon name="settings" size={20}/></button>}
        </div>)}
        <button data-mobile-room-primary onClick={invite}><MobileIcon name="plus" size={18}/>{t('inviteMember')}</button>
      </>}
      {(page === 'invite' || page === 'edit') && <form onSubmit={e => { e.preventDefault(); if (!name.trim() || /[\s@]/.test(name.trim())) { setError(t('invalidMember')); return } if (page === 'invite') void mutate('invite', { name: name.trim(), provider, ...(role.trim() ? { instructions: role.trim() } : {}) }); else if (member) void mutate('updateMember', { name: member.name, rename: name.trim(), instructions: role.trim() || null }) }}>
        {page === 'invite' && <label>{t('agentProvider')}<select aria-label={t('agentProvider')} required disabled={busy || !providers?.localAgentAvailable} value={provider} onChange={e => setProvider(e.target.value)}><option value="">{t('chooseProvider')}</option>{providers?.providers.map(p => <option key={p.provider} value={p.provider} disabled={!p.authenticated}>{p.displayName}{p.authenticated ? '' : ` · ${t('needsLogin')}`}</option>)}</select></label>}
        {page === 'invite' && <p role="status" data-mobile-room-hint>{providers === null ? t('loadingAgents') : !providers.providers.length ? t('noAgents') : !providers.providers.some(p => p.authenticated) ? t('loginAgents') : ''}</p>}
        <label>{t('memberName')}<input aria-label={t('memberName')} autoComplete="off" required value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
        <label>{t('memberRole')}<textarea aria-label={t('memberRole')} rows={3} value={role} disabled={busy} onChange={e => setRole(e.target.value)} placeholder={t('memberRoleHint')}/></label>
        <p data-mobile-room-hint>{t(page === 'invite' ? 'inviteHint' : 'roleChangeHint')}</p>
        {page === 'edit' && member && <details><summary>{t('advanced')}</summary><p>{t('agentProvider')}: {member.provider}</p><p>{t('hostPath')}: {member.cwd || t('inheritWorkspace')}</p></details>}
        <button data-mobile-room-primary type="submit" disabled={busy || (page === 'invite' && !provider)}>{busy ? t('saving') : t(page === 'invite' ? 'inviteMember' : 'save')}</button>
      </form>}
      {page === 'edit' && member && <>
        {confirm ? <div data-mobile-confirm><p>{t(confirm === 'cancel' ? 'stopMemberConfirm' : 'removeMemberConfirm')}</p><button disabled={busy} onClick={() => void mutate(confirm, { name: member.name })}>{t('confirm')}</button><button disabled={busy} onClick={() => setConfirm(null)}>{t('cancel')}</button></div> : <div data-mobile-room-secondary>{running(member) && <button onClick={() => setConfirm('cancel')}>{t('stopMember')}</button>}<button disabled={running(member)} title={running(member) ? t('stopMemberConfirm') : undefined} onClick={() => setConfirm('removeMember')}>{t('removeMember')}</button></div>}
      </>}
      {page !== 'members' && <button disabled={busy} data-mobile-room-back onClick={() => { setPage('members'); setConfirm(null); setError('') }}>{t('backMembers')}</button>}
    </dialog>, document.body)}
  </>
}
