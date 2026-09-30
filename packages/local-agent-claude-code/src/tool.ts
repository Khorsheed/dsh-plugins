/**
 * The session-granted `subagent_claude_code` delegation tool — this package's
 * `./tool` composition entry (the worktrees 0.3.0 / room 0.2.0 fold pattern)
 * for agent-preset compositions. The row provides NO service (the
 * preset-mount isolate-realm rule forbids service rows); it registers the
 * model-facing tool into the host tools registry through the family factory
 * (`@khorsheed/dsh-local-agent/tool-factory`), delegating to the `claude-local`
 * provider this package's main row registers at the profile root — the
 * official tool-row shape (the shipped `tool-bash` rows work the same way).
 * Granting is therefore per-session: a preset names the row
 * (`- id: tool-subagent-claude-code-local / name: '@khorsheed/dsh-local-agent-claude-code/tool'`),
 * its sessions get the tool; every other preset's sessions do not.
 *
 * This row used to mount at the profile ROOT from this package's own bundle
 * patch, pointing at the shared `@khorsheed/dsh-local-agent-tool-subagent`
 * companion package; the family fold retired that package (the factory moved
 * into the family core) and moved the row here. The package's bundle patch
 * now mounts ONLY the provider row — a profile-root tool row would grant
 * every session, exactly what the fold removed.
 *
 * @module @khorsheed/dsh-local-agent-claude-code/tool
 */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type { SubagentToolConfig } from '@khorsheed/dsh-local-agent/tool-factory'
import { mountSubagentDelegationTool, subagentToolConfigSchema } from '@khorsheed/dsh-local-agent/tool-factory'

const PACKAGE_NAME = '@khorsheed/dsh-local-agent-claude-code'

/** This entry's own defaults: a preset row needs no config. */
const DEFAULT_PROVIDER = 'claude-local'
const DEFAULT_TOOL_NAME = 'subagent_claude_code'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'local-agent-claude-code-tool'

/**
 * The family core's `localAgent` service is a declared inject (the
 * owning-family companion exception to the community-service probe rule): a
 * preset's standing scope mounts at registry-activation time, BEFORE the
 * profile's later bundle rows provide the core, so a one-shot ctx.get probe
 * at apply saw ABSENT there and nothing re-ran the row (rc.1 boot order; the
 * worktrees `./tool` entry documents the incident). The declared inject pends
 * the row until the core provides, then the body applies.
 */
export const inject = ['tools', 'subagents', 'localAgent']

/** Config: every field optional, defaulting to THIS provider's own values. */
export interface Config {
  /** The `ctx.subagents` provider name to delegate to (default `claude-local`). */
  provider?: string
  /** Model-facing tool name (default `subagent_claude_code`). */
  toolName?: string
}

// Bare `z` annotation per the shared helper's variance note.
export const Config: z = subagentToolConfigSchema(DEFAULT_PROVIDER, DEFAULT_TOOL_NAME)

/**
 * Plugin body: mount the delegation tool through the family factory, stamped
 * with THIS package as the tool-origin owner (AGENTS.md § Tool origin
 * tagging — the shared factory never hardcodes an owner).
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - row config (schema defaults already applied; the `??`
 * fallbacks cover a direct ctx.plugin caller that bypassed validation).
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: SubagentToolConfig = {
    provider: config.provider ?? DEFAULT_PROVIDER,
    toolName: config.toolName ?? DEFAULT_TOOL_NAME,
  }
  mountSubagentDelegationTool(ctx, resolved, PACKAGE_NAME)
}
