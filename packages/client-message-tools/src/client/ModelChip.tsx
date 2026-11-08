/**
 * Model chip for the inline editor's trailing seat: renders the edit's draft
 * provider/model/effort over the session's shared catalog. Menu choices only
 * change that draft; saving the edit submits it through the same per-session
 * ModelDirectory the composer seat and the /model popup share.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { IconCheckOutlineMedium, IconChevronDownOutlineMedium } from './icons.tsx'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserMessageViewProps } from './slots.ts'
import css from './ModelChip.module.css'

type Translate = UserMessageViewProps['t']

/** Props of the editor model chip: the shared catalog and the edit's draft route. */
export interface ModelChipProps {
  /** Selector hook over the session's shared model directory snapshot. */
  useModelDirectory: SnapshotSelectorHook<ModelDirectoryState>
  /** Refresh the advisory directory (fire-and-forget; errors land on the store). */
  loadModels: () => void
  /** Route the edit will submit when saved. */
  selection: ModelSelection
  /** Replace the edit's draft route without writing the session selection. */
  onSelection: (selection: ModelSelection) => void
  /** Disable changes while the edit is saving or another selection is in flight. */
  disabled?: boolean
  /** The message-tools locale seat. */
  t: Translate
}

/** The editor's model chip: trigger with the draft model/effort plus the switch menu. */
export function ModelChip({ useModelDirectory, loadModels, selection, onSelection, disabled = false, t }: ModelChipProps): ReactNode {
  const state = useModelDirectory(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The composer seat loads on session mount; the editor may open first, so
  // load here too (the directory dedupes in-flight generations).
  useEffect(() => { loadModels() }, [loadModels])
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = selection
  const currentGroup = state.groups.find(group => group.id === current.provider)
  const currentModel = currentGroup?.models.find(model => model.id === current.model)
  const reasoning = currentModel?.reasoning
  const effectiveEffort = current.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('model.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const modelLabel = currentModel?.name ?? current.model
  const busy = disabled || state.status === 'selecting'

  const submit = (next: ModelSelection): void => {
    setOpen(false)
    onSelection(next)
  }
  const chooseModel = (provider: string, modelId: string, defaultEffort: string | undefined): void => {
    if (busy || (current.provider === provider && current.model === modelId)) return
    submit({
      provider,
      model: modelId,
      ...defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort },
    })
  }
  const chooseEffort = (effort: string | undefined): void => {
    if (busy || effectiveEffort === effort) return
    submit({
      provider: current.provider,
      model: current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  return (
    <div ref={rootRef} className={css.chip}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('model.aria', { model: modelLabel })}
        aria-haspopup="menu"
        aria-expanded={open}
        title={effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`}
        disabled={busy}
        onClick={() => { setOpen(!open); if (!open) loadModels() }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutlineMedium />
      </button>
      {open && (
        <div className={css.menu} role="menu" aria-label={t('model.menuAria')} aria-busy={state.status === 'loading'}>
          {reasoning !== undefined && (
            <section className={css.group}>
              <div className={css.groupTitle}>{t('model.effort')}</div>
              {[
                ...reasoning.defaultEffort === undefined
                  ? [{ key: 'provider-default', effort: undefined as string | undefined, label: t('model.providerDefault') }]
                  : [],
                ...reasoning.efforts.map(level => ({ key: level.id, effort: level.id as string | undefined, label: level.name })),
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
                  <span className={css.optionLabel}>{level.label}</span>
                  <span className={css.check}>{effectiveEffort === level.effort ? <IconCheckOutlineMedium /> : null}</span>
                </button>
              ))}
            </section>
          )}
          {state.groups.map(group => (
            <section className={css.group} key={group.id}>
              <div className={css.groupTitle}>{group.name}</div>
              {group.models.map((model) => {
                const selected = current.provider === group.id && current.model === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={css.option}
                    disabled={busy}
                    onClick={() => { chooseModel(group.id, model.id, model.reasoning?.defaultEffort) }}
                  >
                    <span className={css.optionLabel}>{model.name}</span>
                    <span className={css.check}>{selected ? <IconCheckOutlineMedium /> : null}</span>
                  </button>
                )
              })}
            </section>
          ))}
          {state.status === 'ready' && state.groups.length === 0 && (
            <div className={css.empty}>{t('model.empty')}</div>
          )}
        </div>
      )}
    </div>
  )
}
