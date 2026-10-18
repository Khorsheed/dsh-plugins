/**
 * The session-granted TypeSafe model tool — this package's `./tool`
 * composition entry (the canvas `./agent` pattern) for agent-preset
 * compositions. The row provides NO service (the preset-mount isolate-realm
 * rule forbids service rows); it registers the model-facing `typesafe_judge`
 * tool into the host tools registry, contributes its guidance section, and
 * registers the `typesafe-decide` skill, all delegating to the global
 * `ctx.typesafe` service core the core row provides at the profile root.
 * Granting is therefore per-session: a preset names the row, its sessions get
 * the tool; every other preset's sessions get nothing.
 *
 * This entry used to ship as the standalone companion package
 * `@khorsheed/dsh-typesafe-tool`; the host-021 wave fold (2026-10-18, the T88
 * evaluation-family / room 0.2.0 precedent) moved it into the core package as
 * this subpath row, and the old package name is retired. An agent preset's
 * `agent.cordis.yml` references the row by name:
 * `- id: typesafe-tool / name: '@khorsheed/dsh-typesafe/tool'` (the row id is
 * unchanged). The package's own bundle patch mounts ONLY the core row — a
 * profile-root tool row would grant every session, exactly what the split
 * removed.
 * @module @khorsheed/dsh-typesafe/tool
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls this package's `Context.typesafe` service augmentation.
import type {} from './index.ts'
import type { TypeSafeService } from './service.ts'
import type { Decision, JudgeResult, QuestionSpec } from './types.ts'

const PACKAGE_NAME = '@khorsheed/dsh-typesafe'

/**
 * Tag the model-visible tool with its origin (AGENTS.md § Tool origin
 * tagging): the capability catalog reads this `Symbol.for`-keyed tag back
 * through `ctx.tools.get()`, so the tool attributes to THIS package. The tag is
 * host-side only and never travels on the model wire.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** The credential reference this row's tool expects the core to resolve. */
const API_KEY_REF = 'TYPESAFE_API_KEY'

/* ── the tool's arguments ──────────────────────────────────────────────────── */

/** Plugin configuration. */
export interface TypeSafeToolConfig {
  /**
   * Whether this row grants the model face at all: the `typesafe_judge` tool,
   * its guidance section, and the `typesafe-decide` skill all move together
   * (guidance about an absent tool is a wrong instruction, not a harmless one).
   */
  tools?: boolean
}

