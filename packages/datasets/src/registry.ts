/**
 * The deployment's dataset registry (T73): `$DSH_HOME/state/datasets/registry.json`,
 * one record per git repository, written only by a human (the tab's register
 * form or the CLI). It replaces per-session bindings as the answer to «which
 * dataset repositories may this deployment's agents use, and which layers of
 * each set may they see».
 *
 * Identity is the realpath of the repository's git COMMON dir, so every
 * checkout and linked worktree of one repository lands on one record — the
 * three bindings that named one repository on 3171 become one registration.
 * «Latest» is the registration's tracked branch as it stands now
 * (`git rev-parse <trackedRef>`), never HEAD: a shared checkout's HEAD is
 * whatever branch the last agent left it on. A tracked branch that does not
 * resolve is refused, never answered from HEAD.
 *
 * Agents address a registration by its reference `<id>/<set>` and never by a
 * path; {@link resolveDatasetRef} carries the three refusals the tools speak.
 * @module @khorsheed/dsh-datasets
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { validateBinding } from './binding.ts'
import {
  assertValidName, DATASET_DESCRIPTOR, datasetDir, DatasetsError, validateDescriptor,
  type DatasetDescriptor,
} from './dataset.ts'
import { commitDate, currentBranch, gitCommonDir, listFiles, localBranches, repoToplevel, resolveCommit, showFile } from './git.ts'
import { normalizeRepoPath } from './repo-path.ts'

/** One set's registered visibility. */
export interface RegistrySet {
  /** The layers agents may read; the modelFacing floor when the set is absent from the record. */
  layers: string[]
}

/** One registered repository. */
export interface RegistryEntry {
  /** The reference prefix agents use (`<id>/<set>`). */
  id: string
  /** Canonical git common dir — the record's identity. */
  commonDir: string
  /** The branch whose tip is «latest». */
  trackedRef: string
  /** ISO time of registration. */
  registeredAt: string
  /** The tracked branch's commit at registration — audit only, never read as «latest». */
  registeredCommit: string
  /** Per-set agent visibility. */
  sets: Record<string, RegistrySet>
  /** The one working tree write verbs may touch (shares the common dir), or null. */
  authoringCheckout: string | null
}

/** The durable file. */
interface RegistryFile {
  readonly version: 1
  readonly entries: RegistryEntry[]
}

/** The tip of a registration's tracked branch. */
export interface LatestCommit {
  commit: string
  /** Committer date, ISO 8601. */
  date: string
}

/** One set as a registration exposes it. */
export interface RegisteredSet {
  /** `<id>/<set>`. */
  ref: string
  set: string
  /** The descriptor's display name, falling back to the set id. */
  title: string
  /** The layers agents may read. */
  layers: string[]
  /** Every layer the descriptor declares. */
  declaredLayers: string[]
  /** The declared layers marked `modelFacing: false`. */
  nonModelFacingLayers: string[]
}

/** Inputs of a new registration. */
export interface RegisterInput {
  /** Any path inside the repository (checkout, linked worktree, `.git`, bare). */
  path: string
  /** Registry id; default: the repository's directory name. */
  id?: string
  /** Default `main`. */
  trackedRef?: string
  /** Per-set layers; a set left out gets the modelFacing floor. */
  sets?: Record<string, RegistrySet>
  /** A working tree of the same repository for write verbs. */
  authoringCheckout?: string | null
}

/** A registration edit. */
export interface UpdateInput {
  id: string
  trackedRef?: string
  sets?: Record<string, RegistrySet>
  authoringCheckout?: string | null
}

/** What a candidate path would register as — the form's live verdict. */
export interface RegisterPreview {
  commonDir: string
  /** The id the form proposes. */
  suggestedId: string
  /** Set when this repository is registered already. */
  registeredAs?: string
  /** Local branches. */
  branches: string[]
  /** The branch the form preselects (`main` when present). */
  defaultRef: string
  /** The branch previewed below, when it resolved. */
  latest?: LatestCommit
  /** Sets at the previewed branch, with the layer defaults. */
  sets: RegisteredSet[]
  /** The candidate's own work tree, when it is one (the authoring-checkout default). */
  checkout?: string
}

/** One legacy binding group that became (or already was) a registration. */
export interface ImportedBinding {
  id: string
  commonDir: string
  /** The bound paths that folded into it. */
  paths: string[]
  /** Session binding files that named it. */
  sessions: number
  /** False when the repository was registered before the import. */
  created: boolean
}

