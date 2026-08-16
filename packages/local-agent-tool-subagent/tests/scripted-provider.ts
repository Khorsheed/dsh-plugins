/**
 * A package-local scripted subagent provider that records the resolved
 * requests it receives, so the family tool's tests exercise the real
 * `ctx.subagents.start()` dispatch without spawning a CLI.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProvider, SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'

export interface ScriptedProviderConfig {
  /** Provider name registered in `ctx.subagents`. */
  name: string
  /** Record of every resolved request the provider accepted. */
  started: Array<{ label?: string; task: string }>
  /** Consumed delegation intents, mirroring how a family provider pops them. */
  taken: Array<{ kind: string; childSessionId?: string; cliSessionId?: string }>
}

/**
 * A one-shot provider that publishes an immediate completed run echoing the
 * task. The run id equals a fixed child session id, matching the family
 * providers' session-backed contract, and it consumes one staged delegation
 * intent per start like a real family provider.
 */
export function mountScriptedProvider(ctx: Context, config: ScriptedProviderConfig): () => void {
  const provider: SubagentProvider = {
    name: config.name,
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start(request) {
      const task = request.prompt
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('')
      config.started.push({ ...request.label === undefined ? {} : { label: request.label }, task })
      const registry = ctx.get('localAgent') as {
        takeDelegationIntent(parentSessionId: string, provider: string): { kind: string; childSessionId?: string; cliSessionId?: string } | undefined
      } | undefined
      const intent = registry?.takeDelegationIntent(request.parent.session.id, config.name)
      if (intent !== undefined) config.taken.push(intent)
      const result: Promise<SubagentResult> = settleRunResult({
        attempt: async () => ({ output: [{ type: 'text', text: `done: ${task}` }], stopReason: 'completed' }),
        collectOutput: () => [],
        cancelled: () => false,
        signal: request.signal,
        onAbort: () => {},
      })
      return subprocessRunHandle({
        id: SessionId('scripted-child'),
        result,
        signal: request.signal,
        onAbort: () => {},
        requestCancel: () => {},
        teardown: async () => {},
      })
    },
  }
  return ctx.subagents.registerProvider(provider)
}
