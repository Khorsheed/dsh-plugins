import { useState } from 'react'
  import { Button, IconBrowseOutline16, IconTrashOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CatalogSkillRow } from '@khorsheed/dsh-capability-catalog/types'
  import type { CapabilityCatalogKey } from './locales.ts'
  import css from './CapabilityCatalogCard.module.css'

/** Built-in / plugin-provided skill sources — never deletable, shown with the 内置 tag. */
  const BUILTIN_SOURCES: ReadonlySet<string> = new Set(['runtime', 'bundled', 'skill-badge'])
  export const isBuiltin = (skill: CatalogSkillRow): boolean => BUILTIN_SOURCES.has(skill.source)

  /** Preview card in the skills grid (Agent-preset anatomy): name + built-in tag,
 * two-line description, provider subtitle, foot actions. */
export function SkillPreviewCard({ skill, builtin, onOpen, onDelete, t }: {
  skill: CatalogSkillRow
  builtin: boolean
  onOpen: () => void
  onDelete: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  return (
    <div className={css.pvCard}>
      <button type="button" className={css.pvMain} onClick={onOpen}>
        <span className={css.pvHead}>
          <span className={css.pvName}>{skill.name}</span>
          {builtin ? <span className={css.pvTag}>{t('builtin')}</span> : null}
        </span>
        <span className={css.pvDesc}>{skill.description}</span>
        <span className={css.pvSub}>{skill.provider}</span>
      </button>
      <div className={css.pvFoot}>
        <button type="button" className={css.iconButton} onClick={onOpen} aria-label={t('viewDetail')} title={t('viewDetail')}>
          <IconBrowseOutline16 size={16} />
        </button>
        {!builtin ? (
          <button type="button" className={`${css.iconButton} ${css.iconDanger}`} onClick={onDelete} aria-label={t('delete')} title={t('delete')}>
            <IconTrashOutline16 size={16} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Second-step modal confirming a destructive skill delete. */
export function DeleteSkillConfirm({ name, onCancel, onConfirm, t }: {
  name: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  t: (key: CapabilityCatalogKey) => string
}) {
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('delete')}
      description={`${t('confirmDelete')}「${name}」？`}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('delete')}</Button>
        </>
      )}
    />
  )
}
