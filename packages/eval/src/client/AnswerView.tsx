/**
 * 作答视图 (I5·T75, ui-spec §五): ONE component for every place an answer is
 * read — the run record's 看作答, the 结果对比 tables, and the 人工评估 page.
 *
 * A 题's groups sit side by side, one row per 次, and the same parts line up
 * across a row: every criterion on its own grid row. Four tabs under the
 * title (T83, v5): 提交的报告 (each column's stage markdown in one card,
 * clamped to about 16 lines until 展开全文; a verdict hangs under a paragraph
 * only when its evidence quotes that paragraph, see `answer-view.ts`), 代码改动
 * (no data yet — the tab stays and says so), 过程 (the player's session, T69's
 * door) and 判定证据 (each criterion's verdicts with their reasons, and the
 * script output verbatim). 并排 / 单份 and the blind switch sit top right.
 *
 * The blind switch swaps each group's name for a letter in the run's seeded
 * order and closes 过程 (a transcript names its harness). On the 人工评估
 * page the view is locked blind and the payload is the blind queue's — the
 * scrubbed material with no group on the wire — and it drops the tabs: the
 * scoring form sits on top of each column and the reports stay folded under
 * it until the column head's 看作答 opens them (I5·T67 · W9, kept inside the
 * component rather than beside it).
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalAnswerVerdict, EvalJudgeCriterionRow } from '../types.ts'
import {
  blocksOf, criteriaOrder, hangVerdicts, stagesOf, stemsOfRow,
  type AnswerColumnModel, type AnswerFile, type AnswerRow, type AnswerSource, type HungAt,
} from './answer-view.ts'
import type { LabViewProps } from './contract.ts'
import { Chip, Seg2, type Tone } from './parts.tsx'
import base from './LabView.module.css'
import css from './AnswerView.module.css'

type T = LabViewProps['t']

const SOURCE_KEY: Record<AnswerSource, 'answer.sourceHuman' | 'answer.sourceJudge' | 'answer.sourceScript' | 'answer.sourceNone'> = {
  human: 'answer.sourceHuman',
  judge: 'answer.sourceJudge',
  script: 'answer.sourceScript',
  none: 'answer.sourceNone',
}

// T83 · answer: v5's tones — a judged column reads green, a script-only one
// amber (the judge's word is missing), matching the 判官缺席 card.
const SOURCE_TONE: Record<AnswerSource, Tone> = { human: 'ok', judge: 'ok', script: 'warn', none: 'warn' }

/** A stage's heading: 阶段 1 for `stage1`, the stem itself otherwise. */
function stageLabel(stem: string, t: T): string {
  const match = /(\d+)$/.exec(stem)
  return match === null ? stem : t('answer.stage', { stage: match[1] ?? stem })
}

