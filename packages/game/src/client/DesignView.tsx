/**
 * 策划: the living design doc. The one-pager and the pillars sit pinned on
 * top (every later idea is weighed against them); the chapters fold below,
 * each with its status, a 刚更新 mark when it changed since the user last
 * opened it, and in-place editing (the user's words win — the agent reads
 * the file). 元素与数值 is drawn from the element files with a bar chart per
 * number; 试玩记录 is the log the plugin keeps.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { artStyleLabel } from '../project.ts'
import type { ChapterView, ElementView, ProjectView } from '../types.ts'
import { failureOf, type ViewProps } from './contract.ts'
import { Markdown } from './markdown.tsx'
import css from './GameTab.module.css'

/** Props of the design view. */
export interface DesignViewProps extends ViewProps {
  readonly project: ProjectView
  readonly onStyle: () => void
  /** The chapter a jump asked to open. */
  readonly openChapter?: string | null
  readonly onOpenChapter?: (id: string | null) => void
}

const STATUS_KEY = { todo: 'design.todo', draft: 'design.draft', done: 'design.done' } as const

/** Per-project "last seen" times of chapters (localStorage, per viewer). */
function seenKey(projectId: string): string {
  return `dsh-game:seen:${projectId}`
}
function readSeen(projectId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(seenKey(projectId)) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function writeSeen(projectId: string, seen: Record<string, number>): void {
  try {
    localStorage.setItem(seenKey(projectId), JSON.stringify(seen))
  } catch {
    // Per-viewer convenience only.
  }
}

/** The design view. */
export function DesignView(props: DesignViewProps): ReactNode {
  const { t, project } = props
  const manifest = project.manifest
  const [open, setOpen] = useState<string | null>(props.openChapter ?? null)
  useEffect(() => { if (props.openChapter != null) setOpen(props.openChapter) }, [props.openChapter])
  const [seen, setSeen] = useState<Record<string, number>>(() => readSeen(project.id))
  useEffect(() => { setSeen(readSeen(project.id)) }, [project.id])
  const toggle = (chapter: ChapterView): void => {
    setOpen(o => (o === chapter.id ? null : chapter.id))
    const next = { ...seen, [chapter.id]: Date.now() }
    setSeen(next)
    writeSeen(project.id, next)
  }
  const chapters = project.chapters.filter(c => c.id !== 'pillars')
  const pillarsChapter = project.chapters.find(c => c.id === 'pillars')
  const done = project.chapters.filter(c => !c.generated && c.status === 'done').length
  const authored = project.chapters.filter(c => !c.generated).length

  return <div className={css.scroll}>
    <OnePager {...props} />
    {pillarsChapter !== undefined && <section className={`${css.chapter} ${css.notesChapter}`} data-open={open === 'pillars' ? 'true' : 'false'}>
      <button type="button" className={css.chapterHead} aria-expanded={open === 'pillars'} onClick={() => { toggle(pillarsChapter) }}>
        <span className={css.chevron} aria-hidden="true">{open === 'pillars' ? '▾' : '▸'}</span>
        <span className={css.chapterTitle}>{pillarsChapter.title}</span>
        <span className={css.metaLine}>{t('design.pillarNotesHint')}</span>
        <span className={css.spacer} />
        <span className={css.status} data-status={pillarsChapter.status}>{t(STATUS_KEY[pillarsChapter.status])}</span>
      </button>
      {open === 'pillars' && <ChapterBody {...props} chapter={pillarsChapter} />}
    </section>}

    <div className={css.progressRow}>
      <span className={css.metaLine}>{t('design.progress', { done, total: authored })}</span>
      <span className={css.progressBar}><span style={{ width: `${authored === 0 ? 0 : done / authored * 100}%` }} /></span>
    </div>

    <div className={css.chapters}>
      {chapters.map(c => {
        const fresh = c.mtime > 0 && c.text !== '' && c.mtime > (seen[c.id] ?? 0) && Date.now() - c.mtime < 1000 * 60 * 60 * 24 * 7
        const isOpen = open === c.id
        return <section key={c.id} className={css.chapter} data-open={isOpen ? 'true' : 'false'}>
          <button type="button" className={css.chapterHead} aria-expanded={isOpen} onClick={() => { toggle(c) }}>
            <span className={css.chevron} aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            <span className={css.chapterTitle}>{c.title}</span>
            {fresh && <span className={css.freshTag}>{t('design.fresh')}</span>}
            <span className={css.spacer} />
            <span className={css.status} data-status={c.generated ? 'generated' : c.status}>
              {c.generated ? t('design.generated') : t(STATUS_KEY[c.status])}
            </span>
          </button>
          {isOpen && (c.id === 'elements'
            ? <NumbersChapter t={t} elements={project.elements} types={manifest?.elementTypes ?? []} />
            : <ChapterBody {...props} chapter={c} />)}
        </section>
      })}
    </div>
  </div>
}

/** The one-pager (game.json): pitch, element types, style, pillars — read, or edited in place. */
function OnePager(props: DesignViewProps): ReactNode {
  const { t, sessionId, api, project, onStyle, refresh } = props
  const manifest = project.manifest
  const [editing, setEditing] = useState(false)
  const [pitch, setPitch] = useState('')
  const [types, setTypes] = useState('')
  const [pillars, setPillars] = useState('')
  const [error, setError] = useState<string | null>(null)
  const begin = (): void => {
    setPitch(manifest?.pitch ?? '')
    setTypes((manifest?.elementTypes ?? []).join('、'))
    setPillars((manifest?.pillars ?? []).join('\n'))
    setError(null)
    setEditing(true)
  }
  return <section className={css.onePager}>
    <div className={css.onePagerHead}>
      <span className={css.eyebrow}>{t('design.onePager')}</span>
      <span className={css.metaLine}>game.json</span>
      <span className={css.spacer} />
      <button type="button" className={css.styleChip} onClick={onStyle} title={t('style.change')}>
        {t('design.style', { style: manifest === null ? '—' : artStyleLabel(manifest.artStyle) })}
      </button>
      {!editing && manifest !== null && <button type="button" className={css.ghost} onClick={begin}>{t('design.editOnePager')}</button>}
    </div>
    {editing
      ? <div className={css.onePagerForm}>
          <label className={css.field}><span className={css.fieldKey}>{t('design.pitchLabel')}</span>
            <textarea className={css.textarea} rows={2} value={pitch} onChange={e => { setPitch(e.target.value) }} /></label>
          <label className={css.field}><span className={css.fieldKey}>{t('design.typesLabel')}</span>
            <input className={css.input} value={types} onChange={e => { setTypes(e.target.value) }} /></label>
          <label className={css.field}><span className={css.fieldKey}>{t('design.pillarsLabel')}</span>
            <textarea className={css.textarea} rows={4} value={pillars} onChange={e => { setPillars(e.target.value) }} /></label>
          {error !== null && <p className={css.warnText}>{error}</p>}
          <div className={css.rowEnd}>
            <button type="button" className={css.ghost} onClick={() => { setEditing(false) }}>{t('common.cancel')}</button>
            <button type="button" className={css.primary} onClick={() => {
              void api.setOnePager(sessionId, project.id, { pitch, elementTypes: types, pillars }).then(r => {
                if (failureOf(r) !== undefined) { setError(t('design.onePagerInvalid')); return }
                setEditing(false)
                refresh()
              })
            }}>{t('common.save')}</button>
          </div>
        </div>
      : <>
          <p className={css.pitch}>{manifest?.pitch || t('design.noPitch')}</p>
          <div className={css.typeRow}>{(manifest?.elementTypes ?? []).map(type => <span key={type} className={css.typeTag}>{type}</span>)}</div>
          <div className={css.pillars}>
            <span className={css.eyebrow}>{t('design.pillars')}</span>
            {(manifest?.pillars.length ?? 0) > 0
              ? <ol className={css.pillarList}>{manifest!.pillars.map((p, i) => <li key={i}>{p}</li>)}</ol>
              : <p className={css.metaLine}>{t('design.noPillars')}</p>}
          </div>
        </>}
  </section>
}

/** One chapter's body: read, or edit in place. */
function ChapterBody(props: DesignViewProps & { chapter: ChapterView }): ReactNode {
  const { t, sessionId, api, project, chapter, refresh } = props
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(chapter.text)
  useEffect(() => { if (!editing) setText(chapter.text) }, [chapter.text, editing])
  if (editing) {
    return <div className={css.chapterBody}>
      <textarea className={css.textarea} rows={Math.min(18, Math.max(6, text.split('\n').length + 1))} value={text} onChange={e => { setText(e.target.value) }} />
      <div className={css.rowEnd}>
        <span className={css.metaLine}>{t('design.editNote')}</span>
        <span className={css.spacer} />
        <button type="button" className={css.ghost} onClick={() => { setEditing(false); setText(chapter.text) }}>{t('common.cancel')}</button>
        <button type="button" className={css.primary} onClick={() => {
          void api.writeChapter(sessionId, project.id, chapter.id, text).then(r => {
            if (failureOf(r) === undefined) {
              setEditing(false)
              refresh()
            }
          })
        }}>{t('common.save')}</button>
      </div>
    </div>
  }
  return <div className={css.chapterBody}>
    {chapter.text === ''
      ? <p className={css.lead}>{chapter.generated ? t('design.emptyGenerated') : chapter.id === 'pillars' ? t('design.pillarNotesEmpty') : t('design.empty', { file: chapter.file })}</p>
      : <Markdown text={chapter.text} />}
    {!chapter.generated && <div className={css.rowEnd}>
      <span className={css.metaLine}>{chapter.file}</span>
      <span className={css.spacer} />
      <button type="button" className={css.ghost} onClick={() => { setEditing(true) }}>{t('design.edit')}</button>
    </div>}
  </div>
}

/** 元素与数值: one table per type plus a bar chart per numeric column. */
function NumbersChapter({ t, elements, types }: { t: ViewProps['t']; elements: readonly ElementView[]; types: readonly string[] }): ReactNode {
  const groups = useMemo(() => {
    const all = [...types, ...elements.map(e => e.type).filter(type => !types.includes(type))]
    return [...new Set(all)].map(type => ({ type, rows: elements.filter(e => e.type === type) })).filter(g => g.rows.length > 0)
  }, [elements, types])
  if (groups.length === 0) return <div className={css.chapterBody}><p className={css.lead}>{t('design.emptyGenerated')}</p></div>
  return <div className={css.chapterBody}>
    <p className={css.metaLine}>{t('design.numbersNote')}</p>
    {groups.map(({ type, rows }) => {
      const keys = [...new Set(rows.flatMap(e => Object.keys(e.stats)))].slice(0, 6)
      const numeric = keys.filter(k => rows.filter(e => typeof e.stats[k] === 'number').length >= 2)
      return <div key={type} className={css.numbers}>
        <h5 className={css.numbersTitle}>{type}<span className={css.count}>{rows.length}</span></h5>
        <div className={css.tableWrap}><table className={css.table}>
          <thead><tr><th>{t('elements.name')}</th>{keys.map(k => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>{rows.map(e => <tr key={e.id}><td>{e.name}</td>{keys.map(k => <td key={k}>{String(e.stats[k] ?? '')}</td>)}</tr>)}</tbody>
        </table></div>
        {numeric.slice(0, 2).map(k => {
          const max = Math.max(...rows.map(e => (typeof e.stats[k] === 'number' ? Math.abs(e.stats[k] as number) : 0)), 1e-9)
          return <div key={k} className={css.bars} aria-label={t('design.chart', { key: k })}>
            <span className={css.barsKey}>{k}</span>
            {rows.map(e => {
              const v = typeof e.stats[k] === 'number' ? e.stats[k] as number : 0
              return <div key={e.id} className={css.barRow}>
                <span className={css.barName}>{e.name}</span>
                <span className={css.barTrack}><span className={css.barFill} style={{ width: `${Math.abs(v) / max * 100}%` }} /></span>
                <span className={css.barValue}>{v}</span>
              </div>
            })}
          </div>
        })}
      </div>
    })}
  </div>
}
