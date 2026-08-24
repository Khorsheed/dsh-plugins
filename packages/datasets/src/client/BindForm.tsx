/**
 * The bind/edit form, three stages: the path section (input + one-tap sources
 * + a live repository preview with a readable verdict), the collapsed
 * "restrict visibility" section (chip multi-selects fed by the preview —
 * nobody types dataset ids or layer names by hand), and confirm.
 *
 * Boundary semantics: an unchecked-everything group is FORBIDDEN (the confirm
 * button disables with a hint) — the binding schema reads an absent whitelist
 * as "everything" and an empty array as "nothing", so letting the UI write []
 * would be ambiguous; collapsing the section is how the user says "all".
 * The bound repoPath is the preview's canonical toplevel (whitespace and
 * trailing slashes never reach the store).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, Input, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { DatasetBinding, PreviewRepoResult } from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import css from './BindForm.module.css'

/** Live preview state of the path input. */
type Preview =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ok'; path: string; result: PreviewRepoResult }
  | { status: 'error'; path: string; message: string }

/** Trim and strip trailing slashes (a lone '/' survives). */
function normalizePath(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
}

/** The form's props: sources, the preview driver, submit/cancel, the error seat, and the copy. */
export interface BindFormProps {
  initial: DatasetBinding | null
  /** The session workspace's directory, when one exists (the one-tap option). */
  currentCwd: string | undefined
  /** Whether the host can show its native directory chooser. */
  canPick: boolean
  pickDirectory: () => Promise<string | null>
  /** Preview one candidate repository path (one RPC; not whitelist-filtered). */
  previewRepo: (path: string) => Promise<RemoteResult<PreviewRepoResult>>
  onSubmit: (binding: DatasetBinding) => void
  onCancel: () => void
  /** A bind failure to surface inside the form. */
  notice: string | null
  t: DatasetsViewProps['t']
}

/**
 * The bind/edit form.
 * @param props - see {@link BindFormProps}.
 */
