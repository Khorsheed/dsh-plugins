/**
 * The edit dialog's 模式工具 line as a pure state: local-agent's member-tools
 * status (what the member's CURRENT process holds of its mode tools) plus
 * what this dialog knows (the member is running, the human just asked for a
 * reload) → one of the line's states. Kept apart from the component so every
 * state is testable without rendering.
 */
import type { LocalAgentMemberToolsStatus } from '@khorsheed/dsh-local-agent/types'

/** What the line shows. */
export type MemberToolsLineState =
  | { readonly kind: 'hidden' }
  /** Every mode tool reached the process. `note`: a reload just finished, or one ran at round start. */
  | { readonly kind: 'ok'; readonly names: readonly string[]; readonly loadedAt?: number; readonly note?: { readonly kind: 'reloaded' } | { readonly kind: 'auto'; readonly at: number } }
  /**
   * The process lacks some (or all) of them: `cause` says why, `afterReload`
   * that a reload already ran and did not help.
   */
  | {
    readonly kind: 'missing'
    readonly received: readonly string[]
    readonly missing: readonly string[]
    readonly total: number
    readonly at?: number
    readonly cause: 'failed' | 'empty' | 'partial'
    readonly afterReload: boolean
  }
  /** A reload is replacing the process now. */
  | { readonly kind: 'reloading'; readonly total: number }
  /** A reload waits for the running round to end. */
  | { readonly kind: 'scheduled'; readonly received: number; readonly total: number }
  /**
   * Nothing known about the current process: it never reported (`old`: it
   * started before reports existed), a reload's new process has not listed
   * yet (`next-message`), or there is no process (`no-process`).
   */
  | { readonly kind: 'unknown'; readonly total: number; readonly hint: 'old' | 'next-message' | 'no-process' }

/**
 * Fold the status into the line's state.
 * @param status - local-agent's read; null/undefined = no mode or no family (no line).
 * @param clickedAt - when this dialog asked for a reload (its result is shown as 刚刚重新载入完成).
 * @returns the state.
 */
export function memberToolsLine(status: LocalAgentMemberToolsStatus | null | undefined, clickedAt?: number): MemberToolsLineState {
  if (status === null || status === undefined) return { kind: 'hidden' }
  const total = status.expected.length
  if (status.reload?.state === 'scheduled') return { kind: 'scheduled', received: status.process === 'full' ? status.received.length : 0, total }
  if (status.reload?.state === 'reloading') return { kind: 'reloading', total }
  const afterReload = status.lastReload?.outcome === 'missing'
  if (status.process === 'placeholder' || status.process === 'empty') {
    return {
      kind: 'missing',
      received: [],
      missing: status.expected,
      total,
      ...status.loadedAt === undefined ? {} : { at: status.loadedAt },
      cause: status.process === 'placeholder' ? 'failed' : 'empty',
      afterReload,
    }
  }
  if (status.process === 'full') {
    const have = new Set(status.received)
    const missing = status.expected.filter(name => !have.has(name))
    if (missing.length > 0) {
      return {
        kind: 'missing',
        received: status.received.filter(name => status.expected.includes(name)),
        missing,
        total,
        ...status.loadedAt === undefined ? {} : { at: status.loadedAt },
        cause: 'partial',
        afterReload,
      }
    }
    const last = status.lastReload
    const reloaded = clickedAt !== undefined && last?.by === 'manual' && last.outcome === 'loaded' && last.at >= clickedAt
    return {
      kind: 'ok',
      names: status.received,
      ...status.loadedAt === undefined ? {} : { loadedAt: status.loadedAt },
      ...reloaded
        ? { note: { kind: 'reloaded' as const } }
        : status.autoReloadAt === undefined ? {} : { note: { kind: 'auto' as const, at: status.autoReloadAt } },
    }
  }
  if (status.process === 'unreported') {
    return { kind: 'unknown', total, hint: status.lastReload?.outcome === 'pending' ? 'next-message' : 'old' }
  }
  return { kind: 'unknown', total, hint: 'no-process' }
}

/**
 * A mode's short name for the line ("游戏开发模式" → "游戏开发", "Game dev
 * mode" → "Game dev"): the dialog's meta row already says it is a mode.
 * @param name - the mode's display name.
 * @returns the name without its trailing 模式 / mode.
 */
export function modeShortName(name: string): string {
  const short = name.replace(/\s*(模式|mode)$/i, '').trim()
  return short === '' ? name : short
}

/** Local HH:MM of an epoch-ms time. */
export function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
