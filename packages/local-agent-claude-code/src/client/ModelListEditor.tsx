/**
 * The curated model-list editor: an ORDERED shortlist of endpoint-served
 * models — the first entry is the default model every delegation round
 * starts with. Rows drag to reorder and delete per row; "add model" opens a
 * dialog over the endpoint's served catalog (search + checkboxes), so the
 * list can only ever contain what the endpoint actually serves. An empty
 * list falls back to the pre-list chain (the settings model key, the scoped
 * settings.json, then the CLI's own default). Every edit persists
 * immediately through the gateway's `configureModelList` Remote.
 * @module @khorsheed/dsh-local-agent-claude-code/client — model list editor
 */

import { useMemo, useState } from 'react'
import type { LocalAgentModelDirectory } from '@khorsheed/dsh-local-agent/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './SettingsCard.module.css'

/** Full props of the curated model-list editor. */
export interface ModelListEditorProps extends PropsLocale<typeof NS> {
  /** The current ordered list (empty = the fallback chain decides). */
  models: readonly string[]
  /** The endpoint's served catalog, when a read has landed (drives the add dialog). */
  directory: LocalAgentModelDirectory | null
  /** Persist a new ordered list. */
  onChange(next: readonly string[]): void
}

/** The add dialog: search + checkboxes over the endpoint's served catalog. */
function AddModelsDialog({ models, directory, onAdd, onClose, t }: {
  readonly models: readonly string[]
  readonly directory: LocalAgentModelDirectory | null
  readonly onAdd: (added: readonly string[]) => void
  readonly onClose: () => void
  readonly t: ModelListEditorProps['t']
}) {
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const candidates = useMemo(() => {
    const entries = directory?.entries ?? []
    const needle = query.trim().toLowerCase()
    return entries
      .filter(entry => needle === '' || entry.value.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle))
      .map(entry => ({ ...entry, added: models.includes(entry.value) }))
  }, [directory, query, models])
  const selectable = candidates.filter(entry => !entry.added)
  const allChecked = selectable.length > 0 && selectable.every(entry => checked.has(entry.value))
  const toggleAll = (): void => {
    setChecked(allChecked ? new Set() : new Set(selectable.map(entry => entry.value)))
  }
  const toggle = (value: string): void => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }
  return (
    <div className={css.dialogBackdrop} role="presentation" onClick={() => { onClose() }}>
      <div className={css.dialog} role="dialog" aria-label={t('models.dialog.title')} onClick={event => { event.stopPropagation() }}>
        <div className={css.dialogHead}>
          <h4 className={css.dialogTitle}>{t('models.dialog.title')}</h4>
          <button type="button" className={css.dialogClose} aria-label={t('models.dialog.cancel')} onClick={() => { onClose() }}>
            ✕
          </button>
        </div>
        <p className={css.dialogHint}>{t('models.dialog.hint')}</p>
        <div className={css.dialogToolbar}>
          <input
            type="text"
            className={css.modelInput}
            value={query}
            placeholder={t('models.dialog.search')}
            aria-label={t('models.dialog.search')}
            onChange={event => { setQuery(event.currentTarget.value) }}
          />
          <button type="button" className={css.dialogSelectAll} disabled={selectable.length === 0} onClick={() => { toggleAll() }}>
            {t('models.dialog.selectAll')}
          </button>
        </div>
        <div className={css.dialogList}>
          {directory === null && <span className={css.hint}>{t('models.dialog.loading')}</span>}
          {directory !== null && directory.entries.length === 0 && (
            <span className={css.hint}>{directory.reason ?? t('models.dialog.empty')}</span>
          )}
          {candidates.map(entry => (
            <label key={entry.value} className={entry.added ? `${css.dialogItem} ${css.dialogItemAdded}` : css.dialogItem}>
              <input
                type="checkbox"
                checked={entry.added || checked.has(entry.value)}
                disabled={entry.added}
                onChange={() => { toggle(entry.value) }}
              />
              <span className={css.dialogItemValue}>{entry.value}</span>
              {entry.label !== entry.value && <span className={css.dialogItemLabel}>{entry.label}</span>}
            </label>
          ))}
        </div>
        <div className={css.dialogActions}>
          <button type="button" className={css.modelSave} onClick={() => { onClose() }}>{t('models.dialog.cancel')}</button>
          <button
            type="button"
            className={css.dialogConfirm}
            disabled={checked.size === 0}
            onClick={() => { onAdd([...checked]) }}
          >
            {t('models.dialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The editor body: the ordered rows, the per-row delete, and the add button.
 * Reorders persist on drop — every gesture writes immediately.
 */
export function ModelListEditor({ models, directory, onChange, t }: ModelListEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const move = (from: number, to: number): void => {
    if (from === to) return
    const item = models[from]
    if (item === undefined) return
    const next = [...models]
    next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }
  return (
    <div className={css.modelList}>
      {models.length === 0 && <span className={css.hint}>{t('models.empty')}</span>}
      {models.map((model, index) => {
        const entry = directory?.entries.find(candidate => candidate.value === model)
        return (
          <div
            key={model}
            className={dragIndex === index ? `${css.modelRow} ${css.modelRowDragging}` : css.modelRow}
            draggable
            onDragStart={() => { setDragIndex(index) }}
            onDragOver={event => { event.preventDefault() }}
            onDrop={() => {
              if (dragIndex !== null) move(dragIndex, index)
              setDragIndex(null)
            }}
            onDragEnd={() => { setDragIndex(null) }}
          >
            <span className={css.modelDrag} aria-hidden>⠿</span>
            <span className={css.modelRowValue}>{model}</span>
            {entry !== undefined && entry.label !== model && <span className={css.modelRowLabel}>{entry.label}</span>}
            {index === 0 && <span className={css.modelDefaultChip}>{t('models.defaultChip')}</span>}
            <button
              type="button"
              className={css.modelDelete}
              aria-label={`${t('models.delete')}: ${model}`}
              onClick={() => { onChange(models.filter((_, other) => other !== index)) }}
            >
              ✕
            </button>
          </div>
        )
      })}
      <div className={css.row}>
        <button type="button" className={css.modelAdd} onClick={() => { setDialogOpen(true) }}>
          {t('models.add')}
        </button>
        {models.length > 1 && <span className={css.hint}>{t('models.orderHint')}</span>}
      </div>
      {dialogOpen && (
        <AddModelsDialog
          models={models}
          directory={directory}
          onAdd={(added) => {
            onChange([...models, ...added])
            setDialogOpen(false)
          }}
          onClose={() => { setDialogOpen(false) }}
          t={t}
        />
      )}
    </div>
  )
}
