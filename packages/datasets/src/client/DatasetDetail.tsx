/**
 * The 题集 tab's detail page (ui-spec §四): 题集 › 题目. A file tree on the
 * left where every file carries its slot and who sees it, a slot filter over
 * it, and a right pane that answers the two questions an author actually has
 * about one item in two boxes side by side (T80b) — «选手将看到» (the
 * anti-leak self-check) and «只有判官和探针看得到» (the rest, closed by
 * «可判性»: can this be scored at all) — plus its «作答记录» and the selected
 * file's preview. A narrow view (< 700px) stacks the pane under the tree.
 *
 * The tree's rows are files, not layers. Layers group files by AUTHORING
 * convention; the reader is checking visibility, and the marker on every leaf
 * answers that directly. Layer names still show on the group rows, because a
 * register-homed file and a convention-homed one only line up once you can see
 * which layer claimed them.
 *
 * «选手将看到» lists the item's model-facing files plus the dataset-level
 * prompts, with byte counts — the same bytes the run loop materializes into
 * the cell. An answer key that drifted into a visible layer appears in THIS
 * list, before any run ships it.
 */

import { useState } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconFolderCloseMedium, IconFolderOpenMedium } from './icons.tsx'
import { classifyFile, DATASET_SLOTS, type DatasetSlot } from '../slots.ts'
import type { DatasetOverviewRow, ItemBrief, ItemRecord, JsonObject } from '../types.ts'
import type { DatasetsViewProps, ItemRunsView } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import {
  bucketTone, bytes, Chevron, Chip, EmptyState, FileIcon, SlotMark, slotKey, stageTone, stamp, Word,
} from './parts.tsx'
import { bucketPhrase, stagePhrase } from './vocab.ts'
import { DatasetPreview } from './preview.tsx'
import type { DatasetSelection } from './store.ts'
import css from './DatasetsView.module.css'

/** At most this many metadata chips show in the item header; the rest collapse into +N. */
const MAX_META_PILLS = 3

/** One metadata entry as quiet chip text: scalars inline, containers summarized. */
function metaPillText(key: string, value: unknown): string {
  if (Array.isArray(value)) return `${key} [${value.length}]`
  if (value !== null && typeof value === 'object') return `${key} {…}`
  return `${key}: ${String(value)}`
}

/** The item's metadata as quiet chips — never raw JSON. */
function MetaPills(props: { metadata: JsonObject; t: DatasetsViewProps['t'] }) {
  const { metadata, t } = props
  const entries = Object.entries(metadata)
  if (entries.length === 0) return null
  const shown = entries.slice(0, MAX_META_PILLS)
  const rest = entries.length - shown.length
  return (
    <span className={css.metaPills} title={JSON.stringify(metadata, null, 2)}>
      {shown.map(([key, value]) => <Pill key={key} className={css.metaPill}>{metaPillText(key, value)}</Pill>)}
      {rest > 0 && <Pill className={css.metaPill}>{t('tree.moreMeta', { count: rest })}</Pill>}
    </span>
  )
}

/** One tree leaf: the file's own name, then its slot and who sees it. */
function FileRow(props: {
  label: string
  layer: string | null
  displayPath: string
  sensitiveLayers: ReadonlySet<string>
  selected: boolean
  onClick: () => void
  t: DatasetsViewProps['t']
}) {
  const { label, layer, displayPath, sensitiveLayers, selected, onClick, t } = props
  const { slot, role } = classifyFile(layer, displayPath, sensitiveLayers)
  return (
    <button
      type="button"
      className={selected ? `${css.fileRow} ${css.fileRowSelected}` : css.fileRow}
      onClick={onClick}
    >
      <FileIcon />
      <span className={css.fileName}>{label}</span>
      <SlotMark slot={slot} role={role} t={t} />
    </button>
  )
}

/** Whether one file survives the slot filter (null = every slot passes). */
function passes(
  filter: readonly DatasetSlot[] | null,
  layer: string | null,
  displayPath: string,
  sensitiveLayers: ReadonlySet<string>,
): boolean {
  if (filter === null) return true
  return filter.includes(classifyFile(layer, displayPath, sensitiveLayers).slot)
}