/** One legacy binding that could not be imported. */
export interface DanglingBinding {
  repoPath: string
  sessions: number
  /** Plain sentence: why it was skipped. */
  reason: string
}

/** The import's report. */
export interface ImportBindingsResult {
  imported: ImportedBinding[]
  dangling: DanglingBinding[]
}

/** A resolved `<id>/<set>` reference. */
export interface ResolvedDatasetRef {
  entry: RegistryEntry
  set: string
  latest: LatestCommit
  /** Agent-visible layers of the set (the registry's, else the floor). */
  layers: string[]
}

/** The registry id a Remote read/write request names (the tab's human view of one registration). */
export interface RepoSelector {
  repo: string
}

/** One registration as the tab's grouped list shows it. */
export interface RegistryRow {
  entry: RegistryEntry
  /** The tracked branch's tip; absent when the branch is gone (see `problem`). */
  latest?: LatestCommit
  sets: RegisteredSet[]
  /** One plain sentence when the registration cannot be read right now. */
  problem?: string
}

/** The registry file path under a state root. */
export function registryPathOf(stateRoot: string): string {
  return join(stateRoot, 'registry.json')
}

/**
 * Read the registry file.
 * @param path - the registry file.
 * @returns the entries (empty when the file is absent).
 */
export function readRegistry(path: string): RegistryEntry[] {
  if (!existsSync(path)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new DatasetsError(`dataset registry ${path} is not valid JSON: ${String(error)}`, 'SHAPE_INVALID')
  }
  const record = parsed as Partial<RegistryFile> | null
  if (record === null || typeof record !== 'object' || record.version !== 1 || !Array.isArray(record.entries)) {
    throw new DatasetsError(`dataset registry ${path} has an unknown shape (expected {version:1, entries:[]})`, 'SHAPE_INVALID')
  }
  return record.entries
}

/**
 * Write the registry atomically (temp file + rename).
 * @param path - the registry file.
 * @param entries - every entry.
 */
export function writeRegistry(path: string, entries: readonly RegistryEntry[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const file: RegistryFile = { version: 1, entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)) }
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/**
 * The common dir behind a candidate path, with the form's plain-sentence
 * refusals: a missing path and a non-repository answer differently.
 * @param path - the candidate path, as typed.
 * @returns the canonical common dir and the normalized path.
 */
export async function commonDirOfPath(path: string): Promise<{ commonDir: string; normalized: string }> {
  const normalized = normalizeRepoPath(path)
  if (normalized === '' || !existsSync(normalized)) {
    throw new DatasetsError(`${normalized === '' ? path : normalized} does not exist — no such file or directory`, 'FILE_NOT_FOUND')
  }
  try {
    return { commonDir: await gitCommonDir(normalized), normalized }
  } catch (error) {
    throw new DatasetsError(`${normalized} is not a git repository: ${String(error)}`, 'NOT_A_REPO')
  }
}

/** The id a repository proposes: its directory name (`/x/foo/.git` → `foo`, `/x/foo.git` → `foo`). */
function suggestId(commonDir: string, taken: ReadonlySet<string>): string {
  const name = basename(commonDir) === '.git' ? basename(dirname(commonDir)) : basename(commonDir).replace(/\.git$/, '')
  const base = name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '') || 'repo'
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** Resolve a tracked branch, refusing when it is absent (never falling back to HEAD). */
async function latestAt(commonDir: string, trackedRef: string, id: string): Promise<LatestCommit> {
  let commit: string
  try {
    commit = await resolveCommit(commonDir, `refs/heads/${trackedRef}`)
  } catch {
    throw new DatasetsError(
      `tracked branch ${JSON.stringify(trackedRef)} of ${JSON.stringify(id)} does not exist — `
      + 'pick an existing branch in the registration (nothing falls back to HEAD)',
      'REF_NOT_FOUND',
    )
  }
  return { commit, date: await commitDate(commonDir, commit) }
}