function markdownLabels(t: T): MarkdownLabels {
  return {
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/** The layer word of one verdict: 脚本 / 判官 A / 人工. */
function layerOf(verdict: EvalAnswerVerdict, t: T): string {
  if (verdict.ns === 'human-final') return t('answer.layerHuman')
  if (verdict.ns === 'llm-draft') return verdict.judge ?? t('answer.layerJudge')
  return t('answer.layerScript')
}

/** One verdict as a line: criterion, holds / does not, who, and why. */
function VerdictLine(props: { verdict: EvalAnswerVerdict; at?: HungAt | undefined; showCriterion: boolean; t: T }) {
  const { verdict, at, showCriterion, t } = props
  return (
    <div className={css.verdict} data-pass={verdict.pass}>
      <div className={css.verdictHead}>
        {showCriterion && <span className={base.mono}>{verdict.criterion}</span>}
        <Chip tone={verdict.pass ? 'ok' : 'warn'}>{verdict.pass ? t('judge.pass') : t('judge.fail')}</Chip>
        <span className={css.layer}>{layerOf(verdict, t)}</span>
        {at !== undefined && (
          <span className={base.dim}>{t('answer.quoteAt', { file: at.file, no: at.block + 1 })}</span>
        )}
      </div>
      {verdict.evidence !== null && <div className={css.evidence}>{verdict.evidence}</div>}
    </div>
  )
}

/** One stage's markdown, block by block, with the verdicts that quote each block under it. */
function MarkdownWithVerdicts(props: {
  file: AnswerFile
  hung: ReadonlyArray<{ verdict: EvalAnswerVerdict; at: HungAt }>
  /** 提交的报告 (T83 · v5): the file name sits on the card head, not here. */
  bare: boolean
  t: T
}) {
  const { file, hung, bare, t } = props
  const blocks = blocksOf(file.text)
  return (
    <div className={`${base.markdownDoc} ${css.doc}`}>
      {bare
        ? file.replacements !== null && <div className={base.dim}>{t('judge.scrubbed', { count: file.replacements })}</div>
        : (
      <div className={`${base.markdownBanner} ${css.docBanner}`}>
        <span className={base.markdownInfo}>{file.name}</span>
        {/* The blind face's redaction count, on the banner: the grader sees
            the scrubber ran without opening anything. */}
        {file.replacements !== null && <span className={base.dim}>&nbsp;{t('judge.scrubbed', { count: file.replacements })}</span>}
      </div>
        )}
      <div className={`${base.markdownBody} ${css.docBody}`}>
        {blocks.map((block, index) => (
          // Blocks are positional and never reorder within one file.
          <div key={index} className={css.block}>
            <MarkdownText text={block} labels={markdownLabels(t)} />
            {hung.filter(entry => entry.at.block === index).map(entry => (
              <div key={`${entry.verdict.ns}:${entry.verdict.criterion}:${entry.verdict.judge ?? ''}:${String(entry.verdict.sample)}`} className={css.hung}>
                <VerdictLine verdict={entry.verdict} showCriterion t={t} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A non-markdown file (the structured stage json), folded, verbatim. */
function FoldedFile(props: { file: AnswerFile; t: T }) {
  const { file, t } = props
  return (
    <details className={base.errorDetails}>
      <summary className={base.errorSummary}>
        <span className={base.mono}>{file.name}</span>
        {file.replacements !== null && <span className={base.dim}> {t('judge.scrubbed', { count: file.replacements })}</span>}
      </summary>
      <pre className={base.pre}>{file.text}</pre>
    </details>
  )
}

/** One column's head: its name, its verdict source, and (scoring) 看作答. */
function ColumnHead(props: {
  column: AnswerColumnModel
  blind: boolean
  /** Scoring face: the head's 看作答 opens this column's folded reports. */
  onOpenReports: (() => void) | null
  aside: ReactNode
  /** 提交的报告 (v5): the column's report files, small, at the head's right. */
  files: string | null
  t: T
}) {
  const { column, blind, onOpenReports, aside, files, t } = props
  const name = blind || column.condition === null ? t('answer.blindName', { letter: column.letter }) : column.condition
  return (
    <div className={css.head}>
      <span className={css.name}>{name}</span>
      {aside}
      <Chip tone={SOURCE_TONE[column.source]}>{t(SOURCE_KEY[column.source])}</Chip>
      {files !== null && <span className={css.headFiles} title={files}>{files}</span>}
      {onOpenReports !== null && (
        <button type="button" className={css.headLink} onClick={onOpenReports}>{t('answer.open')}</button>
      )}
    </div>
  )
}

/** About 16 lines of 13/22 reading text: where a long report is cut. */
const CLAMP_PX = 352

/**
 * A long report cut to about 16 lines, with a fade and 展开全文 (T83). Each
 * column clamps and opens on its own: a grader comparing two openings should
 * not have to scroll past the whole of the first answer to reach the second.
 */
function Clamp(props: { open: boolean; onToggle: () => void; children: ReactNode; t: T }) {
  const { open, onToggle, children, t } = props
  const inner = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const node = inner.current
    if (node === null) return undefined
    const measure = (): void => { setOver(node.offsetHeight > CLAMP_PX + 8) }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [])
  const clamped = over && !open
  return (
    <div className={css.clamp} data-clamped={clamped ? 'true' : undefined}>
      <div className={css.clampBody} style={clamped ? { maxHeight: `${String(CLAMP_PX)}px` } : undefined}>
        <div ref={inner}>{children}</div>
      </div>
      {over && (
        <button type="button" className={css.clampToggle} aria-expanded={open} onClick={onToggle}>
          {t(open ? 'answer.collapse' : 'answer.expand')}
        </button>
      )}
    </div>
  )
}

/** One column's cell of one stage row in 提交的报告. */
function StageCell(props: { column: AnswerColumnModel; stem: string; hangs: Map<number, HungAt>; bare: boolean; t: T }) {
  const { column, stem, hangs, bare, t } = props
  const stage = stagesOf(column.files, [stem])[0]
  if (stage === undefined || (stage.markdown === null && stage.others.length === 0)) {
    return <div className={base.dim}>{t('answer.stageMissing', { stage: stageLabel(stem, t) })}</div>
  }
  const hung = stage.markdown === null
    ? []
    : [...hangs.entries()]
      .filter(([, at]) => at.file === stage.markdown?.name)
      .flatMap(([index, at]) => {
        const verdict = column.verdicts[index]
        return verdict === undefined ? [] : [{ verdict, at }]
      })
  const cut = [stage.markdown, ...stage.others].filter((file): file is AnswerFile => file !== null && file.truncated)
  return (
    <>
      {stage.markdown !== null && <MarkdownWithVerdicts file={stage.markdown} hung={hung} bare={bare} t={t} />}
      {stage.others.map(file => <FoldedFile key={file.name} file={file} t={t} />)}
      {cut.map(file => (
        <div key={file.name} className={base.note}>{t('answer.truncated', { name: file.name, bytes: file.bytes ?? 0 })}</div>
      ))}
    </>
  )
}

/** The props the three entries compose. */
export interface AnswerViewProps {
  task: string
  rows: readonly AnswerRow[]
  criteria: readonly EvalJudgeCriterionRow[]
  criteriaNote: string | null
  notes: readonly string[]
  /** The 人工评估 page: blind locked on, the scoring form on top of each column. */
  scoring: ((column: AnswerColumnModel) => ReactNode) | null
  /** The rep the entry named; the chips start there. */
  rep: number | null
  onOpenSession: ((child: string, parent: string | null) => void) | null
  onBack: (() => void) | null
  /**
   * Ask for a re-judge of one column the judge never reached (T80c P2-10);
   * null hides the button. The face decides how the column is named in the
   * ask: by blind number on the 人工评估 page, by group and 次 elsewhere.
   */
  onRejudge: ((column: AnswerColumnModel) => void) | null
  /** Scoring face: a quiet word beside each column's name (its run-wide number). */
  headAside?: ((column: AnswerColumnModel) => ReactNode) | undefined
  /** Open the prompt.md this column's judge actually received (T84 §四); absent hides the button. */
  onJudgePrompt?: ((column: AnswerColumnModel) => void) | null | undefined
  t: T
}

type Tab = 'report' | 'diff' | 'process' | 'evidence'
const TABS: ReadonlyArray<[Tab, 'answer.viewReport' | 'answer.viewDiff' | 'answer.process' | 'answer.viewEvidence']> = [
  ['report', 'answer.viewReport'], ['diff', 'answer.viewDiff'], ['process', 'answer.process'], ['evidence', 'answer.viewEvidence'],
]

/**
 * The answer view.
 * @param props - the rows of one 题 and the face they came from.
 */
export function AnswerView(props: AnswerViewProps) {
  const { task, rows, criteria, criteriaNote, notes, scoring, onOpenSession, onBack, onRejudge, headAside, onJudgePrompt, t } = props
  const locked = scoring !== null
  const [blindChoice, setBlind] = useState(false)
  const blind = locked || blindChoice
  const [tab, setTab] = useState<Tab>('report')
  // The scoring face has no tabs: the forms are the page, and the reports
  // open per column from the head's 看作答.
  const view: Tab = locked ? 'report' : tab
  const [layout, setLayout] = useState<'side' | 'single'>('side')
  const reps = rows.map(row => row.rep).filter((rep): rep is number => rep !== null)
  const [rep, setRep] = useState<number | null>(props.rep)
  // 单份 shows one column per row; which one is its index in the row, so a
  // switch of 次 keeps the same group (the rows share the seeded order).
  const firstRow = rows[0]
  const [single, setSingle] = useState(() => Math.max(0, firstRow?.columns.findIndex(column => column.located) ?? 0))
  // Per column: the report opened past its clamp (named face) or unfolded
  // from 看作答 (scoring face).
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string): void => {
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Blind drops the outline too: the entry named a group, so an outlined
  // «作答 A» would say which letter that group is.
  const shown = (rep === null ? rows : rows.filter(row => row.rep === rep))
    .map(row => blind ? { ...row, columns: row.columns.map(column => ({ ...column, located: false })) } : row)
    .map(row => layout === 'single' && !locked
      ? { ...row, columns: row.columns.filter((_, index) => index === Math.min(single, row.columns.length - 1)) }
      : row)
  const order = criteriaOrder(criteria, rows)
  const rubric = new Map(criteria.map(row => [row.id, row]))
  const nameOf = (column: AnswerColumnModel): string => (
    blind || column.condition === null ? t('answer.blindName', { letter: column.letter }) : column.condition
  )

  return (
    <div className={css.view}>
      <div className={css.bar}>
        {onBack !== null && <Button variant="outline" size="sm" onClick={onBack}>{t('answer.back')}</Button>}
        <span className={css.title}>
          {t(locked ? 'answer.blindTitle' : 'answer.title', { task })}
          {/* The page's one sentence about the blind (T83, v5): beside the
              title, not a paragraph above the answers. */}
          {locked && <span className={css.titleAside}>{t('answer.blindScoring')}</span>}
        </span>
        {reps.length > 1 && (
          <Seg2
            label={t('answer.reps')}
            value={rep ?? 0}
            options={[{ value: 0, label: t('answer.repAll') }, ...reps.map(value => ({ value, label: t('answer.rep', { rep: value }) }))]}
            onChange={(value) => { setRep(value === 0 ? null : value) }}
          />
        )}
        {!locked && (
          <div className={css.barRight}>
            {layout === 'single' && firstRow !== undefined && firstRow.columns.length > 1 && (
              <Seg2
                label={t('answer.pickColumn')}
                value={single}
                options={firstRow.columns.map((column, index) => ({ value: index, label: nameOf(column) }))}
                onChange={setSingle}
              />
            )}
            <Seg2
              label={t('answer.layout')}
              value={layout}
              options={[{ value: 'side', label: t('answer.sideBySide') }, { value: 'single', label: t('answer.single') }]}
              onChange={setLayout}
            />
            <Seg2
              label={t('answer.blindSwitch')}
              value={blind ? 'blind' : 'names'}
              options={[{ value: 'names', label: t('answer.names') }, { value: 'blind', label: t('answer.blind') }]}
              onChange={(value) => { setBlind(value === 'blind') }}
            />
          </div>
        )}
      </div>
      {!locked && (
        <div className={css.tabs} role="tablist" aria-label={t('answer.views')}>
          {TABS.map(([value, key]) => (
            <button
              key={value}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={view === value}
              onClick={() => { setTab(value) }}
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}
      {blind && !locked && <div className={base.dim}>{t('answer.blindNote')}</div>}
      {notes.map(note => <div key={note} className={base.note}>{note}</div>)}

      {/* 代码改动 has no data behind it yet: the tab stays, and says so once
          for the whole view rather than once per column. */}
      {view === 'diff' && <div className={css.tabEmpty}>{t('answer.diffNone')}</div>}

      {view !== 'diff' && shown.map((row) => {
        const width = row.columns.length
        const stems = stemsOfRow(row)
        const hangs = new Map(row.columns.map(column => [column.key, hangVerdicts(column.files, column.verdicts)]))
        // Each cell carries its column's index: below 700px the grid drops
        // to one track and `order` regathers a column's parts under its own
        // head, so the second answer is a scroll away, not a sliver (T80c P1-10).
        const colOf = new Map(row.columns.map((column, index) => [column.key, { '--col': index } as CSSProperties]))
        const at = (column: AnswerColumnModel): CSSProperties | undefined => colOf.get(column.key)
        // A column no judge and no person reached says so ONCE, on its first
        // unjudged criterion, instead of 「这条判据未判」 down every row
        // (T80c P2-10). The rows below stay as empty cells so the other
        // columns' criteria keep their level.
        const firstUnjudged = new Map(row.columns
          .filter(column => column.source === 'script' || column.source === 'none')
          .map(column => [column.key, order.find(id => !column.verdicts.some(verdict => verdict.criterion === id))]))
        // The open report card (v5) reads as the answer itself: no 阶段 N /
        // file-name lines above each stage — the stage headings are the
        // report's own, and the file names ride on the card head. The folded
        // scoring face keeps both, since there they are the only labels.
        const bare = !locked
        const stages = (column: AnswerColumnModel): ReactNode => stems.map(stem => (
          <div key={stem} className={css.stage}>
            {!bare && <div className={css.stageTitle}>{stageLabel(stem, t)}</div>}
            <StageCell column={column} stem={stem} hangs={hangs.get(column.key) ?? new Map()} bare={bare} t={t} />
          </div>
        ))
        const filesOf = (column: AnswerColumnModel): string | null => {
          if (locked || view !== 'report' || column.files.length === 0) return null
          const markdown = column.files.filter(file => /\.md$/i.test(file.name))
          return (markdown.length > 0 ? markdown : column.files).map(file => file.name).join(' · ')
        }
        return (
          <section key={String(row.rep)} className={css.row} aria-label={row.rep === null ? task : t('answer.rep', { rep: row.rep })}>
            {row.rep !== null && <div className={css.repTitle}>{t('answer.rep', { rep: row.rep })}</div>}
            <div className={css.grid} style={{ gridTemplateColumns: `repeat(${String(width)}, minmax(300px, 1fr))` }}>
              {row.columns.map(column => (
                <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="head">
                  <ColumnHead
                    column={column}
                    blind={blind}
                    onOpenReports={locked && column.files.length > 0 ? () => {
                      toggle(column.key)
                      document.getElementById(`eval-answer-reports-${column.key}`)?.scrollIntoView({ block: 'nearest' })
                    } : null}
                    aside={headAside?.(column) ?? null}
                    files={filesOf(column)}
                    t={t}
                  />
                </div>
              ))}

              {scoring !== null && row.columns.map(column => (
                <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="scoring">
                  {scoring(column)}
                </div>
              ))}

              {view === 'report' && (locked
                // Scoring: the criteria on top and the reports folded — the
                // material is thousands of lines and above the forms it would
                // push the columns out of step (I5·T67 · W9).
                ? row.columns.map(column => (
                  <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="reports">
                    {column.files.length === 0
                      ? <div className={base.dim}>{t('judge.materialNone')}</div>
                      : (
                        <details
                          id={`eval-answer-reports-${column.key}`}
                          className={base.errorDetails}
                          open={opened.has(column.key)}
                          onToggle={(event) => {
                            const now = (event.currentTarget as HTMLDetailsElement).open
                            if (now !== opened.has(column.key)) toggle(column.key)
                          }}
                        >
                          <summary className={base.errorSummary}>
                            {t('answer.reportsFolded', { files: column.files.map(file => file.name).join('、') })}
                          </summary>
                          {stages(column)}
                        </details>
                      )}
                  </div>
                ))
                // One card per column, every stage in it (v5), cut at about
                // 16 lines until 展开全文 — each column on its own.
                : row.columns.map(column => (
                  <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="reports">
                    {stems.length === 0
                      ? <div className={base.dim}>{t('answer.noReports')}</div>
                      : <Clamp open={opened.has(column.key)} onToggle={() => { toggle(column.key) }} t={t}>{stages(column)}</Clamp>}
                  </div>
                )))}

              {view === 'process' && row.columns.map(column => (
                <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="process">
                  {/* 过程 is the player's transcript, and a transcript names
                      its harness: behind the blind it stays closed. */}
                  {blind
                    ? <div className={base.dim}>{t('answer.processBlind')}</div>
                    : onOpenSession !== null && column.childSessionId !== null
                      ? (
                        <Button variant="outline" size="sm" onClick={() => { onOpenSession(column.childSessionId as string, column.parentSessionId) }}>
                          {t('answer.processOpen')}
                        </Button>
                      )
                      : <div className={base.dim}>{t('answer.processNone')}</div>}
                </div>
              ))}

              {view === 'evidence' && order.flatMap(id => row.columns.map((column) => {
                const unjudged = (col: AnswerColumnModel, criterion: string): ReactNode => {
                  if (firstUnjudged.get(col.key) !== criterion) return <div className={base.dim}>{t('answer.unjudged')}</div>
                  const count = order.filter(each => !col.verdicts.some(verdict => verdict.criterion === each)).length
                  return (
                    <div className={css.unjudgedSummary} role="note">
                      <span>{t(col.source === 'script' ? 'answer.scriptOnly' : 'answer.noneJudged', { count })}</span>
                      {onRejudge !== null && (
                        <Button variant="outline" size="sm" onClick={() => { onRejudge(col) }}>{t('judge.rejudge')}</Button>
                      )}
                    </div>
                  )
                }
                const verdicts = column.verdicts
                  .map((verdict, index) => ({ verdict, index }))
                  .filter(entry => entry.verdict.criterion === id)
                const row0 = rubric.get(id)
                if (verdicts.length === 0 && firstUnjudged.has(column.key) && firstUnjudged.get(column.key) !== id) {
                  return <div key={`${id}:${column.key}`} className={css.cell} style={at(column)} data-located={column.located} data-part="criterion" data-quiet="true" />
                }
                return (
                  <div key={`${id}:${column.key}`} className={css.cell} style={at(column)} data-located={column.located} data-part="criterion">
                    <div className={css.criterionTitle}>
                      <span className={base.itemName}>{id}</span>
                      {row0 !== undefined && <span className={css.criterionText}>{row0.criterion}</span>}
                    </div>
                    {verdicts.length === 0
                      ? unjudged(column, id)
                      : verdicts.map(({ verdict, index }) => (
                        <VerdictLine
                          key={index}
                          verdict={verdict}
                          at={hangs.get(column.key)?.get(index)}
                          showCriterion={false}
                          t={t}
                        />
                      ))}
                  </div>
                )
              }))}
              {view === 'evidence' && order.length === 0 && row.columns.map(column => (
                <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="criterion">
                  <div className={base.dim}>{t('answer.noVerdicts', { reason: criteriaNote ?? '—' })}</div>
                </div>
              ))}
              {view === 'evidence' && !locked && row.columns.map(column => (
                <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="scripts">
                  <div className={css.stageTitle}>{t('answer.scripts')}</div>
                  {column.scripts.length === 0
                    ? <div className={base.dim}>{t('answer.noScripts')}</div>
                    // The script's output VERBATIM: the drawer's own read.
                    : column.scripts.map(run => <pre key={run.at} className={base.pre}>{run.raw}</pre>)}
                  {onJudgePrompt != null && column.source !== 'script' && (
                    <div>
                      <Button variant="outline" size="sm" onClick={() => { onJudgePrompt(column) }}>{t('judgePrompt.actual')}</Button>
                    </div>
                  )}
                </div>
              ))}
              {/* T83 · answer: each column closes as a card (v5), so the
                  last part does not trail off into the page. */}
              {row.columns.map(column => (
                <div key={column.key} className={css.cell} style={at(column)} data-located={column.located} data-part="foot" aria-hidden="true" />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
