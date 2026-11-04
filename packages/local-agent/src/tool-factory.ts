/**
 * The family-owned delegation-tool factory: the model-facing subagent tool
 * over one configured `ctx.subagents` provider, replacing the official
 * tool-subagent rows in the harness bundles. The schema is the official subset
 * (`description`/`prompt`) plus an optional `resume` handle: the dsh child
 * session id returned by the first delegation's result text. A resumed call
 * continues the SAME CLI conversation instead of starting a fresh one — the
 * family providers spawn their CLI's resume command (kimi `-S`, claude
 * `--resume`, codex `exec resume`) under the harness scoped home, appending
 * the new round into the same dsh child session.
 *
 * The resume target never travels inside the prompt: task text is untrusted,
 * and a forged handle embedded there would hijack another session's context.
 * The tool instead carries the handle as a first-class `resume` parameter and
 * resolves it through the localAgent service, which rejects any handle that
 * does not name a delegation recorded for THIS parent session and provider.
 *
 * Every call runs through the core's single execution entry,
 * `ctx.localAgent.run()` (batch 5 S4): it queues in the member's execution
 * ledger with every other caller's rounds, then starts through
 * `ctx.subagents.startActivation()` with caller delivery, so lifecycle events
 * (`subagent/start`/`subagent/end`) and the standard 子代理 surface are
 * unchanged. The durable dsh child session id is minted HERE for a fresh
 * call (host 0.2.1 forbids a provider run id naming a live Session, so the
 * activation never surfaces it).
 *
 * This module used to ship as the standalone companion package
 * `@khorsheed/dsh-local-agent-tool-subagent` (0.1.x); the family fold moved it
 * into the core package as the `./tool-factory` export (the worktrees 0.3.0 /
 * room 0.2.0 pattern, one level down: the mountable row is each PROVIDER's own
 * `./tool` composition entry, which binds its provider/toolName defaults and
 * passes its package name as the tool-origin owner). `local-agent-dsh`
 * consumes the same factory for its settings-driven dynamic `subagent_dsh`
 * mount. The factory itself is never a loader row.
 *
 * @module @khorsheed/dsh-local-agent/tool-factory
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
// Type-only: this package's own `Context.localAgent` service augmentation.
import type {} from './index.ts'
import type { LocalAgentExecutionIntent } from './types.ts'

/**
 * Tag the model-visible tool with its origin (AGENTS.md § Tool origin tagging;
 * seam S12): the capability catalog reads this `Symbol.for`-keyed tag back
 * through `ctx.tools.get()`. This factory registers on behalf of every family
 * provider, so the owner arrives as a PARAMETER — the calling entry's own
 * package identity — never a hardcoded package name. The tag is host-side
 * only and never travels on the model wire.
 */
const definePluginTool = <T extends object>(def: T, owner: string): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner },
  })

/**
 * Model-visible self-description appended to a FRESH delegation's result, so
 * the model can continue the same conversation in a later round. Pinned
 * verbatim; the resume tool's `resume` parameter carries the handle.
 */
export const RESUME_HINT_PREFIX = '追问请带 resume="'

/** Resolved delegation-tool configuration (the `./tool` entry's Config post-defaults). */
export interface SubagentToolConfig {
  /** The `ctx.subagents` provider name to start runs on (e.g. `kimi-cli`). */
  provider: string
  /** Model-facing tool name (e.g. `subagent_kimi`). */
  toolName?: string
}

/**
 * The Config schema of a provider's `./tool` composition entry: every field
 * optional, defaulting to the CALLING provider's own values, so a preset row
 * needs no config (`- id: tool-subagent-kimi / name:
 * '@khorsheed/dsh-local-agent-kimi/tool'` mounts the kimi delegation tool).
 *
 * Bare `z` return annotation: `z<Config>` fails schemastery 3.18.4's variance
 * under exactOptionalPropertyTypes (TS2375) and dropping the annotation trips
 * TS2742; the interface stays the apply signature's contract.
 */
export function subagentToolConfigSchema(provider: string, toolName: string): z {
  return z.object({
    provider: z.string().default(provider),
    toolName: z.string().default(toolName),
  })
}

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
      // The seam carries provider-authored failure detail in `diagnostic`
      // (bounded, content-free); without it the parent only ever saw the
      // generic line and every CLI failure looked identical.
      return result.diagnostic === undefined ? 'subagent run failed' : `subagent run failed: ${result.diagnostic}`
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
function withPartialText(error: string, output: readonly ContentBlock[]): string {
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
      + 'the first result as `resume`. '
      + 'This is the one-shot path — it fits a task you will not revisit. When you expect to work with '
      + 'the SAME agent over several rounds (review → fix → re-review style iteration) and the '
      + '`room_invite` tool is available, prefer inviting it as a named room member instead: name it by '
      + 'its function (e.g. "design-review", "restart-test") so later rounds can address it by role and '
      + 'reuse the context it has accumulated.',
    promptDescription:
      'The complete, self-contained task for the subagent. It does not share this conversation\'s '
      + 'context, so include everything it needs. Never embed a resume handle inside this text.',
    resumeDescription:
      'Optional dsh child session id returned by the first delegation\'s result text, to continue that '
      + 'same CLI conversation in a later round. Omit for a fresh delegation. Never embed the handle '
      + 'inside `prompt` — pass it here.',
  }
}

