/**
 * The 新建实验 form — ui-spec §五's one list action, and step 2 of the
 * eight-step flow for the person who does not want to write JSON.
 *
 * It is the same verb the agent's `eval_plan_draft` calls. That is the whole
 * design: a plan drafted here and a plan drafted in one sentence in the
 * conversation are the same file, written by the same code, into the same
 * repository working copy, and they arrive in the same list as the same 草稿
 * row. Nothing about a draft says which side made it.
 *
 * 启动不在这张表单上. The form's button is 保存草稿并 validate, and it lands on
 * the plan-review page — where 批准并启动 lives and stays (R1). A draft that
 * validate rejects is still written: the row says 草稿 and the review page says
 * why, which is more useful than a dialog that refuses to save.
 *
 * Its pickers are filled by ONE read (`draftOptions`, the sets with their items
 * and stage schemas) plus the condition registry the conditions page already
 * reads — nothing here guesses what a repository holds.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalConditionRow, EvalDraftOptionsView, EvalDraftResult } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { ErrorState } from './ErrorState.tsx'
import css from './LabView.module.css'

/** The fields a minted condition may change (ui-spec §五's six, keyed for the form). */
type MintField = 'harness' | 'model' | 'scope' | 'preset' | 'permissions' | 'reasoning'

const MINT_FIELDS: readonly MintField[] = ['harness', 'model', 'scope', 'preset', 'permissions', 'reasoning']

/** Each editable field's own label key — one dictionary entry per field, no key arithmetic. */
const MINT_LABEL: Readonly<Record<MintField, EvalKey>> = {
  harness: 'new.mint.harness',
  model: 'new.mint.model',
  scope: 'new.mint.scope',
  preset: 'new.mint.preset',
  permissions: 'new.mint.permissions',
  reasoning: 'new.mint.reasoning',
}

/** Toggle one id in a picked set, preserving pick order. */
function toggle(picked: readonly string[], id: string): string[] {
  return picked.includes(id) ? picked.filter(entry => entry !== id) : [...picked, id]
}

/** A checkbox list over ids — the 题目多选 / 阶段 / 条件 shape, three times. */
function PickList(props: {
  ids: readonly string[]
  picked: readonly string[]
  onToggle: (id: string) => void
  label: (id: string) => string
  empty: string
}) {
  const { ids, picked, onToggle, label, empty } = props
  if (ids.length === 0) return <div className={css.dim}>{empty}</div>
  return (
    <div className={css.pickList}>
      {ids.map(id => (
        <label key={id} className={css.guardedItem}>
          <input type="checkbox" checked={picked.includes(id)} onChange={() => { onToggle(id) }} />
          <span>{label(id)}</span>
        </label>
      ))}
    </div>
  )
}

/** One labelled row of the form. */
function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.formRow}>
      <span className={css.formLabel}>{props.label}</span>
      <div className={css.formField}>{props.children}</div>
    </div>
  )
}

/**
 * The 新建实验 dialog.
 * @param props - the two reads that fill it, the write, and the sink that
 *   takes the caller to the draft's plan-review page.
 */
