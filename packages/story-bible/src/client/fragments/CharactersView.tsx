/**
 * 角色记忆: character chips + the 心智时间游标 (截至第 N 章) + the five
 * blocks (当前态 / 经历流水 / 内核 / 知道的事·不知道的事·秘密 / 关系 /
 * 档案), every field editable in place (writeCharacter patch — the card IS
 * the edit unit). Automatic experience lines carry the 自动·撤销 tag; the
 * gesture takes them back by id.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CharacterRecord, ExperienceEntry } from '../../types.ts'
import type { StoryTabProps } from '../contract.ts'
import type { WorkShell } from '../data.ts'
import css from '../fragments.module.css'

/** The characters view's props. */
export interface CharactersViewProps {
  readonly props: StoryTabProps
  readonly shell: WorkShell
  readonly workId: string
}

/** 角色记忆 view. */
export function CharactersView({ props, shell, workId }: CharactersViewProps): ReactNode {
  const { t } = props
  const sessionId = props.sessionId
  const story = props.useStory(current => current)
  const [characters, setCharacters] = useState<readonly CharacterRecord[] | null>(null)
  const [experiences, setExperiences] = useState<readonly ExperienceEntry[] | null>(null)

  const characterId = story.cmCharacterId
  const cursor = story.cmCursor

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const roster = await shell.run(() => props.listCharacters({ workId }))
      if (cancelled || roster === null) return
      setCharacters(roster)
      if (characterId === null && roster.length > 0) props.setCmCharacter(roster[0]!.id)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, story.rev])

  useEffect(() => {
    if (characterId === null) {
      setExperiences(null)
      return
    }
    let cancelled = false
    void (async () => {
      const value = await shell.run(() => props.listExperiences({ workId, characterId }))
      if (!cancelled && value !== null) setExperiences(value)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, characterId, story.rev])

  if (characters === null) return <div className={css.notice}>{t('state.loading')}</div>
  if (characters.length === 0) return <div className={css.notice}>{t('cm.noCharacter')}</div>

  const current = characters.find(candidate => candidate.id === characterId) ?? characters[0]!
  const maxChapter = (experiences ?? []).reduce((max, entry) => Math.max(max, entry.chapter), 0)
  const shown = (experiences ?? []).filter(entry => cursor === null || entry.chapter <= cursor)

  const retract = (id: string): void => {
    if (sessionId === undefined) return
    void (async () => {
      const value = await shell.run(() => props.retractExperience(sessionId, { workId, id }))
      if (value === null) return
      if (!value.ok) {
        shell.showToast(shell.errorText(value.error))
        return
      }
      props.refresh()
      shell.showToast(t('toast.expRetracted'))
    })()
  }

  return (
    <div className={css.fragRoot}>
      <div className={css.cmTop}>
        <span className={css.cmWho}>
          {current.name}
          <span>{current.identity}</span>
        </span>
        <span className={css.cmCursor}>
          {t('cm.cursor')}
          <span className={css.chapGrid}>
            {Array.from({ length: maxChapter }, (_, index) => index + 1).map(n => (
              <button
                key={n}
                type="button"
                className={css.cg}
                data-has={(experiences ?? []).some(entry => entry.chapter === n) || undefined}
                data-on={(cursor ?? maxChapter) === n || undefined}
                onClick={() => { props.setCmCursor((cursor ?? maxChapter) === n && n === maxChapter ? null : n) }}
              >
                {n}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className={css.chrChips}>
        {characters.map(character => (
          <button
            key={character.id}
            type="button"
            className={css.viewChip}
            data-on={character.id === current.id || undefined}
            onClick={() => { props.setCmCharacter(character.id) }}
          >
            {character.name}
          </button>
        ))}
      </div>
      <div className={css.viewBody}>
        <div className={css.blk}>
          <div className={css.blkTitle}>{t('cm.currentState')}{t('cm.currentAt', { n: String(cursor ?? maxChapter) })}</div>
          <FieldRow label={t('cm.where')} value={current.currentState.where} onSave={value => saveField(props, shell, workId, current, 'currentState', { ...current.currentState, where: value })} />
          <FieldRow label={t('cm.state')} value={current.currentState.state} onSave={value => saveField(props, shell, workId, current, 'currentState', { ...current.currentState, state: value })} />
          <FieldRow label={t('cm.concern')} value={current.currentState.concern} onSave={value => saveField(props, shell, workId, current, 'currentState', { ...current.currentState, concern: value })} />
        </div>
        <div className={css.blk}>
          <div className={css.blkTitle}>{t('cm.experiences')}</div>
          {shown.length === 0 ? (
            <div className={css.fieldRow}><span className={css.fieldLabel}>{t('cm.noExperiences')}</span></div>
          ) : (
            shown.map((entry, index) => (
              <div key={entry.id ?? index} className={css.exp}>
                <span className={css.expChap}>{t('reader.chapterN', { n: String(entry.chapter) })}</span>
                {entry.entry}
                {entry.autoImported === true && entry.id !== undefined && sessionId !== undefined && (
                  <button type="button" className={css.expAuto} title={t('cm.autoTitle')} onClick={() => { retract(entry.id!) }}>
                    {t('cm.auto')}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
        <div className={css.blk}>
          <div className={css.blkTitle}>{t('cm.core')}</div>
          <FieldRow label={t('cm.want')} value={current.core.want} onSave={value => saveField(props, shell, workId, current, 'core', { ...current.core, want: value })} />
          <FieldRow label={t('cm.lack')} value={current.core.lack} onSave={value => saveField(props, shell, workId, current, 'core', { ...current.core, lack: value })} />
          <FieldRow label={t('cm.wound')} value={current.core.wound} onSave={value => saveField(props, shell, workId, current, 'core', { ...current.core, wound: value })} />
        </div>
        <div className={css.blk}>
          <div className={css.blkTitle}>{t('cm.knowledge')}</div>
          <ListFieldRow label={t('cm.knows')} values={current.knowledge.knows} onSave={values => saveField(props, shell, workId, current, 'knowledge', { ...current.knowledge, knows: values })} />
          <ListFieldRow label={t('cm.unaware')} values={current.knowledge.unaware} onSave={values => saveField(props, shell, workId, current, 'knowledge', { ...current.knowledge, unaware: values })} />
          <ListFieldRow label={t('cm.secrets')} values={current.knowledge.secrets} onSave={values => saveField(props, shell, workId, current, 'knowledge', { ...current.knowledge, secrets: values })} />
        </div>
        <div className={css.blk}>
          <div className={css.blkTitle}>{t('cm.relationships')}</div>
          {current.relationships.length === 0 ? (
            <div className={css.fieldRow}><span className={css.fieldLabel}>—</span></div>
          ) : (
            current.relationships.map((rel, index) => (
              <div key={index} className={css.relRow}>
                {rel.target} · {rel.description}
                {rel.changes.length > 0 && (
                  <span className={css.relDelta}>▲ {rel.changes.map(change => `${t('reader.chapterN', { n: String(change.chapter) })}${change.note}`).join('；')}</span>
                )}
              </div>
            ))
          )}
        </div>
        <div className={css.blk}>
          <div className={css.blkTitle}>{t('cm.profile')}</div>
          <FieldRow label={t('field.voice')} value={current.profile.voice} onSave={value => saveField(props, shell, workId, current, 'profile', { ...current.profile, voice: value })} />
          <FieldRow label={t('sets.edit')} value={current.profile.appearance} onSave={value => saveField(props, shell, workId, current, 'profile', { ...current.profile, appearance: value })} />
        </div>
      </div>
    </div>
  )
}

/** Save one character block field (writeCharacter patch), with the shared toast/touch. */
function saveField(
  props: StoryTabProps,
  shell: WorkShell,
  workId: string,
  character: CharacterRecord,
  block: 'profile' | 'core' | 'knowledge' | 'currentState',
  value: unknown,
): void {
  const sessionId = props.sessionId
  if (sessionId === undefined) return
  void (async () => {
    const result = await shell.run(() => props.writeCharacter(sessionId, {
      workId,
      id: character.id,
      name: character.name,
      [block]: value,
    } as never))
    if (result === null) return
    if (!result.ok) {
      shell.showToast(shell.errorText(result.error))
      return
    }
    props.refresh()
    shell.showToast(props.t('toast.characterSaved'))
  })()
}

/** One single-line field row with inline edit. */
function FieldRow({ label, value, onSave }: {
  label: string
  value: string | undefined
  onSave: (value: string | undefined) => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  if (editing) {
    return (
      <div className={css.fieldRow}>
        <span className={css.fieldLabel}>{label}</span>
        <input
          className={css.editLine}
          autoFocus
          value={draft}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              const trimmed = draft.trim()
              onSave(trimmed.length === 0 ? undefined : trimmed)
              setEditing(false)
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              setDraft(value ?? '')
              setEditing(false)
            }
          }}
        />
      </div>
    )
  }
  return (
    <div className={css.fieldRow}>
      <span className={css.fieldLabel}>{label}</span>
      {value ?? '—'}
      <button type="button" className={css.fieldEdit} aria-label={label} onClick={() => { setDraft(value ?? ''); setEditing(true) }}>✎</button>
    </div>
  )
}

/** One string-list field row (edited as one 顿号/逗号-joined line). */
function ListFieldRow({ label, values, onSave }: {
  label: string
  values: readonly string[]
  onSave: (values: readonly string[]) => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(values.join('、'))
  if (editing) {
    return (
      <div className={css.fieldRow}>
        <span className={css.fieldLabel}>{label}</span>
        <input
          className={css.editLine}
          autoFocus
          value={draft}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              onSave(draft.split(/[、,，;；]/).map(part => part.trim()).filter(part => part.length > 0))
              setEditing(false)
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              setDraft(values.join('、'))
              setEditing(false)
            }
          }}
        />
      </div>
    )
  }
  return (
    <div className={css.fieldRow}>
      <span className={css.fieldLabel}>{label}</span>
      {values.length === 0 ? '—' : values.join('、')}
      <button type="button" className={css.fieldEdit} aria-label={label} onClick={() => { setDraft(values.join('、')); setEditing(true) }}>✎</button>
    </div>
  )
}
