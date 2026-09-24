/**
 * The ONE narrow write into an existing condition declaration: `model.endpoint`.
 *
 * Everything else that writes a condition file writes a NEW one. `draft.ts`
 * mints copies and refuses to overwrite; `provision.ts` corrects `home.sha`
 * from what it measured, which is a transcription of a measurement rather than
 * an authored value. This module is the third case and deliberately the
 * smallest: a person changing one declared field on the conditions page.
 *
 * It exists because `model.endpoint` is a field the pre-run readiness gate
 * refuses a condition for leaving null, and until I5·T58 there was no way to
 * set it on a condition that already existed — not on the page, not in the
 * draft tool's editable set. The person opened the JSON in an editor, twice,
 * and had to write the same value both times or the experiment silently grew a
 * second factor (I5·T39 · G6).
 *
 * The edit is a factor change like any other: `model.endpoint` is condition
 * hash input, so the document that comes out is a different subject from the
 * one that went in, and any lock beside it is now stale. The answer says so;
 * nothing here writes or deletes a lock, because provisioning is the only
 * writer of one and it is a human act taken separately.
 * @module @khorsheed/dsh-eval
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { hashConditionDocument } from './hash.ts'
import { CONDITION_ID_RE, CONDITION_SCHEMA_ID } from './schema.ts'
import { conditionDiagnostics, expandHome, type EvalDiagnostic } from './validate.ts'

/** Thrown when the declaration cannot be edited at all. */
export class EvalConditionEditRefused extends Error {
  constructor(message: string, readonly diagnostics: EvalDiagnostic[] = []) {
    super(message)
  }
}

/** What one edit changed. */
export interface ConditionEditReport {
  condition: string
  /** Empty since T73 (the library is deployment-wide); kept for old readers. */
  dataset: string
  /** The declaration that was written (absolute). */
  conditionPath: string
  /** The field's value before the edit. */
  before: string | null
  /** The field's value after it. */
  after: string | null
  /** The condition hash as the declaration now reads. */
  sha: string
  /** The hash before the edit; equal to `sha` when the value was already this. */
  shaBefore: string
  /** Whether anything was written (a no-op edit writes nothing). */
  written: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `child` is `root` or sits inside it. */
function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Where the condition library's declaration of a condition lives.
 * @param root - the library root (the directory holding `conditions/` — the eval state root).
 * @param condition - the condition id (its file stem).
 * @returns the absolute path.
 * @throws {@link EvalConditionEditRefused} when the id could not be a file
 *   name — it is joined into a path, so an id carrying a separator would
 *   address a file outside the library.
 */
export function conditionPathIn(root: string, condition: string): string {
  if (!CONDITION_ID_RE.test(condition)) {
    throw new EvalConditionEditRefused(
      `condition id ${JSON.stringify(condition)} is not a usable name — it doubles as a file name, so it must start with a `
      + 'letter or digit and hold only letters, digits, dot, dash and underscore.',
    )
  }
  return join(resolve(expandHome(root)), 'conditions', `${condition}.json`)
}

/**
 * Set one condition's `model.endpoint`.
 *
 * Writes only inside the condition library, and only that one field; the
 * rest of the document is carried through as it was parsed, so key order and
 * every other value survive. Nothing is committed.
 * @param options - the library root, the condition, and
 *   the value (null declares "not resolved yet", which the readiness gate
 *   refuses — legal, and sometimes what a person means).
 * @returns what changed, including the condition hash on both sides.
 * @throws {@link EvalConditionEditRefused} when the declaration cannot be
 *   read, is not a valid `dataseek.condition/1`, or sits outside the library.
 */
export async function setConditionEndpoint(
  options: { root: string; condition: string; endpoint: string | null },
): Promise<ConditionEditReport> {
  const root = resolve(expandHome(options.root))
  const conditionAbs = conditionPathIn(root, options.condition)
  if (!isInside(root, conditionAbs)) {
    throw new EvalConditionEditRefused(`condition ${conditionAbs} is not inside the condition library ${root}`)
  }
  let document: unknown
  try {
    document = JSON.parse(await readFile(conditionAbs, 'utf8'))
  } catch (error) {
    throw new EvalConditionEditRefused(
      `cannot read condition ${basename(conditionAbs)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const { errors } = conditionDiagnostics(document)
  if (errors.length > 0 || !isPlainObject(document)) {
    throw new EvalConditionEditRefused(
      `condition ${options.condition} violates ${CONDITION_SCHEMA_ID} — editing one field of a declaration nothing else `
      + 'accepts would leave it just as unusable',
      errors,
    )
  }
  const endpoint = options.endpoint === null || options.endpoint.trim() === '' ? null : options.endpoint.trim()
  const model = isPlainObject(document['model']) ? { ...document['model'] } : {}
  const before = typeof model['endpoint'] === 'string' ? model['endpoint'] : null
  const shaBefore = hashConditionDocument(document)
  if (before === endpoint) {
    return {
      condition: options.condition,
      dataset: '',
      conditionPath: conditionAbs,
      before,
      after: endpoint,
      sha: shaBefore,
      shaBefore,
      written: false,
    }
  }
  model['endpoint'] = endpoint
  document['model'] = model
  try {
    await writeFile(conditionAbs, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new EvalConditionEditRefused(
      `cannot write condition ${basename(conditionAbs)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return {
    condition: options.condition,
    dataset: '',
    conditionPath: conditionAbs,
    before,
    after: endpoint,
    sha: hashConditionDocument(document),
    shaBefore,
    written: true,
  }
}