export function NewExperimentDialog(props: {
  open: boolean
  onClose: () => void
  onDrafted: (result: EvalDraftResult) => void
  fetchDraftOptions: LabViewProps['fetchDraftOptions']
  fetchConditions: LabViewProps['fetchConditions']
  draftExperiment: LabViewProps['draftExperiment']
  sessionId: LabViewProps['sessionId']
  t: LabViewProps['t']
}) {
  const { open, onClose, onDrafted, fetchDraftOptions, fetchConditions, draftExperiment, sessionId, t } = props
  const [options, setOptions] = useState<EvalDraftOptionsView | null>(null)
  const [rows, setRows] = useState<readonly EvalConditionRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [dataset, setDataset] = useState('')
  const [commit, setCommit] = useState('')
  const [items, setItems] = useState<readonly string[]>([])
  const [stages, setStages] = useState<readonly string[]>([])
  const [conditions, setConditions] = useState<readonly string[]>([])
  const [judges, setJudges] = useState<readonly string[]>([])
  const [judgeSamples, setJudgeSamples] = useState('1')
  const [reps, setReps] = useState('1')
  const [seed, setSeed] = useState(String(new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate()))
  const [interleave, setInterleave] = useState(true)
  const [activeMinutes, setActiveMinutes] = useState('60')
  const [turns, setTurns] = useState('10')
  const [unitImage, setUnitImage] = useState('')
  const [unitNetwork, setUnitNetwork] = useState('')
  const [egress, setEgress] = useState('')
  const [notes, setNotes] = useState('')
  const [mintOpen, setMintOpen] = useState(false)
  const [mintId, setMintId] = useState('')
  const [mintFrom, setMintFrom] = useState('')
  const [mint, setMint] = useState<Record<MintField, string>>({
    harness: '', model: '', scope: '', preset: '', permissions: '', reasoning: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)

  // A refusal lands at the BOTTOM of a form that scrolls, so on a long one it
  // is off screen and the save looks like it did nothing. Bring it into view —
  // guarded, because jsdom (and any other non-layout host) has no such method.
  useEffect(() => {
    const node = errorRef.current
    if (error !== null && typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [error])

  // Both reads are paid for when the dialog OPENS, not on every visit to the
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
    void fetchConditions(sessionId, {}).then((result) => {
      if (cancelled) return
      if (result.ok) setRows(result.value.rows)
    })
    return () => { cancelled = true }
  }, [open, sessionId, fetchDraftOptions, fetchConditions])

  const sets = options?.datasets ?? []
  // The set is picked once and everything else follows from it: a plan draws
  // its items, its stage schemas and its conditions from ONE set, so a picker
  // showing another set's would only offer a refusal later.
  const chosen = sets.find(entry => entry.id === dataset) ?? (sets.length === 1 ? sets[0] : undefined)
  const setId = chosen?.id ?? dataset
  const available = rows.filter(row => row.dataset === setId)
  const mintedName = mintOpen ? mintId.trim() : ''
  const changedFields = MINT_FIELDS.filter(field => mint[field].trim() !== '')

  const canSubmit = name.trim() !== '' && setId !== '' && items.length > 0 && stages.length > 0
    && (conditions.length > 0 || mintedName !== '')
    && (!mintOpen || (mintedName !== '' && mintFrom.trim() !== '' && changedFields.length > 0))

  const submit = (): void => {
    setBusy(true)
    setError(null)
    void draftExperiment(sessionId, {
      name: name.trim(),
      dataset: setId,
      ...(commit.trim() === '' ? {} : { commit: commit.trim() }),
      items: [...items],
      conditions: [...conditions],
      ...(mintOpen && mintedName !== ''
        ? {
          newConditions: [{
            id: mintedName,
            from: mintFrom.trim(),
            // Only the fields the person actually typed into: an empty box is
            // "leave it as the copy has it", never "set it to empty".
            ...Object.fromEntries(changedFields.map(field => [field, mint[field].trim()])),
          }],
        }
        : {}),
      ...(judges.length === 0 ? {} : { judgeConditions: [...judges], judgeSamples: Number(judgeSamples) || 1 }),
      reps: Number(reps) || 1,
      stages: [...stages],
      seed: Number(seed) || 0,
      interleave,
      activeMinutes: Number(activeMinutes) || 60,
      turns: Number(turns) || 10,
      ...(unitImage.trim() === ''
        ? {}
        : {
          unit: {
            image: unitImage.trim(),
            ...(unitNetwork.trim() === '' ? {} : { network: unitNetwork.trim() }),
            ...(egress.trim() === '' ? {} : { egressCommand: egress.trim().split(/\s+/) }),
          },
        }),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
    }).then((result) => {
      setBusy(false)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onDrafted(result.value)
    })
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
          <Button size="sm" onClick={onClose}>{t('new.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={busy || !canSubmit} onClick={submit}>
            {busy ? t('new.saving') : t('new.save')}
          </Button>
        </>
      )}
    >
      <div className={css.newForm}>
        {loadError !== null && <ErrorState what={t('new.optionsError')} message={loadError} compact t={t} />}
        {(options?.notes ?? []).map(note => <div key={note} className={css.note}>{note}</div>)}

        <Row label={t('new.name')}>
          <Input value={name} onChange={(e) => { setName(e.target.value) }}
            placeholder={t('new.namePlaceholder')} aria-label={t('new.name')} />
        </Row>
        <Row label={t('new.dataset')}>
          <select
            className={css.select}
            value={setId}
            aria-label={t('new.dataset')}
            onChange={(e) => {
              setDataset(e.target.value)
              // Everything picked belonged to the previous set.
              setItems([]); setStages([]); setConditions([]); setJudges([])
            }}
          >
            <option value="">{t('new.datasetPick')}</option>
            {sets.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
          </select>
        </Row>
        <Row label={t('new.commit')}>
          <Input value={commit} onChange={(e) => { setCommit(e.target.value) }}
            placeholder={t('new.commitPlaceholder')} aria-label={t('new.commit')} />
        </Row>
        <Row label={t('new.items')}>
          <PickList
            ids={chosen?.items ?? []}
            picked={items}
            onToggle={(id) => { setItems(toggle(items, id)) }}
            label={id => id}
            empty={t('new.itemsEmpty')}
          />
        </Row>
        <Row label={t('new.conditions')}>
          <PickList
            ids={available.map(row => row.id)}
            picked={conditions}
            onToggle={(id) => { setConditions(toggle(conditions, id)) }}
            label={(id) => {
              const row = available.find(entry => entry.id === id)
              return row === undefined ? id : `${id} · ${row.harness ?? '—'} / ${row.model ?? '—'}`
            }}
            empty={t('new.conditionsEmpty')}
          />
          <Button size="sm" onClick={() => { setMintOpen(!mintOpen) }}>
            {mintOpen ? t('new.mintClose') : t('new.mintOpen')}
          </Button>
        </Row>
        {mintOpen && (
          <div className={css.guardedBox}>
            {/* 选模型即新建条件 (ui-spec §五, the conditions page's note): choosing
                a model is minting a subject, and a subject is always a COPY —
                the pair is worth running because it differs in ONE field. */}
            <div className={css.guardedTitle}>{t('new.mintTitle')}</div>
            <Row label={t('new.mintId')}>
              <Input value={mintId} onChange={(e) => { setMintId(e.target.value) }}
                placeholder={t('new.mintIdPlaceholder')} aria-label={t('new.mintId')} />
            </Row>
            <Row label={t('new.mintFrom')}>
              <select className={css.select} value={mintFrom} aria-label={t('new.mintFrom')}
                onChange={(e) => { setMintFrom(e.target.value) }}>
                <option value="">{t('new.mintFromPick')}</option>
                {available.map(row => (
                  <option key={row.id} value={row.id}>{row.id} · {row.harness ?? '—'} / {row.model ?? '—'}</option>
                ))}
              </select>
            </Row>
            {MINT_FIELDS.map(field => (
              <Row key={field} label={t(MINT_LABEL[field])}>
                <Input
                  value={mint[field]}
                  onChange={(e) => { setMint({ ...mint, [field]: e.target.value }) }}
                  placeholder={t('new.mintUnchanged')}
                  aria-label={t(MINT_LABEL[field])}
                />
              </Row>
            ))}
            <div className={css.dim}>
              {changedFields.length === 1
                ? t('new.mintOneFactor', { field: changedFields[0] as string })
                : t('new.mintFactors', { count: changedFields.length })}
            </div>
          </div>
        )}
        <Row label={t('new.judges')}>
          <PickList
            ids={available.map(row => row.id)}
            picked={judges}
            onToggle={(id) => { setJudges(toggle(judges, id)) }}
            label={id => id}
            empty={t('new.conditionsEmpty')}
          />
          {judges.length > 0 && (
            <Input value={judgeSamples} onChange={(e) => { setJudgeSamples(e.target.value) }}
              placeholder={t('new.judgeSamples')} aria-label={t('new.judgeSamples')} />
          )}
        </Row>
        <Row label={t('new.stages')}>
          <PickList
            ids={chosen?.stages ?? []}
            picked={stages}
            onToggle={(id) => { setStages(toggle(stages, id)) }}
            label={id => id}
            empty={t('new.stagesEmpty')}
          />
        </Row>
        <Row label={t('new.reps')}>
          <Input value={reps} onChange={(e) => { setReps(e.target.value) }} aria-label={t('new.reps')} />
        </Row>
        <Row label={t('new.seed')}>
          <Input value={seed} onChange={(e) => { setSeed(e.target.value) }} aria-label={t('new.seed')} />
          <label className={css.guardedItem}>
            <input type="checkbox" checked={interleave} onChange={(e) => { setInterleave(e.target.checked) }} />
            <span>{t('new.interleave')}</span>
          </label>
        </Row>
        <Row label={t('new.budget')}>
          <Input value={activeMinutes} onChange={(e) => { setActiveMinutes(e.target.value) }}
            placeholder={t('new.activeMinutes')} aria-label={t('new.activeMinutes')} />
          <Input value={turns} onChange={(e) => { setTurns(e.target.value) }}
            placeholder={t('new.turns')} aria-label={t('new.turns')} />
        </Row>
        <Row label={t('new.unit')}>
          <Input value={unitImage} onChange={(e) => { setUnitImage(e.target.value) }}
            placeholder={t('new.unitImage')} aria-label={t('new.unitImage')} />
          {unitImage.trim() !== '' && (
            <>
              <Input value={unitNetwork} onChange={(e) => { setUnitNetwork(e.target.value) }}
                placeholder={t('new.unitNetwork')} aria-label={t('new.unitNetwork')} />
              <Input value={egress} onChange={(e) => { setEgress(e.target.value) }}
                placeholder={t('new.egress')} aria-label={t('new.egress')} />
            </>
          )}
        </Row>
        <Row label={t('new.notes')}>
          <Input value={notes} onChange={(e) => { setNotes(e.target.value) }}
            placeholder={t('new.notesPlaceholder')} aria-label={t('new.notes')} />
        </Row>
        <div className={css.dim}>{t('new.notStarting')}</div>
        {error !== null && (
          <div ref={errorRef}>
            <ErrorState what={t('new.error')} message={error} compact t={t} />
          </div>
        )}
      </div>
    </Modal>
  )
}