/** The sets of a repository at a commit, with each descriptor (unreadable descriptors are skipped). */
async function setsAt(commonDir: string, commit: string): Promise<Array<{ id: string; descriptor: DatasetDescriptor }>> {
  const files = await listFiles(commonDir, commit, 'datasets')
  const ids = new Set<string>()
  for (const file of files) {
    const parts = file.split('/')
    if (parts.length === 3 && parts[2] === DATASET_DESCRIPTOR) ids.add(parts[1]!)
  }
  const out: Array<{ id: string; descriptor: DatasetDescriptor }> = []
  for (const id of [...ids].sort()) {
    const path = `${datasetDir(id)}/${DATASET_DESCRIPTOR}`
    try {
      const raw = await showFile(commonDir, commit, path)
      if (raw === undefined) continue
      out.push({ id, descriptor: validateDescriptor(JSON.parse(raw), path) })
    } catch {
      // A set whose descriptor does not parse is not offerable; validate reports it.
    }
  }
  return out
}

/** One set's view: registry layers ∩ declared, else the modelFacing floor. */
function setView(entryId: string, set: string, descriptor: DatasetDescriptor, registered: RegistrySet | undefined): RegisteredSet {
  const declaredLayers = descriptor.layers.map(layer => layer.name)
  const nonModelFacingLayers = descriptor.layers.filter(layer => layer.modelFacing === false).map(layer => layer.name)
  const layers = registered !== undefined
    ? registered.layers.filter(layer => declaredLayers.includes(layer))
    : declaredLayers.filter(layer => !nonModelFacingLayers.includes(layer))
  const title = descriptor.name !== undefined && descriptor.name !== '' ? descriptor.name : set
  return { ref: `${entryId}/${set}`, set, title, layers, declaredLayers, nonModelFacingLayers }
}

/** Validate per-set layers against the sets declared at a commit. */
function validateSets(
  sets: Record<string, RegistrySet> | undefined,
  available: ReadonlyArray<{ id: string; descriptor: DatasetDescriptor }>,
): Record<string, RegistrySet> {
  const out: Record<string, RegistrySet> = {}
  for (const [set, value] of Object.entries(sets ?? {})) {
    const found = available.find(candidate => candidate.id === set)
    if (found === undefined) {
      throw new DatasetsError(`set ${JSON.stringify(set)} does not exist at the tracked branch`, 'DATASET_NOT_FOUND')
    }
    if (!Array.isArray(value?.layers) || value.layers.some(layer => typeof layer !== 'string')) {
      throw new DatasetsError(`set ${JSON.stringify(set)} needs {layers: string[]}`, 'SHAPE_INVALID')
    }
    const declared = found.descriptor.layers.map(layer => layer.name)
    for (const layer of value.layers) {
      if (!declared.includes(layer)) {
        throw new DatasetsError(
          `layer ${JSON.stringify(layer)} is not declared by set ${JSON.stringify(set)} (declared: ${declared.join(', ')})`,
          'LAYER_UNDECLARED',
        )
      }
    }
    out[set] = { layers: [...new Set(value.layers)].sort() }
  }
  return out
}

/** Whether a string reads as a filesystem path rather than a registry reference. */
export function looksLikePath(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.startsWith('.')
    || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.split('/').length > 2 || trimmed.includes('\\')
}

/** The registry's operations over one file. */
export interface RepoRegistry {
  /** The file this registry reads and writes. */
  readonly path: string
  /** Every registration. */
  entries(): RegistryEntry[]
  /** One registration by id. */
  get(id: string): RegistryEntry | undefined
  /** The registration a path belongs to (identity = common dir), if any. */
  lookupPath(path: string): Promise<RegistryEntry | undefined>
  /** The form's live verdict on a candidate path. */
  preview(path: string, trackedRef?: string): Promise<RegisterPreview>
  /** Register a repository (human-only). */
  register(input: RegisterInput): Promise<RegistryEntry>
  /** Edit a registration (human-only). */
  update(input: UpdateInput): Promise<RegistryEntry>
  /** Remove a registration (human-only). Returns false when absent. */
  remove(id: string): boolean
  /** A registration's tracked-branch tip. */
  latest(entry: RegistryEntry): Promise<LatestCommit>
  /** A registration's sets at its latest commit. */
  sets(entry: RegistryEntry, latest?: LatestCommit): Promise<RegisteredSet[]>
  /** Resolve `<id>/<set>` — or refuse with the three agent-facing sentences. */
  resolveRef(ref: string): Promise<ResolvedDatasetRef>
  /** Every registration with its latest commit and sets (a broken one carries `problem`). */
  rows(): Promise<RegistryRow[]>
  /** Fold the legacy per-session bindings into registrations. */
  importBindings(bindingsRoot: string): Promise<ImportBindingsResult>
}

