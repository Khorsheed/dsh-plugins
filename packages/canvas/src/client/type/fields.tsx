/**
 * A typed card's fields on screen (card types, P1a): the face a definition
 * gives a card on the board (and in the type page's preview), the definition
 * as a field table, the card page's field list, and its field form.
 *
 * Every piece reads the definition the same way the tools do — the title
 * field, the face fields and the value text come from `card-types.ts` — so
 * what the Agent is told a card looks like is what the user sees. Values the
 * definition no longer names are never dropped here: the form writes the
 * fields WHOLE, so it carries them over untouched.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  faceFieldsOf, fieldValueText, removedFieldValues, titleFieldOf,
  type FieldDef, type FieldValue, type TypeDefinition,
} from '../../card-types.ts'
import type { CardCategoryId } from '../../types.ts'
import css from './fields.module.css'

type T = TranslateNS<'canvas'>

/** One card's values, by field key. */
export type FieldValues = Readonly<Record<string, FieldValue>>

/** A card's shown name by id, or undefined when the card is gone. */
export type CardNameOf = (cardId: string) => string | undefined

/** One card a reference field may point at. */
export interface RefCandidate {
  readonly id: string
  readonly name: string
  readonly kind: CardCategoryId
}

/** A field's kind in words: `单选` / `引用 → 人物`. */
export function fieldTypeText(t: T, field: FieldDef, labelOf: (kind: CardCategoryId) => string): string {
  const kind = t(`field.type.${field.type}` as const)
  return field.type === 'ref' && field.refKind !== undefined
    ? `${kind} ${t('field.refTo', { kind: labelOf(field.refKind) })}`
    : kind
}

/** Whether a value holds anything worth showing. */
function filled(value: FieldValue | undefined): value is FieldValue {
  if (value === undefined) return false
  if (typeof value === 'number') return true
  if (typeof value === 'string') return value.trim() !== ''
  return value.length > 0
}

/** One value as a line of text, references by their cards' names. */
function valueLine(t: T, value: FieldValue, nameOf: CardNameOf): string {
  return fieldValueText(value, id => nameOf(id) ?? `${id}${t('field.refGone')}`)
}

/**
 * A typed card's face: its title field (or the fallback), then its face
 * fields. `profile` stacks them as label/value rows, `entry` runs them on one
 * line under the title; `note` is the entry form too — the board only asks
 * for it when a note-layout type still marks face fields.
 */
