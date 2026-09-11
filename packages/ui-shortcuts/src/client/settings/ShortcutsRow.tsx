/** Settings card for the shortcut registry: one rebindable field per registered action. */
import { Fragment, useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings.plugin.item keyed-slot SlotMap merge, so this
// component's props type matches the plugin configuration card contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { bindingOfEvent, bindingParts, equalPreference, formatBinding, isBindingKey, mouseBindingOfEvent, partLabel } from '../bindings.ts'
import type { BindingPart } from '../bindings.ts'
import type { ShortcutPreference } from '../../settings.ts'
import type { ShortcutActionContribution } from '../contract.ts'
import { MouseGlyph } from './MouseGlyph.tsx'
import css from './ShortcutsRow.module.css'

/** Stable React key for one gesture slot (slot identities are unique per kind). */
function partKey(part: BindingPart): string {
  switch (part.kind) {
    case 'modifier': return `modifier:${part.modifier}`
    case 'key': return `key:${part.key}`
    case 'mouse': return `mouse:${part.button}`
  }
}

/** Registration-side preference face. */
export interface ShortcutsRowInjected {
  hooks: {
    /** Live registered action list (registration order) bound as useActions. */
    actions: SnapshotStore<readonly ShortcutActionContribution[]>
    /** Live preference per action id bound as usePreferences. */
    preferences: SnapshotStore<Record<string, ShortcutPreference>>
    /** Action currently recording a new binding (null = none) bound as useCapturing. */
    capturing: SnapshotStore<string | null>
  }
  /** Translate a contributing plugin's locale seat (its ns + key). */
  translate: (ns: string, key: string) => string
  /** Replace one action's preference (`{ kind: 'none' }` unbinds). */
  setPreference: (id: string, preference: ShortcutPreference) => void
  /** Restore one action to its shipped default binding. */
  reset: (id: string) => void
  /** Enter or leave gesture-capture mode for one action. */
  setCapturing: (id: string | null) => void
}

/** Full settings-card props. */
export type ShortcutsRowProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'shortcuts'>
  & InjectFace<ShortcutsRowInjected>

/**
 * Render the shortcut preferences: one row per registered action with its
 * current binding, a gesture recorder, and a reset-to-default control.
 * @param props - composed Settings slot props.
 * @returns the preference section.
 */
export function ShortcutsRow({
  useActions, usePreferences, useCapturing, translate, setPreference, reset, setCapturing, t,
}: ShortcutsRowProps) {
  const actions = useActions(value => value)
  const preferences = usePreferences(value => value)
  const capturing = useCapturing(value => value)

  // The one slot the dictionaries own: modifier and key legends are keycap
  // legends and read the same in every language, while a mouse button is prose
  // — and it renders as the device diagram plus its word.
  const visibleLabel = (part: BindingPart): string => part.kind === 'mouse'
    ? t(part.button === 1 ? 'gesture.middle' : 'gesture.right')
    : partLabel(part)

  // Gesture capture: while one action records, the next keydown or bindable
  // mousedown completes the binding; Escape cancels and Delete/Backspace
  // unbinds. The event is fully claimed in the capture phase so the browser
  // default (save, open-file) and the settings modal's own Escape never fire,
  // and the policy flag keeps the global wiring standed down while recording —
  // the global listeners are registered before this one, so they see the
  // capture flag on the very event that completes a binding. The primary
  // mouse button is deliberately not bindable and is left alone: it is how the
  // recorder itself is operated. Leaving the row aborts the capture.
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
    const onMouseDown = (event: MouseEvent): void => {
      const binding = mouseBindingOfEvent(event)
      if (binding === null) return
      event.preventDefault() // autoscroll / primary-selection paste must not start
      event.stopPropagation()
      setPreference(capturing, binding)
      setCapturing(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [capturing, setPreference, setCapturing])

  useEffect(() => () => { setCapturing(null) }, [setCapturing])

  return (
    <div className={css.row}>
      <div className={css.fields}>
        {actions.map((action) => {
          const preference = preferences[action.id] ?? action.defaultBinding
          const active = capturing === action.id
          // The default hint and the reset control share one condition: they
          // exist only while the binding differs from the shipped default.
          const modified = !equalPreference(preference, action.defaultBinding)
          return (
            <div key={action.id} className={css.field}>
              <div className={css.fieldText}>
                <div className={css.fieldLabel}>{translate(action.label.ns, action.label.key)}</div>
                <div className={css.fieldDesc}>{translate(action.description.ns, action.description.key)}</div>
                {modified && (
                  <div className={css.defaultHint}>
                    {t('default', { binding: formatBinding(action.defaultBinding, visibleLabel) })}
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
                    onClick={() => { setCapturing(active ? null : action.id) }}
                  >
                    {active
                      ? t('capturing')
                      : preference.kind === 'none'
                        ? t('unbound')
                        : bindingParts(preference).map((part, index) => (
                          <Fragment key={partKey(part)}>
                            {index > 0 && <span className={css.plus}>+</span>}
                            <span className={css.keycap}>
                              {part.kind === 'mouse' && <MouseGlyph button={part.button} />}
                              {visibleLabel(part)}
                            </span>
                          </Fragment>
                        ))}
                  </button>
                  {modified && (
                    <button
                      type="button"
                      className={css.reset}
                      onClick={() => { reset(action.id) }}
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
    </div>
  )
}
