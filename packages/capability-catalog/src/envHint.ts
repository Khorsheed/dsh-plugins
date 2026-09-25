/**
 * Skill env hint via `tools/post-execute` — a runtime companion context that
 * tells the model about any skill's configured credential env mappings.
 *
 * The catalog injects credentials as trusted per-execution `DSH_<KEY>` env
 * vars (see shellEnv.ts), but a skill's own text references the original
 * `$KEY` name and the model does not derive the alias on its own. This module
 * observes `tools/post-execute` when the `skill` tool loads a skill and appends
 * a generic, per-skill note listing each configured mapping, so the model can
 * use the value without us modifying the user's SKILL.md.
 *
 * Generic: it derives the mappings from the loaded skill's own env-decl keys
 * (decodeEnvDecls) + the credential store, so any future key / skill is
 * covered. It never touches the skill file or the provider's returned content.
 * @module @khorsheed/dsh-capability-catalog/envHint
 */

import type { Context } from '@deepseek-ai/cordis'
import { decodeCredentialDecls, decodeEnvDecls, mergeCredentialDecls, resolveServices } from './skills.ts'

const DSH_PREFIX = 'DSH_'

/** Subscribe to `tools/post-execute`; appends an env-mapping hint for the
 * loaded skill. Returns a disposer. Degrades silently when tools/registry/
 * credentials are absent or the tool is not the skills loader. */
export function installSkillEnvHint(ctx: Context, getScope: () => Promise<unknown | undefined>): void {
  // Subscribe inside the DEFERRED tools inject — a one-shot ctx.get probe loses
  // the hint if tools mounts after this plugin (silently degrading it with no
  // error), while inject fires when the registry appears and never in a
  // composition without one (dropping only the hint, never the boot).
  ctx.inject(['tools'], () => {
    ctx.on('tools/post-execute', (async (
      exec: { name?: string; arguments?: unknown },
      _result: unknown,
      next: () => Promise<unknown>,
    ) => {
    if (exec?.name !== 'skill') return next()
    const skillName = (exec.arguments as { name?: string } | undefined)?.name
    if (typeof skillName !== 'string' || skillName.length === 0) return next()
    const scope = await getScope().catch(() => undefined)
    const { registry, credentials } = resolveServices(ctx)
    if (registry === undefined || credentials === undefined) return next()
    const lookup = scope === undefined ? {} : { scope }
    let def
    try {
      def = await registry.get(skillName, lookup)
    } catch {
      return next()
    }
    if (def === undefined) return next()

    const decls = mergeCredentialDecls(decodeCredentialDecls(def.metadata), decodeEnvDecls(def.content ?? ''))
    const configured: string[] = []
    for (const decl of decls) {
      const info = await credentials.describe(decl.key).catch(() => undefined)
      if (info?.configured === true) configured.push(decl.key)
    }
    if (configured.length === 0) return next()

    const lines = [
      `Runtime credential mapping for ${skillName}:`,
      ...configured.map(k => `- ${k} is configured; in the model shell it is available as ${DSH_PREFIX}${k}. Use it as ${k}="${DSH_PREFIX}${k}" <command>.`),
      `Do not search dotenv files or ask the user for this credential, and do not print either variable.`,
    ]
    const hint = lines.join('\n')

    return {
      kind: 'accept',
      additionalContexts: [{
        id: `capability-catalog-env-hint-${skillName}`,
        role: 'user',
        content: [{ type: 'text', text: hint }],
        // Producer-owned kind: the retired {kind: 'plugin'} wrapper fails the
        // rc.1 native source admission at the durable write (turn-killing).
        source: { kind: 'capability-catalog', plugin: 'capability-catalog', form: 'env-hint' },
      }] as unknown as never,
    }
    }) as never)
  })
}
