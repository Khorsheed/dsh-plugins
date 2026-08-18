import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContextGuardConfig } from './config.ts'
import type { ContextGuardSettingsCardProps } from './slots.ts'
import css from './SettingsCard.module.css'

/** One number field's staged draft, its validity, and the reset/save actions. */
interface FieldDraft {
  text: string
  invalid: boolean
}

/** Parse a draft into a number, or NaN when it is not one. */
function parseNumber(text: string): number {
  const value = Number(text.trim())
  return Number.isFinite(value) ? value : Number.NaN
}

/** Whether the user layer carries a field (presence marks an override). */
function overridden(snapshot: SettingsScopeSnapshot<ContextGuardConfig>, field: keyof ContextGuardConfig): boolean {
  return snapshot.user !== undefined
    && typeof snapshot.user === 'object'
    && snapshot.user !== null
    && field in snapshot.user
}

/**
 * The context-guard settings card in the plugin configuration tab: the same
 * collapsible chrome the official plugin cards use (a header naming the
 * plugin and what its settings govern, disclosing the controls in place),
 * re-implemented here because the client bundle-purity gate forbids
 * value-importing the official card chrome. Two staged number fields write
 * through the shared settingsScope on save; per-field reset reverts a field
 * to the composition layer.
 */
export function ContextGuardSettingsCard({ useConfig, scope, t }: ContextGuardSettingsCardProps) {
  const snapshot = useConfig(value => value)
  const value = snapshot.status === 'ready' ? snapshot.value : undefined
  const [open, setOpen] = useState(false)
  const [threshold, setThreshold] = useState<FieldDraft>({ text: '', invalid: false })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const aliveRef = useRef(true)
  /** The section revision the drafts were last seeded from; re-seed only on a committed change. */
  const seededRevision = useRef<number | null>(null)

  // Re-seed the drafts whenever the section VALUE changes (first load, a save
  // settling, an external reset). Keyed on the snapshot revision rather than
  // the value's object identity: a save settling publishes a new snapshot
  // (revision bump), while an unrelated re-render must not discard a draft in
  // flight — the staged model promises the screen shows exactly what a save
  // would store.
  useEffect(() => {
    aliveRef.current = true
    if (value === undefined) return
    if (seededRevision.current === snapshot.revision) return
    seededRevision.current = snapshot.revision ?? null
    setThreshold({ text: String(value.thresholdRatio), invalid: false })
    setSaved(false)
    setError(false)
    return () => {
      aliveRef.current = false
    }
  }, [value, snapshot.revision])

  if (snapshot.status === 'unavailable') return null

  const write = (draft: FieldDraft, min: number, max: number): void => {
    const parsed = parseNumber(draft.text)
    setThreshold({ text: draft.text, invalid: !Number.isFinite(parsed) || parsed < min || parsed > max })
  }

  const save = (): void => {
    if (threshold.invalid || snapshot.writable !== true) return
    const ratio = parseNumber(threshold.text)
    if (!Number.isFinite(ratio)) return
    setError(false)
    setSaved(false)
    void scope.set('thresholdRatio', ratio).then(() => {
      if (!aliveRef.current) return
      setSaved(true)
    }, () => {
      if (!aliveRef.current) return
      setError(true)
    })
  }

  const reset = (): void => {
    setError(false)
    setSaved(false)
    void scope.unset('thresholdRatio').catch(() => {
      if (aliveRef.current) setError(true)
    })
  }

  const title = t('settings.title')
  const dirty = threshold.text !== String(value?.thresholdRatio ?? '')

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && value !== undefined && (
        <div className={css.body}>
          <label className={css.field}>
            <span className={css.fieldHead}>
              <span className={css.fieldName}>{t('settings.field.threshold')}</span>
              {overridden(snapshot, 'thresholdRatio') && <span className={css.badge}>{t('settings.overridden')}</span>}
            </span>
            <span className={css.inputRow}>
              <input
                className={threshold.invalid ? `${css.input} ${css.inputInvalid}` : css.input}
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={threshold.text}
                aria-label={t('settings.field.threshold')}
                onChange={(event) => { write({ text: event.target.value, invalid: false }, 0.01, 1) }}
              />
              <button type="button" className={css.reset} onClick={reset}>
                {t('settings.reset')}
              </button>
            </span>
            <span className={css.hint}>{t('settings.field.threshold.hint')}</span>
          </label>
          <span className={css.footer}>
            <span className={css.status}>
              {saved ? <span className={css.saved}>{t('settings.saved')}</span> : null}
              {error ? <span className={css.errorText}>{t('settings.error')}</span> : null}
            </span>
            <button
              type="button"
              className={css.secondary}
              disabled={!dirty}
              onClick={() => {
                if (value === undefined) return
                setThreshold({ text: String(value.thresholdRatio), invalid: false })
                setSaved(false)
                setError(false)
              }}
            >
              {t('settings.discard')}
            </button>
            <button
              type="button"
              className={css.save}
              disabled={!dirty || threshold.invalid || snapshot.writable !== true}
              onClick={save}
            >
              {t('settings.save')}
            </button>
          </span>
        </div>
      )}
    </li>
  )
}
