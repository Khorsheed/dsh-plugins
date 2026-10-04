/**
 * 设定集: the settled elements in five boards (世界观/人物/场景/物品/创作
 * 原则). The 人物 board reads the character cards (identity + core + voice +
 * the reserved image slot + 「角色记忆 →」); the other boards read canon
 * memories by kind. Every card edits in place through the derives_from
 * revision protocol (patchMemory — the old row archives into the chain).
 *
 * 场景/物品 boards render honestly empty for now: the kind axis (世界/人物/
 * 章节/伏笔点子/原则) files nothing into them yet (proposal §2 vs §6's open
 * seam) — see the package Agent Note.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CharacterRecord, MemoryRecord } from '../../types.ts'
import type { StoryTabProps } from '../contract.ts'
import type { WorkShell } from '../data.ts'
import css from '../fragments.module.css'

/** The sets view's props. */
export interface SetsViewProps {
  readonly props: StoryTabProps
  readonly shell: WorkShell
  readonly workId: string
}

/** The five boards. */
const BOARDS = ['world', 'character', 'scene', 'item', 'principle'] as const
type Board = (typeof BOARDS)[number]

/** 设定集 view. */
export function SetsView({ props, shell, workId }: SetsViewProps): ReactNode {
  const { t } = props
  const rev = props.useStory(current => current.rev)
  const [board, setBoard] = useState<Board>('character')
  const [memories, setMemories] = useState<readonly MemoryRecord[] | null>(null)
  const [characters, setCharacters] = useState<readonly CharacterRecord[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [canon, roster] = await Promise.all([
        shell.run(() => props.listMemories({ workId, layer: 'canon' })),
        shell.run(() => props.listCharacters({ workId })),
      ])
      if (cancelled) return
      if (canon !== null) setMemories(canon)
      if (roster !== null) setCharacters(roster)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, rev])

  const rows = boardRows(board, memories ?? [], characters ?? [])

  return (
    <div className={css.fragRoot}>
      <div className={css.setChips} role="tablist">
        {BOARDS.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={board === id}
            className={css.viewChip}
            data-on={board === id || undefined}
            onClick={() => { setBoard(id) }}
          >
            {t(`sets.board.${id}`)} {boardCount(id, memories ?? [], characters ?? [])}
          </button>
        ))}
      </div>
      <div className={css.viewBody}>
        {board === 'character' ? (
          (characters ?? []).length === 0 ? (
            <div className={css.notice}>{t('sets.empty')}</div>
          ) : (
            (characters ?? []).map(character => (
              <CharacterSetCard key={character.id} character={character} props={props} />
            ))
          )
        ) : rows.length === 0 ? (
          <div className={css.notice}>{t('sets.empty')}</div>
        ) : (
          rows.map(memory => (
            <MemorySetCard key={memory.id} memory={memory} props={props} shell={shell} workId={workId} tag={boardTag(board, t)} />
          ))
        )}
      </div>
    </div>
  )
}

/** One board's rows (memories only; the character board reads its own table). */
function boardRows(board: Board, memories: readonly MemoryRecord[], _characters: readonly CharacterRecord[]): readonly MemoryRecord[] {
  if (board === 'world') return memories.filter(memory => memory.kind === '世界' && memory.type !== 'prospective')
  if (board === 'principle') return memories.filter(memory => memory.kind === '原则')
  // 场景/物品: nothing files here yet (the kind axis has no value for them).
  return []
}

/** One board's chip count. */
function boardCount(board: Board, memories: readonly MemoryRecord[], characters: readonly CharacterRecord[]): number {
  if (board === 'character') return characters.length
  return boardRows(board, memories, characters).length
}

/** One board's card tag. */
function boardTag(board: Board, t: SetsViewProps['props']['t']): string {
  return t(`sets.board.${board}`)
}

/** One character card on the 人物 board. */
function CharacterSetCard({ character, props }: { character: CharacterRecord; props: StoryTabProps }): ReactNode {
  const { t } = props
  return (
    <div className={css.setCard}>
      <div className={css.setHead}>
        <b>{character.name}</b>
        <span className={css.setTag}>{t('sets.board.character')}</span>
        <button type="button" className={css.textLink} onClick={() => { props.openCharacter(character.id) }}>
          {t('sets.gotoCM')}
        </button>
      </div>
      <div>
        <span className={css.setField}>{t('field.identity')}</span>
        {character.identity}
      </div>
      <div>
        <span className={css.setField}>{t('field.core')}</span>
        {[character.core.want, character.core.lack, character.core.wound].filter(part => part !== undefined).join(' · ')}
      </div>
      {character.profile.voice !== undefined && (
        <div>
          <span className={css.setField}>{t('field.voice')}</span>
          {character.profile.voice}
        </div>
      )}
      <div className={css.imagePh}>{t('sets.imagePh')}</div>
    </div>
  )
}

/** One canon memory card, editable through the derives_from chain. */
function MemorySetCard({ memory, props, shell, workId, tag }: {
  memory: MemoryRecord
  props: StoryTabProps
  shell: WorkShell
  workId: string
  tag: string
}): ReactNode {
  const { t } = props
  const sessionId = props.sessionId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(memory.content)

  const save = (): void => {
    if (sessionId === undefined) return
    const content = draft.trim()
    if (content.length === 0 || content === memory.content) {
      setEditing(false)
      setDraft(memory.content)
      return
    }
    void (async () => {
      const value = await shell.run(() => props.patchMemory(sessionId, { workId, id: memory.id, content }))
      if (value === null) return
      if (!value.ok) {
        shell.showToast(shell.errorText(value.error))
        return
      }
      props.refresh()
      void shell.reloadShell()
      shell.showToast(t('toast.memorySaved'))
      setEditing(false)
    })()
  }

  return (
    <div className={css.setCard}>
      <div className={css.setHead}>
        <span className={css.setTag}>{tag}</span>
        {memory.autoImported === true && <span className={css.setTag}>{t('wm.sourceAuto')}</span>}
        {sessionId !== undefined && !editing && (
          <button type="button" className={css.textLink} aria-label={t('sets.edit')} onClick={() => { setDraft(memory.content); setEditing(true) }}>
            {t('sets.edit')}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className={css.editArea}
            autoFocus
            value={draft}
            onChange={event => { setDraft(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setDraft(memory.content)
                setEditing(false)
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
            }}
          />
          <div className={css.editRow}>
            <button type="button" className={css.smallButton} data-primary="true" onClick={save}>{t('sets.save')}</button>
            <button type="button" className={css.smallButton} onClick={() => { setDraft(memory.content); setEditing(false) }}>
              {t('sets.cancelEdit')}
            </button>
          </div>
        </>
      ) : (
        memory.content
      )}
      {memory.evidenceInText !== undefined && (
        <div className={css.ruleMeta}>
          <span className={css.setField}>{t('field.evidence')}</span>
          {t('wm.evidence', { text: memory.evidenceInText })}
        </div>
      )}
    </div>
  )
}