export const Config: z<TypeSafeToolConfig> = z.object({
  tools: z.boolean().default(true),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'typesafe-tool'

/**
 * The `typesafe` core is a declared inject (the owning-family companion
 * exception to the community-service probe rule): a preset's standing scope
 * mounts at registry-activation time, BEFORE the profile's later bundle rows
 * provide the core, so a one-shot ctx.get probe at apply saw ABSENT there and
 * nothing re-ran the row (rc.1 boot order; 3080 production 2026-09-27). The
 * declared inject pends the row until the core provides, then the whole body
 * applies. The tools/prompt/skill registries still join through deferred
 * injection so their mount order cannot strand the registrations.
 */
export const inject = ['typesafe']

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/** The narrow skill-registry slice this plugin registers into. */
interface SkillRegistrySlice {
  register(skill: {
    name: string
    description: string
    content: string
    source: string
    provider?: string
    metadata?: Readonly<Record<string, unknown>>
  }): () => void
}

/* ── guidance ──────────────────────────────────────────────────────────────── */

/** The tool-description guidance, kept next to the section so the two cannot drift. */
const TOOL_DESCRIPTION =
  'Ask TypeSafe System One (Jev) for a fast typed judgement about a piece of state — a calibrated yes/no '
  + 'probability, one option out of a defined set, or a level on an ordered scale. Use it for semantic calls you '
  + 'would otherwise guess at (does this message need a reply, which team owns this, how urgent is this). Do NOT '
  + 'use it for exact lookups, arithmetic, or anything ordinary code decides. Ask one narrow question per entry '
  + 'and put every independent question in ONE call: batching is markedly cheaper and faster than separate calls. '
  + 'Never build a CLI, script, or wrapper process for TypeSafe — this tool is the path.'

const GUIDANCE =
  'TypeSafe judgements go through the typesafe_judge tool — never through a shell command, a wrapper script, or a '
  + 'new CLI. Ask one narrow question per entry, define its answers in `instructions` (and in `choices`/`levels`), '
  + 'and put every independent question into one call. Compare across dimensions with separate questions in the '
  + 'same call rather than one compound question. Read a noul as a probability (no separate confidence); read a '
  + 'choice/score together with its confidence and distribution. Keep thresholds in code, not in your head: when '
  + 'the decision needs a cutoff, state it in `instructions` and report the value you got. Treat calibrated '
  + 'probabilities as evidence, not truth.'

/* ── the skill ─────────────────────────────────────────────────────────────── */

interface SkillFile {
  readonly name: string
  readonly description: string
  readonly content: string
}

/**
 * Load the shipped `typesafe-decide` skill. A missing or malformed file is a
 * warning, never a boot failure — this is a discovery aid.
 * @returns the parsed skill, or undefined when it cannot be read.
 */
function loadSkill(): SkillFile | undefined {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'typesafe-decide', 'SKILL.md')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  const frontmatter = match?.[1] ?? ''
  const skillName = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim()
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim()
  const content = match?.[2]
  if (skillName === undefined || description === undefined || content === undefined) return undefined
  return { name: skillName, description, content }
}

/* ── rendering ─────────────────────────────────────────────────────────────── */

/** `0.82` — probabilities read best with two decimals. */
const probability = (value: number): string => value.toFixed(2)

/** One decision as one line of model-facing text. */
function decisionLine(decision: Decision): string {
  const head = `${decision.id} [${decision.type}]`
  if (decision.type === 'noul') return `${head}: ${probability(Number(decision.answer))}`
  const confidence = decision.confidence === undefined ? '' : ` confidence=${probability(decision.confidence)}`
  const distribution = decision.probabilities === undefined
    ? ''
    : ` ${Object.entries(decision.probabilities).map(([key, value]) => `${key}=${probability(value)}`).join(' ')}`
  const label = decision.type === 'score' && decision.legend !== undefined
    ? ` "${decision.legend[String(decision.answer)] ?? ''}"`
    : ''
  return `${head}: ${String(decision.answer)}${label}${confidence}${distribution}`
}

/** The whole judgement as compact text, or the failure as a sentence. */
export function formatResult(result: JudgeResult): string {
  if (!result.ok) {
    return `typesafe_judge could not answer (${result.reason}): ${result.detail}\n`
      + 'If this judgement is essential, tell the human which credential or network dependency is missing; '
      + 'do not retry the same call blindly and do not fake the answer.'
  }
  const { judgement } = result
  const usage = judgement.usage === undefined ? '' : ` tokens=${judgement.usage.inputTokens}/${judgement.usage.outputTokens}`
  const header = `${judgement.model} ${judgement.latencyMs}ms${judgement.cached ? ' cached' : ''}${usage}`
  return [header, ...judgement.decisions.map(decisionLine)].join('\n')
}

/** Turn the model's arguments into wire questions, rejecting malformed ones. */
export function toSeamQuestions(questions: readonly unknown[]): QuestionSpec[] | string {
  if (questions.length === 0) return 'at least one question is required'
  if (questions.length > 32) return 'at most 32 questions may be asked in one call'
  const seen = new Set<string>()
  const out: QuestionSpec[] = []
  for (const raw of questions) {
    if (raw === null || typeof raw !== 'object') return 'every question must be an object'
    const question = raw as { id?: unknown; type?: unknown; instructions?: unknown; choices?: unknown; levels?: unknown }
    if (typeof question.id !== 'string' || question.id.trim() === '') return 'every question needs a non-empty id'
    if (seen.has(question.id)) return `duplicate question id "${question.id}"`
    seen.add(question.id)
    const instructions = typeof question.instructions === 'string' ? question.instructions : ''
    if (question.type === 'noul') {
      out.push({ id: question.id, type: 'noul', instructions })
      continue
    }
    if (question.type === 'choice') {
      const choices = question.choices
      if (choices === null || typeof choices !== 'object' || Array.isArray(choices)
        || Object.keys(choices as object).length === 0) {
        return `question "${question.id}" is a choice and needs at least one entry in choices`
      }
      const criteria: Record<string, string | null> = {}
      for (const [option, description] of Object.entries(choices as Record<string, unknown>)) {
        const text = typeof description === 'string' ? description.trim() : ''
        criteria[option] = text === '' ? null : text
      }
      out.push({ id: question.id, type: 'choice', instructions, criteria })
      continue
    }
    if (question.type === 'score') {
      const levels = question.levels
      if (!Array.isArray(levels) || levels.length === 0) {
        return `question "${question.id}" is a score and needs at least one entry in levels`
      }
      out.push({ id: question.id, type: 'score', instructions, criteria: levels.map(String) })
      continue
    }
    return `question "${question.id}" has an unknown type "${String(question.type)}"`
  }
  return out
}

/** Read the model's arguments defensively — the wire may carry anything. */
export function parseJudgeArgs(args: unknown): { state: string; questions: readonly unknown[] } {
  const input = (args ?? {}) as { state?: unknown; questions?: unknown }
  return {
    state: typeof input.state === 'string' ? input.state : '',
    questions: Array.isArray(input.questions) ? input.questions : [],
  }
}

/**
 * Build the `typesafe_judge` definition for one service.
 * @param service - the core service this row pends on.
 * @returns the tagged definition, ready to register.
 */
export function typesafeJudgeTool(service: TypeSafeService): ToolDefinition {
  return definePluginTool(defineTool({
    name: 'typesafe_judge',
    description: TOOL_DESCRIPTION,
    parameters: {
      state: {
        type: 'string',
        required: true,
        description: 'The content to judge: the message, ticket or draft, or the named fields carrying the context.',
      },
      questions: {
        type: 'array',
        required: true,
        description: 'One to 32 narrow questions, all answered together in one call.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: {
              type: 'string',
              required: true,
              description: 'Short id for this question; its answer comes back under the same id.',
            },
            type: {
              type: 'string',
              enum: ['noul', 'choice', 'score'],
              required: true,
              description: 'noul = yes/no probability; choice = one of a defined set; score = a level on an ordered scale.',
            },
            instructions: {
              type: 'string',
              required: true,
              description: 'The judgement itself, phrased so it stands alone (no reference to other questions).',
            },
            choices: {
              type: 'object',
              additionalProperties: true,
              description: 'choice only: option name → one-line description. Use "" when the name says enough. '
                + 'Add an other/none option when the list may not cover the input.',
            },
            levels: {
              type: 'array',
              items: { type: 'string' },
              description: 'score only: ordered level descriptions, first to last, each standing on its own.',
            },
          },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args, exec): Promise<string> => {
      const parsed = parseJudgeArgs(args)
      const questions = toSeamQuestions(parsed.questions)
      if (typeof questions === 'string') return `typesafe_judge rejected the call: ${questions}`
      const result = await service.judge(
        { state: parsed.state, questions },
        exec.signal === undefined ? {} : { signal: exec.signal },
      )
      return formatResult(result)
    },
  }))
}

