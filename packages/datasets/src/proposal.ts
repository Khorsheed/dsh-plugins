/**
 * Registration proposals (T90): the hand-off between the 「题集整理」 session
 * and the person who registers.
 *
 * The organizing agent converts a dataset into a git repository and then
 * files ONE proposal: which repository and commit, where the data came from,
 * which layers it suggests agents see, and the mapping that explains every
 * file of the original directory and every file of the result. The proposal
 * never touches the registry (decision A: only a person writes it). The
 * plugin then checks the mapping against the repository's git objects (and
 * the original directory when it is readable) — a mapping that does not match
 * the repository blocks confirmation — and serves the review the Datasets
 * tab renders: facts, the 「原目录 → 题集」 comparison, a per-item drill-in.
 *
 * @module @khorsheed/dsh-datasets
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { commitCount, commitDate, git, listFiles, repoToplevel, resolveCommit } from './git.ts'
import { DATASETS_DIR, DatasetsError, assertValidName, type DatasetDescriptor } from './dataset.ts'
import { commonDirOfPath, setsAt, type RegistryEntry, type RegistrySet, type RepoRegistry } from './registry.ts'
import { classifyChanges, zoneClassifier, type FileZone } from './zones.ts'
import { normalizeRepoPath } from './repo-path.ts'
import type { ValidateResult } from './service.ts'

/** Where the original data came from. */
export interface ProposalSource {
  /** `local`: a directory on this machine; `public`: downloaded; `protocol`: already in the protocol layout. */
  kind: 'local' | 'public' | 'protocol'
  /** One plain line a person recognizes (`SWE-bench Verified (princeton-nlp)`). */
  label: string
  /** The original directory on this machine (read, never written). */
  path?: string
  url?: string
  license?: string
}

/** One layer suggestion: should agents see it, and why. */
export interface ProposalLayer {
  set: string
  layer: string
  visible: boolean
  reason?: string
}

/** What happened to one field of a split source record. */
export interface SourceFieldDisposition {
  name: string
  /** Where it went (`items/<id>/answer/answer.txt`, `item.json#question`); absent when dropped. */
  to?: string
  /** Why it was dropped (required when `to` is absent). */
  reason?: string
}

/** What happened to one file (or directory, trailing `/`) of the original data. */
export interface SourceMapping {
  /** Path relative to `source.path`; a trailing `/` covers a whole directory; `*` matches within one segment. */
  path: string
  /** `split`: records became items; `copy`: copied as is; `unused`: left out (needs `reason`). */
  disposition: 'split' | 'copy' | 'unused'
  /** Where it went in the repository (pattern), for split / copy. */
  target?: string
  reason?: string
  /** For split record files: every field of a record, accounted for. */
  fields?: SourceFieldDisposition[]
  /** Records the agent counted (checked for jsonl / json / csv). */
  count?: number
  /** The record field whose value is the item id — lets the review find any item's source record. */
  key?: string
}

/** Where one group of repository files came from. */
export interface OutputMapping {
  /** Repo-relative path or pattern (`*` per segment; a trailing `/` covers a directory). */
  path: string
  /** `split`: cut from source records; `copy`: copied verbatim; `new`: written by the agent. */
  origin: 'split' | 'copy' | 'new'
  /** The source file (relative to `source.path`) it came from. */
  from?: string
  /** The source field it came from. */
  field?: string
  note?: string
  /** How many files the agent expects this entry to match. */
  count?: number
}

/** One worked example the agent picked for the 「逐条对照」 view. */
export interface ProposalSample {
  set: string
  item: string
  from?: { file: string; line?: number }
}

/** What the organizing agent files. */
export interface ProposalInput {
  /** The repository (any path inside it; normally the checkout the agent worked in). */
  repo: string
  /** Default: the checkout's current branch, else `main`. */
  trackedRef?: string
  /** The commit the agent finished on; default the branch tip. Must be the tip. */
  commit?: string
  /** The registration name the agent suggests. */
  registryId?: string
  /** What the person said they want to test with it. */
  purpose?: string
  source: ProposalSource
  layers?: ProposalLayer[]
  mapping: { sources?: SourceMapping[]; outputs: OutputMapping[] }
  samples?: ProposalSample[]
  /** The organizing session (where 「退回给 Agent」 goes). */
  sessionId?: string
  /** Anything the person should read before confirming. */
  notes?: string
}

/** A stored proposal. */
export interface Proposal extends ProposalInput {
  id: string
  createdAt: string
  updatedAt: string
  status: 'pending' | 'returned' | 'confirmed' | 'superseded'
  /** `new`: not registered yet; `update`: a new version of a registered repository. */
  kind: 'new' | 'update'
  commonDir: string
  /** The repository's work tree (the authoring checkout on confirm), or null for a bare repository. */
  checkout: string | null
  trackedRef: string
  commit: string
  registryId: string
  /** The registration this updates (kind `update`). */
  registeredAs?: string
  returnNote?: string
  confirmedAs?: string
}

/** One finding of the mapping check. */
export interface ProposalProblem {
  code:
    | 'COMMIT_NOT_TIP' | 'OUTPUT_UNCOVERED' | 'OUTPUT_MISSING' | 'OUTPUT_COUNT'
    | 'SOURCE_MISSING' | 'SOURCE_UNLISTED' | 'SOURCE_COUNT' | 'SOURCE_UNREAD' | 'FIELD_UNACCOUNTED'
    | 'DISPOSITION_INCOMPLETE' | 'SAMPLE_MISSING' | 'VALIDATE_FAILED' | 'LAYER_UNKNOWN' | 'NO_SETS'
    | 'UNLAYERED_VISIBLE' | 'UNCOMMITTED' | 'HISTORY_REWRITTEN'
  message: string
  path?: string
}

