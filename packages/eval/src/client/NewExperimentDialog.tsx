/**
 * The 新建实验 dialog (T87): fill in what you know, and let the agent organize
 * the rest.
 *
 * Four fields — a name (required), the question (optional), a set (optional)
 * and, once a set is chosen, its items (optional). The one action,
 * 「让 Agent 组织」, turns them into a request (organize.ts) and hands it to
 * the caller, which puts it in this session's chat box — NEVER sends it — and
 * falls back to the clipboard when there is no chat box to write into. The
 * agent then walks the person through whatever was left open and drafts with
 * `eval_plan_draft`, the same verb the old four-step wizard called; starting
 * stays a click on the 实验设计 page (R1).
 *
 * The wizard it replaces (I5·T67) asked twenty questions — a commit hash, a
 * seed, a container image — of a person who mostly wanted to say «compare
 * these two». Its code is gone rather than kept unreachable: the service verb
 * it called is the agent's, and still here.
 *
 * Its one read is `draftOptions` (the sets, each item with its title, stage
 * count and whether the dataset marks it a placeholder), paid for when the
 * dialog opens.
 */

import { useEffect, useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalDraftItemOption, EvalDraftOptionsView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { buildOrganizeRequest, checkExperimentName, visibleItems, type NameCheck } from './organize.ts'
import css from './LabView.module.css'

/** The name rule, said in place: which part is broken, and the whole rule once. */
function nameMessage(check: NameCheck, t: LabViewProps['t']): string | null {
  if (check.ok) return null
  if (check.reason === 'empty') return t('new.nameRequired')
  if (check.reason === 'chars') {
    return t('new.nameBadChars', { chars: check.bad.map(char => (char === ' ' ? t('new.nameSpace') : `「${char}」`)).join('') })
  }
  return t('new.nameBadStart')
}

/** One item's line: ID, then its title and stage count when the dataset declares them. */
function ItemLine(props: { item: EvalDraftItemOption; checked: boolean; onToggle: () => void; t: LabViewProps['t'] }) {
  const { item, checked, onToggle, t } = props
  return (
    <label className={css.orgItem} data-placeholder={item.placeholder ? '' : undefined}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={css.orgItemId}>{item.id}</span>
      {item.title !== null && <span className={css.orgItemTitle}>{item.title}</span>}
      {item.stages !== null && item.stages > 0 && (
        <span className={css.orgItemMeta}>{t('new.itemStages', { count: item.stages })}</span>
      )}
      {item.placeholder && <span className={css.orgItemTag}>{t('new.placeholderTag')}</span>}
    </label>
  )
}

/**
 * The 新建实验 dialog.
 * @param props - the read that fills it, and the sink 「让 Agent 组织」 hands
 *   the request to (the caller puts it in the chat box and closes this).
 */
export function NewExperimentDialog(props: {
  open: boolean
  onClose: () => void
  onOrganize: (request: string) => void
  fetchDraftOptions: LabViewProps['fetchDraftOptions']
  sessionId: LabViewProps['sessionId']
  t: LabViewProps['t']
}) {
  const { open, onClose, onOrganize, fetchDraftOptions, sessionId, t } = props
  const [options, setOptions] = useState<EvalDraftOptionsView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [question, setQuestion] = useState('')
  const [dataset, setDataset] = useState('')
  const [items, setItems] = useState<readonly string[]>([])
  const [showPlaceholders, setShowPlaceholders] = useState(false)
  const ids = useId()

  // The read is paid for when the dialog OPENS, not on every visit to the
  // list: walking a repository's item tree is not a read to spend on a person
  // who is only looking at their experiments.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchDraftOptions(sessionId, {}).then((result) => {
      if (cancelled) return
      if (result.ok) setOptions(result.value)
      else setLoadError(result.error.message)
    })
    return () => { cancelled = true }
  }, [open, sessionId, fetchDraftOptions])

  const sets = options?.datasets ?? []
  const chosen = sets.find(entry => entry.id === dataset)
  // A host that predates T87 sends ids only; they still list, without titles.
  const allItems: readonly EvalDraftItemOption[] = chosen?.itemInfo
    ?? (chosen?.items ?? []).map(id => ({ id, title: null, stages: null, placeholder: false }))
  const placeholders = allItems.filter(item => item.placeholder).length
  const shown = visibleItems(allItems, showPlaceholders)
  const check = checkExperimentName(name)
  // Say nothing until the person has typed (or tried to go on): an empty box
  // on a fresh dialog is not a mistake yet.
  const message = touched || name !== '' ? nameMessage(check, t) : null

  const reset = (): void => {
    setName(''); setTouched(false); setQuestion(''); setDataset(''); setItems([]); setShowPlaceholders(false)
  }

  const organize = (): void => {
    setTouched(true)
    if (!check.ok) return
    onOrganize(buildOrganizeRequest({ name, question, dataset, items }, t))
    reset()
  }

  const togglePlaceholders = (): void => {
    // Hiding them again drops them from the pick: a hidden choice is one the
    // person can no longer see they made.
    if (showPlaceholders) setItems(items.filter(id => !allItems.some(item => item.id === id && item.placeholder)))
    setShowPlaceholders(!showPlaceholders)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('new.title')}
      description={t('new.description')}
      closeLabel={t('export.close')}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{t('new.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={!check.ok} onClick={organize}>{t('new.organize')}</Button>
        </>
      )}
    >
      <div className={css.newForm}>
        {loadError !== null && <ErrorState what={t('new.optionsError')} message={loadError} compact t={t} />}

        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor={`${ids}-name`}>
            {t('new.name')}<span className={css.orgRequired}>{t('new.required')}</span>
          </label>
          <Input
            id={`${ids}-name`}
            value={name}
            onChange={(e) => { setName(e.target.value) }}
            onBlur={() => { if (name !== '') setTouched(true) }}
            placeholder={t('new.namePlaceholder')}
            aria-label={t('new.name')}
            aria-invalid={message !== null}
            aria-describedby={`${ids}-name-help`}
          />
          <div id={`${ids}-name-help`} className={message === null ? css.orgHelp : css.orgError} role={message === null ? undefined : 'alert'}>
            {message ?? t('new.nameHelp')}
          </div>
        </div>

        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor={`${ids}-question`}>
            {t('new.question')}<span className={css.orgOptional}>{t('new.optional')}</span>
          </label>
          <textarea
            id={`${ids}-question`}
            className={css.orgTextarea}
            rows={3}
            value={question}
            onChange={(e) => { setQuestion(e.target.value) }}
            placeholder={t('new.questionPlaceholder')}
            aria-label={t('new.question')}
          />
        </div>

        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor={`${ids}-dataset`}>
            {t('new.dataset')}<span className={css.orgOptional}>{t('new.optional')}</span>
          </label>
          <select
            id={`${ids}-dataset`}
            className={css.orgSelect}
            value={dataset}
            aria-label={t('new.dataset')}
            onChange={(e) => {
              setDataset(e.target.value)
              // The items belonged to the previous set.
              setItems([])
              setShowPlaceholders(false)
            }}
          >
            <option value="">{t('new.datasetLater')}</option>
            {sets.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
          </select>
          {options !== null && sets.length === 0 && loadError === null && (
            <div className={css.orgHelp}>{t('new.datasetNone')}</div>
          )}
        </div>

        {chosen !== undefined && (
          <div className={css.formRow}>
            <span className={css.formLabel}>
              {t('new.items')}<span className={css.orgOptional}>{t('new.itemsOptional')}</span>
            </span>
            {shown.length === 0
              ? <div className={css.orgHelp}>{t('new.itemsEmpty')}</div>
              : (
                <div className={css.orgItems} role="group" aria-label={t('new.items')}>
                  {shown.map(item => (
                    <ItemLine
                      key={item.id}
                      item={item}
                      checked={items.includes(item.id)}
                      onToggle={() => {
                        setItems(items.includes(item.id) ? items.filter(id => id !== item.id) : [...items, item.id])
                      }}
                      t={t}
                    />
                  ))}
                </div>
              )}
            {placeholders > 0 && (
              <button type="button" className={css.orgLink} onClick={togglePlaceholders}>
                {showPlaceholders ? t('new.placeholdersHide') : t('new.placeholdersShow', { count: placeholders })}
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