export function BindForm(props: BindFormProps) {
  const { initial, currentCwd, canPick, pickDirectory, previewRepo, onSubmit, onCancel, notice, t } = props
  const [repo, setRepo] = useState(initial?.repoPath ?? '')
  const [preview, setPreview] = useState<Preview>({ status: 'idle' })
  // The fold opens on its own when the current binding carries whitelists.
  const [restrictOpen, setRestrictOpen] = useState(
    initial !== null && (initial.datasets !== undefined || initial.layers !== undefined),
  )
  // null = untouched (everything). Initialized when the fold opens.
  const [pickedDatasets, setPickedDatasets] = useState<Set<string> | null>(null)
  const [pickedLayers, setPickedLayers] = useState<Set<string> | null>(null)
  const requestSeq = useRef(0)

  const ok = preview.status === 'ok' ? preview.result : null
  // Chip universes: the preview's, unioned with the current binding's entries
  // so an existing whitelist entry never silently vanishes from the form.
  const datasetUniverse = useMemo(() => {
    const ids = (ok?.datasets ?? []).map(dataset => dataset.id)
    return [...new Set([...ids, ...(initial?.datasets ?? [])])]
  }, [ok, initial])
  const layerUniverse = useMemo(() => {
    const names = (ok?.datasets ?? []).flatMap(dataset => dataset.layers)
    return [...new Set([...names, ...(initial?.layers ?? [])])]
  }, [ok, initial])
  const sensitiveLayers = useMemo(() => {
    const names = (ok?.datasets ?? []).flatMap(dataset => dataset.nonModelFacingLayers)
    return new Set(names)
  }, [ok])

  // Live preview, debounced; a stale answer is dropped by the request counter.
  useEffect(() => {
    const path = normalizePath(repo)
    if (path === '') {
      setPreview({ status: 'idle' })
      return
    }
    setPreview({ status: 'loading', path })
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      void previewRepo(path).then((result) => {
        if (requestSeq.current !== seq) return
        if (result.ok) setPreview({ status: 'ok', path, result: result.value })
        else setPreview({ status: 'error', path, message: result.error.message })
      })
    }, 400)
    return () => { clearTimeout(timer) }
  }, [repo, previewRepo])

  // Initialize the picks when the fold opens: the current binding's values
  // when present, else everything the preview knows.
  useEffect(() => {
    if (!restrictOpen || ok === null) return
    if (pickedDatasets === null) {
      setPickedDatasets(new Set(initial?.datasets ?? datasetUniverse))
    }
    if (pickedLayers === null) {
      // The default checks follow the mechanism floor: only modelFacing:true
      // layers (sensitive layers are added deliberately, by hand).
      setPickedLayers(new Set(initial?.layers ?? layerUniverse.filter(name => !sensitiveLayers.has(name))))
    }
  }, [restrictOpen, ok, pickedDatasets, pickedLayers, initial, datasetUniverse, layerUniverse, sensitiveLayers])

  // A path change under an open fold prunes picks to the new universe.
  useEffect(() => {
    if (ok === null) return
    if (pickedDatasets !== null) {
      const pruned = [...pickedDatasets].filter(id => datasetUniverse.includes(id))
      if (pruned.length !== pickedDatasets.size) setPickedDatasets(new Set(pruned))
    }
    if (pickedLayers !== null) {
      const pruned = [...pickedLayers].filter(name => layerUniverse.includes(name))
      if (pruned.length !== pickedLayers.size) setPickedLayers(new Set(pruned))
    }
  }, [ok, pickedDatasets, pickedLayers, datasetUniverse, layerUniverse])

  const toggle = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  // An empty group is forbidden (see the module doc): [] would read as
  // "nothing visible" while the schema's "all" is an absent field.
  const datasetsEmpty = restrictOpen && pickedDatasets !== null && datasetUniverse.length > 0 && pickedDatasets.size === 0
  const layersEmpty = restrictOpen && pickedLayers !== null && layerUniverse.length > 0 && pickedLayers.size === 0
  const canConfirm = ok !== null && !datasetsEmpty && !layersEmpty

  const submit = (): void => {
    if (ok === null) return
    const datasets = restrictOpen && pickedDatasets !== null && pickedDatasets.size < datasetUniverse.length
      ? [...pickedDatasets].sort()
      : undefined
    const layers = restrictOpen && pickedLayers !== null && pickedLayers.size < layerUniverse.length
      ? [...pickedLayers].sort()
      : undefined
    onSubmit({
      repoPath: ok.repo,
      ...(datasets !== undefined ? { datasets } : {}),
      ...(layers !== undefined ? { layers } : {}),
    })
  }

  return (
    <form
      className={css.form}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className={css.title}>{initial === null ? t('binding.form.title') : t('binding.form.titleEdit')}</div>
      <Input
        value={repo}
        onChange={event => { setRepo(event.target.value) }}
        placeholder={t('binding.form.repo')}
        aria-label={t('binding.form.repo')}
      />
      <div className={css.shortcuts}>
        {currentCwd !== undefined && (
          <Button type="button" size="sm" onClick={() => { setRepo(currentCwd) }}>
            {t('binding.form.useWorkspace')}
          </Button>
        )}
        {canPick && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void pickDirectory().then((picked) => {
                if (picked !== null) setRepo(picked)
              })
            }}
          >
            {t('binding.form.browse')}
          </Button>
        )}
      </div>
      <div className={css.preview} aria-live="polite">
        {preview.status === 'loading' && (
          <span className={css.previewLoading}>{t('binding.form.preview.loading')}</span>
        )}
        {preview.status === 'error' && <span className={css.previewError}>{preview.message}</span>}
        {ok !== null && ok.datasets.length > 0 && (
          <span className={css.previewOk}>
            <IconCheckOutline16 size={14} />
            {t('binding.form.preview.ok', { count: ok.datasets.length })}
          </span>
        )}
        {ok !== null && ok.datasets.length === 0 && (
          <span className={css.previewEmpty}>{t('binding.form.preview.empty')}</span>
        )}
      </div>
      <button
        type="button"
        className={css.restrictToggle}
        onClick={() => { setRestrictOpen(!restrictOpen) }}
        aria-expanded={restrictOpen}
      >
        {restrictOpen ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        {t('binding.form.restrict')}
      </button>
      {restrictOpen && (
        <div className={css.restrictBody}>
          {ok === null && (
            <div className={css.hint}>
              {preview.status === 'loading' ? t('binding.form.preview.loading') : t('binding.form.repo')}
            </div>
          )}
          {ok !== null && (
            <>
              <div className={css.chipGroup}>
                <div className={css.chipGroupLabel}>{t('binding.form.restrictDatasets')}</div>
                <div className={css.chips}>
                  {datasetUniverse.map((id) => {
                    const count = ok.datasets.find(dataset => dataset.id === id)?.itemCount
                    return (
                      <Pill
                        key={id}
                        active={pickedDatasets?.has(id) === true}
                        onClick={() => { setPickedDatasets(toggle(pickedDatasets ?? new Set(datasetUniverse), id)) }}
                      >
                        {id}{count !== undefined ? ` · ${count}` : ''}
                      </Pill>
                    )
                  })}
                </div>
              </div>
              <div className={css.chipGroup}>
                <div className={css.chipGroupLabel}>
                  {t('binding.form.restrictLayers')}
                  {' '}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => { setPickedLayers(new Set(layerUniverse.filter(name => !sensitiveLayers.has(name)))) }}
                  >
                    {t('binding.form.taskFacingOnly')}
                  </Button>
                </div>
                <div className={css.chips}>
                  {layerUniverse.map((name) => (
                    <Pill
                      key={name}
                      active={pickedLayers?.has(name) === true}
                      onClick={() => { setPickedLayers(toggle(pickedLayers ?? new Set(layerUniverse), name)) }}
                    >
                      {name}{sensitiveLayers.has(name) ? ` · ${t('binding.form.sensitive')}` : ''}
                    </Pill>
                  ))}
                </div>
              </div>
              {(datasetsEmpty || layersEmpty) && <div className={css.hint}>{t('binding.form.keepOne')}</div>}
            </>
          )}
        </div>
      )}
      <div className={css.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={!canConfirm}>
          {t('binding.form.submit')}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>{t('binding.form.cancel')}</Button>
      </div>
      {notice !== null && <div className={css.notice}>{notice}</div>}
    </form>
  )
}
