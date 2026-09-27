/**
 * The design page's 题目抽屉 and 判官提示词 (T84 §二.1, §四.2): everything an
 * item carries, read at the commit the experiment PINS — never the branch
 * head the 题集 tab shows — plus the prompt a judge receives.
 *
 * Every read goes through the structural {@link DatasetsFace} the run loop
 * uses (eval never imports the datasets package), with the three layers named
 * explicitly: the bare scope is the modelFacing floor, and the rubric and the
 * probes are not on it. Text only, cut past {@link ARTIFACT_MAX_BYTES} and
 * said so — the same rules as `experimentArtifact`.
 * @module @khorsheed/dsh-eval
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { ARTIFACT_MAX_BYTES, extensionOf, isInside } from './cell-artifact.ts'
import type { DatasetsFace } from './faces.ts'
import { JUDGE_MATERIAL_FILES, judgedCriteria, judgePromptSegments, pickRubricPath } from './judge.ts'
import { EvalReadRefused } from './read.ts'
import { inStageScope, leafStages } from './weights.ts'
import type {
  EvalDatasetFileRequest, EvalDatasetFileView, EvalItemMaterialFile, EvalItemMaterialsView, EvalItemRubricRow,
  EvalJudgePromptPreviewView, EvalJudgePromptView,
} from './types.ts'

/** What a dataset file may be read back as: the artifact list plus the probe languages. */
export const DATASET_TEXT_EXTENSIONS: readonly string[] = [
  '.md', '.json', '.txt', '.yml', '.yaml', '.log', '.jsonl', '.mjs', '.cjs', '.js', '.ts', '.sh', '.py', '.toml',
]

/** The pinned dataset, as an experiment records it. */
export interface PinnedDataset {
  datasets: DatasetsFace | undefined
  repo: string
  datasetId: string
  commit: string
}

