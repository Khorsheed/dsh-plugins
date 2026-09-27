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
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
 * One tab's files, the one a reader opens first on top: task.md on 题面,
 * then markdown before data, the item's own before the set's.
 */
export function tabFiles(files: readonly EvalItemMaterialFile[], tab: EvalItemMaterialTab): EvalItemMaterialFile[] {
  const rank = (file: EvalItemMaterialFile): number =>
    (/(^|\/)task\.md$/.test(file.path) ? 0 : 10) + (file.path.endsWith('.md') ? 0 : 1) + (file.source === 'item' ? 0 : 2)
  return files.filter(file => file.tab === tab).map((file, index) => ({ file, index }))
    .sort((a, b) => rank(a.file) - rank(b.file) || a.index - b.index).map(entry => entry.file)
}

/**
 * The fallback container (T85 §2.7): a fixed right overlay over a dimmed
 * page; Escape and the backdrop close it; a phone-width screen gets the
 * whole page. The pane inside draws its own header, as it does in the host
 * sidebar.
 * @param props - the accessible name, the body, the close.
 */
export function SheetFrame(props: { label: string; onClose: () => void; children: ReactNode }) {
  const { label, onClose, children } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div className={css.sheetLayer}>
      <div className={css.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={css.sheet} role="dialog" aria-modal="true" aria-label={label}>
        {children}
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
 * An item's materials: five tabs over the pinned dataset. The tab is the
 * container's (a sidebar keeps it in its stack across reloads).
 * @param props - the item, the faces, the open tab, and where the source line goes.
 */
export function ItemMaterials(props: {
  item: string
  faces: ItemInspectFaces
  tab: EvalItemMaterialTab
  onTab: (tab: EvalItemMaterialTab) => void
  onSub: (sub: string | null) => void
  t: LabViewProps['t']
}) {
  const { item, faces, tab, onTab: setTab, onSub, t } = props
  const [view, setView] = useState<Answer<EvalItemMaterialsView> | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void faces.materials(item).then((answer) => { if (live) setView(answer) })
    return () => { live = false }
  }, [item, faces])
  const value = view?.ok === true ? view.value : null
  const shownFiles = useMemo(() => (value === null ? [] : tabFiles(value.files, tab)), [value, tab])
  const sub = value === null ? null : t('inspect.pinned', { dataset: value.dataset, commit: value.commit.slice(0, 8) })
  useEffect(() => { onSub(sub) }, [sub, onSub])
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
    <>
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
            : <FilesTab files={shownFiles} item={item} read={faces.file} t={t} />}
          {value.notes.length > 0 && <div className={css.scaleNote}>{value.notes.join(' · ')}</div>}
        </>
      )}
    </>
  )
}

/** A piece of prompt: literal text, or the slot a material file fills at run time. */
export type PromptPiece = { kind: 'text'; text: string } | { kind: 'material'; path: string }

/** The parts of a judge prompt, split on its own headings. */
export interface PromptPart {
  kind: 'fixed' | 'criteria' | 'materials' | 'output'
  pieces: PromptPiece[]
}

const PART_HEADINGS: ReadonlyArray<[PromptPart['kind'], string]> = [['criteria', '## 判据'], ['materials', '## 材料'], ['output', '## 输出要求']]

/**
 * Split a judge prompt into what eval fixes, what the rubric brings, what the
 * run fills in, and the output rules — by the headings `buildJudgePrompt`
 * writes. A prompt without them stays one fixed block. Material slots (the
 * pre-run preview's segments) stay slots, never text.
 * @param prompt - the prompt text, or the preview's segments.
 */
export function promptParts(prompt: string | readonly PromptPiece[]): PromptPart[] {
  const pieces: readonly PromptPiece[] = typeof prompt === 'string' ? [{ kind: 'text', text: prompt }] : prompt
  // One entry per line; a slot is one entry of its own.
  const lines: PromptPiece[] = pieces.flatMap((piece): PromptPiece[] => piece.kind === 'material'
    ? [piece]
    : piece.text.split('\n').map(line => ({ kind: 'text', text: line })))
  const parts: PromptPart[] = []
  let current: PromptPart = { kind: 'fixed', pieces: [] }
  const close = (): void => {
    const merged: PromptPiece[] = []
    for (const line of current.pieces) {
      const last = merged.at(-1)
      if (line.kind === 'text' && last?.kind === 'text') last.text = `${last.text}\n${line.text}`
      else merged.push(line.kind === 'text' ? { ...line } : line)
    }
    const kept = merged
      .map(piece => (piece.kind === 'text' ? { ...piece, text: piece.text.replace(/^\n+|\n+$/g, '') } : piece))
      .filter(piece => piece.kind === 'material' || piece.text.trim() !== '')
    if (kept.length > 0) parts.push({ kind: current.kind, pieces: kept })
  }
  for (const line of lines) {
    const heading = line.kind === 'text' ? PART_HEADINGS.find(([, prefix]) => line.text.startsWith(prefix)) : undefined
    if (heading !== undefined) {
      close()
      current = { kind: heading[0], pieces: [] }
    }
    current.pieces.push(line)
  }
  close()
  return parts
}

