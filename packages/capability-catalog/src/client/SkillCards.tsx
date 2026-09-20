import { useState } from 'react'
  import { Button, IconBrowseOutline16, IconTrashOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
  import type { CatalogSkillRow } from '@khorsheed/dsh-capability-catalog/types'
  import { ModeChips } from './ModeChips.tsx'
  import type { CatalogModeChip } from './mode-model.ts'
  import type { CapabilityCatalogKey } from './locales.ts'
  import css from './CapabilityCatalogCard.module.css'

/** Skill `source` buckets that resolve to a local file the catalog may delete;
 * everything else (bundled/runtime/skill-badge) is protected and not deletable. */
const DELETABLE_SOURCES: ReadonlySet<string> = new Set(['user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'custom'])

/** Short source tag shown on the card: 内置 / 插件 / 项目 / 自定义 / 用户. */
const skillSourceTag = (source: string, t: (key: CapabilityCatalogKey) => string): string => {
  switch (source) {
    case 'bundled': return t('builtin')
    case 'runtime': return t('toolPlugin')
    case 'project-dsh':
    case 'project-agents': return t('sourceProject')
    case 'custom': return t('sourceCustom')
    case 'user-dsh':
    case 'user-agents': return t('sourceUser')
    default: return source
  }
}

  /** Preview card in the skills grid (Agent-preset anatomy): name + source tag,
 * two-line description, provider subtitle, foot actions. In the comparison view
 * a chip row names the modes that load it. */
export function SkillPreviewCard({ skill, tag, modes, modeTotal, onMode, onOpen, onDelete, t }: {
  skill: CatalogSkillRow
  /** Overrides the source tag (the management surface shows a managed skill's
   * preset scope there, where that policy is the point). */
  tag?: string | undefined
  /** The modes that load this skill (comparison view only). */
  modes?: readonly CatalogModeChip[] | undefined
  /** How many modes the comparison read, so an all-modes row can say so. */
  modeTotal?: number | undefined
  onMode: (id: string) => void
  onOpen: () => void
  onDelete: () => void
  t: (key: CapabilityCatalogKey) => string
}) {
  const deletable = DELETABLE_SOURCES.has(skill.source)
  return (
    <div className={css.pvCard}>
      <button type="button" className={css.pvMain} onClick={onOpen}>
        <span className={css.pvHead}>
          <span className={css.pvName}>{skill.name}</span>
          <span className={css.pvTag}>{tag ?? skillSourceTag(skill.source, t)}</span>
        </span>
        <span className={css.pvDesc}>{skill.description}</span>
        <span className={css.pvSub}>{skill.provider}</span>
      </button>
      {modes === undefined ? null : <ModeChips modes={modes} total={modeTotal ?? 0} onSelect={onMode} t={t} />}
      <div className={css.pvFoot}>
        <button type="button" className={css.iconButton} onClick={onOpen} aria-label={t('viewDetail')} title={t('viewDetail')}>
          <IconBrowseOutline16 size={16} />
        </button>
        {deletable ? (
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
      closeLabel={t('close')}
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