/* ── apply ─────────────────────────────────────────────────────────────────── */

/**
 * Plugin body: register the tool, its guidance and the skill. The declared
 * `typesafe` inject pends the row until the core provides, so mount order can
 * no longer strand it; the in-body guard stays as the defensive direct-call
 * path (tests invoke apply without the loader's inject machinery).
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: TypeSafeToolConfig = {}): void {
  const service = ctx.get('typesafe')
  if (service === undefined) {
    // Degrade, don't explode: the core is not mounted in this composition, so
    // there is nothing to delegate to. A preset naming this row still mounts.
    ctx.logger.info(`${PACKAGE_NAME}: the global typesafe service is absent — typesafe_judge is not registered`)
    return
  }
  if (config.tools === false) return

  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // registry's own mount order on the real composition tree and loses,
  // silently never registering the tool.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(
      () => toolsCtx.tools.register(typesafeJudgeTool(service)),
      `${PACKAGE_NAME}: typesafe_judge tool`,
    )
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({ name: 'typesafe:judge', order: 152, text: GUIDANCE })
  })

  // The skill rides the same deferred door: the registry may mount after us.
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    const skill = loadSkill()
    if (skill === undefined) {
      ctx.logger.warn(`${PACKAGE_NAME}: the shipped typesafe-decide skill could not be read — not registered`)
      return
    }
    // `metadata.credentials` is the capability catalog's own convention: it
    // gives this credential a password field in 「工具与技能」 with no new UI,
    // writing the same store the core resolves `TYPESAFE_API_KEY` through.
    skillCtx.effect(() => skills.register({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source: 'runtime',
      provider: PACKAGE_NAME,
      metadata: {
        credentials: [{
          key: API_KEY_REF,
          label: 'TypeSafe API key (console.typesafe.ai/keys)',
        }],
      },
    }), `${PACKAGE_NAME}: ${skill.name} skill`)
  })
}
