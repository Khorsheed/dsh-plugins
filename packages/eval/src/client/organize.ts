/**
 * 「让 Agent 组织」 (T87): the 新建实验 dialog's one action, as pure functions.
 *
 * The dialog collects only what a person already knows — a name, maybe a
 * question, maybe a set and some items — and hands the rest to the planning
 * agent as a sentence in the composer. Nothing here writes a file or sends a
 * message: the request lands in the chat box and the person presses send.
 *
 * Three pieces, each tested on its own:
 * - {@link checkExperimentName}: the name doubles as a file stem, so the rule
 *   is `eval_plan_draft`'s own (`CONDITION_ID_RE` in schema.ts), checked as
 *   the person types so the refusal never waits for the agent;
 * - {@link visibleItems}: placeholder items (the dataset marks them — see
 *   draft.ts `isPlaceholderItem`) are hidden unless asked for;
 * - {@link buildOrganizeRequest}: the structured request — what is settled,
 *   what the agent must walk the person through one by one, which choices get
 *   a suggested default to confirm, and that it ends with a draft, never a start.
 */

import type { EvalDraftItemOption } from '../types.ts'
import type { EvalKey } from './locales.ts'

/**
 * The experiment-name rule, spelled as `eval_plan_draft` spells it: a letter
 * or digit first, then letters, digits, dot, dash, underscore. Kept as a copy
 * rather than imported because schema.ts is the host face (it pulls the plan
 * schema), and this module is browser code; eval's tests pin the two equal.
 */
export const EXPERIMENT_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i

/** Why a name cannot be used, or that it can. */
export type NameCheck =
  | { ok: true }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'start' }
  | { ok: false; reason: 'chars'; bad: string[] }

/**
 * Check an experiment name as the person types it.
 * @param raw - the input's value (trimmed here, as the draft trims it).
 * @returns ok, or which part of the rule it breaks — for `chars`, the
 *   offending characters once each, in order of appearance, so the message
 *   can name them.
 */
export function checkExperimentName(raw: string): NameCheck {
  const name = raw.trim()
  if (name === '') return { ok: false, reason: 'empty' }
  if (EXPERIMENT_NAME_RE.test(name)) return { ok: true }
  const bad: string[] = []
  for (const char of name) {
    if (!/[a-z0-9._-]/i.test(char) && !bad.includes(char)) bad.push(char)
  }
  if (bad.length > 0) return { ok: false, reason: 'chars', bad }
  // Every character is allowed, so the first one is the problem (`.x`, `-x`).
  return { ok: false, reason: 'start' }
}

/**
 * The items the picker lists: every real one, and the placeholders only when
 * the person asked to see them. Order is the set's own.
 * @param items - the set's items with their metadata.
 * @param showPlaceholders - the 「显示占位题」 toggle.
 */
export function visibleItems(items: readonly EvalDraftItemOption[], showPlaceholders: boolean): EvalDraftItemOption[] {
  return items.filter(item => showPlaceholders || !item.placeholder)
}

/**
 * 选题 as the dialog settled it (T90 · second segment): the mode, and what the
 * request must carry for `eval_plan_draft` to redo it — the pool size is said
 * to the person, the seed is passed verbatim.
 */
export type OrganizeSelection =
  | { mode: 'all'; pool: number; includePlaceholders: boolean }
  | { mode: 'random'; count: number; seed: number; pool: number; includePlaceholders: boolean }
  | { mode: 'pick'; items: readonly string[] }

/** What the dialog hands over. Everything but the name is optional. */
export interface OrganizeInput {
  name: string
  question?: string | undefined
  /** `<registration id>/<set>`; empty/undefined = not chosen. */
  dataset?: string | undefined
  /** Item ids, in pick order; empty = not chosen. Read only when `selection` is absent. */
  items?: readonly string[] | undefined
  /** 选题; a pick with no items counts as not chosen. */
  selection?: OrganizeSelection | undefined
}

