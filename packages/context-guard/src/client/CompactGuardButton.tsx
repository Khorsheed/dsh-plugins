import { useEffect, useMemo, useRef, useState } from 'react'
import { IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls ui-conversation's SlotMap merge (the input.right seat and
// its InputZone owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `contextPressure` SessionProjectionMap merge for
// useProjection.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { guardReading } from './guard.ts'
import type { CompactGuardButtonProps } from './slots.ts'
import css from './CompactGuardButton.module.css'

export type { CompactGuardButtonProps } from './slots.ts'

/**
 * Composer-tool-row compact button. Renders nothing until the next request's
 * budget (projected context + output budget) crosses the threshold; then it
 * appears automatically — amber while a compaction can still run, red once
 * the budget already exceeds the window. The threshold and budget come from
 * the shared `context-guard` settings section (live), falling back to the
 * composition-time values while the settings surface is absent. Clicking
 * executes the official `/compact` command through the injected face.
 */
export function CompactGuardButton({
  useProjection,
  useConfig,
  t,
  thresholdRatio,
  maxTokens,
  compactNow,
}: CompactGuardButtonProps) {
  const pressure = useProjection('contextPressure')
  const config = useConfig(value => value)
  const effective = config.status === 'ready' && config.value !== undefined
    ? config.value
    : { thresholdRatio, maxTokens }
  const reading = useMemo(() => guardReading({
    projectedTokens: pressure?.projectedTokens ?? pressure?.pressureTokens ?? Number.NaN,
    contextWindow: pressure?.contextWindow,
    maxTokens: effective.maxTokens,
    thresholdRatio: effective.thresholdRatio,
  }), [pressure, effective.maxTokens, effective.thresholdRatio])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (reading === null || reading.level === 'ok') return null

  const overdue = reading.level === 'overdue'
  const run = (): void => {
    setBusy(true)
    setError(null)
    void compactNow().then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={overdue ? `${css.button} ${css.overdue}` : `${css.button} ${css.warning}`}
        aria-label={overdue
          ? t('button.overdue.aria', { percent: String(reading.percent) })
          : t('button.warning.aria', { percent: String(reading.percent) })}
        title={overdue
          ? t('button.overdue.title', { percent: String(reading.percent) })
          : t('button.warning.title', {
            percent: String(reading.percent),
            maxTokens: String(effective.maxTokens),
          })}
        disabled={busy}
        onClick={run}
      >
        <span className={css.icon} aria-hidden>
          <IconWarningOutline16 size={14} />
        </span>
        {t('button.label')}
      </button>
      {/* Failure copy stays English (error-surface policy: not localized). */}
      {error !== null && (
        <span className={css.error} role="status" title={error}>
          {t('button.error')}
        </span>
      )}
    </span>
  )
}
