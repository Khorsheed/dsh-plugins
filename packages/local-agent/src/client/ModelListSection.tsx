/**
 * The family's shared「可用模型」section: an ORDERED shortlist of
 * endpoint-served models — the first entry is the default model every
 * delegation round starts with. Rows drag to reorder and delete per row;
 * "add model" opens a dialog over the endpoint's served catalog (search +
 * checkboxes), so the list can only ever contain what the endpoint actually
 * serves. An empty list falls back to the pre-list chain (the settings
 * model key, the scoped config file, then the CLI's own default). Every
 * edit persists immediately through the harness's model-list face (the
 * gateway's `modelList`/`configureModelList` Remotes).
 *
 * One implementation serves every companion card (claude-code, codex,
 * kimi): the section owns its state (list read on activate, immediate
 * writes, the catalog read behind the add dialog) so each card's
 * integration is the two faces plus copy — the interaction cannot drift
 * between harnesses. Copy lives in the family core's own dictionary.
 * @module @khorsheed/dsh-local-agent/client — model list section
 */

import { useEffect, useMemo, useState } from 'react'
import type { LocalAgentModelDirectory } from '@khorsheed/dsh-local-agent/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './ModelListSection.module.css'

/** The harness's curated-list face the section edits through. */
export interface ModelListSectionListFace {
  /** Read the current ordered list (absent/malformed reads as empty). */
  read(): Promise<readonly string[] | null | undefined>
  /** Persist a new ordered list; the answer replaces the section's state. */
  write(models: readonly string[]): Promise<readonly string[] | null | undefined>
}

/** Full props of the shared model-list section. */
export interface ModelListSectionProps extends PropsLocale<typeof NS> {
  /** Whether the section's surface is currently visible (gates the reads — a collapsed card never fetches). */
  readonly active: boolean
  /** The harness's curated-list face; absent hides the editor (a core predating the Remotes). */
  readonly modelList?: ModelListSectionListFace | undefined
  /** The endpoint's served catalog read — the add dialog's candidate vocabulary. */
  readonly modelDirectory?: ((refresh?: boolean) => Promise<LocalAgentModelDirectory | null | undefined>) | undefined
  /** Re-read the catalog whenever this value changes (a credential save: a fresh credential's models belong in the dialog now). */
  readonly directoryRefresh?: unknown
}

/** The section's staged state: the list and the catalog behind the add dialog. */
function useModelListState(
  active: boolean,
  modelList: ModelListSectionListFace | undefined,
  modelDirectory: ModelListSectionProps['modelDirectory'],
  directoryRefresh: unknown,
) {
  const unavailable = modelList === undefined
  const [models, setModels] = useState<readonly string[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!active || modelList === undefined) return
    let stale = false
    void modelList.read().then(
      (list) => { if (!stale) setModels(list ?? []) },
      () => { if (!stale) setModels([]) },
    )
    return () => { stale = true }
  }, [active, modelList])
  // The endpoint's served catalog: the add dialog's candidate vocabulary.
  // Refreshed while the surface is active and whenever directoryRefresh
  // moves (a fresh credential's models belong in the dialog now).
  const [directory, setDirectory] = useState<LocalAgentModelDirectory | null>(null)
  useEffect(() => {
    if (!active || modelDirectory === undefined) return
    let stale = false
    void modelDirectory(true).then(
      (result) => { if (!stale) setDirectory(result ?? null) },
      () => { if (!stale) setDirectory(null) },
    )
    return () => { stale = true }
  }, [active, modelDirectory, directoryRefresh])
  const saveModels = (next: readonly string[]): void => {
    if (modelList === undefined) return
    setSaved(false)
    setError(false)
    void modelList.write(next).then(
      (written) => {
        setModels(written ?? next)
        setSaved(true)
      },
      () => { setError(true) },
    )
  }
  return { models, unavailable, saved, error, directory, saveModels }
}

/** The add dialog: search + checkboxes over the endpoint's served catalog. */
function AddModelsDialog({ models, directory, onAdd, onClose, t }: {
  readonly models: readonly string[]
  readonly directory: LocalAgentModelDirectory | null
  readonly onAdd: (added: readonly string[]) => void
  readonly onClose: () => void
  readonly t: ModelListSectionProps['t']
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
function ModelListEditor({ models, directory, onChange, t }: {
  readonly models: readonly string[]
  readonly directory: LocalAgentModelDirectory | null
  readonly onChange: (next: readonly string[]) => void
  readonly t: ModelListSectionProps['t']
}) {
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

/**
 * The「可用模型」section every companion's settings card renders: the block
 * chrome (title + ⓘ bubble), the editor, and the save verdict. Reads fire
 * only while `active`; a missing list face renders the header without the
 * editor (declare-and-degrade).
 * @param props - the faces, the activity gate, and copy.
 * @returns the section.
 */
export function ModelListSection({ active, modelList, modelDirectory, directoryRefresh, t }: ModelListSectionProps) {
  const { models, unavailable, saved, error, directory, saveModels } = useModelListState(active, modelList, modelDirectory, directoryRefresh)
  return (
    <section className={css.block}>
      <h3 className={css.blockTitle}>
        {t('models.title')}
        <Tooltip label={t('models.info')} side="bottom" maxWidth={360}>
          <button type="button" className={css.info} aria-label={t('models.info.aria')}>ⓘ</button>
        </Tooltip>
      </h3>
      {!unavailable && (
        <>
          <ModelListEditor models={models} directory={directory} onChange={saveModels} t={t} />
          {saved && <span className={css.saved}>{t('models.applied')}</span>}
          {error && <span className={css.errorText}>{t('models.error')}</span>}
        </>
      )}
    </section>
  )
}
