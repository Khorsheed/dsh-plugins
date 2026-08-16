/** General Settings row for the shortcut actions: fixed operations with user-chosen keys. */
import { Fragment, useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_PREFERENCES } from '../../settings.ts'
import type { ShortcutAction, ShortcutPreference } from '../../settings.ts'
import { bindingOfEvent, bindingParts, equalPreference, formatBinding, isBindingKey } from '../bindings.ts'
import type { ShortcutKey } from '../locales.ts'
import css from './ShortcutsRow.module.css'

/** Registration-side preference face. */
export interface ShortcutsRowInjected {
  hooks: {
    /** Live pause preference bound as usePause. */
    pause: SnapshotStore<ShortcutPreference>
    /** Live steer-send preference bound as useSteerSend. */
    steerSend: SnapshotStore<ShortcutPreference>
    /** Action currently recording a new binding (null = none) bound as useCapturing. */
    capturing: SnapshotStore<ShortcutAction | null>
  }
  /** Replace one action's preference (`{ kind: 'none' }` unbinds). */
  setPreference: (action: ShortcutAction, preference: ShortcutPreference) => void
  /** Restore one action to its shipped default preference. */
  reset: (action: ShortcutAction) => void
  /** Enter or leave key-capture mode for one action. */
  setCapturing: (action: ShortcutAction | null) => void
}

/** Full Settings-row props. */
export type ShortcutsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'shortcuts'>
  & InjectFace<ShortcutsRowInjected>

/** The fixed actions in display order. */
const ACTIONS: readonly { action: ShortcutAction; label: ShortcutKey; desc: ShortcutKey }[] = [
  { action: 'pause', label: 'action.pause', desc: 'action.pause.desc' },
  { action: 'steerSend', label: 'action.steerSend', desc: 'action.steerSend.desc' },
]

/**
 * Render the shortcut preferences: one row per fixed action with its current
 * binding, a key-capture recorder, and a reset-to-default control.
 * @param props - composed Settings slot props.
 * @returns the preference section.
 */
export function ShortcutsRow({
  usePause, useSteerSend, useCapturing, setPreference, reset, setCapturing, t,
}: ShortcutsRowProps) {
  const pause = usePause(value => value)
  const steerSend = useSteerSend(value => value)
  const capturing = useCapturing(value => value)

  // Key capture: while one action records, every keydown completes, cancels
  // (Escape), or unbinds (Delete/Backspace). The chord is fully claimed in the
  // capture phase so the browser default (e.g. save) and the settings modal's
  // own Escape never fire, and the policy flag keeps the global wiring
  // standed down while recording. Leaving the row aborts the capture.
  useEffect(() => {
    if (capturing === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(null)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        setPreference(capturing, { kind: 'none' })
        setCapturing(null)
        return
      }
      if (!isBindingKey(event)) return
      setPreference(capturing, bindingOfEvent(event))
      setCapturing(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [capturing, setPreference, setCapturing])

  useEffect(() => () => { setCapturing(null) }, [setCapturing])

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.title')}</div>
        <div className={css.desc}>{t('settings.description')}</div>
      </div>
      <div className={css.fields}>
        {ACTIONS.map(({ action, label, desc }) => {
          const preference = action === 'pause' ? pause : steerSend
          const active = capturing === action
          // The default hint and the reset control share one condition: they
          // exist only while the binding differs from the shipped default.
          const modified = !equalPreference(preference, DEFAULT_PREFERENCES[action])
          return (
            <div key={action} className={css.field}>
              <div className={css.fieldText}>
                <div className={css.fieldLabel}>{t(label)}</div>
                <div className={css.fieldDesc}>{t(desc)}</div>
                {modified && (
                  <div className={css.defaultHint}>
                    {t('default', { binding: formatBinding(DEFAULT_PREFERENCES[action]) })}
                  </div>
                )}
              </div>
              <div className={css.side}>
                <div className={css.controls}>
                  <button
                    type="button"
                    className={active ? css.capture : preference.kind === 'none' ? css.empty : css.binding}
                    aria-pressed={active}
                    title={active ? undefined : t('binding.hint')}
                    onClick={() => { setCapturing(active ? null : action) }}
                  >
                    {active
                      ? t('capturing')
                      : preference.kind === 'none'
                        ? t('unbound')
                        : bindingParts(preference).map((part, index) => (
                          <Fragment key={part}>
                            {index > 0 && <span className={css.plus}>+</span>}
                            <span className={css.keycap}>{part}</span>
                          </Fragment>
                        ))}
                  </button>
                  {modified && (
                    <button
                      type="button"
                      className={css.reset}
                      onClick={() => { reset(action) }}
                    >
                      {t('reset')}
                    </button>
                  )}
                </div>
                {active && <div className={css.captureHint}>{t('capture.hint')}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {/* The section column strips a border on the slot's last child, so this
          block's closing hairline lives on an inner element it cannot reach. */}
      <div className={css.divider} />
    </div>
  )
}