/**
 * Mount the family delegation tool on one provider: register the
 * model-visible tool while the provider is registered, mirroring provider
 * lifecycle (sibling load order and HMR replacement can change provider
 * availability while the calling fiber stays active).
 * @param ctx - the calling entry's plugin context (a preset-scope mount, or
 * local-agent-dsh's toggle-owned dynamic plugin).
 * @param config - resolved provider/toolName pair.
 * @param owner - the calling package's own name, stamped as the tool-origin
 * owner (never hardcoded here — this factory serves every family provider).
 */
/**
 * A family tool call's execution facts: caller `tool`, the call id as the
 * caller's handle, cause `tool-call` (this also covers a room's main agent
 * continuing a member directly — user decision 2026-11-03 ④), and the task
 * `turn:<n>` of the calling session when its `tool/call` event names the turn.
 * @param session - the calling (parent) session.
 * @param callId - the model-visible call id (the root of a PTC dispatch).
 */
export function toolCallExecution(session: Session, callId: string): LocalAgentExecutionIntent {
  const sessionId = String(session.id)
  let turn: number | undefined
  try {
    const call = session.snapshotEvents().findLast(event => event.type === 'tool/call' && String((event.data as { callId?: unknown }).callId) === callId)
    const value = (call?.data as { turn?: unknown } | undefined)?.turn
    if (typeof value === 'number' && Number.isFinite(value)) turn = value
  } catch { /* A session without a readable log records no task. */ }
  return {
    caller: 'tool',
    callerRef: callId,
    cause: { kind: 'tool-call', sessionId, callId },
    ...turn === undefined ? {} : { task: { sessionId, id: `turn:${turn}` } },
  }
}

export function mountSubagentDelegationTool(ctx: Context, config: SubagentToolConfig, owner: string): void {
  const toolName = config.toolName ?? 'subagent'
  const wording = familyWording()
  let disposeTool: (() => void) | undefined
  const mount = (): void => {
    disposeTool = ctx.tools.register(definePluginTool(defineTool({
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
        // The durable child identity: the recorded resume handle, or minted
        // here for a fresh delegation (host 0.2.1 activations never surface
        // it — a provider run id naming a live Session is DUPLICATE_CHILD,
        // so the provider publishes a per-execution id and this id rides the
        // staged intent instead).
        const childSessionId = resumeHandle ?? randomUUID()
        // The execution record's facts (batch 5 S1): this tool call caused
        // the round, and the task is the calling session's turn that made the
        // call (read from the call's own `tool/call` event, never guessed).
        const execution = toolCallExecution(parent.session, String(exec.rootCallId ?? exec.callId))
        // The single execution entry (batch 5 S4): the round queues in the
        // member's ledger behind any other execution of the same member — a
        // composer input, a room dispatch, another tool call — so a member
        // never runs two rounds at once (user decision 2026-11-03 ④: a room's
        // main agent may continue a member this way). The core decides
        // first round vs continuation (the handle has a delegation record),
        // reattaches an evicted child, tracks the run for `/local-agent stop`,
        // and writes the execution's records. The tool's own signal cancels
        // it while queued and while running.
        const handle = await ctx.localAgent.run({
          parentSessionId,
          provider: config.provider,
          member: { childSessionId },
          input: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          caller: execution.caller,
          ...execution.cause === undefined ? {} : { cause: execution.cause },
          ...execution.task === undefined ? {} : { task: execution.task },
          ...execution.callerRef === undefined ? {} : { callerRef: execution.callerRef },
          label: args.description,
          signal: exec.signal,
        })
        const run: SubagentRun = await handle.started
        const settled = await settleForegroundRun(run)
        if (resume === undefined) {
          // Fresh delegation: self-describe the resume handle (the dsh child
          // session id minted above and staged on the intent) so the model
          // can continue the same conversation in a later round.
          return {
            ...settled,
            output: [...settled.output, {
              type: 'text',
              text: `${RESUME_HINT_PREFIX}${childSessionId}"`,
            }],
          }
        }
        return settled
      },
    }), owner))
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
    ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${toolName}" tool will register when it appears`)
  }
}
