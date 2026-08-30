/**
 * Host-upgrade self-guidance, host half. Registers the `plugin-upgrade` skill:
 * the runbook an in-instance agent follows when the user asks to move the
 * instance across a host release (fetch the new host into a separate checkout,
 * inventory plugin breakage, apply dual-line fixes, verify on a live
 * acceptance instance, then self-restart with resume). Pull-based discovery —
 * the skill catalog surfaces it exactly when a task smells like an upgrade.
 *
 * The skill ships as a bundle directory (`skills/plugin-upgrade/` carrying
 * reference docs and the supervisor script template beside SKILL.md), so the
 * registration passes `resourceBase` and the catalog can list the bundle.
 * Everything degrades to a warning: a discovery aid must never take a boot
 * down.
 * @module @khorsheed/dsh-plugin-upgrade
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** The slice of the skill registry this package consumes (optional service). */
interface SkillRegistrySlice {
  register: (skill: {
    name: string
    description: string
    content: string
    source: string
    provider?: string
    resourceBase?: { kind: 'directory'; path: string }
  }) => () => void
}

/** The registered skill's parsed shape (what the registry consumes). */
export interface PluginUpgradeSkill {
  name: string
  description: string
  content: string
  source: 'runtime'
  provider: string
  resourceBase: { kind: 'directory'; path: string }
}

/**
 * Read and parse the shipped `plugin-upgrade` SKILL.md into a registration.
 *
 * The bundle carries reference docs and the restart supervisor template beside
 * SKILL.md, so — per the capability-catalog registration protocol — the
 * registration points `resourceBase` at the bundle directory and the catalog
 * lists those files (a content-only skill would omit it instead).
 * @param ctx - plugin context (for logging).
 * @returns the parsed skill, or undefined when the file is missing/malformed
 *   (a discovery aid must never take a boot down, so each failure warns; the
 *   pack-smoke test owns the bundle's presence in the tarball).
 */
function readUpgradeSkill(ctx: Context): PluginUpgradeSkill | undefined {
  try {
    const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'plugin-upgrade')
    const skillFile = join(skillDir, 'SKILL.md')
    const raw = readFileSync(skillFile, 'utf8')
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
    const name = /^name: (.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim()
    const description = /^description: (.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim()
    const content = match?.[2]
    if (match === null || name === undefined || description === undefined || content === undefined) {
      ctx.logger.warn('plugin-upgrade: shipped SKILL.md is malformed — the plugin-upgrade skill is not registered')
      return undefined
    }
    return {
      name,
      description,
      content,
      source: 'runtime',
      provider: 'plugin-upgrade',
      resourceBase: { kind: 'directory', path: skillDir },
    }
  } catch (error) {
    ctx.logger.warn(`plugin-upgrade: shipped SKILL.md unreadable (${String(error)}) — the plugin-upgrade skill is not registered`)
    return undefined
  }
}

/** The host half requires no service; `skills` is awaited, never baked into inject. */
export const inject: readonly string[] = []

/**
 * Plugin body: register the upgrade runbook skill once the `skills` service is
 * ready. `ctx.inject(['skills'], …)` waits for the service rather than probing
 * it synchronously at apply time, so registration is not skipped when the host
 * mounts this plugin before the skill registry is up; a composition without
 * the capability simply leaves the fiber pending — never a boot failure.
 * @param ctx - Cordis context.
 * @returns a disposer unwinding the registration effect.
 */
export function apply(ctx: Context): () => void {
  const disposers: Array<() => void> = []
  ctx.inject(['skills'], (scoped) => {
    const skill = readUpgradeSkill(scoped)
    if (skill === undefined) return
    const registry = scoped.get('skills') as SkillRegistrySlice | undefined
    if (registry === undefined) return
    disposers.push(scoped.effect(() => registry.register(skill)))
  })
  return () => { for (const disposer of disposers.reverse()) disposer() }
}
