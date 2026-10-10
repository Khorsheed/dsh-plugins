/**
 * The project switcher: every game as a card — the last check's screen, the
 * title, live version, art style, element count, last change and the pitch —
 * with the session's own project marked. The first card starts a new game:
 * creation goes through the agent (the light gate needs the user's pitch,
 * element kinds and style), so it writes an opener into the composer.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { artStyleLabel } from '../project.ts'
import type { ProjectCard } from '../types.ts'
import type { ViewProps } from './contract.ts'
import css from './GameTab.module.css'

/** "3 分钟前" style relative time. */
function ago(t: ViewProps['t'], iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const min = Math.round(ms / 60000)
  if (min < 1) return t('switcher.justNow')
  if (min < 60) return t('switcher.minutes', { count: min })
  const h = Math.round(min / 60)
  if (h < 24) return t('switcher.hours', { count: h })
  return t('switcher.days', { count: Math.round(h / 24) })
}

/** The last path segment (the project folder), the full path goes in the tooltip. */
function folderOf(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root
}

/** Props of the switcher. */
export interface ProjectSwitcherProps extends ViewProps {
  readonly currentId: string | null
  /** Re-fetch trigger (state revision). */
  readonly rev: number
  readonly onChoose: (projectId: string | null) => void
  readonly onNew: () => void
}

/** The card grid. */
export function ProjectSwitcher({ t, api, currentId, rev, onChoose, onNew }: ProjectSwitcherProps): ReactNode {
  const [cards, setCards] = useState<readonly ProjectCard[] | null>(null)
  useEffect(() => {
    let live = true
    void api.projectCards().then(r => { if (live) setCards(r.ok ? r.value : []) }).catch(() => { if (live) setCards([]) })
    return () => { live = false }
  }, [api, rev])

  return <div className={css.projectGrid}>
    <button type="button" className={css.newCard} onClick={onNew}>
      <span className={css.newPlus} aria-hidden="true">＋</span>
      <strong>{t('switcher.new')}</strong>
      <span className={css.metaLine}>{t('switcher.newHint')}</span>
    </button>
    {cards === null && <div className={css.projectCard} data-loading="true"><span className={css.metaLine}>{t('loading')}</span></div>}
    {cards?.map(card => {
      const current = card.id === currentId
      return <button key={card.id} type="button" className={css.projectCard} aria-current={current ? 'true' : undefined}
        title={card.root} onClick={() => { onChoose(card.id) }}>
        <span className={css.projectThumb}>
          {card.thumb !== undefined
            ? <img src={`data:image/webp;base64,${card.thumb}`} alt="" />
            : <span className={css.projectInitial}>{card.title.slice(0, 1)}</span>}
          {current && <span className={css.projectHere}>{t('switcher.here')}</span>}
        </span>
        <span className={css.projectBody}>
          <strong className={css.projectTitle}>{card.title}</strong>
          <span className={css.projectChips}>
            <span className={css.headChip} data-tone={card.version === null ? 'muted' : 'ok'}>{card.version === null ? t('switcher.noVersion') : `v${card.version}`}</span>
            {card.artStyle !== '' && <span className={css.headChip}>{artStyleLabel(card.artStyle)}</span>}
            <span className={css.headChip}>{t('switcher.elements', { count: card.elements })}</span>
          </span>
          {card.pitch !== '' && <span className={css.projectPitch}>{card.pitch}</span>}
          <span className={css.metaLine}>{ago(t, card.updatedAt)} · {folderOf(card.root)}</span>
        </span>
      </button>
    })}
  </div>
}
