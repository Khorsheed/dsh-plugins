/**
 * 灵感墙: the ghost cards (intent drafts) and the recently accepted, in
 * three topic columns (世界/人物/章节 — proposal §8's ruling: foreshadow
 * seeds and principles don't get columns, they file into the world column's
 * flow and their destination line says where acceptance routes them). Every
 * card reads its post-acceptance destination (kind 即归档路由).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { MemoryKind, MemoryRecord } from '../../types.ts'
import type { StoryTabProps } from '../contract.ts'
import type { WorkShell } from '../data.ts'
import css from '../fragments.module.css'

/** The wall's props: the tab's faces, the shell, the focus. */
export interface WallViewProps {
  readonly props: StoryTabProps
  readonly shell: WorkShell
  readonly workId: string
}

/** One column's id and the kinds that file into it. */
const COLUMNS: readonly { id: 'world' | 'character' | 'chapter'; kinds: readonly MemoryKind[] }[] = [
  { id: 'world', kinds: ['世界', '伏笔点子', '原则'] },
  { id: 'character', kinds: ['人物'] },
  { id: 'chapter', kinds: ['章节'] },
]

/** One card's destination line, per kind (kind 即归档路由). */
function destOf(kind: MemoryKind | undefined, ghost: boolean, t: WallViewProps['props']['t']): string {
  if (kind === '人物') return ghost ? t('wall.dest.character') : t('wall.archivedCharacter')
  if (kind === '章节') return ghost ? t('wall.dest.chapter') : t('wall.archivedChapter')
  if (kind === '伏笔点子') return t('wall.dest.foreshadow')
  if (kind === '原则') return t('wall.dest.principle')
  return ghost ? t('wall.dest.world') : t('wall.archivedWorld')
}

/** 灵感墙 view. */
export function WallView({ props, shell, workId }: WallViewProps): ReactNode {
  const { t, decideMemory } = props
  const sessionId = props.sessionId
  const rev = props.useStory(current => current.rev)
  const [memories, setMemories] = useState<readonly MemoryRecord[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const value = await shell.run(() => props.listMemories({ workId, layer: 'intent' }))
      if (!cancelled && value !== null) setMemories(value)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, rev])

  const ghosts = (memories ?? []).filter(memory => memory.intentStatus === 'draft')
  const recent = (memories ?? []).filter(memory => memory.intentStatus === 'active')

  const decide = (id: string, action: 'accept' | 'discard' | 'archive', toastKey: 'toast.accepted' | 'toast.dropped' | 'toast.archived'): void => {
    if (sessionId === undefined) return
    void (async () => {
      const value = await shell.run(() => decideMemory(sessionId, { workId, id, action }))
      if (value === null) return
      if (!value.ok) {
        shell.showToast(shell.errorText(value.error))
        return
      }
      props.refresh()
      void shell.reloadShell()
      shell.showToast(t(toastKey))
    })()
  }

  if (memories === null) return <div className={css.notice}>{t('state.loading')}</div>
  if (ghosts.length === 0 && recent.length === 0) return <div className={css.notice}>{t('wall.empty')}</div>

  return (
    <div className={css.cols}>
      {COLUMNS.map(column => {
        const columnGhosts = ghosts.filter(memory => column.kinds.includes(memory.kind ?? '世界'))
        const columnRecent = recent.filter(memory => column.kinds.includes(memory.kind ?? '世界'))
        return (
          <div key={column.id} className={css.col}>
            <div className={css.colTitle}>
              <span>{t(`wall.${column.id}`)}</span>
              <span>{columnGhosts.length + columnRecent.length}</span>
            </div>
            {columnRecent.map(memory => (
              <div key={memory.id} className={css.card} data-kind={memory.kind ?? '世界'}>
                <div className={css.cardMeta}>
                  {t('wall.recent')}
                  {sessionId !== undefined && (
                    <button type="button" className={css.archiveLink} onClick={() => { decide(memory.id, 'archive', 'toast.archived') }}>
                      {t('wall.archive')}
                    </button>
                  )}
                </div>
                {memory.content}
                <div className={css.cardDest}>{destOf(memory.kind, false, t)}</div>
              </div>
            ))}
            {columnGhosts.map(memory => (
              <div key={memory.id} className={`${css.card} ${css.cardGhost}`} data-kind={memory.kind ?? '世界'}>
                <div className={css.cardMeta}>{t('wall.ghost')}</div>
                {memory.content}
                <div className={css.cardDest}>{destOf(memory.kind, true, t)}</div>
                {sessionId !== undefined && (
                  <div className={css.cardActs}>
                    <button type="button" onClick={() => { decide(memory.id, 'accept', 'toast.accepted') }}>{t('wall.accept')}</button>
                    <button type="button" onClick={() => { decide(memory.id, 'discard', 'toast.dropped') }}>{t('wall.drop')}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