/** The prompt in labelled blocks; a material slot is a label, outside any fence. */
function PromptBlocks(props: { prompt: string | readonly PromptPiece[]; criteriaLabel: string; t: LabViewProps['t'] }) {
  const { prompt, criteriaLabel, t } = props
  const label = (kind: PromptPart['kind']): string => kind === 'criteria'
    ? criteriaLabel
    : kind === 'materials' ? t('judgePrompt.part.materials') : kind === 'output' ? t('judgePrompt.part.output') : t('judgePrompt.part.fixed')
  return (
    <div className={css.promptBlocks}>
      {promptParts(prompt).map(part => (
        <section key={part.kind} className={css.promptPart} data-kind={part.kind}>
          <div className={css.promptLabel}>{label(part.kind)}</div>
          {part.pieces.map((piece, index) => (piece.kind === 'text'
            ? <pre key={index} className={css.inspectPre}>{piece.text}</pre>
            : (
                <div key={index} className={css.promptSlot} data-material={piece.path}>
                  {t('judgePrompt.slot', { path: piece.path })}
                </div>
              )))}
        </section>
      ))}
    </div>
  )
}

/**
 * 判官看到什么 and the pre-run prompt preview, under 怎么判 — inline, the
 * T84 form (kept for a host half without the sidebar pages' reads).
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
      </div>
      {open && (
        <JudgePromptPreviewBody
          items={items}
          judges={judges}
          item={item}
          judge={judge}
          onPick={(nextItem, nextJudge) => { setItem(nextItem); setJudge(nextJudge) }}
          preview={preview}
          t={t}
        />
      )}
    </div>
  )
}

/**
 * The pre-run prompt with its item / judge pickers — the sidebar page's body
 * and the inline preview's. The choice is the container's.
 * @param props - what to choose from, the choice, and the preview face.
 */
export function JudgePromptPreviewBody(props: {
  items: readonly string[]
  judges: readonly string[]
  item: string
  judge: string | null
  onPick: (item: string, judge: string | null) => void
  preview: NonNullable<ItemInspectFaces['preview']>
  t: LabViewProps['t']
}) {
  const { items, judges, item, judge, onPick, preview, t } = props
  const [view, setView] = useState<Answer<EvalJudgePromptPreviewView> | null>(null)
  useEffect(() => {
    if (item === '') return
    let live = true
    setView(null)
    void preview(item, judge).then((answer) => { if (live) setView(answer) })
    return () => { live = false }
  }, [item, judge, preview])
  const value = view?.ok === true ? view.value : null
  return (
    <>
      <div className={css.drawerActions}>
        <label className={css.dim}>
          {t('judgePrompt.item')}{' '}
          <select className={css.select} value={item} onChange={(e) => { onPick(e.target.value, judge) }}>
            {items.map(each => <option key={each} value={each}>{each}</option>)}
          </select>
        </label>
        {judges.length > 1 && (
          <label className={css.dim}>
            {t('judgePrompt.judge')}{' '}
            <select className={css.select} value={judge ?? ''} onChange={(e) => { onPick(item, e.target.value) }}>
              {judges.map(each => <option key={each} value={each}>{each}</option>)}
            </select>
          </label>
        )}
      </div>
      {view === null && <div className={css.dim}>{t('inspect.loading')}</div>}
      {view !== null && !view.ok && <div className={css.dim}>{`${t('inspect.error')}：${view.message}`}</div>}
      {value !== null && (
        <>
          <div className={css.dim}>{value.note ?? t('judgePrompt.previewNote')}</div>
          {value.outOfScope.length > 0 && (
            <div className={css.stageScope} data-partial="">
              {t('judgePrompt.outOfScope', { n: value.outOfScope.length, ids: value.outOfScope.join('、') })}
            </div>
          )}
          <PromptBlocks
            prompt={value.segments}
            criteriaLabel={t('judgePrompt.part.criteria', { path: 'rubric.yml', dataset: '', commit: value.commit.slice(0, 8) })}
            t={t}
          />
        </>
      )}
    </>
  )
}

/**
 * The prompt.md a cell's judge actually received, with a judge/sample picker.
 * @param props - the read.
 */
export function JudgePromptActual(props: {
  read: (judge: string | null, sample: string | null) => Promise<Answer<EvalJudgePromptView>>
  t: LabViewProps['t']
}) {
  const { read, t } = props
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
    <>
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
                  <PromptBlocks prompt={value.text} criteriaLabel={t('judgePrompt.part.criteriaRun')} t={t} />
                  {value.truncated && <div className={css.dim}>{value.note}</div>}
                </>
              )}
        </>
      )}
    </>
  )
}
