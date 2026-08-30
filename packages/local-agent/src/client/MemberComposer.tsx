/**
 * Writable composer for family CLI member sessions, elected through the
 * 'conversation.composer' chain at priority -20 (ui-subagent's read-only
 * takeover sits at -10; chain election is ascending, first non-null selector
 * wins). The chain-slot contract requires a selector to be a PURE function of
 * the owner props, so membership is decided in two stages: the selector coarse-
 * filters on the session snapshot (one-shot subagent sessions elect), and the
 * component confirms real family membership through the `memberOf` Remote —
 * a session the family never delegated renders the same read-only panel the
 * official composer shows, never a writable box. The verification window is
 * a NEUTRAL checking state (no read-only semantics), an RPC failure is never
 * read as "not a member", and a confirmed membership is cached per session so
 * a re-enter renders the writable box on the first frame. Send goes to the
 * `promptMember` Remote (the facade resume), never to the official input
 * machine; Stop goes to `stopMember`.
 */
import { useEffect, useRef, useState } from 'react'
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
  // Pending interactions (questions/approvals) belong to the official
  // ApprovalPanel — a chain entry at priority 1. Election runs ascending, so
  // this -20 entry would shadow it: decline and let the interaction render.
  if (owner.interactions.length > 0) return null
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
  /**
   * The in-flight delegation child session ids (the second running source:
   * the official summary `running` flag is agent-based and stays false for
   * external CLI runs, which have no live host agent). undefined = RPC
   * failure; the component keeps the last known bit rather than flapping.
   */
  activeDelegations: () => Promise<readonly string[] | undefined>
}

/** Full chain props after the member selector accepts the owner currency. */
export type MemberComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: MemberComposerMatch } & PropsLocale<typeof NS> & MemberComposerInjected

/** Membership probe state: undefined = still checking, null = not a member. */
type Membership = LocalAgentDelegationView | null | undefined

/** RPC-failure retry budget for the membership probe (see the probe effect). */
const MEMBER_PROBE_RETRIES = 2
/** Delay between membership probe retries. */
const MEMBER_PROBE_RETRY_MS = 300
/** In-flight delegation poll cadence (the taskpilot dock's proven cadence). */
const ACTIVE_DELEGATIONS_POLL_MS = 1_500

/**
 * Session-level positive membership cache: a recorded delegation is immutable
 * for the session's lifetime, so a confirmed member re-enter renders the
 * writable box on the first frame instead of re-flashing the checking state.
 * Null answers (not yet delegated) are never cached — the record lands with
 * the first round's settle, and the probe effect re-checks on running flips.
 */
const membershipCache = new Map<string, LocalAgentDelegationView>()

/** Test hook: drop every cached membership answer. */
export function resetMembershipCache(): void {
  membershipCache.clear()
}

/**
 * The member composer: a writable box for family member sessions and the
 * official-looking read-only panel for every other one-shot session. Drafts
 * stay in local state (the official input machine is deliberately NOT wired —
 * its send path is hardwired to the host prompt pipeline this channel must
 * bypass). A run in flight disables the input and swaps Send for Stop — the
 * running bit is DUAL-SOURCE: the session summary's flag (agent-based; the
 * dsh member's sub-instance drives it natively) OR the family's in-flight
 * delegation registry polled through `activeDelegations` (the only source
 * that lights up for external CLI runs, which have no live host agent).
 * @param props - selector match, standard slot props, locale seat, and the
 *   injected gateway face.
 * @returns the composer, the neutral checking state while probing, or the
 *   read-only panel when not a member.
 */
export function MemberComposer({ matched, useSession, useProjection, memberOf, promptMember, stopMember, activeDelegations, t }: MemberComposerProps) {
  const [membership, setMembership] = useState<Membership>(() => membershipCache.get(matched.childSessionId))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** The last structured promptMember failure, rendered inline. */
  const [error, setError] = useState<string | null>(null)
  const sessionRunning = useSession(snapshot => snapshot.running) ?? false
  /** The polled in-flight bit for this child (second running source). */
  const [memberActive, setMemberActive] = useState(false)
  /** The child the current membership answer belongs to (re-probes on switch). */
  const membershipFor = useRef<string | null>(null)
  /** Mirror of `membership` for the probe effect (kept out of its deps: a null answer must not self-trigger). */
  const membershipRef = useRef<Membership>(undefined)
  membershipRef.current = membership
  // The member dock self-renders ambient state from the projection seat: the
  // official panels (StatsLine on 'conversation.composer.dock', TodoPanel on
  // 'conversation.input.dock') live INSIDE the fallback InputBar that
  // `overlay: true` hides on election, so no official dock row can reach a
  // member session. One bag entry per projection a contributor reads.
  const projections: MemberDockProjections = {
    tokenUsage: useProjection('tokenUsage'),
    todos: useProjection('todos'),
  }

  // Second running source: poll the family's in-flight delegation registry.
  // The official summary flag never lights up for external CLI runs (no live
  // host agent), so without this the Stop button and the running badge never
  // appear and the membership re-probe below never fires in production. An
  // RPC failure keeps the last known bit instead of flapping Stop off.
  useEffect(() => {
    let cancelled = false
    const childId = matched.childSessionId
    const tick = (): void => {
      void activeDelegations().then((ids) => {
        if (cancelled || ids === undefined) return
        setMemberActive(ids.includes(childId))
      }, () => {})
    }
    tick()
    const timer = setInterval(tick, ACTIVE_DELEGATIONS_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [activeDelegations, matched.childSessionId])
  const running = sessionRunning || memberActive

  useEffect(() => {
    const childId = matched.childSessionId
    if (membershipFor.current !== childId) {
      // A different child: seed from the positive cache (a member re-enter
      // skips the probe entirely) and reset to checking when uncached.
      membershipFor.current = childId
      const cached = membershipCache.get(childId)
      setMembership(cached)
      if (cached !== undefined) return
    } else if (membershipRef.current !== null && membershipRef.current !== undefined) {
      return // already resolved for this child
    }
    // A null answer (not yet a member) re-probes on every running flip: the
    // delegation record lands with the first round's settle (exec) or the
    // live handshake, exactly when running changes — so an open panel flips
    // from the one-shot read-only fallback to the writable member box on its
    // own, without a session re-enter. An UNDEFINED answer is an RPC failure,
    // never membership evidence: it keeps the neutral checking state and
    // retries within a bounded budget before degrading to the read-only
    // panel, so a transient failure never flashes "one-shot" at a member.
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const settle = (view: Membership): void => {
      if (cancelled) return
      if (view === undefined && attempts < MEMBER_PROBE_RETRIES) {
        attempts += 1
        timer = setTimeout(probe, MEMBER_PROBE_RETRY_MS)
        return
      }
      const resolved = view === undefined ? null : view
      if (resolved !== null) membershipCache.set(childId, resolved)
      setMembership(resolved)
    }
    const probe = (): void => {
      // A rejected RPC is the same transient failure as an undefined value.
      void memberOf(childId).then(settle, () => settle(undefined))
    }
    probe()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [memberOf, matched.childSessionId, running])

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
