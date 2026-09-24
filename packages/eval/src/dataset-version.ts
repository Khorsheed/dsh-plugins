/**
 * WHICH COMMIT a new experiment pins (T73).
 *
 * A draft used to leave `dataset.commit` null and let the run's snapshot pin
 * whatever the working copy held that day. That made "the same experiment,
 * again" silently a different one whenever the dataset moved, and a
 * comparison across two experiments meaningless unless somebody checked.
 * A draft now pins a commit when it is written, and the choice is made here.
 *
 * The candidates are the commits a person could plausibly mean:
 * - the latest commit of the tracked branch (the registration's `latest`);
 * - every commit an existing experiment on the same `<registry>/<set>` pins,
 *   when that experiment shares at least one condition with the new draft —
 *   those are the experiments a reader will compare this one against.
 *
 * When every candidate holds byte-identical `items/` and `schemas/` trees
 * (compared by git tree id), the choice does not matter to any result and the
 * latest wins silently. Otherwise the draft is refused and the agent is told
 * to ask the person: guessing here is exactly the silent drift this replaces.
 * An explicit commit is accepted only when it is one of the candidates, so a
 * typo or a stray ref cannot slip past the same question.
 * @module
 */
import type { DatasetsRegistryFace } from './faces.ts'
import type { ExperimentRecord } from './experiment-store.ts'

/** One commit a draft could pin, and why it is a candidate. */
export interface DatasetVersionCandidate {
  commit: string
  /** The tracked branch's latest commit. */
  latest: boolean
  /** Experiments that pin this commit and share a condition with the draft. */
  experiments: string[]
}

/** The decision: the commit to pin, and the candidates it was chosen from. */
export interface DatasetVersionDecision {
  commit: string
  candidates: DatasetVersionCandidate[]
}

/** Why no commit could be chosen — the message is agent-facing. */
export class DatasetVersionRefused extends Error {
  constructor(message: string, readonly candidates: DatasetVersionCandidate[]) {
    super(message)
  }
}

/** The registry reads the decision needs. */
export type DatasetVersionFace = Pick<DatasetsRegistryFace, 'registration' | 'registryObjectId' | 'resolveRegistryCommit'>

/** One candidate as one line of the refusal. */
function candidateLine(candidate: DatasetVersionCandidate, latestDate: string): string {
  const why: string[] = []
  if (candidate.latest) why.push(`latest on the tracked branch${latestDate === '' ? '' : `, ${latestDate}`}`)
  if (candidate.experiments.length > 0) why.push(`pinned by ${candidate.experiments.join(', ')}`)
  return `  - ${candidate.commit.slice(0, 7)} (${why.join('; ')})`
}

/**
 * Decide the commit for a draft of `<registry>/<set>` running `conditions`.
 * @param face - the datasets registry reads.
 * @param input.registry - the registration id.
 * @param input.set - the dataset set.
 * @param input.conditions - every condition the draft names (players and judges).
 * @param input.experiments - the deployment's existing experiments.
 * @param input.commit - the commit the caller asked for, if any.
 * @throws {@link DatasetVersionRefused} when the version is ambiguous or the asked commit is no candidate.
 */
export async function decideDatasetVersion(
  face: DatasetVersionFace,
  input: {
    registry: string
    set: string
    conditions: readonly string[]
    experiments: ReadonlyArray<ExperimentRecord & { conditions: readonly string[] }>
    commit?: string | null
  },
): Promise<DatasetVersionDecision> {
  const registration = await face.registration(input.registry)
  const byCommit = new Map<string, DatasetVersionCandidate>()
  byCommit.set(registration.latest.commit, { commit: registration.latest.commit, latest: true, experiments: [] })
  const wanted = new Set(input.conditions)
  for (const record of input.experiments) {
    const pin = record.meta.dataset
    if (pin.registry !== input.registry || pin.set !== input.set) continue
    if (!record.conditions.some(id => wanted.has(id))) continue
    const candidate = byCommit.get(pin.commit) ?? { commit: pin.commit, latest: false, experiments: [] }
    candidate.experiments.push(record.id)
    byCommit.set(pin.commit, candidate)
  }
  const candidates = [...byCommit.values()]
  const listing = candidates.map(candidate => candidateLine(candidate, registration.latest.date)).join('\n')

  const asked = typeof input.commit === 'string' ? input.commit.trim() : ''
  if (asked !== '') {
    let full: string | undefined
    try {
      full = await face.resolveRegistryCommit(input.registry, asked)
    } catch {
      full = undefined
    }
    const hit = full === undefined ? undefined : byCommit.get(full)
    if (hit === undefined) {
      throw new DatasetVersionRefused(
        `commit ${JSON.stringify(asked)} is not a candidate version for ${input.registry}/${input.set}. `
        + `A draft pins the tracked branch's latest commit or a commit an experiment with the same conditions already pins:\n${listing}\n`
        + 'Pass one of these as `commit`.',
        candidates,
      )
    }
    return { commit: hit.commit, candidates }
  }

  if (candidates.length > 1) {
    const set = `datasets/${input.set}`
    const trees = await Promise.all(candidates.map(async candidate => [
      await face.registryObjectId(input.registry, candidate.commit, `${set}/items`),
      await face.registryObjectId(input.registry, candidate.commit, `${set}/schemas`),
    ].join(':')))
    if (new Set(trees).size > 1) {
      throw new DatasetVersionRefused(
        `version is ambiguous for ${input.registry}/${input.set}: these commits hold different items/ or schemas/, `
        + `and results pinned to different ones do not compare:\n${listing}\n`
        + 'Ask the person which version this experiment should pin with ask_user_question, then draft again with that '
        + '`commit`. If they skip the question, stop — do not pick one yourself.',
        candidates,
      )
    }
  }
  return { commit: registration.latest.commit, candidates }
}
