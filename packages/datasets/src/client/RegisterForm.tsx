/**
 * The register / edit-registration form, three stages: the path section
 * (input + native chooser + a live verdict), the registration's shape (its
 * id, the tracked branch, per-set agent-visible layers as chips), and confirm.
 *
 * A registration belongs to the deployment, not to a session. There is no
 * «use the session workspace» shortcut: the session cwd is where an agent
 * works, which is exactly the directory a dataset repository must not be.
 * There is no dataset whitelist either: every set on the tracked branch is
 * listed, and what an agent may read of each is its layer chips. The chips
 * default to the modelFacing floor; a sensitive layer is added by hand, one
 * set at a time.
 *
 * Boundary semantics: a set with no chip checked is FORBIDDEN (confirm
 * disables with a hint) — a set the agent may read nothing of should not be
 * listed to it, and the registry has no «hidden set» notion. The path is sent
 * as typed; the host canonicalizes it to the repository's git common dir, so
 * a checkout, a linked worktree and a `.git` directory of one repository all
 * land on one registration.
 */

import { useEffect, useRef, useState } from 'react'
import { Button, IconCheckOutline16, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { RegisterInput, RegisterPreview, RegistryEntry, RegistrySet, UpdateInput } from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { shortCommit } from './parts.tsx'
import css from './RegisterForm.module.css'

/** Live preview state of the path input. */
type Preview =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ok'; path: string; result: RegisterPreview }
  | { status: 'error'; path: string; message: string }

/** Trim and strip trailing slashes (a lone '/' survives). */
function normalizePath(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
}

/** The form's props: the edited registration (if any), the preview driver, submit/cancel, and the copy. */
export interface RegisterFormProps {
  /** The registration being edited; undefined registers a new repository. */
  initial?: RegistryEntry | undefined
  /** Whether the host can show its native directory chooser. */
  canPick: boolean
  pickDirectory: () => Promise<string | null>
  /** Preview one candidate path at one branch (one RPC). */
  previewRepo: (path: string, trackedRef?: string) => Promise<RemoteResult<RegisterPreview>>
  onRegister: (input: RegisterInput) => void
  onUpdate: (input: UpdateInput) => void
  onCancel: () => void
  /** A register/update failure to surface inside the form. */
  notice: string | null
  t: DatasetsViewProps['t']
}

/**
 * The register / edit form.
 * @param props - see {@link RegisterFormProps}.
 */
export function RegisterForm(props: RegisterFormProps) {
  const { initial, canPick, pickDirectory, previewRepo, onRegister, onUpdate, onCancel, notice, t } = props
  const [path, setPath] = useState(initial?.commonDir ?? '')
  const [id, setId] = useState('')
  // null = follow the preview's default branch until the person picks one.
  const [branch, setBranch] = useState<string | null>(initial?.trackedRef ?? null)
  const [preview, setPreview] = useState<Preview>({ status: 'idle' })
  // Per-set picks; a set absent here shows the preview's default layers.
  const [picked, setPicked] = useState<Record<string, ReadonlySet<string>>>({})
  const [authoring, setAuthoring] = useState(initial === undefined || initial.authoringCheckout !== null)
  const requestSeq = useRef(0)

  const ok = preview.status === 'ok' ? preview.result : null
  const trackedRef = branch ?? ok?.defaultRef

  // Live preview, debounced; a stale answer is dropped by the request counter.
  useEffect(() => {
    const target = normalizePath(path)
    if (target === '') {
      setPreview({ status: 'idle' })
      return
    }
    setPreview({ status: 'loading', path: target })
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      void previewRepo(target, branch ?? undefined).then((result) => {
        if (requestSeq.current !== seq) return
        if (result.ok) setPreview({ status: 'ok', path: target, result: result.value })
        else setPreview({ status: 'error', path: target, message: result.error.message })
      })
    }, 400)
    return () => { clearTimeout(timer) }
  }, [path, branch, previewRepo])

  const layersOf = (set: string): ReadonlySet<string> => {
    const explicit = picked[set]
    if (explicit !== undefined) return explicit
    return new Set(ok?.sets.find(entry => entry.set === set)?.layers ?? [])
  }
  const toggle = (set: string, layer: string): void => {
    const next = new Set(layersOf(set))
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    setPicked({ ...picked, [set]: next })
  }

  // A second registration of one repository is refused by the host too; the
  // form says so before the person fills anything in.
  const duplicate = initial === undefined && ok?.registeredAs !== undefined
  const emptySet = (ok?.sets ?? []).some(set => layersOf(set.set).size === 0)
  const canConfirm = ok !== null && ok.latest !== undefined && !duplicate && !emptySet

  const submit = (): void => {
    if (ok === null || !canConfirm) return
    const sets: Record<string, RegistrySet> = {}
    for (const set of ok.sets) sets[set.set] = { layers: [...layersOf(set.set)].sort() }
    const checkout = authoring ? (ok.checkout ?? initial?.authoringCheckout ?? null) : null
    if (initial !== undefined) {
      onUpdate({
        id: initial.id,
        ...(trackedRef !== undefined ? { trackedRef } : {}),
        sets,
        authoringCheckout: checkout,
      })
      return
    }
    const name = id.trim()
    onRegister({
      path: normalizePath(path),
      ...(name !== '' ? { id: name } : {}),
      ...(trackedRef !== undefined ? { trackedRef } : {}),
      sets,
      authoringCheckout: checkout,
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
      <div className={css.title}>
        {initial !== undefined ? t('register.titleEdit', { id: initial.id }) : t('register.title')}
      </div>
      {initial === undefined && (
        <div className={css.pathRow}>
          <Input
            value={path}
            onChange={(event) => {
              setPath(event.target.value)
              // A new candidate repository starts from its own defaults.
              setBranch(null)
              setPicked({})
            }}
            placeholder={t('register.path')}
            aria-label={t('register.path')}
          />
          {canPick && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void pickDirectory().then((chosen) => {
                  if (chosen === null) return
                  setPath(chosen)
                  setBranch(null)
                  setPicked({})
                })
              }}
            >
              {t('register.browse')}
            </Button>
          )}
        </div>
      )}
      <div className={css.preview} aria-live="polite">
        {preview.status === 'loading' && (
          <span className={css.previewLoading}>{t('register.preview.loading')}</span>
        )}
        {preview.status === 'error' && (
          <ErrorState
            what={t('register.preview.failed')}
            message={preview.message}
            path={preview.path}
            compact
            t={t}
          />
        )}
        {duplicate && (
          <ErrorState
            what={t('register.preview.failed')}
            message={`this repository is registered already as ${JSON.stringify(ok.registeredAs)}`}
            path={ok.commonDir}
            compact
            t={t}
          />
        )}
        {ok !== null && !duplicate && ok.latest === undefined && (
          <span className={css.previewEmpty}>{t('register.preview.noRef', { ref: trackedRef ?? '' })}</span>
        )}
        {ok !== null && !duplicate && ok.latest !== undefined && ok.sets.length > 0 && (
          <span className={css.previewOk}>
            <IconCheckOutline16 size={14} />
            {t('register.preview.ok', {
              count: ok.sets.length,
              ref: trackedRef ?? '',
              short: shortCommit(ok.latest.commit),
              date: ok.latest.date.slice(0, 10),
            })}
          </span>
        )}
        {ok !== null && !duplicate && ok.latest !== undefined && ok.sets.length === 0 && (
          <span className={css.previewEmpty}>{t('register.preview.empty', { ref: trackedRef ?? '' })}</span>
        )}
      </div>
      {ok !== null && !duplicate && (
        <div className={css.shape}>
          {initial === undefined && (
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('register.id')}</span>
              <Input
                value={id}
                onChange={(event) => { setId(event.target.value) }}
                placeholder={ok.suggestedId}
                aria-label={t('register.id')}
              />
            </label>
          )}
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('register.branch')}</span>
            <select
              className={css.select}
              value={trackedRef ?? ''}
              onChange={(event) => {
                setBranch(event.target.value)
                setPicked({})
              }}
              aria-label={t('register.branch')}
            >
              {ok.branches.map(name => <option key={name} value={name}>{name}</option>)}
              {trackedRef !== undefined && !ok.branches.includes(trackedRef) && (
                <option value={trackedRef}>{trackedRef}</option>
              )}
            </select>
          </label>
          {ok.sets.length > 0 && (
            <div className={css.chipGroup}>
              <div className={css.fieldLabel}>{t('register.layers')}</div>
              {ok.sets.map(set => (
                <div key={set.set} className={css.setRow}>
                  <span className={css.setName} title={set.title}>{set.set}</span>
                  <span className={css.chips}>
                    {set.declaredLayers.map(layer => (
                      <Pill
                        key={layer}
                        active={layersOf(set.set).has(layer)}
                        onClick={() => { toggle(set.set, layer) }}
                      >
                        {layer}{set.nonModelFacingLayers.includes(layer) ? ` · ${t('register.sensitive')}` : ''}
                      </Pill>
                    ))}
                  </span>
                </div>
              ))}
              {emptySet && <div className={css.hint}>{t('register.keepOne')}</div>}
            </div>
          )}
          {(ok.checkout !== undefined || (initial !== undefined && initial.authoringCheckout !== null)) && (
            <label className={css.check}>
              <input
                type="checkbox"
                checked={authoring}
                onChange={(event) => { setAuthoring(event.target.checked) }}
              />
              {t('register.authoring')}
            </label>
          )}
        </div>
      )}
      <div className={css.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={!canConfirm}>
          {initial !== undefined ? t('register.save') : t('register.submit')}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>{t('register.cancel')}</Button>
      </div>
      {notice !== null && <ErrorState what={t('notice.failed')} message={notice} compact t={t} />}
    </form>
  )
}
