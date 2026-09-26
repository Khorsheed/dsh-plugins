import { useEffect, useMemo, useRef, useState } from 'react'
import { IconWarningOutlineMedium } from './icons.tsx'
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
 * Composer-tool-row compact button. Renders nothing until the context
 * occupancy (`projectedTokens / contextWindow` — the same number the
 * composer's context ring shows) crosses the threshold; then it appears
 * automatically in the amber warning tint. The threshold comes from the
 * shared `context-guard` settings section (live), falling back to the
 * composition-time value while the settings surface is absent. Clicking
 * executes the official `/compact` command through the injected face.
 */
export function CompactGuardButton({
  useProjection,
  useConfig,
  t,
  thresholdRatio,
  compactNow,
}: CompactGuardButtonProps) {
  const pressure = useProjection('contextPressure')
  const config = useConfig(value => value)
  const effective = config.status === 'ready' && config.value !== undefined
    ? config.value
    : { thresholdRatio }
  const reading = useMemo(() => guardReading({
    projectedTokens: pressure?.projectedTokens ?? pressure?.pressureTokens ?? Number.NaN,
    contextWindow: pressure?.contextWindow,
    thresholdRatio: effective.thresholdRatio,
  }), [pressure, effective.thresholdRatio])
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
        className={`${css.button} ${css.warning}`}
        aria-label={t('button.aria', { percent: String(reading.percent) })}
        disabled={busy}
        onClick={run}
      >
        <span className={css.icon} aria-hidden>
          <IconWarningOutlineMedium size={14} />
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
