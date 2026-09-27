/**
 * 看题 and 看判官 (T84 §三/§四): the item-materials drawer and the judge
 * prompt, before and after a run.
 *
 * The drawer reads the dataset at the commit the experiment pins — never the
 * worktree's HEAD — and sorts every file into who reads it: 题面 and 阶段说明
 * go to the player, 判据's judge group goes to the judge, 检查脚本 run after
 * the player hands in, 参考材料 are for people only.
 *
 * The judge prompt is view-only: before a run, a preview built by the same
 * code the run uses (only the player's material is a placeholder); after a
 * run, the prompt.md each judge sample actually received.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalDatasetFileRequest,
  EvalDatasetFileView,
  EvalItemMaterialFile,
  EvalItemMaterialTab,
  EvalItemMaterialsView,
  EvalItemRubricRow,
  EvalJudgePromptPreviewView,
  EvalJudgePromptView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { MarkdownDoc } from './MarkdownDoc.tsx'
import { Chip, Seg2 } from './parts.tsx'
import css from './LabView.module.css'

/** A remote answer, flattened for the page. */
export type Answer<T> = { ok: true; value: T } | { ok: false; message: string }

/** What the design page needs to open an item and preview its judge prompt. */
export interface ItemInspectFaces {
  materials: (item: string) => Promise<Answer<EvalItemMaterialsView>>
  file: (request: Omit<EvalDatasetFileRequest, 'experimentId'>) => Promise<Answer<EvalDatasetFileView>>
  /** Null when the host half is older than the preview. */
  preview: ((item: string, judge: string | null) => Promise<Answer<EvalJudgePromptPreviewView>>) | null
}

const TABS: readonly EvalItemMaterialTab[] = ['task', 'stages', 'rubric', 'probes', 'reference']

/**
 * The side sheet: a fixed right overlay over a dimmed page; Escape and the
 * backdrop close it; a phone-width screen gets the whole page.
 * @param props - the title, the quiet line under it, the body, the close.
 */
export function Sheet(props: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; t: LabViewProps['t'] }) {
  const { title, sub, onClose, children, t } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div className={css.sheetLayer}>
      <div className={css.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={css.sheet} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className={css.sheetHead}>
          <div className={css.sheetTitles}>
            <div className={css.sheetTitle}>{title}</div>
            {sub !== undefined && <div className={css.sheetSub}>{sub}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('inspect.close')}</Button>
        </header>
        <div className={css.sheetBody}>{children}</div>
      </aside>
    </div>
  )
}

/** A file's name without its directories. */
function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** The body of one file: rendered markdown, or the text as it is. */
function FileBody(props: { view: EvalDatasetFileView; t: LabViewProps['t'] }) {
  const { view, t } = props
  if (view.text === null) return <div className={css.dim}>{view.note ?? t('inspect.binary')}</div>
  return (
    <>
      {view.path.endsWith('.md')
        ? <MarkdownDoc text={view.text} banner={baseName(view.path)} t={t} />
        : <pre className={css.inspectPre}>{view.text}</pre>}
      {view.truncated && <div className={css.dim}>{view.note}</div>}
    </>
  )
}

