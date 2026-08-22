/**
 * Writable composer for family CLI member sessions, elected through the
 * 'conversation.composer' chain at priority -20 (ui-subagent's read-only
 * takeover sits at -10; chain election is ascending, first non-null selector
 * wins). The chain-slot contract requires a selector to be a PURE function of
 * the owner props, so membership is decided in two stages: the selector coarse-
 * filters on the session snapshot (one-shot subagent sessions elect), and the
 * component confirms real family membership through the `memberOf` Remote —
 * a session the family never delegated renders the same read-only panel the
 * official composer shows, never a writable box. Send goes to the
 * `promptMember` Remote (the facade resume), never to the official input
 * machine; Stop goes to `stopMember`.
 */
import { useEffect, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalAgentDelegationView, LocalAgentPromptResult } from '@khorsheed/dsh-local-agent/types'
import { memberDockLines, type MemberDockProjections } from './member-dock.ts'
import { NS } from './locales.ts'
import css from './MemberComposer.module.css'

/** What the chain selector hands the elected component. */
export interface MemberComposerMatch {
  /**
   * The elected session's id — a one-shot subagent session, possibly a family
   * member (the component confirms through the Remote).
   */
  childSessionId: string
}

/**
 * Pure coarse filter for the composer chain: elect any one-shot subagent
 * session. Deliberately wide (selector purity allows no async membership
 * check) — the component degrades to the read-only panel when the delegation
 * registry has no record for the session.
 * @param owner - the composer chain currency dispatched by ConversationRoot.
 * @returns the match carrying the child session id, or null to pass the
 *   election down the chain.
 */
export function selectCliMember(owner: ComposerChainProps): MemberComposerMatch | null {
  const session = owner.session
  const subagent = session?.subagent
  if (session === undefined || subagent === undefined || subagent === null) return null
  if (subagent.address.mode !== 'one-shot') return null
  return { childSessionId: session.sessionId }
}

/**
 * Injected business face: the member channel's gateway remotes, narrowed to
 * plain values (an RPC failure surfaces as undefined, which the component
 * renders through its own copy rather than throwing into the slot tree).
 */
export interface MemberComposerInjected {
  /** The delegation view for a child session; null = not a family member. */
  memberOf: (childSessionId: string) => Promise<LocalAgentDelegationView | null | undefined>
  /** Send one human follow-up to the member (facade resume host-side). */
  promptMember: (childSessionId: string, text: string) => Promise<LocalAgentPromptResult | undefined>
  /** Interrupt the member's in-flight run. */
  stopMember: (childSessionId: string) => Promise<boolean | undefined>
}

/** Full chain props after the member selector accepts the owner currency. */
export type MemberComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: MemberComposerMatch } & PropsLocale<typeof NS> & MemberComposerInjected

/** Membership probe state: undefined = still checking, null = not a member. */
type Membership = LocalAgentDelegationView | null | undefined

/**
 * The member composer: a writable box for family member sessions and the
 * official-looking read-only panel for every other one-shot session. Drafts
 * stay in local state (the official input machine is deliberately NOT wired —
 * its send path is hardwired to the host prompt pipeline this channel must
 * bypass); a run in flight (the session's own `running` flag, driven by the
 * mirrored transcript events) disables the input and swaps Send for Stop.
 * @param props - selector match, standard slot props, locale seat, and the
 *   injected gateway face.
 * @returns the composer, or the read-only panel while checking / when not a
 *   member.
 */
export function MemberComposer({ matched, useSession, useProjection, memberOf, promptMember, stopMember, t }: MemberComposerProps) {
  const [membership, setMembership] = useState<Membership>(undefined)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** The last structured promptMember failure, rendered inline. */
  const [error, setError] = useState<string | null>(null)
  const running = useSession(snapshot => snapshot.running) ?? false
  // The member dock self-renders ambient state from the projection seat: the
  // official panels (StatsLine on 'conversation.composer.dock', TodoPanel on
  // 'conversation.input.dock') live INSIDE the fallback InputBar that
  // `overlay: true` hides on election, so no official dock row can reach a
  // member session. One bag entry per projection a contributor reads.
  const projections: MemberDockProjections = {
    tokenUsage: useProjection('tokenUsage'),
    todos: useProjection('todos'),
  }

  useEffect(() => {
    let cancelled = false
    setMembership(undefined)
    void memberOf(matched.childSessionId).then((view) => {
      if (!cancelled) setMembership(view ?? null)
    })
    return () => { cancelled = true }
  }, [memberOf, matched.childSessionId])

  if (membership === undefined) {
    return <div className={css.frame} role="status"><span>{t('member.checking')}</span></div>
  }
  if (membership === null) {
    // Not a family member: render the official one-shot read-only panel
    // (visually aligned with ui-subagent's SubagentReadOnlyComposer), never a
    // writable box.
    return (
      <div className={css.frame} role="status">
        <strong>{t('member.readonly.title')}</strong>
        <span>{t('member.readonly.body')}</span>
      </div>
    )
  }

  const busy = sending || running
  const dockLines = memberDockLines(projections, t)
  const send = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    setSending(true)
    setError(null)
    void promptMember(matched.childSessionId, text).then((result) => {
      setSending(false)
      if (result !== undefined && result.ok) {
        setDraft('')
      } else {
        setError(result !== undefined && !result.ok ? result.error : t('member.sendFailed'))
      }
    })
  }
  const stop = (): void => {
    void stopMember(matched.childSessionId)
  }
  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setDraft(event.target.value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Shift+Enter is the native newline; an IME-composition Enter picks a
    // candidate and must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!event.repeat) send() // held-down Enter must not machine-gun sends
  }

  return (
    <div className={css.root}>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      <div className={css.card}>
        <div className={css.header}>
          <span>{t('member.title', { harness: membership.harnessDisplayName ?? membership.provider })}</span>
          {running && <span className={css.running}>{t('member.running')}</span>}
        </div>
        <textarea
          className={css.input}
          value={draft}
          rows={2}
          disabled={busy}
          placeholder={t('member.placeholder')}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <div className={css.row}>
          {running ? (
            <button type="button" className={css.primary} aria-label={t('member.stop')} onClick={stop}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={css.primary}
              aria-label={t('member.send')}
              disabled={draft.trim() === '' || busy}
              onClick={send}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {dockLines.length > 0 && (
        <div className={css.dock} data-member-dock>
          {dockLines.map(line => (
            <div
              key={line.id}
              className={css.dockRow}
              // The stats row keeps the pre-dock test hook; every row also
              // carries its contributor id as the generic hook.
              data-member-stats={line.id === 'stats' ? '' : undefined}
              data-member-dock-row={line.id}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
