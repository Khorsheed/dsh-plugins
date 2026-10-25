/**
 * The room composer's @ menu, data side: two groups — this room's members,
 * then other sessions (the host's session-reference candidates, the same
 * list its own @ menu shows). With nothing typed the second group lists the
 * five most recent; typing filters both groups by a fuzzy match where the
 * typed characters only have to appear in order (「剪插」 finds 「开发剪辑插件」),
 * ranked exact > prefix > contiguous > in-order, then by recency.
 *
 * Pure and DOM-free — unit-tested on its own.
 * @module @khorsheed/dsh-room/client/at-menu
 */

/** One session candidate, as the host's session-reference resolver lists it. */
export interface SessionCandidate {
  readonly sessionId: string
  /** The latest title (the session id when untitled). */
  readonly label: string
  readonly displayTitle?: string
  /** The canonical `@[label](dsh-session:…)` mention the host inserts. */
  readonly mention: string
  readonly sameWorkspace?: boolean
  readonly createdAt?: number
  /** The session is a room (asking a room goes through its own roster). */
  readonly room?: boolean
  /** A room's members (askable by name). */
  readonly members?: readonly RoomMenuMember[]
}

/** A member of another room, as the @ menu lists it. */
export interface RoomMenuMember {
  readonly name: string
  readonly kind: string
  readonly provider?: string
}

/** One row of the other-sessions group: a session (or room), or a member of a room. */
export type OtherRow =
  | { readonly kind: 'session'; readonly candidate: SessionCandidate }
  | { readonly kind: 'roomMember'; readonly candidate: SessionCandidate; readonly member: RoomMenuMember }

/** How many other sessions show before anything is typed. */
export const RECENT_SESSIONS = 5

/** How many other sessions a typed query shows at most. */
export const MATCHED_SESSIONS = 8

/**
 * How well a query matches a text: 0 exact, 1 prefix, 2 contiguous, 3 the
 * characters in order; undefined for no match. Case-insensitive; an empty
 * query matches everything at tier 0.
 * @param query - what the human typed after `@`.
 * @param text - a member name or session title.
 * @returns the tier, or undefined.
 */
export function matchTier(query: string, text: string): number | undefined {
  const needle = query.toLocaleLowerCase()
  const haystack = text.toLocaleLowerCase()
  if (needle === '' || haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1
  if (haystack.includes(needle)) return 2
  let at = 0
  for (const char of haystack) {
    if (char === needle[at]) at += 1
    if (at === needle.length) return 3
  }
  return undefined
}

/**
 * Filter and rank by match tier, keeping the incoming order (recency) within a tier.
 * @param query - what the human typed after `@`.
 * @param items - the candidates, most relevant first.
 * @param text - the text an item is matched on.
 * @returns the matching items, best first.
 */
export function rankByMatch<T>(query: string, items: readonly T[], text: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, tier: matchTier(query, text(item)) }))
    .filter((entry): entry is { item: T; index: number; tier: number } => entry.tier !== undefined)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(entry => entry.item)
}

/** A session candidate's shown title. */
export function sessionTitle(candidate: SessionCandidate): string {
  return candidate.displayTitle ?? candidate.label
}

/**
 * The other-sessions group: the candidates minus this room and its members'
 * own sessions, deduplicated, then the recent five (nothing typed) or the
 * best matches.
 * @param query - what the human typed after `@`.
 * @param candidates - the resolver's candidates, most relevant first (several lookups may be merged).
 * @param exclude - session ids never offered (the room, its members' sessions).
 * @returns the group's rows.
 */
export function sessionRows(query: string, candidates: readonly SessionCandidate[], exclude: ReadonlySet<string>): SessionCandidate[] {
  const pool = uniqueCandidates(candidates, exclude)
  if (query === '') return pool.slice(0, RECENT_SESSIONS)
  return rankByMatch(query, pool, sessionTitle).slice(0, MATCHED_SESSIONS)
}

/** The candidates minus the excluded, first occurrence kept. */
function uniqueCandidates(candidates: readonly SessionCandidate[], exclude: ReadonlySet<string>): SessionCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (exclude.has(candidate.sessionId) || seen.has(candidate.sessionId)) return false
    seen.add(candidate.sessionId)
    return true
  })
}

/**
 * The other-sessions group with rooms. Nothing typed: the recent five, each
 * expanded room followed by its members. Typed: sessions and every room's
 * members match together (a member by its own name), best first.
 * @param query - what the human typed after `@`.
 * @param candidates - the resolver's candidates, most relevant first.
 * @param exclude - session ids never offered.
 * @param expanded - the rooms whose members show.
 * @returns the group's rows.
 */
export function otherRows(query: string, candidates: readonly SessionCandidate[], exclude: ReadonlySet<string>, expanded: ReadonlySet<string>): OtherRow[] {
  if (query === '') {
    return sessionRows('', candidates, exclude).flatMap(candidate => [
      { kind: 'session' as const, candidate },
      ...expanded.has(candidate.sessionId) ? (candidate.members ?? []).map(member => ({ kind: 'roomMember' as const, candidate, member })) : [],
    ])
  }
  const pool: OtherRow[] = uniqueCandidates(candidates, exclude).flatMap(candidate => [
    { kind: 'session' as const, candidate },
    ...(candidate.members ?? []).map(member => ({ kind: 'roomMember' as const, candidate, member })),
  ])
  return rankByMatch(query, pool, row => row.kind === 'session' ? sessionTitle(row.candidate) : row.member.name).slice(0, MATCHED_SESSIONS)
}

/**
 * The mention for a member of a room: the room's own `dsh-session:` URI under
 * a 「成员（房间）」 label (the label `room_help` reads the member from).
 * @param candidate - the room.
 * @param member - its member.
 * @returns the mention text and its label.
 */
export function memberMention(candidate: SessionCandidate, member: RoomMenuMember): { readonly mention: string; readonly label: string } {
  const uri = /\]\((dsh-session:[^)\s]*)\)\s*$/u.exec(candidate.mention)?.[1] ?? ''
  const label = `${member.name}（${sessionTitle(candidate)}）`
  return { mention: `@[${label.replace(/[\\\]]/gu, '\\$&')}](${uri})`, label }
}

/**
 * A free-text offset in the composer's textarea as a detect-coordinate
 * offset in the input machine's draft: each chip before it folds to one
 * placeholder (see draft-chips.ts), so the offset moves right by the number
 * of chips whose segments end before it.
 * @param segments - the typed text around the chips (draftSegments).
 * @param freeIndex - the offset in the textarea's text.
 * @returns the detect offset.
 */
export function detectOffset(segments: readonly string[], freeIndex: number): number {
  let remaining = freeIndex
  for (let k = 0; k < segments.length; k += 1) {
    const length = segments[k]!.length
    if (remaining <= length || k === segments.length - 1) return freeIndex + k
    remaining -= length
  }
  return freeIndex
}

/**
 * A row's time hint: HH:MM today, else M/D.
 * @param at - epoch ms.
 * @param now - epoch ms of "now".
 * @returns the hint.
 */
export function shortTime(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}
