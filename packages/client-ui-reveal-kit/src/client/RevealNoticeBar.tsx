/**
 * The notice a held-back jump leaves at the top of a panel: what landed, a
 * button to go there, and one to let it be. Subscribes to its controller.
 * @module @khorsheed/dsh-client-ui-reveal-kit
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { RevealController } from './reveal.ts'
import css from './RevealNoticeBar.module.css'

/** Props of {@link RevealNoticeBar}. */
export interface RevealNoticeBarProps<T> {
  readonly controller: RevealController<T>
  /** The go button's words (「去看看」). */
  readonly goLabel: string
  /** The dismiss button's words (「不用了」). */
  readonly dismissLabel: string
  readonly className?: string | undefined
}

/** The notice bar; renders nothing without a notice. */
export function RevealNoticeBar<T>({ controller, goLabel, dismissLabel, className }: RevealNoticeBarProps<T>): ReactNode {
  const [, rerender] = useState(0)
  useEffect(() => controller.subscribe(() => { rerender(n => n + 1) }), [controller])
  const notice = controller.notice
  if (notice === null) return null
  return <div className={className ? `${css.bar} ${className}` : css.bar} role="status">
    <span className={css.text}>{notice.text}</span>
    <button type="button" className={css.go} onClick={() => { controller.follow() }}>{goLabel}</button>
    <button type="button" className={css.dismiss} onClick={() => { controller.dismiss() }}>{dismissLabel}</button>
  </div>
}