/** One set as the review shows it. */
export interface ReviewSet {
  set: string
  title: string
  itemCount: number
  layers: Array<{
    name: string
    /** The descriptor's own `modelFacing` (false = hidden by default). */
    modelFacing: boolean
    /** The agent's suggestion (descriptor floor when it made none). */
    suggested: boolean
    reason?: string
    /** For updates: what the registration grants today. */
    registered?: boolean
  }>
}

/** One source row of the comparison. */
export interface ReviewSource extends SourceMapping {
  /** Files on disk this row covers (undefined when the original directory is not readable). */
  files?: number
  /** Records the plugin counted (jsonl / json / csv only). */
  counted?: number
}

/** One group of repository files of the comparison. */
export interface ReviewOutput {
  path: string
  origin: OutputMapping['origin'] | 'unexplained'
  from?: string
  field?: string
  note?: string
  files: number
  items: number
  /** Where the files sit: one zone/set/layer when uniform. */
  zone: FileZone | 'mixed'
  set?: string
  layer?: string
  /** For updates: how many of the files changed. */
  added?: number
  modified?: number
}

/** One changed path of an update review. */
export interface ReviewChange {
  status: 'A' | 'M' | 'D'
  path: string
  zone: FileZone
  set?: string
  item?: string
  layer?: string
  visible: boolean
}

/** The review the Datasets tab renders for one proposal. */
export interface ProposalReview {
  proposal: Proposal
  facts: {
    itemCount: number
    sets: ReviewSet[]
    validate: { ok: boolean; errors: Array<{ set: string; message: string }>; warnings: number }
    version: { number: number; date: string; commit: string; trackedRef: string; commonDir: string; checkout: string | null }
    /** For updates: the version agents read today. */
    registered?: { number: number; date: string; commit: string }
  }
  compare: {
    mode: 'new' | 'update'
    summary: { split: number; copy: number; new: number; unused: number; added: number; modified: number; deleted: number; outside: number }
    sources: ReviewSource[]
    /** Whether the original directory could be read (else the source rows are the agent's word). */
    sourceRead: boolean
    outputs: ReviewOutput[]
    /** Agent-visible files that sit in no layer (passthrough). */
    unlayered: string[]
    /** Updates: every changed path; deletions are always listed. */
    changes?: ReviewChange[]
  }
  /** Blocking findings: confirmation is refused while any remain. */
  problems: ProposalProblem[]
  /** Findings a person should read but that do not block. */
  warnings: ProposalProblem[]
  /** Every item, for the drill-in and the random pick. */
  items: Array<{ set: string; item: string }>
}

/** One file of the item drill-in. */
export interface ReviewItemFile {
  path: string
  zone: FileZone
  layer?: string
  origin?: ReviewOutput['origin']
  from?: string
  field?: string
  bytes: number
  /** The first 4 KB as text (absent for binary files). */
  excerpt?: string
  truncated?: boolean
}

/** The 「逐条对照」 view of one item. */
export interface ReviewItem {
  set: string
  item: string
  files: ReviewItemFile[]
  /** The source record this item came from, when the mapping says how to find it. */
  source?: { file: string; line?: number; record?: string; truncated?: boolean; missing?: string }
}

/** The 「完整清单」 view: every repository file with its origin, plus every source row. */
export interface ReviewFiles {
  outputs: Array<{ path: string; zone: FileZone; set?: string; item?: string; layer?: string; origin: ReviewOutput['origin']; from?: string; field?: string }>
  sources: ReviewSource[]
  truncated: boolean
}

/** What the store needs from the rest of the service. */
export interface ProposalDeps {
  registry: RepoRegistry
  validate(repo: string, commit: string): Promise<ValidateResult>
}

/** The proposal store and its review builders. */
export interface ProposalStore {
  readonly root: string
  /** Check a proposal against the repository; writes nothing. */
  check(input: ProposalInput): Promise<{ proposal: Proposal; problems: ProposalProblem[]; warnings: ProposalProblem[] }>
  /** Check and store (refused while blocking problems remain). Supersedes an open proposal of the same repository. */
  propose(input: ProposalInput): Promise<{ proposal: Proposal; warnings: ProposalProblem[] }>
  /** Every stored proposal, newest first. */
  list(): Proposal[]
  get(id: string): Proposal
  review(id: string): Promise<ProposalReview>
  reviewItem(id: string, set: string, item: string): Promise<ReviewItem>
  reviewFiles(id: string): Promise<ReviewFiles>
  /** Register (or update) from a proposal — the person's gesture. */
  confirm(id: string, registryId: string, sets: Record<string, RegistrySet>): Promise<RegistryEntry>
  /** Send it back with a note for the organizing session. */
  giveBack(id: string, note: string): Proposal
  /** The review of a registration's pending version, without a proposal (the update gate held it). */
  reviewPending(entry: RegistryEntry): Promise<ProposalReview | undefined>
  /** Confirm a registration's pending version. */
  confirmPending(entry: RegistryEntry, commit: string, sets: Record<string, RegistrySet>): Promise<RegistryEntry>
}

