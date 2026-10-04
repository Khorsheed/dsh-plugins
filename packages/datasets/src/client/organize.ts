/**
 * T90 · the 「让 Agent 整理」 requests: what the 添加题集 dialog, a
 * registration's 「交给 Agent 修改」 and the review's 「退回给 Agent」 write into
 * a 「题集整理」 session's chat box — NEVER sent; the person reads it and sends.
 *
 * Pure text builders (the host doors that open the session and write the
 * draft live in `index.ts`), so the wording is testable without a host. Each
 * request names the dataset-authoring skill explicitly: the 题集整理 preset
 * grants it, but a session on the default preset still finds it by name when
 * the skill is mounted.
 */
import type { DatasetsViewProps } from './contract.ts'

type T = DatasetsViewProps['t']

/** What the 添加题集 dialog asks for. */
export interface AddDatasetFields {
  /** 数据在哪: a path, a file, or a public dataset's name / link. */
  source: string
  /** 题集名称: the registration name the agent proposes with. */
  name: string
  /** 想拿它测什么 (optional). */
  purpose: string
  /**
   * The parent directory the person picked for the new repository (T95);
   * absent or '' = the datasets home. The repository is `<parent>/<name>`,
   * the same rule as the default.
   */
  repoParent?: string
}

/** The registration-name rule (the registry's own: letters, digits, `._-`, a letter or digit first). */
export const NAME_RULE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Whether a typed name can be a registration name.
 * @param name - the typed name (trimmed by the caller).
 * @returns true when the registry would take it.
 */
export function checkDatasetName(name: string): boolean {
  return NAME_RULE.test(name)
}

/**
 * Where a new repository goes by default (decision C): `<datasets home>/<name>`.
 * @param home - the host's datasets home ('' when unknown).
 * @param name - the dataset name.
 * @returns the path, or '' when the home is unknown.
 */
export function repoPathFor(home: string, name: string): string {
  if (home === '' || name === '') return ''
  return `${home.replace(/\/+$/, '')}/${name}`
}

/**
 * A directory as a picker returned it, ready to show and to join: trimmed,
 * trailing separators dropped (the macOS chooser answers `/a/b/`), the root
 * kept as `/`.
 * @param path - the picked path.
 * @returns the cleaned path ('' stays '').
 */
export function cleanPickedPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') return ''
  const stripped = trimmed.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

/**
 * A path cut for a middle ellipsis (T96): the head may shrink to `…`, the
 * tail — the last `keep` segments, where the dataset's own name sits — always
 * shows. Joined back, the two halves are the path unchanged.
 * @param path - the full path.
 * @param keep - how many trailing segments stay whole.
 * @returns `[head, tail]`; the head is '' when the path is that short.
 */
export function splitPathTail(path: string, keep = 2): [string, string] {
  const marks: number[] = []
  for (let i = 0; i < path.length; i += 1) {
    if ((path[i] === '/' || path[i] === '\\') && i < path.length - 1) marks.push(i)
  }
  if (marks.length < keep) return ['', path]
  const cut = marks[marks.length - keep]! + 1
  return cut <= 1 ? ['', path] : [path.slice(0, cut), path.slice(cut)]
}

/**
 * Where the new repository's parent is: the person's pick when there is one,
 * the datasets home otherwise.
 * @param home - the datasets home ('' when unknown).
 * @param picked - the picked parent, if any.
 * @returns the parent directory ('' when neither is known).
 */
export function repoParentOf(home: string, picked?: string | null): string {
  const chosen = cleanPickedPath(picked ?? '')
  return chosen !== '' ? chosen : home
}

/**
 * The 添加题集 request.
 * @param fields - the dialog's three fields, plus the picked repository parent.
 * @param home - the datasets home (decision C), '' when unknown; the
 *   picked parent wins over it.
 * @param t - the tab's dictionary.
 * @returns the composer text.
 */
export function buildAddRequest(fields: AddDatasetFields, home: string, t: T): string {
  const lines = [
    t('organize.request'),
    '',
    `- ${t('organize.lineSource', { value: fields.source.trim() })}`,
    `- ${t('organize.lineName', { value: fields.name.trim() })}`,
  ]
  if (fields.purpose.trim() !== '') lines.push(`- ${t('organize.linePurpose', { value: fields.purpose.trim() })}`)
  const repo = repoPathFor(repoParentOf(home, fields.repoParent), fields.name.trim())
  if (repo !== '') lines.push(`- ${t('organize.lineRepo', { value: repo })}`)
  return lines.join('\n')
}

/**
 * The 「交给 Agent 修改」 request for a registered dataset; the person writes
 * what to change after the last line.
 * @param target - the registration.
 * @param target.name - its registration name.
 * @param target.checkout - its authoring checkout, or null.
 * @param target.ref - its tracked branch.
 * @param t - the tab's dictionary.
 * @returns the composer text.
 */
export function buildUpdateRequest(target: { name: string; checkout: string | null; ref: string }, t: T): string {
  const lines = [t('organize.updateRequest', { name: target.name }), '']
  if (target.checkout !== null) lines.push(`- ${t('organize.lineCheckout', { value: target.checkout })}`)
  lines.push(`- ${t('organize.lineRef', { value: target.ref })}`, '', t('organize.lineWant'), '')
  return lines.join('\n')
}

/**
 * The 「退回给 Agent」 request: the person's note under one framing line.
 * @param name - the proposal's registration name.
 * @param note - what the person wrote.
 * @param t - the tab's dictionary.
 * @returns the composer text.
 */
export function buildReturnRequest(name: string, note: string, t: T): string {
  return `${t('organize.returnRequest', { name })}\n\n${note.trim()}`
}

/** Where a request ended up — the notice the tab shows. */
export type OrganizeOutcome =
  | { kind: 'drafted'; sessionId: string }
  | { kind: 'copied'; sessionId?: string }
  | { kind: 'manual'; text: string; sessionId?: string }
  | { kind: 'failed'; message: string }

/** Retry offsets (ms) for writing a draft into a session that is still opening. */
export const DRAFT_RETRIES_MS = [0, 120, 300, 700, 1500, 3000] as const

/**
 * Write a draft into a session that may still be mounting: try at each retry
 * offset until `insert` answers true.
 * @param insert - one attempt; true when the text landed.
 * @param wait - the timer (injectable for tests).
 * @returns whether any attempt landed.
 */
export async function draftWithRetries(
  insert: () => boolean,
  wait: (ms: number) => Promise<void> = ms => new Promise((resolve) => { setTimeout(resolve, ms) }),
): Promise<boolean> {
  let at = 0
  for (const offset of DRAFT_RETRIES_MS) {
    if (offset > at) await wait(offset - at)
    at = offset
    let ok = false
    try { ok = insert() } catch { ok = false }
    if (ok) return true
  }
  return false
}
