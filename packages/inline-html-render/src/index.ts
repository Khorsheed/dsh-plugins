/**
 * Inline HTML render host half. Registers the `inline-html-card` skill, which
 * documents the fenced-block protocol the browser half consumes: the agent
 * writes a ` ```dsh-card ```` fenced block (or a `dsh-card <spec>` inline
 * fence) whose body is a fully self-contained HTML document, and the client
 * half swaps the rendered `<pre><code class="language-dsh-card">` for a
 * sandboxed iframe that runs it.
 *
 * This half owns no DOM and no Remote — it only advertises the contract so
 * the agent knows how to author a card. It degrades silently when the
 * `skills` capability is absent (a minimal composition may lack it), exactly
 * like file-preview's 3d-artifact registration.
 * @module @khorsheed/dsh-inline-html-render
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** The slice of the skill registry this package consumes (optional service). */
interface SkillRegistrySlice {
  register: (skill: { name: string; description: string; content: string; source: string }) => () => void
}

/**
 * Register the `inline-html-card` skill — the generation-side contract for
 * authoring a self-contained HTML card that the browser renders in a
 * sandboxed iframe. Pull-based discovery: an agent whose task involves
 * drawing a rich inline card finds the contract in the skill catalog. Optional:
 * compositions without the skill capability skip the registration.
 * A missing/malformed shipped SKILL.md degrades to a warning — a discovery
 * aid must never take a boot down.
 * @param ctx - plugin context.
 */
function registerCardSkill(ctx: Context): void {
  const skills = ctx.get('skills') as SkillRegistrySlice | undefined
  if (skills === undefined) {
    ctx.logger.warn('inline-html-render: skills capability absent — the inline-html-card skill is not registered')
    return
  }
  try {
    const skillFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'inline-html-card', 'SKILL.md')
    const raw = readFileSync(skillFile, 'utf8')
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
    const name = /^name: (.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim()
    const description = /^description: (.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim()
    const content = match?.[2]
    if (match === null || name === undefined || description === undefined || content === undefined) {
      ctx.logger.warn('inline-html-render: shipped SKILL.md is malformed — the inline-html-card skill is not registered')
      return
    }
    ctx.effect(() => skills.register({ name, description, content, source: 'runtime' }))
  } catch (error) {
    ctx.logger.warn(`inline-html-render: shipped SKILL.md unreadable (${String(error)}) — the inline-html-card skill is not registered`)
  }
}

/** The host half requires no service: `skills` is read optionally, never injected. */
export const inject: readonly string[] = []

/**
 * Plugin body: register the card-authoring skill.
 * @param ctx - Cordis context carrying the optional `skills` service.
 * @returns a disposer unwinding the effect.
 */
export function apply(ctx: Context): () => void {
  registerCardSkill(ctx)
  return () => {}
}