const LAYERS = ['visible', 'verify', 'grading'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireFace(pin: PinnedDataset): DatasetsFace {
  if (pin.datasets === undefined) throw new EvalReadRefused('no datasets service is mounted, so the item cannot be read')
  return pin.datasets
}

/**
 * Sort an item's files into the drawer's five tabs.
 * - 题面: the item's visible files (task.md, standards.yml), stage prompts aside;
 * - 阶段说明: stage prompts, item-level then set-level, and `schemas/<stage>.json`;
 * - 判据: the rubric (listed as rows, not a file);
 * - 检查脚本: the item's verify layer and the set's shared verify layer;
 * - 参考材料: the rest of the grading layer (oracle, notes, rubric.md).
 */
export function classifyMaterials(input: {
  itemLayers: Record<string, string[]>
  datasetLayers: Record<string, string[]>
  rubricPath: string | null
  phases: readonly string[]
  schemas: readonly string[]
}): EvalItemMaterialFile[] {
  const out: EvalItemMaterialFile[] = []
  const isPrompt = (path: string): boolean => /(?:^|\/)prompts\//.test(path)
  for (const path of input.itemLayers['visible'] ?? []) {
    out.push({ tab: isPrompt(path) ? 'stages' : 'task', source: 'item', layer: 'visible', path })
  }
  for (const path of input.datasetLayers['visible'] ?? []) {
    if (isPrompt(path)) out.push({ tab: 'stages', source: 'dataset', layer: 'visible', path })
  }
  for (const path of input.schemas) out.push({ tab: 'stages', source: 'passthrough', layer: 'schemas', path })
  for (const path of input.itemLayers['verify'] ?? []) out.push({ tab: 'probes', source: 'item', layer: 'verify', path })
  for (const path of input.datasetLayers['verify'] ?? []) out.push({ tab: 'probes', source: 'dataset', layer: 'verify', path })
  for (const path of input.itemLayers['grading'] ?? []) {
    out.push({ tab: path === input.rubricPath ? 'rubric' : 'reference', source: 'item', layer: 'grading', path })
  }
  return out
}

/**
 * The rubric's leaves for the 判据 tab: every kind, in document order, each
 * with the stages it judges and whether this run scores it.
 * @param rubricText - the rubric YAML.
 * @param scope.runIn - the item's `runIn` (binds `verify.json` evidence).
 * @param scope.planStages - the plan's `stages`; null — every leaf counts.
 */
export function rubricRows(rubricText: string, scope: { runIn: readonly string[] | null; planStages: readonly string[] | null }): EvalItemRubricRow[] {
  const doc = yaml.load(rubricText)
  if (!isPlainObject(doc) || !Array.isArray(doc['items'])) return []
  const rows: EvalItemRubricRow[] = []
  for (const raw of doc['items'] as unknown[]) {
    if (!isPlainObject(raw) || typeof raw['id'] !== 'string') continue
    const stages = leafStages(raw, scope.runIn)
    rows.push({
      id: raw['id'],
      kind: typeof raw['kind'] === 'string' ? raw['kind'] : null,
      weight: typeof raw['weight'] === 'number' ? raw['weight'] : null,
      negative: raw['negative'] === true,
      veto: raw['veto'] === true,
      criterion: typeof raw['criterion'] === 'string' ? raw['criterion'] : null,
      evidence: typeof raw['evidence'] === 'string' ? raw['evidence'] : null,
      stages,
      inScope: inStageScope(stages, scope.planStages),
    })
  }
  return rows
}

/**
 * List one item's materials at the pinned commit.
 * @param pin - the experiment's dataset pin and the face.
 * @param input.item - the item id.
 * @param input.planStages - the plan's `stages` (null/empty: every stage).
 */
export async function listItemMaterials(
  pin: PinnedDataset,
  input: { experimentId: string; item: string; planStages: readonly string[] | null },
): Promise<EvalItemMaterialsView> {
  const face = requireFace(pin)
  const planStages = input.planStages === null || input.planStages.length === 0 ? null : input.planStages
  const scope = { repo: pin.repo, layers: LAYERS }
  const shown = await face.show(scope, pin.datasetId, input.item, pin.commit)
  const item = shown.items.find(candidate => candidate.id === input.item)
  if (item === undefined) throw new EvalReadRefused(`item ${input.item} is not in the dataset at ${pin.commit.slice(0, 7)}`)
  const notes: string[] = []
  const meta = isPlainObject(item.metadata) ? item.metadata : {}
  const phases = strings(meta['phasesUsed'])
  const runIn = Array.isArray(meta['runIn']) ? strings(meta['runIn']) : null
  const rubricPath = pickRubricPath(item.layers['grading'] ?? [])
  // `schemas/` sits at the set root, outside every layer: reachable only
  // through the passthrough read, and only by name (the stages this item uses).
  const schemas: string[] = []
  if (face.readPassthrough !== undefined) {
    for (const stage of phases) {
      try {
        await face.readPassthrough(scope, pin.datasetId, `schemas/${stage}.json`, pin.commit)
        schemas.push(`schemas/${stage}.json`)
      } catch { /* this stage ships no schema */ }
    }
  } else if (phases.length > 0) {
    notes.push('this datasets service cannot read set-root files, so schemas/ is not listed')
  }
  let rubric: EvalItemMaterialsView['rubric'] = null
  if (rubricPath === null) notes.push(`item ${input.item} ships no rubric in its grading layer`)
  else {
    try {
      const read = await face.read(scope, { dataset: pin.datasetId, item: input.item, layer: 'grading', path: rubricPath, commit: pin.commit })
      rubric = { path: rubricPath, rows: rubricRows(read.content, { runIn, planStages }) }
    } catch (error) {
      notes.push(`the rubric could not be read: ${message(error)}`)
    }
  }
  return {
    experimentId: input.experimentId,
    item: input.item,
    dataset: pin.datasetId,
    commit: pin.commit,
    title: typeof meta['title'] === 'string' ? meta['title'] : null,
    phases,
    runStages: planStages === null ? null : phases.filter(phase => planStages.includes(phase)),
    files: classifyMaterials({
      itemLayers: item.layers, datasetLayers: shown.datasetLayers ?? {}, rubricPath, phases, schemas,
    }),
    rubric,
    notes,
  }
}

/**
 * Read one file of the pinned dataset — the drawer's right pane.
 * @throws {@link EvalReadRefused} when no face is mounted or the source is unknown.
 */
export async function readDatasetFile(pin: PinnedDataset, request: EvalDatasetFileRequest): Promise<EvalDatasetFileView> {
  const face = requireFace(pin)
  const scope = { repo: pin.repo, layers: LAYERS }
  const base = { experimentId: request.experimentId, item: request.item, layer: request.layer, path: request.path }
  const extension = extensionOf(request.path)
  if (!DATASET_TEXT_EXTENSIONS.includes(extension)) {
    return {
      ...base, commit: pin.commit, kind: 'binary', truncated: false, bytes: 0, text: null,
      note: `这一页不内联 ${extension === '' ? '无扩展名的' : extension} 文件，只内联文本和脚本源码`,
    }
  }
  let read: { content: string; commit: string }
  if (request.source === 'passthrough') {
    if (face.readPassthrough === undefined) throw new EvalReadRefused('this datasets service cannot read set-root files')
    if (!/^schemas\/[^/]+\.json$/.test(request.path)) throw new EvalReadRefused(`only schemas/<stage>.json is read outside the layers: ${request.path}`)
    read = await face.readPassthrough(scope, pin.datasetId, request.path, pin.commit)
  } else {
    if (!(LAYERS as readonly string[]).includes(request.layer)) throw new EvalReadRefused(`unknown layer ${request.layer}`)
    if (request.source === 'item' && (request.item === null || request.item === '')) throw new EvalReadRefused('an item file needs its item id')
    read = await face.read(scope, {
      dataset: pin.datasetId,
      ...(request.source === 'item' ? { item: request.item as string } : {}),
      layer: request.layer,
      path: request.path,
      commit: pin.commit,
    })
  }
  const buffer = Buffer.from(read.content, 'utf8')
  const cut = buffer.length > ARTIFACT_MAX_BYTES
  return {
    ...base,
    commit: read.commit,
    kind: 'text',
    truncated: cut,
    bytes: buffer.length,
    text: cut ? buffer.subarray(0, ARTIFACT_MAX_BYTES).toString('utf8') : read.content,
    note: cut ? `文件 ${String(buffer.length)} 字节，超过 ${String(ARTIFACT_MAX_BYTES)} 字节上限，只返回开头部分` : null,
  }
}

/**
 * The prompt a judge will receive for one item, before anything ran: the
 * same template ({@link judgePromptSegments}, which {@link buildJudgePrompt}
 * fills for the run) and the same in-scope criteria the run loop uses. The
 * text segments match the real prompt byte for byte; each material file is a
 * slot the page labels, never placeholder text inside a code fence.
 * @param pin - the experiment's dataset pin and the face.
 * @param input.judge - the judge condition id the prompt names.
 * @param input.planStages - the plan's `stages`: only those stages' criteria and material.
 */
export async function previewJudgePrompt(
  pin: PinnedDataset,
  input: { experimentId: string; item: string; judge: string; planStages: readonly string[] | null },
): Promise<EvalJudgePromptPreviewView> {
  const face = requireFace(pin)
  const planStages = input.planStages === null || input.planStages.length === 0 ? null : input.planStages
  const scope = { repo: pin.repo, layers: LAYERS }
  const shown = await face.show(scope, pin.datasetId, input.item, pin.commit)
  const item = shown.items.find(candidate => candidate.id === input.item)
  if (item === undefined) throw new EvalReadRefused(`item ${input.item} is not in the dataset at ${pin.commit.slice(0, 7)}`)
  const meta = isPlainObject(item.metadata) ? item.metadata : {}
  const runIn = Array.isArray(meta['runIn']) ? strings(meta['runIn']) : null
  const rubricPath = pickRubricPath(item.layers['grading'] ?? [])
  if (rubricPath === null) throw new EvalReadRefused(`item ${input.item} ships no rubric: the judge would not be asked anything`)
  const rubric = await face.read(scope, { dataset: pin.datasetId, item: input.item, layer: 'grading', path: rubricPath, commit: pin.commit })
  const judged = judgedCriteria(rubric.content, { task: input.item, runIn, planStages })
  const materialPaths = JUDGE_MATERIAL_FILES
    .filter(path => planStages === null || planStages.includes(path.replace(/\.(json|md)$/, '')))
  const segments = judgePromptSegments({ taskId: input.item, judgeConditionId: input.judge, criteria: judged.criteria, materialPaths })
  return {
    experimentId: input.experimentId,
    item: input.item,
    judge: input.judge,
    commit: rubric.commit,
    segments,
    criteria: judged.criteria.map(criterion => criterion.id),
    outOfScope: judged.outOfScope,
    note: judged.criteria.length === 0 ? '这道题在本次阶段里没有 llm-draft 判据：判官不会被调用' : null,
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * Read the prompt.md a cell's judging actually wrote, under
 * `<stateRoot>/judge/<runId>/<missionId>/attempt-<N>/<judge>/<sample>/`.
 * Lexical and real-path containment both, like `cellArtifact`.
 * @param stateRoot - `$DSH_HOME/state/eval`.
 * @throws {@link EvalReadRefused} on an unsafe segment or a path outside the run's judge directory.
 */
export async function readJudgePrompt(stateRoot: string, request: {
  runId: string; missionId: string; attempt: number; judge?: string; sample?: string
}): Promise<EvalJudgePromptView> {
  for (const [name, value] of [['runId', request.runId], ['missionId', request.missionId], ['judge', request.judge], ['sample', request.sample]] as const) {
    if (value !== undefined && (!SAFE_SEGMENT.test(value) || value === '..' || value === '.')) {
      throw new EvalReadRefused(`${name} ${JSON.stringify(value)} is not a plain path segment`)
    }
  }
  if (!Number.isInteger(request.attempt) || request.attempt < 1) throw new EvalReadRefused(`attempt must be a positive integer`)
  const runRoot = join(stateRoot, 'judge', request.runId)
  const base = join(runRoot, request.missionId, `attempt-${String(request.attempt)}`)
  const view: EvalJudgePromptView = {
    runId: request.runId, missionId: request.missionId, attempt: request.attempt,
    samples: [], judge: null, sample: null, text: null, truncated: false, note: null,
  }
  let judges: string[]
  try {
    judges = (await readdir(base, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch {
    return { ...view, note: '这一格没有判官目录：判官没跑，或这一格在判官阶段之前就停了' }
  }
  for (const judge of judges) {
    const samples = (await readdir(join(base, judge), { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    for (const sample of samples) {
      const exists = await stat(join(base, judge, sample, 'prompt.md')).then(info => info.isFile(), () => false)
      if (exists) view.samples.push({ judge, sample })
    }
  }
  const chosen = view.samples.find(entry =>
    (request.judge === undefined || entry.judge === request.judge) && (request.sample === undefined || entry.sample === request.sample))
  if (chosen === undefined) {
    return { ...view, note: view.samples.length === 0 ? '判官目录里没有 prompt.md' : '没有这份样本' }
  }
  const file = join(base, chosen.judge, chosen.sample, 'prompt.md')
  let real: string
  let root: string
  try {
    root = await realpath(runRoot)
    real = await realpath(file)
  } catch {
    return { ...view, note: 'prompt.md 不在磁盘上' }
  }
  if (!isInside(root, real) || !isInside(resolve(runRoot), resolve(file))) {
    throw new EvalReadRefused('prompt.md 越出了这个 run 的判官目录，拒绝读取')
  }
  const buffer = await readFile(real)
  const cut = buffer.length > ARTIFACT_MAX_BYTES
  return {
    ...view,
    judge: chosen.judge,
    sample: chosen.sample,
    text: buffer.subarray(0, ARTIFACT_MAX_BYTES).toString('utf8'),
    truncated: cut,
    note: cut ? `文件 ${String(buffer.length)} 字节，超过 ${String(ARTIFACT_MAX_BYTES)} 字节上限，只返回开头部分` : null,
  }
}
