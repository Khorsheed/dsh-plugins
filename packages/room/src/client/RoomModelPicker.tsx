/**
 * The room composer's main-agent model picker: our own trigger over the
 * official per-session ModelDirectory (ui-model-selection's public
 * `ctx.modelDirectories` service), because the official model seat
 * (`conversation.input.model`) rides the hidden InputBar fallback and slots
 * are single-owner — no cross-plugin API re-hosts it. The room's bare-message
 * path IS the session's root agent, so this directory's `select()` writes
 * exactly what the official composer seat switches (the durable per-session
 * selection through the session controller's selectModel remote); @-addressed
 * member dispatches ride room's own submit remote and are untouched. The
 * trigger and the two-level menu mirror the official ModelSelect (figma
 * 496:26454): a root pane of Model / Effort cells drilling into the
 * provider-grouped model list and the current model's effort levels. The menu
 * opens upward absolutely from the picker (the composer sits at the
 * conversation's bottom) rather than portaled — the takeover card has no
 * overflow clip above the row.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutlineMedium, IconChevronDownOutlineMedium, IconChevronRightOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomModelDirectory, RoomModelSelection } from './slots.ts'
import css from './RoomModelPicker.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

interface RoomModelPickerProps {
  /** The session's shared official directory (same instance the /model popup reads). */
  readonly directory: RoomModelDirectory
  /** Selection failures ride the composer's inline error line. */
  readonly onError: (message: string) => void
  readonly t: PropsLocale<'room'>['t']
}

/**
 * Render the main-agent model seat: trigger (current model name + effort in
 * the caption tone + chevron) and, while open, the two-level menu.
 * @param props - the shared directory, the error sink, and the locale seat.
 * @returns the picker.
 */
export function RoomModelPicker({ directory, onError, t }: RoomModelPickerProps) {
  const state = useSyncExternalStore(
    fn => directory.store.subscribe(fn),
    () => directory.store.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const rootRef = useRef<HTMLDivElement | null>(null)

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({ group, model }))), [state.groups])
  const currentChoice = choices.find(choice =>
    choice.group.id === state.current?.provider && choice.model.id === state.current.model)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('composer.model.effortDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const busy = state.status === 'selecting'

  // Click-outside closes the dropdown (the member composer's picker pattern);
  // Escape backs out of a drilled pane first, then closes.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
      setPane('root')
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (pane !== 'root') setPane('root')
      else setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, pane])

  const show = (): void => {
    setPane('root')
    setOpen(true)
    // The official seat's show(): ensure the shared advisory catalog is
    // loaded; failures land on the store and render as the in-menu status.
    void directory.load().catch(() => {})
  }

  const settle = (promise: Promise<unknown>): void => {
    void promise.then((result) => {
      // alpha.2 resolves a RemoteResult whose `ok` carries the outcome;
      // 0.1.5's void resolution (any non-Result value) reads as success.
      if (typeof result === 'object' && result !== null && 'ok' in result && !result.ok) {
        onError(t('composer.model.failed'))
        return
      }
      setOpen(false)
      setPane('root')
    }, () => {
      onError(t('composer.model.failed'))
    })
  }

  const choose = (selection: RoomModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      setOpen(false)
      setPane('root')
      return
    }
    settle(directory.select(selection))
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null || effectiveEffort === effort) {
      setOpen(false)
      setPane('root')
      return
    }
    settle(directory.select({
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }))
  }

  const waiting = state.current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('composer.model.loading')
    : currentChoice?.model.name
      ?? (state.current === null ? t('composer.model.select') : `${state.current.provider}/${state.current.model}`)

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('composer.model.picker')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`}
        onClick={() => {
          if (open) {
            setOpen(false)
            setPane('root')
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutlineMedium className={open ? css.chevronOpen : css.chevron} />
      </button>
      {open && (
        <div className={css.menu} role="menu" aria-label={t('composer.model.picker')} aria-busy={state.status === 'loading' || busy}>
          {pane === 'root' && (
            <>
              <button type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('composer.model.menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutlineMedium className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('composer.model.menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutlineMedium className={css.cellChevron} />
                </button>
              )}
            </>
          )}
          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('composer.model.status.loading')}</div>
              )}
              <div className={css.groups}>
                {state.groups.map(group => (
                  <section role="group" aria-label={group.name} className={css.group} key={group.id}>
                    <div className={css.groupTitle}>{group.name}</div>
                    {group.models.map((model) => {
                      const selected = state.current?.provider === group.id && state.current.model === model.id
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={css.option}
                          title={model.name}
                          disabled={busy}
                          onClick={() => { choose({ provider: group.id, model: model.id }) }}
                        >
                          <span className={css.modelName}>{model.name}</span>
                          <span className={css.check}>
                            {selected ? <IconCheckOutlineMedium /> : null}
                          </span>
                        </button>
                      )
                    })}
                  </section>
                ))}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.status}>{t('composer.model.empty')}</div>
              )}
            </>
          )}
          {pane === 'effort' && (
            reasoning === undefined
              ? <div className={css.status}>{t('composer.model.emptyEfforts')}</div>
              : [
                ...reasoning.defaultEffort === undefined
                  ? [{ key: 'provider-default', effort: undefined as string | undefined, label: t('composer.model.effortDefault') }]
                  : [],
                ...reasoning.efforts.map(level => ({ key: `effort:${level.id}`, effort: level.id as string | undefined, label: level.name })),
              ].map(level => (
                <button
                  key={level.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={effectiveEffort === level.effort}
                  className={css.option}
                  disabled={busy}
                  onClick={() => { chooseEffort(level.effort) }}
                >
                  <span className={css.modelName}>{level.label}</span>
                  <span className={css.check}>
                    {effectiveEffort === level.effort ? <IconCheckOutlineMedium /> : null}
                  </span>
                </button>
              ))
          )}
        </div>
      )}
    </div>
  )
}