/**
 * Open the registry stored at one file.
 * @param path - the registry file (`<stateRoot>/registry.json`).
 * @returns the registry.
 */
export function openRegistry(path: string): RepoRegistry {
  const load = (): RegistryEntry[] => readRegistry(path)

  const assertAuthoringCheckout = async (checkout: string | null | undefined, commonDir: string): Promise<string | null> => {
    if (checkout === undefined || checkout === null || checkout.trim() === '') return null
    const resolved = await commonDirOfPath(checkout)
    if (resolved.commonDir !== commonDir) {
      throw new DatasetsError(
        `${resolved.normalized} belongs to a different repository — the authoring checkout must be a working tree of this one`,
        'SHAPE_INVALID',
      )
    }
    try {
      return await repoToplevel(resolved.normalized)
    } catch {
      throw new DatasetsError(`${resolved.normalized} is not a working tree — pick a checkout, not the .git directory`, 'NOT_A_REPO')
    }
  }

  const registry: RepoRegistry = {
    path,

    entries: load,

    get(id) {
      return load().find(entry => entry.id === id)
    },

    async lookupPath(candidate) {
      try {
        const { commonDir } = await commonDirOfPath(candidate)
        return load().find(entry => entry.commonDir === commonDir)
      } catch {
        return undefined
      }
    },

    async preview(candidate, trackedRef) {
      const { commonDir, normalized } = await commonDirOfPath(candidate)
      const entries = load()
      const existing = entries.find(entry => entry.commonDir === commonDir)
      const branches = await localBranches(commonDir)
      const defaultRef = existing?.trackedRef ?? (branches.includes('main') ? 'main' : (branches[0] ?? 'main'))
      const ref = trackedRef ?? defaultRef
      let checkout: string | undefined
      try {
        checkout = await repoToplevel(normalized)
      } catch {
        checkout = undefined
      }
      const id = existing?.id ?? suggestId(commonDir, new Set(entries.map(entry => entry.id)))
      let latest: LatestCommit | undefined
      let sets: RegisteredSet[] = []
      try {
        latest = await latestAt(commonDir, ref, id)
        sets = (await setsAt(commonDir, latest.commit)).map(({ id: set, descriptor }) =>
          setView(id, set, descriptor, existing?.sets[set]))
      } catch (error) {
        if (!(error instanceof DatasetsError && error.code === 'REF_NOT_FOUND')) throw error
      }
      return {
        commonDir, suggestedId: id, branches, defaultRef,
        ...(existing !== undefined ? { registeredAs: existing.id } : {}),
        ...(latest !== undefined ? { latest } : {}),
        sets,
        ...(checkout !== undefined ? { checkout } : {}),
      }
    },

    async register(input) {
      const { commonDir } = await commonDirOfPath(input.path)
      const entries = load()
      const existing = entries.find(entry => entry.commonDir === commonDir)
      if (existing !== undefined) {
        throw new DatasetsError(
          `this repository is registered already as ${JSON.stringify(existing.id)} — edit that registration instead`,
          'ALREADY_REGISTERED',
        )
      }
      const id = input.id ?? suggestId(commonDir, new Set(entries.map(entry => entry.id)))
      assertValidName('registry id', id)
      if (entries.some(entry => entry.id === id)) {
        throw new DatasetsError(`registry id ${JSON.stringify(id)} is taken by another repository — pick another id`, 'ALREADY_REGISTERED')
      }
      const trackedRef = (input.trackedRef ?? 'main').trim()
      const latest = await latestAt(commonDir, trackedRef, id)
      const sets = validateSets(input.sets, await setsAt(commonDir, latest.commit))
      const entry: RegistryEntry = {
        id,
        commonDir,
        trackedRef,
        registeredAt: new Date().toISOString(),
        registeredCommit: latest.commit,
        sets,
        authoringCheckout: await assertAuthoringCheckout(input.authoringCheckout, commonDir),
      }
      writeRegistry(path, [...entries, entry])
      return entry
    },

    async update(input) {
      const entries = load()
      const index = entries.findIndex(entry => entry.id === input.id)
      if (index < 0) throw new DatasetsError(`no registration ${JSON.stringify(input.id)}`, 'NOT_REGISTERED')
      const current = entries[index]!
      const trackedRef = input.trackedRef?.trim() ?? current.trackedRef
      const latest = await latestAt(current.commonDir, trackedRef, current.id)
      const next: RegistryEntry = {
        ...current,
        trackedRef,
        sets: input.sets !== undefined ? validateSets(input.sets, await setsAt(current.commonDir, latest.commit)) : current.sets,
        authoringCheckout: input.authoringCheckout !== undefined
          ? await assertAuthoringCheckout(input.authoringCheckout, current.commonDir)
          : current.authoringCheckout,
      }
      const updated = [...entries]
      updated[index] = next
      writeRegistry(path, updated)
      return next
    },

    remove(id) {
      const entries = load()
      const kept = entries.filter(entry => entry.id !== id)
      if (kept.length === entries.length) return false
      writeRegistry(path, kept)
      return true
    },

    async latest(entry) {
      return await latestAt(entry.commonDir, entry.trackedRef, entry.id)
    },

    async sets(entry, latest) {
      const tip = latest ?? await latestAt(entry.commonDir, entry.trackedRef, entry.id)
      return (await setsAt(entry.commonDir, tip.commit)).map(({ id: set, descriptor }) =>
        setView(entry.id, set, descriptor, entry.sets[set]))
    },

    async rows() {
      const out: RegistryRow[] = []
      for (const entry of load()) {
        try {
          const latest = await latestAt(entry.commonDir, entry.trackedRef, entry.id)
          out.push({ entry, latest, sets: await registry.sets(entry, latest) })
        } catch (error) {
          out.push({ entry, sets: [], problem: error instanceof Error ? error.message : String(error) })
        }
      }
      return out
    },

    async resolveRef(ref) {
      const raw = ref.trim()
      const entries = load()
      if (looksLikePath(raw)) {
        const owner = await registry.lookupPath(raw)
        if (owner !== undefined) {
          const sets = await registry.sets(owner).catch(() => [] as RegisteredSet[])
          throw new DatasetsError(
            `dataset takes a registry reference, not a path: ${JSON.stringify(raw)} is registered as `
            + `${JSON.stringify(owner.id)} — pass "${owner.id}/<set>"`
            + (sets.length > 0 ? ` (${sets.map(one => one.ref).join(', ')})` : ''),
            'PATH_NOT_REF',
          )
        }
        throw notRegistered(raw)
      }
      const slash = raw.indexOf('/')
      if (slash > 0) {
        const entry = entries.find(candidate => candidate.id === raw.slice(0, slash))
        if (entry !== undefined) {
          const set = raw.slice(slash + 1)
          const latest = await latestAt(entry.commonDir, entry.trackedRef, entry.id)
          const sets = await registry.sets(entry, latest)
          const found = sets.find(candidate => candidate.set === set)
          if (found === undefined) {
            throw new DatasetsError(
              `${JSON.stringify(entry.id)} has no set ${JSON.stringify(set)} on ${entry.trackedRef} `
              + `(sets: ${sets.map(one => one.ref).join(', ') || 'none'})`,
              'DATASET_NOT_FOUND',
            )
          }
          return { entry, set, latest, layers: found.layers }
        }
      }
      // Not a full reference: match it against every registered reference.
      const needle = raw.toLowerCase()
      const candidates: Array<{ view: RegisteredSet; entry: RegistryEntry; latest: LatestCommit }> = []
      for (const entry of entries) {
        let latest: LatestCommit
        try {
          latest = await latestAt(entry.commonDir, entry.trackedRef, entry.id)
        } catch {
          continue
        }
        for (const view of await registry.sets(entry, latest)) {
          if (view.ref.toLowerCase().includes(needle) || view.title.toLowerCase().includes(needle)) {
            candidates.push({ view, entry, latest })
          }
        }
      }
      if (candidates.length === 0) throw notRegistered(raw)
      const lines = candidates.map(({ view, entry, latest }) =>
        `  - ${view.ref} (tracking ${entry.trackedRef}, latest ${latest.commit.slice(0, 7)}, ${latest.date.slice(0, 10)})`)
      throw new DatasetsError(
        `dataset ${JSON.stringify(raw)} matches ${candidates.length} registered dataset${candidates.length === 1 ? '' : 's'}, `
        + 'and choosing is not yours to do:\n'
        + `${lines.join('\n')}\n`
        + (candidates.length === 1
          ? `Pass the full reference "${candidates[0]!.view.ref}" if that is the one the person named; otherwise `
          : '')
        + 'use ask_user_question to let the person choose; if they skip, stop and do not draft.',
        'AMBIGUOUS_DATASET',
      )
    },

    async importBindings(bindingsRoot) {
      const groups = new Map<string, { paths: Set<string>; sessions: number; first: string; layers: Array<string[] | undefined> }>()
      const dangling = new Map<string, DanglingBinding>()
      const files = existsSync(bindingsRoot) ? readdirSync(bindingsRoot).filter(name => name.endsWith('.json')) : []
      for (const file of files.sort()) {
        // Read the record directly (never through readBinding, which migrates
        // in place): the import leaves every legacy file byte-identical.
        let repoPath: string
        let layers: string[] | undefined
        try {
          const record = JSON.parse(readFileSync(join(bindingsRoot, file), 'utf8')) as { version?: unknown; binding?: unknown }
          if (record?.version !== 1) continue
          const binding = validateBinding(record.binding)
          repoPath = binding.repoPath
          layers = binding.layers
        } catch {
          continue
        }
        let commonDir: string
        try {
          commonDir = (await commonDirOfPath(repoPath)).commonDir
        } catch (error) {
          const reason = error instanceof DatasetsError && error.code === 'FILE_NOT_FOUND'
            ? 'the path no longer exists'
            : 'the path is not a git repository'
          const prior = dangling.get(repoPath)
          dangling.set(repoPath, { repoPath, sessions: (prior?.sessions ?? 0) + 1, reason })
          continue
        }
        const group = groups.get(commonDir) ?? { paths: new Set<string>(), sessions: 0, first: repoPath, layers: [] }
        group.paths.add(repoPath)
        group.sessions += 1
        group.layers.push(layers)
        groups.set(commonDir, group)
      }
      const imported: ImportedBinding[] = []
      for (const [commonDir, group] of groups) {
        const paths = [...group.paths].sort()
        const existing = load().find(entry => entry.commonDir === commonDir)
        if (existing !== undefined) {
          imported.push({ id: existing.id, commonDir, paths, sessions: group.sessions, created: false })
          continue
        }
        // Track main when it exists, else the branch the bound checkout had
        // out; a repository with neither cannot be imported in one click.
        const branches = await localBranches(commonDir)
        let trackedRef: string | undefined = branches.includes('main') ? 'main' : undefined
        let checkout: string | undefined
        for (const candidate of paths) {
          try {
            checkout ??= await repoToplevel(candidate)
          } catch { /* a bound .git dir has no work tree */ }
          trackedRef ??= await currentBranch(candidate)
        }
        if (trackedRef === undefined) {
          dangling.set(group.first, {
            repoPath: group.first, sessions: group.sessions,
            reason: 'the repository has no main branch and the bound checkout is detached — register it by hand',
          })
          continue
        }
        // A binding's layer whitelist carries over as each set's layers, but
        // never widens past the modelFacing floor: several bindings merge to
        // their intersection (the narrowest grant any session had), and an
        // unrestricted binding contributes the floor.
        try {
          const tip = await latestAt(commonDir, trackedRef, 'import')
          const sets: Record<string, RegistrySet> = {}
          for (const { id: set, descriptor } of await setsAt(commonDir, tip.commit)) {
            let allowed = setView('import', set, descriptor, undefined).layers
            for (const whitelist of group.layers) {
              if (whitelist !== undefined) allowed = allowed.filter(layer => whitelist.includes(layer))
            }
            sets[set] = { layers: allowed }
          }
          const entry = await registry.register({ path: commonDir, trackedRef, sets, authoringCheckout: checkout ?? null })
          imported.push({ id: entry.id, commonDir, paths, sessions: group.sessions, created: true })
        } catch (error) {
          dangling.set(group.first, {
            repoPath: group.first, sessions: group.sessions,
            reason: error instanceof DatasetsError ? error.message : String(error),
          })
        }
      }
      return { imported, dangling: [...dangling.values()] }
    },
  }
  return registry
}

/** The unregistered-repository refusal (the tool face's third sentence). */
function notRegistered(raw: string): DatasetsError {
  return new DatasetsError(
    `${JSON.stringify(raw)} is not registered in this deployment's dataset registry; eval uses registered `
    + 'repositories only. Ask the person to register it on the Datasets tab (Register repository), then try '
    + 'again. Do not read that directory yourself.',
    'NOT_REGISTERED',
  )
}