export function TypedFace({ t, definition, values, nameOf, fallbackTitle }: {
  readonly t: T
  readonly definition: TypeDefinition
  readonly values: FieldValues | undefined
  readonly nameOf: CardNameOf
  readonly fallbackTitle: string
}): ReactNode {
  const titleField = titleFieldOf(definition)
  const titleValue = titleField === undefined ? undefined : values?.[titleField.key]
  const title = filled(titleValue) ? valueLine(t, titleValue, nameOf) : fallbackTitle
  const rows = faceFieldsOf(definition)
    .map(field => ({ field, value: values?.[field.key] }))
    .filter((row): row is { field: FieldDef; value: FieldValue } => filled(row.value))
  return (
    <div className={css.face} data-layout={definition.layout}>
      {title !== '' && <div className={css.faceTitle}>{title}</div>}
      {rows.length > 0 && (definition.layout === 'profile' ? (
        <dl className={css.faceRows}>
          {rows.map(({ field, value }) => (
            <div key={field.key} className={css.faceRow}>
              <dt>{field.label}</dt>
              <dd>{valueLine(t, value, nameOf)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className={css.faceLine}>
          {rows.map(({ field, value }) => (
            <span key={field.key} title={field.label}>{valueLine(t, value, nameOf)}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The definition as a table: each field's name and marks, its kind, and how to fill it. */
export function FieldTable({ t, definition, labelOf }: {
  readonly t: T
  readonly definition: TypeDefinition
  readonly labelOf: (kind: CardCategoryId) => string
}): ReactNode {
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('type.col.label')}</th>
            <th>{t('type.col.type')}</th>
            <th>{t('type.col.hint')}</th>
          </tr>
        </thead>
        <tbody>
          {definition.fields.map(field => (
            <tr key={field.key}>
              <td>
                <span className={css.fieldName}>{field.label}</span>
                <code className={css.fieldKey}>{field.key}</code>
                {field.required === true && <span className={css.mark}>{t('field.required')}</span>}
                {field.face === true && <span className={css.mark}>{t('field.face')}</span>}
              </td>
              <td className={css.typeCell}>
                {fieldTypeText(t, field, labelOf)}
                {field.type === 'select' && (field.options ?? []).length > 0 && (
                  <div className={css.options}>{(field.options ?? []).join(' / ')}</div>
                )}
              </td>
              <td className={css.hintCell}>{field.hint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The card page's fields, read: every field of the definition (an empty one
 * shows a dash, so what is missing is visible), references as buttons that
 * open their card, then any value a revision dropped.
 */
export function FieldList({ t, definition, values, nameOf, onOpenRef }: {
  readonly t: T
  readonly definition: TypeDefinition
  readonly values: FieldValues | undefined
  readonly nameOf: CardNameOf
  readonly onOpenRef: (cardId: string, name: string) => void
}): ReactNode {
  const removed = removedFieldValues(definition, values)
  const shown = (field: FieldDef | undefined, value: FieldValue | undefined): ReactNode => {
    if (!filled(value)) return <span className={css.empty}>—</span>
    if (field?.type === 'ref' && Array.isArray(value)) {
      return (
        <span className={css.chips}>
          {value.map(id => {
            const name = nameOf(id)
            return (
              <button
                key={id}
                type="button"
                className={css.refChip}
                disabled={name === undefined}
                onClick={() => { if (name !== undefined) onOpenRef(id, name) }}
              >
                {name ?? `${id}${t('field.refGone')}`}
              </button>
            )
          })}
        </span>
      )
    }
    if (field?.type === 'tags' && Array.isArray(value)) {
      return <span className={css.chips}>{value.map(tag => <span key={tag} className={css.tag}>{tag}</span>)}</span>
    }
    return <span className={field?.type === 'text' ? css.longValue : undefined}>{valueLine(t, value, nameOf)}</span>
  }
  return (
    <div className={css.list}>
      <dl className={css.rows}>
        {definition.fields.map(field => (
          <div key={field.key} className={css.row}>
            <dt title={field.hint}>{field.label}</dt>
            <dd>{shown(field, values?.[field.key])}</dd>
          </div>
        ))}
      </dl>
      {removed.length > 0 && (
        <details className={css.removed}>
          <summary title={t('field.removedTip')}>{t('field.removed')} · {removed.length}</summary>
          <dl className={css.rows}>
            {removed.map(([key, value]) => (
              <div key={key} className={css.row}>
                <dt><code>{key}</code></dt>
                <dd>{shown(undefined, value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}

/** What one input holds while the form is open (tags and numbers stay text until saved). */
type Draft = Readonly<Record<string, string | readonly string[]>>

function draftOf(definition: TypeDefinition, values: FieldValues | undefined): Draft {
  const draft: Record<string, string | readonly string[]> = {}
  for (const field of definition.fields) {
    const value = values?.[field.key]
    if (field.type === 'ref') draft[field.key] = Array.isArray(value) ? value : []
    else if (field.type === 'tags') draft[field.key] = Array.isArray(value) ? value.join('、') : typeof value === 'string' ? value : ''
    else draft[field.key] = value === undefined ? '' : Array.isArray(value) ? value.join('、') : String(value)
  }
  return draft
}

/** The form's words as stored values; an empty input stores nothing. */
function valueOf(field: FieldDef, entry: string | readonly string[] | undefined): FieldValue | undefined {
  if (entry === undefined) return undefined
  if (field.type === 'ref') return Array.isArray(entry) && entry.length > 0 ? [...entry] : undefined
  const text = typeof entry === 'string' ? entry.trim() : ''
  if (text === '') return undefined
  if (field.type === 'tags') {
    const tags = text.split(/[,，、;；\n]/).map(tag => tag.trim()).filter(tag => tag !== '')
    return tags.length > 0 ? [...new Set(tags)] : undefined
  }
  if (field.type === 'number') {
    const number = Number(text)
    return Number.isFinite(number) ? number : undefined
  }
  return field.type === 'text' ? entry as string : text
}

/**
 * The card page's field form. It writes the fields WHOLE: the values the
 * definition no longer names ride along untouched, and a required field left
 * empty keeps the form open with the list of what is missing.
 */
export function FieldForm({ t, definition, values, candidates, selfId, onSave, onCancel }: {
  readonly t: T
  readonly definition: TypeDefinition
  readonly values: FieldValues | undefined
  /** The cards a reference may point at (archived ones already left out). */
  readonly candidates: readonly RefCandidate[]
  /** The card being edited: never its own reference. */
  readonly selfId: string | null
  readonly onSave: (values: Record<string, FieldValue>) => void
  readonly onCancel: () => void
}): ReactNode {
  const [draft, setDraft] = useState<Draft>(() => draftOf(definition, values))
  const [missing, setMissing] = useState<readonly string[]>([])
  const set = (key: string, entry: string | readonly string[]): void => {
    setDraft(current => ({ ...current, [key]: entry }))
  }
  const nameOf = (id: string): string => candidates.find(card => card.id === id)?.name ?? `${id}${t('field.refGone')}`

  const save = (): void => {
    const next: Record<string, FieldValue> = Object.fromEntries(removedFieldValues(definition, values))
    const empty: string[] = []
    for (const field of definition.fields) {
      const value = valueOf(field, draft[field.key])
      if (value !== undefined) next[field.key] = value
      else if (field.required === true) empty.push(field.label)
    }
    setMissing(empty)
    if (empty.length === 0) onSave(next)
  }

  const input = (field: FieldDef): ReactNode => {
    const entry = draft[field.key]
    const text = typeof entry === 'string' ? entry : ''
    const common = { id: `field-${field.key}`, className: css.input, title: field.hint }
    if (field.type === 'text') {
      return <textarea {...common} rows={3} value={text} placeholder={field.hint} onChange={event => { set(field.key, event.target.value) }} />
    }
    if (field.type === 'select') {
      const options = field.options ?? []
      return (
        <select {...common} value={text} onChange={event => { set(field.key, event.target.value) }}>
          <option value="">{t('field.selectNone')}</option>
          {/* A value the options no longer hold still shows, so opening the form never drops it. */}
          {text !== '' && !options.includes(text) && <option value={text}>{text}</option>}
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      )
    }
    if (field.type === 'ref') {
      const chosen = Array.isArray(entry) ? entry : []
      const open = candidates.filter(card =>
        card.id !== selfId && !chosen.includes(card.id) && (field.refKind === undefined || card.kind === field.refKind))
      return (
        <span className={css.refInput}>
          {chosen.map(id => (
            <span key={id} className={css.refChip}>
              {nameOf(id)}
              <button
                type="button"
                className={css.refRemove}
                aria-label={t('field.removeRef', { name: nameOf(id) })}
                onClick={() => { set(field.key, chosen.filter(other => other !== id)) }}
              >
                ×
              </button>
            </span>
          ))}
          {open.length > 0 && (
            <select
              className={css.refAdd}
              value=""
              title={field.hint}
              onChange={event => { if (event.target.value !== '') set(field.key, [...chosen, event.target.value]) }}
            >
              <option value="">{t('field.addRef')}</option>
              {open.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
            </select>
          )}
        </span>
      )
    }
    return (
      <input
        {...common}
        type={field.type === 'number' ? 'number' : 'text'}
        value={text}
        placeholder={field.type === 'tags' ? t('field.tagsHint') : field.hint}
        onChange={event => { set(field.key, event.target.value) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
          if (event.key === 'Escape') onCancel()
        }}
      />
    )
  }

  return (
    <div className={css.form}>
      {definition.fields.map(field => (
        <div key={field.key} className={css.formRow}>
          <label htmlFor={`field-${field.key}`} title={field.hint}>
            {field.label}
            {field.required === true && <span className={css.star} aria-label={t('field.required')}>*</span>}
          </label>
          {input(field)}
        </div>
      ))}
      <div className={css.formActions}>
        {missing.length > 0 && (
          <span className={css.missing} role="alert">{t('field.missing', { list: missing.join('、') })}</span>
        )}
        <span className={css.spacer} />
        <Button size="sm" onClick={onCancel}>{t('field.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={save}>{t('field.save')}</Button>
      </div>
    </div>
  )
}
