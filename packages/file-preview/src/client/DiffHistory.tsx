/** Change-history view: steps through every recorded write/edit diff of one
 * file — the surface the official document tab has no counterpart for, and the
 * reason this package keeps a self-drawn body at all. */

import { useState, type ReactNode } from 'react'
import { DiffBlock, type DiffBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FilePreviewEntry } from '../types.ts'
import type {} from './locales.ts'
import css from './FilePreviewTab.module.css'

/** Localized DiffBlock chrome from the filePreview dictionary. */
function diffBlockChrome(t: TranslateNS<'filePreview'>): { labels: DiffBlockLabels } {
  const labels: DiffBlockLabels = {
    copy: t('diff.copy'),
    copied: t('diff.copied'),
    collapse: t('diff.collapse'),
    collapseAria: t('diff.collapseAria'),
    expand: (count: number) => t('diff.expand', { count }),
    expandAria: (count: number) => t('diff.expandAria', { count }),
    codeLabel: t('diff.code'),
    wrapLabel: t('diff.wrap'),
    unwrapLabel: t('diff.unwrap'),
  }
  // 0.1.5's DiffBlock draws a `files` footer and looks the formatter up on
  // the labels; rc.1 dropped the label from the type (and the footer with
  // it). Attach it outside the literal so rc.1's excess-property check stays
  // green while the legacy runtime still finds its formatter.
  ;(labels as { files?: (count: number) => string }).files = (count: number) => t('diff.files', { count })
  return { labels }
}

/**
 * One file's change history: the recorded write/edit diffs with a stepper. The
 * step index counts from the LATEST change (0 = most recent, the default
 * position), matching "修改记录 2/2 · 最新" reading where ‹ walks older and ›
 * walks newer. Keyed by the selection at the render site, so the position
 * resets per file. The pane's diff face owns the inset and the scrollport
 * (the kernel's .diffScroll), so this view draws no surface of its own.
 * @param props - the list entry carrying the diffs, and the locale seat.
 */
export function DiffHistory(props: { entry: FilePreviewEntry; t: TranslateNS<'filePreview'> }): ReactNode {
  const { entry, t } = props
  const diffs = entry.diffs
  // Index over `entry.diffs` (event order); 0 = the latest change, the default.
  const [diffIndex, setDiffIndex] = useState(0)
  const current = diffs[diffs.length - 1 - diffIndex]
  if (current === undefined) return null
  const stepDiff = (delta: number): void => {
    setDiffIndex((index) => {
      const next = index + delta
      // The stepper buttons are disabled at both bounds, so a delta can never
      // leave the range; the clamps keep the index honest for direct callers.
      /* v8 ignore next -- bounds are disabled at the UI; direct callers stay in range */
      if (next < 0) return 0
      /* v8 ignore next -- bounds are disabled at the UI; direct callers stay in range */
      if (next >= diffs.length) return diffs.length - 1
      return next
    })
  }
  return (
    <div>
      <div className={css.stepper}>
        <button
          type="button"
          className={css.stepButton}
          onClick={() => { stepDiff(1) }}
          disabled={diffIndex >= diffs.length - 1}
          aria-label={t('history.step.older')}
        >
          ‹
        </button>
        <span className={css.stepLabel}>
          {t('history.step.count', { current: diffs.length - diffIndex, total: diffs.length })}
          {diffIndex === 0 ? ` · ${t('history.step.latest')}` : ''}
          {' · '}{t('history.step', { turn: current.turn, step: current.step })}
        </span>
        <button
          type="button"
          className={css.stepButton}
          onClick={() => { stepDiff(-1) }}
          disabled={diffIndex <= 0}
          aria-label={t('history.step.newer')}
        >
          ›
        </button>
      </div>
      <DiffBlock className={css.diffWrap} diffs={[{ path: entry.path, oldText: current.oldText, newText: current.newText }]} {...diffBlockChrome(t)} />
    </div>
  )
}
