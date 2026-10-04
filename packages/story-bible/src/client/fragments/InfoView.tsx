/**
 * 信息 view: the registry window — what the deployment actually stored for
 * this work, counts computed live and marked as coming from the same source
 * as the views (proposal §6's 信息 page), plus the paths and the cache note.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { ReactNode } from 'react'
import type { StoryTabProps } from '../contract.ts'
import type { WorkShell } from '../data.ts'
import css from '../fragments.module.css'

/** The info view's props. */
export interface InfoViewProps {
  readonly props: StoryTabProps
  readonly shell: WorkShell
}

/** 信息 view. */
export function InfoView({ props, shell }: InfoViewProps): ReactNode {
  const { t } = props
  const info = shell.info
  if (info === null) return <div className={css.notice}>{t('state.loading')}</div>
  const { meta, counts } = info
  return (
    <div>
      <div className={css.infoNote}>{t('info.note')}</div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.work')}</span>
        <span>《{meta.title}》（{meta.id}）</span>
      </div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.workspace')}</span>
        <span>
          <code className={css.infoPath}>{meta.workspace}</code>
          {' '}
          {t('info.workspaceBody', { dir: `${meta.workspace}/${meta.title}` })}
        </span>
      </div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.stateDir')}</span>
        <span><code className={css.infoPath}>{info.stateDir}</code></span>
      </div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.memories')}</span>
        <span>
          {t('info.memoriesCount', { total: String(counts.memories), drafts: String(counts.intentDrafts), pending: String(counts.pending) })}
          <span className={css.infoSame}>{t('info.sameSource')}</span>
        </span>
      </div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.characters')}</span>
        <span>
          {t('info.charactersCount', { count: String(counts.characters) })}
          <span className={css.infoSame}>{t('info.sameSource')}</span>
        </span>
      </div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.chapters')}</span>
        <span>
          {t('info.chaptersCount', { count: String(counts.chapters) })}
          <span className={css.infoSame}>{t('info.sameSource')}</span>
        </span>
      </div>
      <div className={css.infoRow}>
        <span className={css.infoKey}>{t('info.cache')}</span>
        <span>{t('info.cacheNote')}</span>
      </div>
    </div>
  )
}
