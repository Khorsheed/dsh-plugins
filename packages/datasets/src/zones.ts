/**
 * Where one repository file sits in the protocol, and therefore who can see
 * it: the descriptor, an item's always-visible `item.json`, a declared layer
 * (dataset-level or item-level, directory or `register`-homed), the
 * always-visible passthrough zone, or outside `datasets/` altogether (never
 * served to an agent).
 *
 * T90: the registration review (the 「原目录 → 题集」 comparison) and the
 * update gate (a registration follows its branch until a change touches what
 * agents can see) both need this one answer per path, read from git objects
 * at one commit — never from a checkout.
 * @module @khorsheed/dsh-datasets
 */
import { diffPaths, isAncestor } from './git.ts'
import {
  buildRegistry, DATASET_DESCRIPTOR, DATASETS_DIR, ITEM_METADATA, loadDescriptor, type DatasetDescriptor,
} from './dataset.ts'

/** The protocol zone of one repository path. */
export type FileZone = 'descriptor' | 'item-meta' | 'layer' | 'passthrough' | 'outside'

/** One path's place in the protocol. */
export interface FileClass {
  zone: FileZone
  /** The set the path belongs to (absent outside `datasets/`). */
  set?: string
  /** The item, for item-level paths. */
  item?: string
  /** The declared layer, for `zone: 'layer'`. */
  layer?: string
}

/** One set's classification inputs at one commit. */
interface SetIndex {
  descriptor: DatasetDescriptor
  layers: Set<string>
  /** Repo-relative object path → layer, for `register`-homed files. */
  claimed: Map<string, string>
}

/** A per-commit classifier: loads each set's descriptor once. */
export interface ZoneClassifier {
  classify(path: string): Promise<FileClass>
  /** The descriptor of a set at this commit, or undefined when it has none / it does not parse. */
  descriptor(set: string): Promise<DatasetDescriptor | undefined>
}

/**
 * Build a classifier for one commit of one repository.
 * @param repo - repository (common dir or checkout).
 * @param commit - a resolved commit sha.
 * @returns the classifier.
 */
export function zoneClassifier(repo: string, commit: string): ZoneClassifier {
  const sets = new Map<string, Promise<SetIndex | undefined>>()
  const indexOf = (set: string): Promise<SetIndex | undefined> => {
    let found = sets.get(set)
    if (found === undefined) {
      found = (async () => {
        let descriptor: DatasetDescriptor
        try {
          descriptor = await loadDescriptor(repo, commit, set)
        } catch {
          return undefined
        }
        const claimed = new Map<string, string>()
        try {
          const registry = await buildRegistry(repo, commit, set, descriptor)
          for (const [key, files] of registry.entries) {
            const layer = key.split('\0')[1]!
            for (const file of files) claimed.set(file.object, layer)
          }
        } catch {
          // A register that fails to build is validate's report; the files
          // then classify by directory alone.
        }
        return { descriptor, layers: new Set(descriptor.layers.map(layer => layer.name)), claimed }
      })()
      sets.set(set, found)
    }
    return found
  }
  return {
    async descriptor(set) {
      return (await indexOf(set))?.descriptor
    },
    async classify(path) {
      const parts = path.split('/')
      if (parts[0] !== DATASETS_DIR || parts.length < 3) return { zone: 'outside' }
      const set = parts[1]!
      const rest = parts.slice(2)
      if (rest.length === 1 && rest[0] === DATASET_DESCRIPTOR) return { zone: 'descriptor', set }
      const index = await indexOf(set)
      if (index === undefined) return { zone: 'passthrough', set }
      const homed = index.claimed.get(path)
      if (rest[0] === 'items' && rest.length >= 3) {
        const item = rest[1]!
        if (rest.length === 3 && rest[2] === ITEM_METADATA) return { zone: 'item-meta', set, item }
        if (homed !== undefined) return { zone: 'layer', set, item, layer: homed }
        if (rest.length >= 4 && index.layers.has(rest[2]!)) return { zone: 'layer', set, item, layer: rest[2]! }
        return { zone: 'passthrough', set, item }
      }
      if (rest.length >= 2 && index.layers.has(rest[0]!)) return { zone: 'layer', set, layer: rest[0]! }
      return { zone: 'passthrough', set }
    },
  }
}

/**
 * The layers agents may read in one set: the registration's own list when it
 * names the set, else every layer the descriptor does not mark
 * `modelFacing: false` (the floor).
 * @param descriptor - the set's descriptor.
 * @param registered - the registration's layers for the set, if any.
 * @returns the agent-visible layer names.
 */
export function agentLayersOf(descriptor: DatasetDescriptor, registered: readonly string[] | undefined): Set<string> {
  if (registered !== undefined) return new Set(registered)
  return new Set(descriptor.layers.filter(layer => layer.modelFacing !== false).map(layer => layer.name))
}

/**
 * Whether an agent granted `agentLayers` sees a classified path.
 * @param file - the classification.
 * @param agentLayers - the set's agent-visible layers.
 * @returns true for every zone but a non-granted layer and `outside`.
 */
export function agentSees(file: FileClass, agentLayers: ReadonlySet<string>): boolean {
  if (file.zone === 'outside') return false
  if (file.zone === 'layer') return agentLayers.has(file.layer!)
  return true
}

/** One changed path between two commits, classified. */
export interface ClassifiedChange extends FileClass {
  status: 'A' | 'M' | 'D'
  path: string
  /** Whether an agent under the registration sees this path (on the side it exists on). */
  visible: boolean
}

/**
 * Every change between two commits, each with its zone and whether agents see
 * it — the update gate's input and the update review's file list. History
 * that is not linear (a rewritten branch) reports `linear: false`: nothing
 * about it can be trusted to be invisible.
 * @param repo - repository (common dir).
 * @param from - the confirmed commit.
 * @param to - the branch tip.
 * @param registered - the registration's per-set layers (`entry.sets`).
 * @returns the classified changes and whether `from` is an ancestor of `to`.
 */
export async function classifyChanges(
  repo: string,
  from: string,
  to: string,
  registered: Readonly<Record<string, { layers: string[] }>>,
): Promise<{ linear: boolean; changes: ClassifiedChange[] }> {
  let linear: boolean
  try {
    linear = await isAncestor(repo, from, to)
  } catch {
    // The confirmed commit is gone (gc'd after a rewrite): same as non-linear.
    return { linear: false, changes: [] }
  }
  const before = zoneClassifier(repo, from)
  const after = zoneClassifier(repo, to)
  const changes: ClassifiedChange[] = []
  for (const change of await diffPaths(repo, from, to)) {
    const side = change.status === 'D' ? before : after
    const file = await side.classify(change.path)
    let visible = file.zone !== 'outside'
    if (file.zone === 'layer' && file.set !== undefined) {
      const descriptor = await side.descriptor(file.set)
      visible = descriptor === undefined || agentSees(file, agentLayersOf(descriptor, registered[file.set]?.layers))
    }
    changes.push({ ...file, status: change.status, path: change.path, visible })
  }
  return { linear, changes }
}
