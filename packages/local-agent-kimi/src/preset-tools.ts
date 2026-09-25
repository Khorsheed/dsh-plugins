/**
 * Legacy kimi preset-variant cleanup. Earlier versions of this bundle
 * bootstrapped `standard-kimi`, `code-kimi`, `minimal-kimi`, and `kimi`
 * preset variants into the user preset root so an official-style preset could
 * carry the `subagent_kimi` tool row. The tool row now mounts at the profile
 * root (see the bundle patch), so every preset delegates without variants;
 * this module removes the leftovers once on startup. The repo is pre-release,
 * so no compatibility path is kept — variants that still exist are deleted.
 * @module @khorsheed/dsh-local-agent-kimi/preset-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

/** The variant preset ids earlier bundle versions bootstrapped. */
const LEGACY_VARIANTS = ['standard-kimi', 'code-kimi', 'minimal-kimi', 'kimi'] as const

/**
 * Remove the legacy kimi preset variants from the user preset root. Uses the
 * agent-presets service's remove (which also clears a default that named one
 * of them), so a session later created under a different default no longer
 * points at a deleted composition.
 * @param ctx - host context carrying the agent-presets service.
 */
export async function removeLegacyVariants(ctx: Context): Promise<void> {
  const presets = ctx.get('agentPresets') as { remove(id: string): Promise<void> } | undefined
  if (presets === undefined) return
  for (const id of LEGACY_VARIANTS) {
    try {
      await presets.remove(id)
    } catch (error) {
      // A variant that does not exist (or was already removed) is the success
      // case; anything else is unexpected and worth surfacing.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
}