/** The file list of one tab and the file it has open. */
function FilesTab(props: {
  files: readonly EvalItemMaterialFile[]
  item: string
  read: ItemInspectFaces['file']
  t: LabViewProps['t']
}) {
  const { files, item, read, t } = props
  const [pick, setPick] = useState<EvalItemMaterialFile | null>(files[0] ?? null)
  const [view, setView] = useState<Answer<EvalDatasetFileView> | null>(null)
  useEffect(() => {
    setPick(files[0] ?? null)
  }, [files])
  useEffect(() => {
    if (pick === null) return
    let live = true
    setView(null)
    void read({ item: pick.source === 'item' ? item : null, source: pick.source, layer: pick.layer, path: pick.path })
      .then((answer) => { if (live) setView(answer) })
    return () => { live = false }
  }, [pick, item, read])
  if (files.length === 0) return <div className={css.dim}>{t('inspect.empty')}</div>
  return (
    <div className={css.inspectSplit}>
      <ul className={css.inspectList}>
        {files.map(file => (
          <li key={`${file.source}:${file.layer}:${file.path}`}>
            <button
              type="button"
              className={css.inspectFile}
              aria-current={pick === file ? 'true' : undefined}
              title={file.source === 'passthrough' ? file.path : `${file.layer}/${file.path}`}
              onClick={() => { setPick(file) }}
            >
              <span className={css.mono}>{file.path}</span>
              {file.source !== 'item' && <span className={css.inspectTag}>{t('inspect.shared')}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className={css.inspectContent}>
        {pick === null
          ? <div className={css.dim}>{t('inspect.pick')}</div>
          : view === null
            ? <div className={css.dim}>{t('inspect.loading')}</div>
            : view.ok
              ? <FileBody view={view.value} t={t} />
              : <div className={css.dim}>{`${t('inspect.error')}：${view.message}`}</div>}
      </div>
    </div>
  )
}

const KIND_ORDER = ['llm-draft', 'human', 'objective'] as const

/** The 判据 tab: the rubric grouped by who scores it, or its raw text. */
function RubricTab(props: {
  rubric: EvalItemMaterialsView['rubric']
  item: string
  read: ItemInspectFaces['file']
  t: LabViewProps['t']
}) {
  const { rubric, item, read, t } = props
  const [raw, setRaw] = useState<'grouped' | 'raw'>('grouped')
  const [text, setText] = useState<Answer<EvalDatasetFileView> | null>(null)
  useEffect(() => {
    if (raw !== 'raw' || rubric === null || text !== null) return
    const path = rubric.path.replace(/^grading\//, '')
    void read({ item, source: 'item', layer: 'grading', path }).then(setText)
  }, [raw, rubric, item, read, text])
  if (rubric === null) return <div className={css.dim}>{t('inspect.rubric.none')}</div>
  const out = rubric.rows.filter(row => !row.inScope).length
  const groups = new Map<string, EvalItemRubricRow[]>()
  for (const row of rubric.rows) {
    const kind = (KIND_ORDER as readonly string[]).includes(row.kind ?? '') ? (row.kind as string) : 'other'
    groups.set(kind, [...(groups.get(kind) ?? []), row])
  }
  return (
    <div className={css.inspectRubric}>
      <div className={css.inspectBar}>
        <span className={css.dim}>{t('inspect.rubric.summary', { n: rubric.rows.length, out })}</span>
        <Seg2
          label={t('inspect.rubric.view')}
          options={[{ value: 'grouped', label: t('inspect.rubric.grouped') }, { value: 'raw', label: t('inspect.rubric.raw') }]}
          value={raw}
          onChange={setRaw}
        />
      </div>
      {raw === 'raw'
        ? (text === null
            ? <div className={css.dim}>{t('inspect.loading')}</div>
            : text.ok ? <FileBody view={text.value} t={t} /> : <div className={css.dim}>{`${t('inspect.error')}：${text.message}`}</div>)
        : [...KIND_ORDER, 'other'].filter(kind => groups.has(kind)).map(kind => (
            <section key={kind} className={css.rubricGroup} data-kind={kind}>
              <h6 className={css.rubricGroupTitle}>{t(`inspect.rubric.kind.${kind}` as EvalKey, { n: groups.get(kind)?.length ?? 0 })}</h6>
              <table className={css.rubricTable}>
                <tbody>
                  {(groups.get(kind) ?? []).map(row => (
                    <tr key={row.id} data-out={row.inScope ? undefined : ''}>
                      <td className={css.mono}>{row.id}</td>
                      <td className={css.num}>{row.weight ?? '—'}</td>
                      <td>
                        <div>{row.criterion ?? '—'}</div>
                        {row.evidence !== null && <div className={css.rubricEvidence}>{row.evidence}</div>}
                      </td>
                      <td className={css.rubricChips}>
                        {row.veto && <Chip tone="danger">{t('inspect.rubric.veto')}</Chip>}
                        {row.stages !== null && <span className={css.dim}>{t('inspect.rubric.stages', { stages: row.stages.join('、') })}</span>}
                        {!row.inScope && <Chip tone="warn">{t('inspect.rubric.out')}</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
    </div>
  )
}

/**
 * The item drawer: five tabs over the pinned dataset.
 * @param props - the item, the faces, the close.
 */
export function ItemDrawer(props: { item: string; faces: ItemInspectFaces; onClose: () => void; t: LabViewProps['t'] }) {
  const { item, faces, onClose, t } = props
  const [tab, setTab] = useState<EvalItemMaterialTab>('task')
  const [view, setView] = useState<Answer<EvalItemMaterialsView> | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void faces.materials(item).then((answer) => { if (live) setView(answer) })
    return () => { live = false }
  }, [item, faces])
  const value = view?.ok === true ? view.value : null
  const sub = value === null ? undefined : t('inspect.pinned', { dataset: value.dataset, commit: value.commit.slice(0, 8) })
  const counts = (key: EvalItemMaterialTab): number => key === 'rubric'
    ? (value?.rubric?.rows.length ?? 0)
    : (value?.files.filter(file => file.tab === key).length ?? 0)
  const stagesWho = value === null
    ? ''
    : t('inspect.who.stages', {
      stages: (value.runStages ?? value.phases).join('、') || '—',
    })
  const who: Record<EvalItemMaterialTab, string> = {
    task: t('inspect.who.task'),
    stages: stagesWho,
    rubric: t('inspect.who.rubric'),
    probes: t('inspect.who.probes'),
    reference: t('inspect.who.reference'),
  }
  return (
    <Sheet title={t('inspect.title', { item })} sub={sub} onClose={onClose} t={t}>
      {view === null && <div className={css.dim}>{t('inspect.loading')}</div>}
      {view !== null && !view.ok && <div className={css.dim}>{`${t('inspect.error')}：${view.message}`}</div>}
      {value !== null && (
        <>
          <div className={css.inspectTabs}>
            <Seg2
              label={t('inspect.tabs')}
              options={TABS.map(key => ({ value: key, label: `${t(`inspect.tab.${key}` as EvalKey)} ${String(counts(key))}` }))}
              value={tab}
              onChange={setTab}
            />
          </div>
          <div className={css.inspectWho} data-tab={tab}>{who[tab]}</div>
          {tab === 'stages' && value.runStages !== null && value.phases.some(stage => !(value.runStages ?? []).includes(stage)) && (
            <div className={css.dim}>
              {value.phases.filter(stage => !(value.runStages ?? []).includes(stage)).map(stage => `${stage} · ${t('inspect.skipped')}`).join('　')}
            </div>
          )}
          {tab === 'rubric'
            ? <RubricTab rubric={value.rubric} item={item} read={faces.file} t={t} />
            : <FilesTab files={value.files.filter(file => file.tab === tab)} item={item} read={faces.file} t={t} />}
          {value.notes.length > 0 && <div className={css.scaleNote}>{value.notes.join(' · ')}</div>}
        </>
      )}
    </Sheet>
  )
}

/** The three parts of a judge prompt, split on its own headings. */
export interface PromptPart {
  kind: 'fixed' | 'criteria' | 'materials' | 'output'
  text: string
}

/**
 * Split a judge prompt into what eval fixes, what the rubric brings, what the
 * run fills in, and the output rules — by the headings `buildJudgePrompt`
 * writes. A prompt without them stays one fixed block.
 * @param text - the prompt.
 */
export function promptParts(text: string): PromptPart[] {
  const lines = text.split('\n')
  const at = (prefix: string): number => lines.findIndex(line => line.startsWith(prefix))
  const marks: Array<{ kind: PromptPart['kind']; line: number }> = [
    { kind: 'fixed' as const, line: 0 },
    { kind: 'criteria' as const, line: at('## 判据') },
    { kind: 'materials' as const, line: at('## 材料') },
    { kind: 'output' as const, line: at('## 输出要求') },
  ].filter(mark => mark.line >= 0).sort((a, b) => a.line - b.line)
  return marks.map((mark, index) => ({
    kind: mark.kind,
    text: lines.slice(mark.line, marks[index + 1]?.line ?? lines.length).join('\n').replace(/\n+$/, ''),
  })).filter(part => part.text.trim() !== '')
}

/** The prompt in labelled blocks. */
function PromptBlocks(props: { text: string; criteriaLabel: string; t: LabViewProps['t'] }) {
  const { text, criteriaLabel, t } = props
  const label = (kind: PromptPart['kind']): string => kind === 'criteria'
    ? criteriaLabel
    : kind === 'materials' ? t('judgePrompt.part.materials') : kind === 'output' ? t('judgePrompt.part.output') : t('judgePrompt.part.fixed')
  return (
    <div className={css.promptBlocks}>
      {promptParts(text).map(part => (
        <section key={part.kind} className={css.promptPart} data-kind={part.kind}>
          <div className={css.promptLabel}>{label(part.kind)}</div>
          <pre className={css.inspectPre}>{part.text}</pre>
        </section>
      ))}
    </div>
  )
}

/**
 * 判官看到什么 and the pre-run prompt preview, under 怎么判.
 * @param props - the items and judges to choose from, and the preview face.
 */
export function JudgePromptPreview(props: {
  items: readonly string[]
  judges: readonly string[]
  preview: NonNullable<ItemInspectFaces['preview']>
  t: LabViewProps['t']
}) {
  const { items, judges, preview, t } = props
  const [open, setOpen] = useState(false)
  const [item, setItem] = useState(items[0] ?? '')
  const [judge, setJudge] = useState<string | null>(judges[0] ?? null)
  const [view, setView] = useState<Answer<EvalJudgePromptPreviewView> | null>(null)
  useEffect(() => {
    if (!open || item === '') return
    let live = true
    setView(null)
    void preview(item, judge).then((answer) => { if (live) setView(answer) })
    return () => { live = false }
  }, [open, item, judge, preview])
  const value = view?.ok === true ? view.value : null
  return (
    <div className={css.judgeSees}>
      <div className={css.judgeSeesLine}>
        <span className={css.judgeSeesKey}>{t('judgeSees.label')}</span>
        <span>{t('judgeSees.text')}</span>
      </div>
      <div className={css.drawerActions}>
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => { setOpen(!open) }} disabled={items.length === 0}>
          {open ? t('judgePrompt.close') : t('judgePrompt.open')}
        </Button>
        {open && (
          <>
            <label className={css.dim}>
              {t('judgePrompt.item')}{' '}
              <select className={css.select} value={item} onChange={(e) => { setItem(e.target.value) }}>
                {items.map(each => <option key={each} value={each}>{each}</option>)}
              </select>
            </label>
            {judges.length > 1 && (
              <label className={css.dim}>
                {t('judgePrompt.judge')}{' '}
                <select className={css.select} value={judge ?? ''} onChange={(e) => { setJudge(e.target.value) }}>
                  {judges.map(each => <option key={each} value={each}>{each}</option>)}
                </select>
              </label>
            )}
          </>
        )}
      </div>
      {open && view === null && <div className={css.dim}>{t('inspect.loading')}</div>}
      {open && view !== null && !view.ok && <div className={css.dim}>{`${t('inspect.error')}：${view.message}`}</div>}
      {open && value !== null && (
        <>
          <div className={css.dim}>{value.note ?? t('judgePrompt.previewNote')}</div>
          {value.outOfScope.length > 0 && (
            <div className={css.stageScope} data-partial="">
              {t('judgePrompt.outOfScope', { n: value.outOfScope.length, ids: value.outOfScope.join('、') })}
            </div>
          )}
          <PromptBlocks
            text={value.prompt}
            criteriaLabel={t('judgePrompt.part.criteria', { path: 'rubric.yml', dataset: '', commit: value.commit.slice(0, 8) })}
            t={t}
          />
        </>
      )}
    </div>
  )
}

/**
 * The prompt.md a cell's judge actually received, with a judge/sample picker.
 * @param props - the cell, the read, the close.
 */
export function JudgePromptSheet(props: {
  cell: { runId: string; missionId: string; attempt: number; label: string }
  read: (judge: string | null, sample: string | null) => Promise<Answer<EvalJudgePromptView>>
  onClose: () => void
  t: LabViewProps['t']
}) {
  const { cell, read, onClose, t } = props
  const [pick, setPick] = useState<{ judge: string; sample: string } | null>(null)
  const [view, setView] = useState<Answer<EvalJudgePromptView> | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void read(pick?.judge ?? null, pick?.sample ?? null).then((answer) => { if (live) setView(answer) })
    return () => { live = false }
  }, [pick, read])
  const value = view?.ok === true ? view.value : null
  const key = (s: { judge: string; sample: string }): string => `${s.judge}/${s.sample}`
  return (
    <Sheet title={t('judgePrompt.actualTitle', { cell: cell.label })} sub={`${cell.runId} · ${cell.missionId} · attempt ${String(cell.attempt)}`} onClose={onClose} t={t}>
      {view === null && <div className={css.dim}>{t('inspect.loading')}</div>}
      {view !== null && !view.ok && <div className={css.dim}>{`${t('inspect.error')}：${view.message}`}</div>}
      {value !== null && (
        <>
          {value.samples.length > 1 && (
            <label className={css.dim}>
              {t('judgePrompt.sample')}{' '}
              <select
                className={css.select}
                value={value.judge !== null && value.sample !== null ? `${value.judge}/${value.sample}` : ''}
                onChange={(e) => { setPick(value.samples.find(s => key(s) === e.target.value) ?? null) }}
              >
                {value.samples.map(s => <option key={key(s)} value={key(s)}>{key(s)}</option>)}
              </select>
            </label>
          )}
          {value.text === null
            ? <div className={css.dim}>{value.note ?? t('inspect.empty')}</div>
            : (
                <>
                  <PromptBlocks text={value.text} criteriaLabel={t('judgePrompt.part.criteriaRun')} t={t} />
                  {value.truncated && <div className={css.dim}>{value.note}</div>}
                </>
              )}
        </>
      )}
    </Sheet>
  )
}