/**
 * The `selection` argument `eval_plan_draft` takes, spelled as the tool
 * spells it — the request quotes it so the agent passes it verbatim rather
 * than re-deriving a seed.
 * @param selection - the dialog's settled selection.
 */
export function selectionArgument(selection: OrganizeSelection): string {
  const placeholders = selection.mode !== 'pick' && selection.includePlaceholders ? { include_placeholders: true } : {}
  if (selection.mode === 'all') return JSON.stringify({ mode: 'all', ...placeholders })
  if (selection.mode === 'random') {
    return JSON.stringify({ mode: 'random', count: selection.count, seed: selection.seed, ...placeholders })
  }
  return JSON.stringify({ mode: 'pick', items: selection.items })
}

type Translate = (key: EvalKey, params?: Record<string, unknown>) => string

/**
 * Build the request 「让 Agent 组织」 puts in the chat box.
 *
 * Shape: one opening line; the settled choices, each on its own line; the
 * open ones as a numbered walk the agent takes one question at a time; the
 * four that always get a suggested default (对比组 / 判官 / 次数 / 预算); and
 * the closing rule — draft with `eval_plan_draft`, start nothing. The dataset
 * version is deliberately absent: `eval_plan_draft` settles it and asks only
 * when it is ambiguous (SKILL «Datasets are registered»).
 * @param input - the dialog's fields.
 * @param t - the lab dictionary (the request is in the person's language).
 */
export function buildOrganizeRequest(input: OrganizeInput, t: Translate): string {
  const question = input.question?.trim() ?? ''
  const dataset = input.dataset?.trim() ?? ''
  const items = (input.selection?.mode === 'pick' ? input.selection.items : input.items ?? [])
    .map(item => item.trim()).filter(item => item !== '')
  // Items only mean something inside a chosen set.
  const selection = dataset === '' ? undefined : input.selection
  const itemsSettled = selection !== undefined && selection.mode !== 'pick' ? true : items.length > 0

  const settled: string[] = [t('organize.settled.name', { name: input.name.trim() })]
  if (question !== '') settled.push(t('organize.settled.question', { question: question.replace(/\s*\n\s*/g, ' ') }))
  if (dataset !== '') settled.push(t('organize.settled.dataset', { dataset }))
  if (selection?.mode === 'all') {
    settled.push(t(selection.includePlaceholders ? 'organize.settled.allWithPlaceholders' : 'organize.settled.all', {
      count: selection.pool, arg: selectionArgument(selection),
    }))
  } else if (selection?.mode === 'random') {
    settled.push(t(selection.includePlaceholders ? 'organize.settled.randomWithPlaceholders' : 'organize.settled.random', {
      count: selection.count, seed: selection.seed, pool: selection.pool, arg: selectionArgument(selection),
    }))
  } else if (items.length > 0) {
    settled.push(selection === undefined
      ? t('organize.settled.items', { items: items.join(t('organize.join')) })
      : t('organize.settled.pick', { items: items.join(t('organize.join')), arg: selectionArgument({ mode: 'pick', items }) }))
  }

  // The open choices, in the order the agent should ask them: the question
  // first (it decides what is worth comparing), then the set, then its items,
  // then the four that always come with a suggestion.
  const open: string[] = []
  if (question === '') open.push(t('organize.open.question'))
  if (dataset === '') open.push(t('organize.open.dataset'))
  if (!itemsSettled) open.push(t('organize.open.items'))
  open.push(t('organize.open.conditions'), t('organize.open.judge'), t('organize.open.reps'), t('organize.open.budget'))

  return [
    t('organize.intro'),
    '',
    t('organize.settledHeading'),
    ...settled.map(line => `- ${line}`),
    '',
    t('organize.openHeading'),
    ...open.map((line, index) => `${index + 1}. ${line}`),
    '',
    t('organize.defaults'),
    t('organize.finish'),
  ].join('\n')
}
