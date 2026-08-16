/**
 * Family-owned model-facing delegation over one configured `ctx.subagents`
 * provider, replacing the official tool-subagent rows in the harness bundles.
 * The schema is the official subset (`description`/`prompt`) plus an optional
 * `resume` handle: the dsh child session id returned by the first delegation's
 * result text. A resumed call continues the SAME CLI conversation instead of
 * starting a fresh one — the family providers spawn their CLI's resume command
 * (kimi `-S`, claude `--resume`, codex `exec resume`) under the harness scoped
 * home, appending the new round into the same dsh child session.
 *
 * The resume target never travels inside the prompt: task text is untrusted,
 * and a forged handle embedded there would hijack another session's context.
 * The tool instead carries the handle as a first-class `resume` parameter and
 * resolves it through the localAgent service, which rejects any handle that
 * does not name a delegation recorded for THIS parent session and provider.
 * Continuation rounds still go through `ctx.subagents.start()`, so lifecycle
 * events (`subagent/start`/`subagent/end`) and the standard 子代理 surface are
 * unchanged.
 * @module @khorsheed/dsh-local-agent-tool-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type {} from '@khorsheed/dsh-local-agent'

export const name = 'local-agent-tool-subagent'

/** Services required before the tool can mount. */
export const inject = ['tools', 'subagents', 'localAgent']

/**
 * Model-visible self-description appended to a FRESH delegation's result, so
 * the model can continue the same conversation in a later round. Pinned
 * verbatim; the resume tool's `resume` parameter carries the handle.
 */
export const RESUME_HINT_PREFIX = '追问请带 resume="'

/** Config: which registered provider this tool delegates to, plus its name. */
export interface Config {
  /** The `ctx.subagents` provider name to start runs on (e.g. `kimi-cli`). */
  provider: string
  /**
   * Model-facing tool name (e.g. `subagent_kimi`). Each loaded instance must
   * use a distinct name.
   */
  toolName?: string
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  toolName: z.string().default('subagent'),
})

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    // Merge-extensible union: a backend may add stop reasons. Treat an unknown
    // terminal reason as a failure rather than reporting partial output as success.
    default:
      return `subagent run ended abnormally (${String(result.stopReason)})`
  }
}

/**
 * Append the child's preserved partial answer to a stop-reason error so a
 * truncated or cancelled child's real text still reaches the parent model.
 * @param error - the stop-reason headline.
 * @param output - the child's selected output (`SubagentResult.output`).
 * @returns the headline, extended with the partial text when any exists.
 */
function withPartialText(error: string, output: ContentBlock[]): string {
  const text = output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`
}

type ForegroundToolResult = {
  readonly kind: 'foreground'
  readonly runId: SubagentRun['id']
  readonly output: JsonValue[]
}

/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure.
 */
async function settleForegroundRun(run: SubagentRun): Promise<ForegroundToolResult> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): ForegroundToolResult => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        // The registry converts this throw to isError; partial output is not
        // success, but the preserved partial answer still reaches the parent.
        throw new Error(withPartialText(error, result.output))
      }
      return {
        kind: 'foreground',
        runId: run.id,
        // Content blocks already cross durable JSON boundaries elsewhere;
        // the registry performs the authoritative lossless snapshot here.
        output: result.output as unknown as JsonValue[],
      }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Model-facing wording for the family CLI providers, which never inherit the
 * parent's conversation (they are fresh CLI processes under a scoped home).
 */
function familyWording(): { description: string; promptDescription: string; resumeDescription: string } {
  return {
    description:
      'Delegate a self-contained task to a local coding-agent CLI (separate process, its own scoped home) '
      + 'so it does not consume this conversation\'s context. The subagent returns its result, not its '
      + 'intermediate steps. Give it a complete, standalone prompt: it does not see this conversation. '
      + 'To continue the same CLI conversation in a later round, pass the child session id returned by '
      + 'the first result as `resume`.',
    promptDescription:
      'The complete, self-contained task for the subagent. It does not share this conversation\'s '
      + 'context, so include everything it needs. Never embed a resume handle inside this text.',
    resumeDescription:
      'Optional dsh child session id returned by the first delegation\'s result text, to continue that '
      + 'same CLI conversation in a later round. Omit for a fresh delegation. Never embed the handle '
      + 'inside `prompt` — pass it here.',
  }
}

export function apply(ctx: Context, config: Config): void {
  const toolName = config.toolName ?? 'subagent'
  const wording = familyWording()
  // Mirror provider lifecycle because sibling load order and HMR replacement
  // can change provider availability while this fiber remains active.
  let disposeTool: (() => void) | undefined
  const mount = (): void => {
    disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description: wording.description,
      parameters: {
        description: {
          type: 'string',
          required: true,
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          required: true,
          description: wording.promptDescription,
        },
        resume: {
          type: 'string',
          description: wording.resumeDescription,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'foreground' },
            runId: { type: 'string', required: true },
            output: { type: 'array', required: true, items: { type: 'json' } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: outputValueText(value.output),
        }],
      },
      // Children never mutate the parent session.
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent
        if (!parent) {
          // Non-agent callers provide no parent for delegation ownership.
          throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
        }
        const parentSessionId = parent.session.id
        // A resumed call resolves its handle against the family registry
        // BEFORE any CLI process starts: an unknown handle, a handle owned by
        // another parent session, or a handle served by a different provider
        // is rejected here instead of resuming someone else's context. The
        // resolved target then rides the localAgent service (never the prompt
        // text) into the provider's start.
        const resumeHandle = args.resume
        const resume = resumeHandle === undefined
          ? undefined
          : ctx.localAgent.resolveDelegation(resumeHandle, {
            provider: config.provider,
            parentSessionId,
          })
        if (resumeHandle === undefined) {
          ctx.localAgent.stageDelegationIntent(parentSessionId, config.provider, { kind: 'fresh' })
        } else if (resume !== undefined) {
          ctx.localAgent.stageDelegationIntent(parentSessionId, config.provider, {
            kind: 'resume',
            childSessionId: resumeHandle,
            cliSessionId: resume.cliSessionId,
          })
        }

        const request = {
          label: args.description,
          prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          parent,
        }
        const run: SubagentRun = await ctx.subagents.start(config.provider, {
          ...request,
          signal: exec.signal,
        })
        const settled = await settleForegroundRun(run)
        if (resume === undefined) {
          // Fresh delegation: self-describe the resume handle (the dsh child
          // session id, which equals the run id for a session-backed run) so
          // the model can continue the same conversation in a later round.
          return {
            ...settled,
            output: [...settled.output, {
              type: 'text',
              text: `${RESUME_HINT_PREFIX}${run.id}"`,
            }],
          }
        }
        return settled
      },
    }))
  }

  // Register listeners before checking presence so no synchronous change is missed.
  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === config.provider && disposeTool === undefined) mount()
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== config.provider || disposeTool === undefined) return
    disposeTool()
    disposeTool = undefined
  })
  const present = ctx.subagents.getProvider(config.provider)
  if (present !== undefined) {
    mount()
  } else {
    // A backend fiber may activate later; a misspelled provider remains visible in this log.
    ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? 'subagent'}" tool will register when it appears`)
  }
}
