/**
 * The one in-place confirmation before an operation replaces a CLI member's
 * process while it runs background work (member-self-started-rounds C①):
 * saving a model or effort change, 重新载入 / 立即载入. 「⚠ 会让 N 项后台工作
 * 失去联系，继续吗？」 with 取消 / 继续. The core owns it because the core owns
 * the member process and its background-task read: the member page's own
 * controls render it directly, a room's surfaces through
 * `LocalAgentUi.renderBackgroundConfirm`.
 * @module @khorsheed/dsh-local-agent/client — background confirm
 */

import { useEffect, useRef, type ReactNode } from 'react'
import type { LocalAgentBackgroundTasks } from '../types.ts'
import type { LocalAgentKey } from './locales.ts'
import css from './BackgroundConfirm.module.css'

/** What a surface hands the confirmation. */
export interface BackgroundConfirmInput {
  /** Background tasks the operation would cut off (positive). */
  readonly count: number
  readonly onConfirm: () => void
  readonly onCancel: () => void
  readonly disabled?: boolean | undefined
}

export type BackgroundConfirmTranslate = (key: LocalAgentKey, params?: Record<string, string>) => string

/** The confirmation row. On mount it scrolls into view and focuses 继续 (it often appears at the bottom of a scrolled panel). */
export function BackgroundConfirm({ count, onConfirm, onCancel, disabled = false, t }: BackgroundConfirmInput & { readonly t: BackgroundConfirmTranslate }): ReactNode {
  const go = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    go.current?.scrollIntoView?.({ block: 'center' })
    go.current?.focus({ preventScroll: true })
  }, [])
  const text = t('member.background.confirm', { count: String(count) })
  return (
    <div className={css.confirm} role="alertdialog" aria-label={text} data-testid="background-confirm">
      <span className={css.text}><span aria-hidden>⚠ </span>{text}</span>
      <span className={css.actions}>
        <button type="button" className={css.cancel} disabled={disabled} onClick={onCancel}>{t('member.background.cancel')}</button>
        <button type="button" ref={go} className={css.go} disabled={disabled} onClick={onConfirm}>{t('member.background.go')}</button>
      </span>
    </div>
  )
}

/**
 * How many background tasks a member's live process runs right now: only
 * `running` tasks, only while the process is up (no process, nothing to cut
 * off). 0 for an unsupported harness, an unreadable answer, or none.
 * @param read - the `memberBackgroundTasks` answer.
 */
export function runningBackgroundTasks(read: LocalAgentBackgroundTasks | null | undefined): number {
  if (read === null || read === undefined || !read.supported || !read.processAlive) return 0
  return read.tasks.filter(task => task.state === 'running').length
}