/** One layer group under an item (or under the dataset-level shared group). */
function LayerNode(props: {
  dataset: string
  item: string | null
  layer: string
  paths: readonly string[]
  selection: DatasetSelection | null
  onSelect: (selection: DatasetSelection) => void
  sensitiveLayers: ReadonlySet<string>
  agentLayers: ReadonlySet<string>
  slotFilter: readonly DatasetSlot[] | null
  t: DatasetsViewProps['t']
}) {
  const { dataset, item, layer, paths, selection, onSelect, sensitiveLayers, agentLayers, slotFilter, t } = props
  const [open, setOpen] = useState(true)
  const visible = paths.filter(path => passes(slotFilter, layer, path, sensitiveLayers))
  if (visible.length === 0) return null
  return (
    <div className={css.layer}>
      <button type="button" className={css.row} onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <Chevron open={open} />
        {open ? <IconFolderOpenMedium className={css.folderIcon} /> : <IconFolderCloseMedium className={css.folderIcon} />}
        <span className={css.rowTitle}>{layer}</span>
        <span className={css.rowCount}>· {t('tree.fileCount', { count: visible.length })}</span>
        {sensitiveLayers.has(layer) && <span className={css.sensitiveMark}>· {t('tree.sensitive')}</span>}
        {agentLayers.has(layer) && <span className={css.sensitiveMark}>· {t('tree.agentReadable')}</span>}
      </button>
      {open && (
        <div className={css.children}>
          {visible.map(path => (
            <FileRow
              key={path}
              label={path}
              layer={layer}
              displayPath={path}
              sensitiveLayers={sensitiveLayers}
              selected={selection?.kind === 'layer' && selection.dataset === dataset
                && selection.item === item && selection.layer === layer && selection.path === path}
              onClick={() => { onSelect({ kind: 'layer', dataset, item, layer, path }) }}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One item: a disclosure row; opening it also loads its brief. */
function ItemNode(props: {
  dataset: string
  item: ItemRecord
  open: boolean
  onOpen: () => void
  selection: DatasetSelection | null
  onSelect: (selection: DatasetSelection) => void
  sensitiveLayers: ReadonlySet<string>
  agentLayers: ReadonlySet<string>
  slotFilter: readonly DatasetSlot[] | null
  t: DatasetsViewProps['t']
}) {
  const { dataset, item, open, onOpen, selection, onSelect, sensitiveLayers, agentLayers, slotFilter, t } = props
  const metaPath = `items/${item.id}/item.json`
  const showMeta = item.metadata !== undefined && passes(slotFilter, null, metaPath, sensitiveLayers)
  return (
    <div className={css.item}>
      <button type="button" className={css.row} onClick={onOpen} aria-expanded={open}>
        <Chevron open={open} />
        <span className={css.rowTitle}>{item.id}</span>
      </button>
      {open && (
        <div className={css.children}>
          {showMeta && (
            // item.json sits at the passthrough zone's footing: readable by
            // every bound session, and readable HERE like any other file.
            <FileRow
              label="item.json"
              layer={null}
              displayPath={metaPath}
              sensitiveLayers={sensitiveLayers}
              selected={selection?.kind === 'passthrough' && selection.dataset === dataset
                && selection.item === item.id && selection.path === metaPath}
              onClick={() => { onSelect({ kind: 'passthrough', dataset, item: item.id, path: metaPath }) }}
              t={t}
            />
          )}
          {Object.entries(item.layers).map(([layer, paths]) => (
            <LayerNode
              key={layer}
              dataset={dataset}
              item={item.id}
              layer={layer}
              paths={paths}
              selection={selection}
              onSelect={onSelect}
              sensitiveLayers={sensitiveLayers}
              agentLayers={agentLayers}
              slotFilter={slotFilter}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** «选手将看到»: the exact file list the player's cell receives. */
function PlayerView(props: { brief: ItemBrief; t: DatasetsViewProps['t'] }) {
  const { brief, t } = props
  const { files, totalBytes } = brief.player
  return (
    <section className={css.box}>
      <div className={css.panelTitle}>
        <span>{t('detail.player')}</span>
        <span className={css.panelCount}>
          {t('detail.playerSummary', { count: files.length, bytes: totalBytes })}
        </span>
      </div>
      <div className={css.panelHint}>{t('detail.playerHint')}</div>
      {files.length === 0
        ? <div className={css.panelWarn}>{t('detail.playerEmpty')}</div>
        : (
          <ul className={css.panelList}>
            {files.map(file => (
              <li key={`${file.source}/${file.layer}/${file.path}`} className={css.panelRow}>
                <span className={css.panelPath}>{file.path}</span>
                {file.source === 'dataset' && <span className={css.panelTag}>{t('detail.playerShared')}</span>}
                <span className={css.panelNumber}>{bytes(file.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/** One file only the judge side reads: its layer-relative path, and whether it is dataset-level. */
interface JudgeOnlyFile {
  layer: string
  path: string
  shared: boolean
}

/**
 * The files of one item (and the dataset-level layers) that sit in a layer
 * that is NOT model-facing — the complement of «选手将看到», read off the
 * same layer declaration the tree's markers use.
 */
function judgeOnlyFiles(
  item: ItemRecord | undefined,
  sharedLayers: Record<string, readonly string[]>,
  sensitiveLayers: ReadonlySet<string>,
): JudgeOnlyFile[] {
  const files: JudgeOnlyFile[] = []
  for (const [layer, paths] of Object.entries(item?.layers ?? {})) {
    if (sensitiveLayers.has(layer)) for (const path of paths) files.push({ layer, path, shared: false })
  }
  for (const [layer, paths] of Object.entries(sharedLayers)) {
    if (sensitiveLayers.has(layer)) for (const path of paths) files.push({ layer, path, shared: true })
  }
  return files
}

/**
 * «只有判官和探针看得到»: the item's judge-only files, then «可判性» — the
 * rubric's shape, the probes, the stage schemas — in one line under them.
 */
function JudgeOnlyView(props: { brief: ItemBrief; files: readonly JudgeOnlyFile[]; t: DatasetsViewProps['t'] }) {
  const { brief, files, t } = props
  const { leaves, kinds, probes, sharedProbes, stageSchemas, notes } = brief.judgeability
  const kindText = Object.entries(kinds)
    .map(([kind, count]) => t('detail.judgeKind', { kind, count }))
    .join(' · ')
  return (
    <section className={css.box}>
      <div className={css.panelTitle}>
        <span>{t('detail.judgeOnly')}</span>
        <span className={css.panelCount}>{t('tree.fileCount', { count: files.length })}</span>
      </div>
      <div className={css.panelHint}>{t('detail.judgeOnlyHint')}</div>
      {files.length === 0
        ? <div className={css.panelHint}>{t('detail.judgeOnlyEmpty')}</div>
        : (
          <ul className={css.panelList}>
            {files.map(file => (
              <li key={`${file.shared ? 'shared' : 'item'}/${file.layer}/${file.path}`} className={css.panelRow}>
                <span className={css.panelPath}>{`${file.layer}/${file.path}`}</span>
                {file.shared && <span className={css.panelTag}>{t('detail.playerShared')}</span>}
              </li>
            ))}
          </ul>
        )}
      <div className={css.panelLine}>
        <span className={css.panelTag}>{t('detail.judge')}</span>
        {t('detail.judgeRubric', { leaves })}
        {kindText !== '' && ` （${kindText}）`}
        {' · '}
        {t('detail.judgeProbes', { count: probes.length })}
        {sharedProbes.length > 0 && ` · ${t('detail.judgeShared', { count: sharedProbes.length })}`}
        {' · '}
        {t('detail.judgeSchemas', { count: stageSchemas.length })}
      </div>
      {notes.map(note => <div key={note} className={css.panelWarn}>{note}</div>)}
    </section>
  )
}

/** «作答记录»: the item's cells across every experiment that ran it. */
function AnswerRecord(props: { runs: ItemRunsView; t: DatasetsViewProps['t'] }) {
  const { runs, t } = props
  return (
    <section className={css.panel}>
      <div className={css.panelTitle}>{t('detail.runs')}</div>
      {runs.runs.length === 0 && <EmptyState title={t('detail.runsEmpty')} hint={t('detail.runsEmptyHint')} />}
      {runs.runs.map(run => (
        <div key={run.runId} className={css.runBlock}>
          <div className={css.panelLine}>
            <span className={css.panelPath}>{run.name}</span>
            <span className={css.panelTag}>{stamp(run.startedAt)}</span>
            {run.commit !== null && <span className={css.panelTag} title={run.commit}>@{run.commit.slice(0, 7)}</span>}
          </div>
          <ul className={css.panelList}>
            {run.cells.map(cell => (
              <li key={cell.missionId} className={css.panelRow}>
                <span className={css.panelPath}>
                  {t('detail.runsCell', { condition: cell.condition ?? '—', rep: cell.rep ?? '—' })}
                </span>
                {/* The bucket and the stage are eval's projection of the same
                    ledger the 实验室 tab reads; ui-spec §九 makes them the same
                    two chips here as they are there. */}
                <Chip tone={bucketTone(cell.bucket)} title={cell.bucket}>
                  <Word phrase={bucketPhrase(cell.bucket)} t={t} />
                </Chip>
                <Chip tone={stageTone(cell.state)} title={cell.state}>
                  <Word phrase={stagePhrase(cell.state)} t={t} />
                </Chip>
                <span className={css.panelNumber}>
                  {Object.entries(cell.verdicts).map(([ns, count]) => `${ns} ${count}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {runs.notes.map(note => <div key={note} className={css.panelHint}>{note}</div>)}
    </section>
  )
}

/** The detail page's props (the shell owns every fetch; this owns the layout). */
export interface DatasetDetailProps {
  dataset: DatasetOverviewRow
  items: readonly ItemRecord[]
  sharedLayers: Record<string, readonly string[]>
  passthrough: readonly string[]
  sensitiveLayers: ReadonlySet<string>
  agentLayers: ReadonlySet<string>
  openItem: string | null
  onOpenItem: (item: string | null) => void
  slotFilter: readonly DatasetSlot[] | null
  onSlotFilter: (slots: readonly DatasetSlot[] | null) => void
  selection: DatasetSelection | null
  onSelect: (selection: DatasetSelection) => void
  brief: ItemBrief | undefined
  briefLoading: boolean
  briefError: string | undefined
  /** undefined = not fetched yet; null = no eval plugin, so the area hides. */
  runs: ItemRunsView | null | undefined
  preview: { content: string; commit: string } | null
  previewLoading: boolean
  previewError: string | null
  t: DatasetsViewProps['t']
}

/**
 * The detail page.
 * @param props - see {@link DatasetDetailProps}.
 */
export function DatasetDetail(props: DatasetDetailProps) {
  const {
    dataset, items, sharedLayers, passthrough, sensitiveLayers, agentLayers,
    openItem, onOpenItem, slotFilter, onSlotFilter, selection, onSelect,
    brief, briefLoading, briefError, runs, preview, previewLoading, previewError, t,
  } = props
  const [passthroughOpen, setPassthroughOpen] = useState(false)
  const openItemRecord = items.find(item => item.id === openItem)
  const visiblePassthrough = passthrough.filter(path => passes(slotFilter, null, path, sensitiveLayers))
  const sharedEntries = Object.entries(sharedLayers)
  const anyFile = items.length > 0 || sharedEntries.length > 0 || visiblePassthrough.length > 0

  return (
    <div className={css.body}>
      <nav className={css.tree} aria-label={t('open')}>
        <div className={css.filterRow}>
          <Pill active={slotFilter === null} onClick={() => { onSlotFilter(null) }}>{t('detail.filterAll')}</Pill>
          {DATASET_SLOTS.map(slot => (
            <Pill
              key={slot}
              active={slotFilter?.includes(slot) === true}
              onClick={() => {
                const current = slotFilter ?? []
                const next = current.includes(slot)
                  ? current.filter(entry => entry !== slot)
                  : [...current, slot]
                onSlotFilter(next.length === 0 ? null : next)
              }}
            >
              {t(slotKey(slot))}
            </Pill>
          ))}
        </div>
        {!anyFile && <div className={css.empty}>{t('list.loading')}</div>}
        {sharedEntries.length > 0 && (
          <div className={css.sharedGroup}>
            <div className={css.sharedLabel}>{t('tree.shared')}</div>
            {sharedEntries.map(([layer, paths]) => (
              <LayerNode
                key={layer}
                dataset={dataset.id}
                item={null}
                layer={layer}
                paths={paths}
                selection={selection}
                onSelect={onSelect}
                sensitiveLayers={sensitiveLayers}
                agentLayers={agentLayers}
                slotFilter={slotFilter}
                t={t}
              />
            ))}
          </div>
        )}
        {visiblePassthrough.length > 0 && (
          <div className={css.layer}>
            <button
              type="button"
              className={css.row}
              onClick={() => { setPassthroughOpen(!passthroughOpen) }}
              aria-expanded={passthroughOpen}
            >
              <Chevron open={passthroughOpen} />
              <span className={css.rowTitle}>{t('tree.passthrough', { count: visiblePassthrough.length })}</span>
            </button>
            {passthroughOpen && (
              <div className={css.children}>
                {visiblePassthrough.map(path => (
                  <FileRow
                    key={path}
                    label={path}
                    layer={null}
                    displayPath={path}
                    sensitiveLayers={sensitiveLayers}
                    selected={selection?.kind === 'passthrough' && selection.dataset === dataset.id
                      && selection.item === null && selection.path === path}
                    onClick={() => { onSelect({ kind: 'passthrough', dataset: dataset.id, item: null, path }) }}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <div className={css.sharedGroup}>
          <div className={css.sharedLabel}>{t('detail.itemsLabel')}</div>
          {items.map(item => (
            <ItemNode
              key={item.id}
              dataset={dataset.id}
              item={item}
              open={item.id === openItem}
              onOpen={() => { onOpenItem(item.id === openItem ? null : item.id) }}
              selection={selection}
              onSelect={onSelect}
              sensitiveLayers={sensitiveLayers}
              agentLayers={agentLayers}
              slotFilter={slotFilter}
              t={t}
            />
          ))}
        </div>
        {slotFilter !== null && !anyFile && (
          <EmptyState title={t('detail.filterEmpty')} hint={t('detail.filterEmptyHint')} />
        )}
      </nav>
      <section className={css.preview}>
        {openItem !== null && (
          <div className={css.itemHeader}>
            <span className={css.previewPath}>{openItem}</span>
            {openItemRecord?.metadata !== undefined && <MetaPills metadata={openItemRecord.metadata} t={t} />}
          </div>
        )}
        <div className={css.previewScroll}>
          {openItem === null && selection === null && (
            <EmptyState title={t('detail.itemEmpty')} hint={t('detail.itemEmptyHint')} />
          )}
          {openItem !== null && briefLoading && brief === undefined && (
            <div className={css.empty}>{t('detail.briefLoading')}</div>
          )}
          {openItem !== null && briefError !== undefined && (
            <ErrorState what={t('detail.briefError')} message={briefError} compact t={t} />
          )}
          {openItem !== null && brief !== undefined && (
            // The two sides of the anti-leak check, side by side (T80b, v5's
            // «选手将看到 / 只有判官和探针看得到»); a narrow pane stacks them.
            <div className={css.compare}>
              <PlayerView brief={brief} t={t} />
              <JudgeOnlyView
                brief={brief}
                files={judgeOnlyFiles(openItemRecord, sharedLayers, sensitiveLayers)}
                t={t}
              />
            </div>
          )}
          {/* The answer record only exists where an eval plugin does: a null
              answer means no orchestrator is installed, so the area is absent
              rather than empty. */}
          {openItem !== null && runs !== undefined && runs !== null && <AnswerRecord runs={runs} t={t} />}
          {selection !== null && (
            <section className={css.panel}>
              <div className={css.panelTitle}>
                <FileIcon />
                <span className={css.previewPath}>
                  {selection.kind === 'passthrough'
                    ? selection.path
                    : `${selection.item ?? t('tree.shared')} / ${selection.layer}/${selection.path}`}
                </span>
                {preview !== null && <span className={css.previewCommit}>@{preview.commit.slice(0, 7)}</span>}
              </div>
              {previewLoading && <div className={css.empty}>{t('preview.loading')}</div>}
              {!previewLoading && previewError !== null && (
                <ErrorState
                  what={t('preview.error')}
                  message={previewError}
                  path={selection.path}
                  compact
                  t={t}
                />
              )}
              {!previewLoading && previewError === null && preview !== null && (
                <div className={css.previewContent}>
                  <DatasetPreview
                    key={`${selection.kind}/${selection.item}/${selection.kind === 'layer' ? selection.layer : ''}/${selection.path}`}
                    path={selection.path}
                    content={preview.content}
                    t={t}
                  />
                </div>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