const SOURCE_FILE_LIMIT = 20_000
const LIST_LIMIT = 20_000
const EXCERPT_BYTES = 4096
const COUNT_BYTES_LIMIT = 512 * 1024 * 1024

/** Whether a repo-relative (or source-relative) path matches a mapping path. */
export function mappingMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/')) return path.startsWith(pattern) || pattern === `${path}/`
  if (!pattern.includes('*')) return pattern === path
  const patternSegments = pattern.split('/')
  const pathSegments = path.split('/')
  if (patternSegments.length !== pathSegments.length) return false
  return patternSegments.every((segment, index) => {
    if (!segment.includes('*')) return segment === pathSegments[index]
    const regex = new RegExp(`^${segment.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
    return regex.test(pathSegments[index] ?? '')
  })
}

/** Every file under a directory (relative, `/`-separated), skipping `.git`; undefined when unreadable. */
function walkSource(root: string): { files: string[]; truncated: boolean } | undefined {
  let stat
  try {
    stat = statSync(root)
  } catch {
    return undefined
  }
  if (stat.isFile()) return { files: [basename(root)], truncated: false }
  const files: string[] = []
  const stack = ['']
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) stack.push(rel)
      else if (entry.isFile()) {
        files.push(rel)
        if (files.length >= SOURCE_FILE_LIMIT) return { files: files.sort(), truncated: true }
      }
    }
  }
  return { files: files.sort(), truncated: false }
}

/** The on-disk path of a source-relative path (a file source is its own root). */
function sourceFile(source: ProposalSource, rel: string): string | undefined {
  if (source.path === undefined || source.path === '') return undefined
  const root = normalizeRepoPath(source.path)
  try {
    if (statSync(root).isFile()) return rel === basename(root) ? root : undefined
  } catch {
    return undefined
  }
  return join(root, ...rel.split('/'))
}

/** Record count and first record's field names of a jsonl / json / csv file. */
async function recordShape(file: string): Promise<{ count: number; fields?: string[] } | undefined> {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return undefined
  }
  if (size > COUNT_BYTES_LIMIT) return undefined
  const lower = file.toLowerCase()
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    let count = 0
    let fields: string[] | undefined
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of lines) {
      if (line.trim() === '') continue
      if (count === 0) {
        try {
          const record: unknown = JSON.parse(line)
          if (record !== null && typeof record === 'object' && !Array.isArray(record)) fields = Object.keys(record)
        } catch {
          // a first line that does not parse: count only
        }
      }
      count += 1
    }
    return { count, ...(fields !== undefined ? { fields } : {}) }
  }
  if (lower.endsWith('.json')) {
    if (size > 64 * 1024 * 1024) return undefined
    try {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!Array.isArray(value)) return undefined
      const first: unknown = value[0]
      const fields = first !== null && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first) : undefined
      return { count: value.length, ...(fields !== undefined ? { fields } : {}) }
    } catch {
      return undefined
    }
  }
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    let count = -1
    let fields: string[] | undefined
    const separator = lower.endsWith('.tsv') ? '\t' : ','
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of lines) {
      if (line.trim() === '') continue
      if (count === -1) fields = line.split(separator).map(field => field.trim().replace(/^"|"$/g, ''))
      count += 1
    }
    return { count: Math.max(count, 0), ...(fields !== undefined ? { fields } : {}) }
  }
  return undefined
}

/** The id an item gets from a source value (`a/b c` → `a-b-c`). */
function asItemId(value: unknown): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '')
}

/** Find the jsonl record whose `key` names this item. */
async function findRecord(file: string, key: string, item: string): Promise<{ line: number; text: string } | undefined> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  let line = 0
  for await (const text of lines) {
    line += 1
    if (text.trim() === '' || !text.includes(item.slice(0, 16))) continue
    try {
      const record = JSON.parse(text) as Record<string, unknown>
      const value = record[key]
      if (value !== undefined && (String(value) === item || asItemId(value) === item)) {
        lines.close()
        return { line, text }
      }
    } catch {
      // skip
    }
  }
  return undefined
}

/** One line of a text file (1-based). */
async function lineOf(file: string, wanted: number): Promise<string | undefined> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  let line = 0
  for await (const text of lines) {
    line += 1
    if (line === wanted) {
      lines.close()
      return text
    }
  }
  return undefined
}

/** Pretty-print a record line for reading, capped. */
function recordExcerpt(text: string): { record: string; truncated: boolean } {
  let pretty = text
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    // not JSON: as is
  }
  return pretty.length > EXCERPT_BYTES * 2
    ? { record: pretty.slice(0, EXCERPT_BYTES * 2), truncated: true }
    : { record: pretty, truncated: false }
}

/** Whether the work tree has uncommitted changes under `datasets/`. */
async function dirtyDatasets(checkout: string | null): Promise<boolean> {
  if (checkout === null) return false
  try {
    return (await git(checkout, ['status', '--porcelain', '--', DATASETS_DIR])).trim() !== ''
  } catch {
    return false
  }
}

/** The first mapping entry that covers a path. */
function outputFor(outputs: readonly OutputMapping[], path: string): OutputMapping | undefined {
  return outputs.find(output => mappingMatches(output.path, path))
}

/** A fresh proposal id. */
function proposalId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `p-${stamp}-${randomBytes(3).toString('hex')}`
}

/** Shape-check the tool input (the model writes it, so every field is checked). */
function assertInput(input: ProposalInput): void {
  const fail = (message: string): never => {
    throw new DatasetsError(`proposal: ${message}`, 'SHAPE_INVALID')
  }
  if (input === null || typeof input !== 'object') fail('expected an object')
  if (typeof input.repo !== 'string' || input.repo.trim() === '') fail('"repo" is required (the repository you committed to)')
  if (input.source === undefined || typeof input.source.label !== 'string' || !['local', 'public', 'protocol'].includes(input.source.kind)) {
    fail('"source" needs {kind: local|public|protocol, label}')
  }
  if (input.mapping === undefined || !Array.isArray(input.mapping.outputs)) fail('"mapping.outputs" is required')
  for (const output of input.mapping.outputs) {
    if (typeof output?.path !== 'string' || !['split', 'copy', 'new'].includes(output.origin)) {
      fail('each mapping.outputs entry needs {path, origin: split|copy|new}')
    }
  }
  for (const source of input.mapping.sources ?? []) {
    if (typeof source?.path !== 'string' || !['split', 'copy', 'unused'].includes(source.disposition)) {
      fail('each mapping.sources entry needs {path, disposition: split|copy|unused}')
    }
  }
  for (const layer of input.layers ?? []) {
    if (typeof layer?.set !== 'string' || typeof layer.layer !== 'string' || typeof layer.visible !== 'boolean') {
      fail('each layers entry needs {set, layer, visible}')
    }
  }
  for (const sample of input.samples ?? []) {
    if (typeof sample?.set !== 'string' || typeof sample.item !== 'string') fail('each samples entry needs {set, item}')
  }
  if (input.registryId !== undefined) assertValidName('registry id', input.registryId)
}

/** Everything one check reads from the repository at the proposal's commit. */
interface RepoSnapshot {
  files: string[]
  classes: Map<string, Awaited<ReturnType<ReturnType<typeof zoneClassifier>['classify']>>>
  descriptors: Array<{ id: string; descriptor: DatasetDescriptor }>
  items: Map<string, Set<string>>
}

async function snapshot(commonDir: string, commit: string): Promise<RepoSnapshot> {
  const files = await listFiles(commonDir, commit, '')
  const classifier = zoneClassifier(commonDir, commit)
  const classes: RepoSnapshot['classes'] = new Map()
  const items = new Map<string, Set<string>>()
  for (const file of files) {
    const found = await classifier.classify(file)
    classes.set(file, found)
    if (found.set !== undefined && found.item !== undefined) {
      let bucket = items.get(found.set)
      if (bucket === undefined) items.set(found.set, bucket = new Set())
      bucket.add(found.item)
    }
  }
  return { files, classes, descriptors: await setsAt(commonDir, commit), items }
}

/**
 * Open the proposal store under one directory.
 * @param root - `<stateRoot>/proposals`.
 * @param deps - the registry and the validator.
 * @returns the store.
 */
export function openProposals(root: string, deps: ProposalDeps): ProposalStore {
  const pathOf = (id: string): string => {
    assertValidName('proposal id', id)
    return join(root, `${id}.json`)
  }
  const write = (proposal: Proposal): void => {
    mkdirSync(root, { recursive: true })
    const target = pathOf(proposal.id)
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(proposal, null, 2)}\n`)
    renameSync(temp, target)
  }
  const list = (): Proposal[] => {
    if (!existsSync(root)) return []
    const out: Proposal[] = []
    for (const name of readdirSync(root)) {
      if (!name.endsWith('.json')) continue
      try {
        out.push(JSON.parse(readFileSync(join(root, name), 'utf8')) as Proposal)
      } catch {
        // a torn file is skipped, never fatal
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const get = (id: string): Proposal => {
    const path = pathOf(id)
    if (!existsSync(path)) throw new DatasetsError(`no proposal ${JSON.stringify(id)}`, 'FILE_NOT_FOUND')
    return JSON.parse(readFileSync(path, 'utf8')) as Proposal
  }

  /** Resolve the proposal's repository facts (no checks yet). */
  const resolve = async (input: ProposalInput): Promise<Proposal> => {
    assertInput(input)
    const { commonDir, normalized } = await commonDirOfPath(input.repo)
    let checkout: string | null
    try {
      checkout = await repoToplevel(normalized)
    } catch {
      checkout = null
    }
    const existing = deps.registry.entries().find(entry => entry.commonDir === commonDir)
    let trackedRef = input.trackedRef?.trim()
    if (trackedRef === undefined || trackedRef === '') {
      trackedRef = existing?.trackedRef
        ?? (checkout !== null ? (await git(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() : '')
      if (trackedRef === '') trackedRef = 'main'
    }
    let commit: string
    try {
      commit = await resolveCommit(commonDir, input.commit ?? `refs/heads/${trackedRef}`)
    } catch {
      throw new DatasetsError(`cannot resolve ${input.commit ?? trackedRef} in ${commonDir} — commit your work on ${trackedRef} first`, 'REF_NOT_FOUND')
    }
    const registryId = existing?.id ?? input.registryId ?? basename(checkout ?? commonDir).replace(/\.git$/, '').replace(/[^A-Za-z0-9._-]/g, '-')
    const now = new Date().toISOString()
    return {
      ...input,
      id: proposalId(),
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      kind: existing !== undefined ? 'update' : 'new',
      commonDir,
      checkout,
      trackedRef,
      commit,
      registryId,
      ...(existing !== undefined ? { registeredAs: existing.id } : {}),
    }
  }

  /** Build the review (and the checks) of a resolved proposal. */
  const build = async (proposal: Proposal): Promise<ProposalReview> => {
    const problems: ProposalProblem[] = []
    const warnings: ProposalProblem[] = []
    const { commonDir, commit } = proposal
    const entry = proposal.registeredAs !== undefined ? deps.registry.get(proposal.registeredAs) : undefined

    // The commit must still be what the branch points at.
    let tip: string | undefined
    try {
      tip = await resolveCommit(commonDir, `refs/heads/${proposal.trackedRef}`)
    } catch {
      tip = undefined
    }
    if (tip !== commit) {
      problems.push({
        code: 'COMMIT_NOT_TIP',
        message: tip === undefined
          ? `branch ${proposal.trackedRef} does not exist any more`
          : `branch ${proposal.trackedRef} moved on after this proposal (now ${tip.slice(0, 12)}, proposal ${commit.slice(0, 12)}) — the agent should file a new proposal`,
      })
    }
    if (proposal.status !== 'confirmed' && await dirtyDatasets(proposal.checkout)) {
      warnings.push({ code: 'UNCOMMITTED', message: 'the checkout has uncommitted changes under datasets/ — they are not part of this version' })
    }

    const snap = await snapshot(commonDir, commit)
    if (snap.descriptors.length === 0) problems.push({ code: 'NO_SETS', message: 'the commit has no datasets/<set>/dataset.json' })

    // Update reviews compare against the version agents read today.
    let registered: ProposalReview['facts']['registered']
    let changes: ReviewChange[] | undefined
    let changedPaths: Set<string> | undefined
    if (entry !== undefined) {
      const current = await deps.registry.latest(entry)
      registered = { number: current.version ?? await commitCount(commonDir, current.commit), date: current.date, commit: current.commit }
      const classified = await classifyChanges(commonDir, current.commit, commit, entry.sets)
      changes = classified.changes.map(change => ({
        status: change.status, path: change.path, zone: change.zone, visible: change.visible,
        ...(change.set !== undefined ? { set: change.set } : {}),
        ...(change.item !== undefined ? { item: change.item } : {}),
        ...(change.layer !== undefined ? { layer: change.layer } : {}),
      }))
      changedPaths = new Set(changes.filter(change => change.status !== 'D').map(change => change.path))
      if (!classified.linear) {
        warnings.push({ code: 'HISTORY_REWRITTEN', message: 'this version is not a continuation of the registered one (the branch was rewritten) — every file counts as changed' })
      }
    }

    // Repository side: every file under datasets/ must be explained.
    const outputs = proposal.mapping.outputs
    const groups = new Map<string, ReviewOutput & { itemSet: Set<string>; zones: Set<string>; sets: Set<string>; layerSet: Set<string> }>()
    const unexplained = { path: '(unexplained)', origin: 'unexplained' as const }
    const matched = new Map<OutputMapping, number>()
    const unlayered: string[] = []
    let outside = 0
    for (const file of snap.files) {
      const found = snap.classes.get(file)!
      if (found.zone === 'outside') {
        outside += 1
        continue
      }
      if (found.zone === 'passthrough') unlayered.push(file)
      const relevant = changedPaths === undefined || changedPaths.has(file)
      const mapping = outputFor(outputs, file)
      if (mapping !== undefined) matched.set(mapping, (matched.get(mapping) ?? 0) + 1)
      if (mapping === undefined && relevant) {
        problems.push({ code: 'OUTPUT_UNCOVERED', message: `${file} is not explained by any mapping.outputs entry`, path: file })
      }
      if (!relevant && mapping === undefined) continue
      const key = mapping?.path ?? unexplained.path
      let group = groups.get(key)
      if (group === undefined) {
        group = {
          path: key,
          origin: mapping?.origin ?? 'unexplained',
          ...(mapping?.from !== undefined ? { from: mapping.from } : {}),
          ...(mapping?.field !== undefined ? { field: mapping.field } : {}),
          ...(mapping?.note !== undefined ? { note: mapping.note } : {}),
          files: 0, items: 0, zone: found.zone,
          itemSet: new Set(), zones: new Set(), sets: new Set(), layerSet: new Set(),
          ...(changedPaths !== undefined ? { added: 0, modified: 0 } : {}),
        }
        groups.set(key, group)
      }
      group.files += 1
      if (found.item !== undefined) group.itemSet.add(`${found.set}/${found.item}`)
      group.zones.add(found.zone)
      if (found.set !== undefined) group.sets.add(found.set)
      if (found.layer !== undefined) group.layerSet.add(found.layer)
      if (changes !== undefined && relevant) {
        const change = changes.find(candidate => candidate.path === file)
        if (change?.status === 'A') group.added = (group.added ?? 0) + 1
        if (change?.status === 'M') group.modified = (group.modified ?? 0) + 1
      }
    }
    for (const output of outputs) {
      const count = matched.get(output) ?? 0
      if (count === 0 && changedPaths === undefined) {
        problems.push({ code: 'OUTPUT_MISSING', message: `mapping.outputs ${output.path} matches no file at this commit`, path: output.path })
      } else if (output.count !== undefined && output.count !== count) {
        problems.push({ code: 'OUTPUT_COUNT', message: `mapping.outputs ${output.path} expects ${output.count} files, the commit has ${count}`, path: output.path })
      }
    }
    const outputRows: ReviewOutput[] = [...groups.values()].map(({ itemSet, zones, sets, layerSet, ...row }) => ({
      ...row,
      items: itemSet.size,
      zone: zones.size === 1 ? row.zone : 'mixed',
      ...(sets.size === 1 ? { set: [...sets][0]! } : {}),
      ...(layerSet.size === 1 ? { layer: [...layerSet][0]! } : {}),
    }))
    if (unlayered.length > 0) {
      warnings.push({
        code: 'UNLAYERED_VISIBLE',
        message: `${unlayered.length} file(s) sit in no layer — every agent sees them`,
        path: unlayered[0]!,
      })
    }

    // Source side: every original file accounted for, records counted.
    const sources: ReviewSource[] = []
    const sourceRows = proposal.mapping.sources ?? []
    const walked = proposal.source.path !== undefined && proposal.source.path !== ''
      ? walkSource(normalizeRepoPath(proposal.source.path))
      : undefined
    if (proposal.source.path !== undefined && proposal.source.path !== '' && walked === undefined) {
      warnings.push({ code: 'SOURCE_UNREAD', message: `the original directory ${proposal.source.path} cannot be read here — the source rows are the agent's account, not checked` })
    }
    if (proposal.kind === 'new' && sourceRows.length === 0 && proposal.source.kind !== 'protocol') {
      problems.push({ code: 'DISPOSITION_INCOMPLETE', message: 'mapping.sources is empty — say what happened to every file of the original data' })
    }
    for (const row of sourceRows) {
      const review: ReviewSource = { ...row }
      if (row.disposition === 'unused' && (row.reason === undefined || row.reason.trim() === '')) {
        problems.push({ code: 'DISPOSITION_INCOMPLETE', message: `${row.path} is unused but gives no reason`, path: row.path })
      }
      if (row.disposition !== 'unused' && (row.target === undefined || row.target.trim() === '')) {
        problems.push({ code: 'DISPOSITION_INCOMPLETE', message: `${row.path} is ${row.disposition} but names no target`, path: row.path })
      }
      for (const field of row.fields ?? []) {
        if ((field.to === undefined || field.to === '') && (field.reason === undefined || field.reason === '')) {
          problems.push({ code: 'DISPOSITION_INCOMPLETE', message: `${row.path}: field ${field.name} has neither a target nor a reason`, path: row.path })
        }
      }
      if (walked !== undefined) {
        const covered = walked.files.filter(file => mappingMatches(row.path, file))
        review.files = covered.length
        if (covered.length === 0) {
          problems.push({ code: 'SOURCE_MISSING', message: `mapping.sources ${row.path} matches no file of the original directory`, path: row.path })
        }
        if (covered.length === 1 && covered[0] === row.path && row.disposition !== 'unused') {
          const file = sourceFile(proposal.source, row.path)
          const shape = file !== undefined ? await recordShape(file) : undefined
          if (shape !== undefined) {
            review.counted = shape.count
            if (row.count !== undefined && row.count !== shape.count) {
              problems.push({ code: 'SOURCE_COUNT', message: `${row.path}: the agent counted ${row.count} records, the file has ${shape.count}`, path: row.path })
            }
            if (row.disposition === 'split' && shape.fields !== undefined) {
              const named = new Set((row.fields ?? []).map(field => field.name))
              const missing = shape.fields.filter(field => !named.has(field))
              if (missing.length > 0) {
                problems.push({ code: 'FIELD_UNACCOUNTED', message: `${row.path}: fields ${missing.join(', ')} are not accounted for`, path: row.path })
              }
            }
          }
        }
      }
      sources.push(review)
    }
    if (walked !== undefined) {
      for (const file of walked.files) {
        if (!sourceRows.some(row => mappingMatches(row.path, file))) {
          problems.push({ code: 'SOURCE_UNLISTED', message: `${file} of the original directory is not accounted for in mapping.sources`, path: file })
        }
      }
    }

    // Samples point at real items; layers name declared ones.
    for (const sample of proposal.samples ?? []) {
      if (!snap.items.get(sample.set)?.has(sample.item)) {
        problems.push({ code: 'SAMPLE_MISSING', message: `sample ${sample.set}/${sample.item} is not an item at this commit` })
      }
    }
    for (const layer of proposal.layers ?? []) {
      const set = snap.descriptors.find(candidate => candidate.id === layer.set)
      if (set === undefined || !set.descriptor.layers.some(decl => decl.name === layer.layer)) {
        problems.push({ code: 'LAYER_UNKNOWN', message: `layers: ${layer.set}/${layer.layer} is not declared at this commit` })
      }
    }

    // The protocol's own check.
    const validateErrors: Array<{ set: string; message: string }> = []
    let validateWarnings = 0
    try {
      const result = await deps.validate(commonDir, commit)
      for (const set of result.datasets) {
        for (const error of set.errors) validateErrors.push({ set: set.id, message: error.message })
        validateWarnings += set.warnings.length
      }
    } catch (error) {
      validateErrors.push({ set: '', message: String(error instanceof Error ? error.message : error) })
    }
    if (validateErrors.length > 0) {
      problems.push({ code: 'VALIDATE_FAILED', message: `validate reports ${validateErrors.length} error(s): ${validateErrors[0]!.message}` })
    }

    const sets: ReviewSet[] = snap.descriptors.map(({ id, descriptor }) => {
      const granted = entry?.sets[id]?.layers
      return {
        set: id,
        title: descriptor.name !== undefined && descriptor.name !== '' ? descriptor.name : id,
        itemCount: snap.items.get(id)?.size ?? 0,
        layers: descriptor.layers.map(decl => {
          const suggestion = proposal.layers?.find(layer => layer.set === id && layer.layer === decl.name)
          const floor = decl.modelFacing !== false
          return {
            name: decl.name,
            modelFacing: decl.modelFacing !== false,
            suggested: suggestion?.visible ?? floor,
            ...(suggestion?.reason !== undefined ? { reason: suggestion.reason } : {}),
            ...(entry !== undefined ? { registered: granted !== undefined ? granted.includes(decl.name) : floor } : {}),
          }
        }),
      }
    })
    const items = [...snap.items.entries()].flatMap(([set, ids]) => [...ids].sort().map(item => ({ set, item })))

    const count = (origin: OutputMapping['origin']): number =>
      outputRows.filter(row => row.origin === origin).reduce((sum, row) => sum + row.files, 0)
    return {
      proposal,
      facts: {
        itemCount: items.length,
        sets,
        validate: { ok: validateErrors.length === 0, errors: validateErrors.slice(0, 20), warnings: validateWarnings },
        version: {
          number: await commitCount(commonDir, commit),
          date: await commitDate(commonDir, commit),
          commit,
          trackedRef: proposal.trackedRef,
          commonDir,
          checkout: proposal.checkout,
        },
        ...(registered !== undefined ? { registered } : {}),
      },
      compare: {
        mode: entry !== undefined ? 'update' : 'new',
        summary: {
          split: count('split'),
          copy: count('copy'),
          new: count('new'),
          unused: sources.filter(row => row.disposition === 'unused').reduce((sum, row) => sum + (row.files ?? 1), 0),
          added: changes?.filter(change => change.status === 'A').length ?? 0,
          modified: changes?.filter(change => change.status === 'M').length ?? 0,
          deleted: changes?.filter(change => change.status === 'D').length ?? 0,
          outside,
        },
        sources,
        sourceRead: walked !== undefined,
        outputs: outputRows,
        unlayered: unlayered.slice(0, 200),
        ...(changes !== undefined ? { changes } : {}),
      },
      problems: problems.slice(0, 200),
      warnings,
      items,
    }
  }

  const store: ProposalStore = {
    root,

    async check(input) {
      const proposal = await resolve(input)
      const review = await build(proposal)
      return { proposal, problems: review.problems, warnings: review.warnings }
    },

    async propose(input) {
      const proposal = await resolve(input)
      const review = await build(proposal)
      if (review.problems.length > 0) {
        throw new DatasetsError(
          `the proposal does not match the repository — fix these and propose again:\n${review.problems.slice(0, 20).map(problem => `- [${problem.code}] ${problem.message}`).join('\n')}`,
          'SHAPE_INVALID',
        )
      }
      for (const other of list()) {
        if (other.commonDir === proposal.commonDir && (other.status === 'pending' || other.status === 'returned')) {
          write({ ...other, status: 'superseded', updatedAt: proposal.createdAt })
        }
      }
      write(proposal)
      return { proposal, warnings: review.warnings }
    },

    list,
    get,

    async review(id) {
      return await build(get(id))
    },

    async reviewItem(id, set, item) {
      const proposal = get(id)
      assertValidName('dataset id', set)
      assertValidName('item id', item)
      const classifier = zoneClassifier(proposal.commonDir, proposal.commit)
      const prefix = `${DATASETS_DIR}/${set}/items/${item}/`
      const paths = await listFiles(proposal.commonDir, proposal.commit, prefix.slice(0, -1))
      if (paths.length === 0) throw new DatasetsError(`item ${set}/${item} not found at this version`, 'ITEM_NOT_FOUND')
      const files: ReviewItemFile[] = []
      for (const path of paths) {
        const found = await classifier.classify(path)
        const mapping = outputFor(proposal.mapping.outputs, path)
        const raw = await git(proposal.commonDir, ['cat-file', 'blob', `${proposal.commit}:${path}`], true)
        const head = raw.subarray(0, EXCERPT_BYTES)
        const binary = head.includes(0)
        files.push({
          path,
          zone: found.zone,
          ...(found.layer !== undefined ? { layer: found.layer } : {}),
          origin: mapping?.origin ?? 'unexplained',
          ...(mapping?.from !== undefined ? { from: mapping.from } : {}),
          ...(mapping?.field !== undefined ? { field: mapping.field } : {}),
          bytes: raw.length,
          ...(binary ? {} : { excerpt: head.toString('utf8') }),
          ...(raw.length > EXCERPT_BYTES && !binary ? { truncated: true } : {}),
        })
      }
      // The source record: the agent's sample first, else the keyed source.
      let source: ReviewItem['source']
      const sample = proposal.samples?.find(candidate => candidate.set === set && candidate.item === item)
      if (sample?.from !== undefined) {
        const file = sourceFile(proposal.source, sample.from.file)
        source = { file: sample.from.file, ...(sample.from.line !== undefined ? { line: sample.from.line } : {}) }
        if (file === undefined || !existsSync(file)) source.missing = 'the original file cannot be read here'
        else if (sample.from.line !== undefined) {
          const text = await lineOf(file, sample.from.line)
          if (text === undefined) source.missing = `line ${sample.from.line} does not exist`
          else Object.assign(source, recordExcerpt(text))
        }
      } else {
        const keyed = (proposal.mapping.sources ?? []).find(row => row.key !== undefined && row.disposition === 'split' && !row.path.endsWith('/') && !row.path.includes('*'))
        if (keyed !== undefined) {
          const file = sourceFile(proposal.source, keyed.path)
          source = { file: keyed.path }
          if (file === undefined || !existsSync(file)) source.missing = 'the original file cannot be read here'
          else {
            const found = await findRecord(file, keyed.key!, item)
            if (found === undefined) source.missing = `no record with ${keyed.key} = ${item}`
            else Object.assign(source, { line: found.line }, recordExcerpt(found.text))
          }
        }
      }
      return { set, item, files, ...(source !== undefined ? { source } : {}) }
    },

    async reviewFiles(id) {
      const proposal = get(id)
      const snap = await snapshot(proposal.commonDir, proposal.commit)
      const outputs: ReviewFiles['outputs'] = []
      for (const path of snap.files) {
        if (outputs.length >= LIST_LIMIT) break
        const found = snap.classes.get(path)!
        const mapping = outputFor(proposal.mapping.outputs, path)
        outputs.push({
          path, zone: found.zone,
          ...(found.set !== undefined ? { set: found.set } : {}),
          ...(found.item !== undefined ? { item: found.item } : {}),
          ...(found.layer !== undefined ? { layer: found.layer } : {}),
          origin: found.zone === 'outside' && mapping === undefined ? 'new' : (mapping?.origin ?? 'unexplained'),
          ...(mapping?.from !== undefined ? { from: mapping.from } : {}),
          ...(mapping?.field !== undefined ? { field: mapping.field } : {}),
        })
      }
      return { outputs, sources: (await build(proposal)).compare.sources, truncated: snap.files.length > outputs.length }
    },

    async confirm(id, registryId, sets) {
      const proposal = get(id)
      if (proposal.status !== 'pending') {
        throw new DatasetsError(`proposal ${id} is ${proposal.status} — only a pending proposal can be confirmed`, 'SHAPE_INVALID')
      }
      const review = await build(proposal)
      if (review.problems.length > 0) {
        throw new DatasetsError(`the proposal does not match the repository: ${review.problems[0]!.message}`, 'SHAPE_INVALID')
      }
      let entry: RegistryEntry
      if (proposal.registeredAs !== undefined && deps.registry.get(proposal.registeredAs) !== undefined) {
        entry = await deps.registry.update({ id: proposal.registeredAs, trackedRef: proposal.trackedRef, sets, confirmedCommit: proposal.commit })
      } else {
        entry = await deps.registry.register({
          path: proposal.commonDir,
          id: registryId,
          trackedRef: proposal.trackedRef,
          sets,
          authoringCheckout: proposal.checkout,
          confirmedCommit: proposal.commit,
        })
      }
      write({ ...proposal, status: 'confirmed', confirmedAs: entry.id, updatedAt: new Date().toISOString() })
      return entry
    },

    giveBack(id, note) {
      const proposal = get(id)
      if (proposal.status !== 'pending') {
        throw new DatasetsError(`proposal ${id} is ${proposal.status} — only a pending proposal can be returned`, 'SHAPE_INVALID')
      }
      const next: Proposal = { ...proposal, status: 'returned', returnNote: note, updatedAt: new Date().toISOString() }
      write(next)
      return next
    },

    async reviewPending(entry) {
      return await pendingReview(entry)
    },

    async confirmPending(entry, commit, sets) {
      const review = await pendingReview(entry)
      if (review === undefined || review.proposal.commit !== commit) {
        throw new DatasetsError(`${commit.slice(0, 12)} is not the version waiting for confirmation — reload the tab`, 'REF_NOT_FOUND')
      }
      if (review.problems.length > 0) {
        throw new DatasetsError(`this version does not pass the checks: ${review.problems[0]!.message}`, 'SHAPE_INVALID')
      }
      return await deps.registry.update({ id: entry.id, sets, confirmedCommit: commit })
    },
  }

  /** The synthetic update review of a registration's held version. */
  async function pendingReview(entry: RegistryEntry): Promise<ProposalReview | undefined> {
    const latest = await deps.registry.latest(entry)
    if (latest.pending === undefined) return undefined
    const now = new Date().toISOString()
    const synthetic: Proposal = {
      id: `pending-${entry.id}`,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      kind: 'update',
      repo: entry.commonDir,
      commonDir: entry.commonDir,
      checkout: entry.authoringCheckout,
      trackedRef: entry.trackedRef,
      commit: latest.pending.commit,
      registryId: entry.id,
      registeredAs: entry.id,
      source: { kind: 'protocol', label: entry.id },
      // No proposal names origins: every changed file reads as written in the repository.
      mapping: { outputs: [{ path: `${DATASETS_DIR}/`, origin: 'new', note: 'committed without a proposal' }] },
    }
    return await build(synthetic)
  }
  return store
}

/** Read a proposal JSON file the CLI was handed. */
export async function readProposalFile(path: string): Promise<ProposalInput> {
  const handle = await open(path, 'r')
  try {
    return JSON.parse(await handle.readFile('utf8')) as ProposalInput
  } finally {
    await handle.close()
  }
}
