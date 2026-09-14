/**
 * The tab's three write gestures, as one small inline form: «新建题集»,
 * «题目骨架», «导入题目».
 *
 * One component rather than three because the three differ only in their
 * fields and their title — and because the RULE they share is the important
 * part: a field is typed, the submit writes into the WORKING TREE, and the
 * commit stays the human's. The tab deliberately owns no body editor
 * (ui-spec §四), so nothing here edits a task statement, a rubric or a probe.
 */

import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetsViewProps } from './contract.ts'
import type { DatasetsForm } from './store.ts'
import css from './DatasetsView.module.css'

/** One typed field of the form. */
export interface SkeletonField {
  /** Stable key — the submitted values are keyed by it. */
  name: string
  /** Field label, also its accessible name. */
  label: string
  /** Whether the submit stays disabled until this field has a value. */
  required: boolean
}

/** The fields each gesture asks for. */
export function fieldsOf(form: Exclude<DatasetsForm, null>, t: DatasetsViewProps['t']): SkeletonField[] {
  if (form === 'newDataset') {
    return [
      { name: 'id', label: t('form.datasetId'), required: true },
      { name: 'name', label: t('form.datasetName'), required: false },
    ]
  }
  if (form === 'newItem') {
    return [{ name: 'item', label: t('form.itemId'), required: true }]
  }
  return [
    { name: 'item', label: t('form.itemId'), required: true },
    { name: 'sourceDir', label: t('form.sourceDir'), required: true },
  ]
}

/** The title each gesture carries. */
export function titleOf(form: Exclude<DatasetsForm, null>, t: DatasetsViewProps['t']): string {
  if (form === 'newDataset') return t('form.newDatasetTitle')
  if (form === 'newItem') return t('form.newItemTitle')
  return t('form.importItemTitle')
}

/**
 * The inline write form.
 * @param props - which gesture, the submit/cancel handlers, and the locale seat.
 */
export function SkeletonForm(props: {
  form: Exclude<DatasetsForm, null>
  onSubmit: (values: Record<string, string>) => void
  onCancel: () => void
  /** A failure from the last submit, shown inside the form. */
  notice: string | null
  t: DatasetsViewProps['t']
}) {
  const { form, onSubmit, onCancel, notice, t } = props
  const [values, setValues] = useState<Record<string, string>>({})
  const fields = fieldsOf(form, t)
  const ready = fields.every(field => !field.required || (values[field.name] ?? '').trim() !== '')
  return (
    <form
      className={css.bindForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        const trimmed: Record<string, string> = {}
        for (const field of fields) trimmed[field.name] = (values[field.name] ?? '').trim()
        onSubmit(trimmed)
      }}
    >
      <div className={css.bindFormTitle}>{titleOf(form, t)}</div>
      {fields.map(field => (
        <Input
          key={field.name}
          value={values[field.name] ?? ''}
          onChange={event => { setValues({ ...values, [field.name]: event.target.value }) }}
          placeholder={field.label}
          aria-label={field.label}
        />
      ))}
      <div className={css.skeletonHint}>{t('skeleton.commitHint')}</div>
      <div className={css.bindFormActions}>
        <Button type="submit" variant="primary" size="sm" disabled={!ready}>{t('form.submit')}</Button>
        <Button type="button" size="sm" onClick={onCancel}>{t('form.cancel')}</Button>
      </div>
      {notice !== null && <div className={css.notice}>{notice}</div>}
    </form>
  )
}
