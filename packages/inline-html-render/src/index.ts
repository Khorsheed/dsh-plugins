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
  register: (skill: {
    name: string
    description: string
    content: string
    source: string
    provider?: string
  }) => () => void
}

/**
 * Read and parse the shipped `inline-html-card` SKILL.md into a registration.
 *
 * This skill is content-only — it ships a single self-contained SKILL.md with
 * no sibling scripts/assets/references. Per the capability-catalog registration
 * protocol, a content-only skill OMITS `resourceBase` so the catalog renders it
 * as a virtual single-SKILL.md node (it does NOT point at a directory that
 * holds only SKILL.md). Add `resourceBase: { kind: 'directory', path }` only
 * when a bundle with files beside SKILL.md is introduced later.
 * @param ctx - plugin context (for logging).
 * @returns the parsed skill, or undefined when the file is missing/malformed
 *   (a discovery aid must never take a boot down, so each failure warns).
 */
function readCardSkill(
  ctx: Context,
): {
  name: string
  description: string
  content: string
  source: string
  provider: string
} | undefined {
  try {
    const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'inline-html-card')
    const skillFile = join(skillDir, 'SKILL.md')
    const raw = readFileSync(skillFile, 'utf8')
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
    const name = /^name: (.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim()
    const description = /^description: (.+)$/m.exec(match?.[1] ?? '')?.[1]?.trim()
    const content = match?.[2]
    if (match === null || name === undefined || description === undefined || content === undefined) {
      ctx.logger.warn('inline-html-render: shipped SKILL.md is malformed — the inline-html-card skill is not registered')
      return undefined
    }
    return {
      name,
      description,
      content,
      source: 'runtime' as const,
      provider: 'inline-html-render',
    }
  } catch (error) {
    ctx.logger.warn(`inline-html-render: shipped SKILL.md unreadable (${String(error)}) — the inline-html-card skill is not registered`)
    return undefined
  }
}

/** The host half requires no service; `skills` is awaited, never baked into inject. */
export const inject: readonly string[] = []

/**
 * Plugin body: register the card-authoring skill once the `skills` service is
 * ready. `ctx.inject(['skills'], …)` waits for the service rather than probing
 * it synchronously at apply time, so registration is not skipped when the host
 * mounts this plugin before the skill registry is up. (The file-preview host is
 * a service class instantiated at a later point; this plugin's `apply` runs
 * earlier, so a plain synchronous `ctx.get('skills')` at apply time could see
 * the registry absent and silently skip — which is why inline-html-card did not
 * appear in the catalog while 3d-artifact did.)
 * @param ctx - Cordis context carrying the `skills` service.
 * @returns a disposer unwinding the registration effect.
 */
export function apply(ctx: Context): () => void {
  const disposers: Array<() => void> = []
  // Wait for the skill registry before registering. If it never appears, this
  // fiber stays pending rather than throwing — a discovery aid must not take a
  // boot down. The injected ctx is scope-addressed, so ctx.get('skills') is set.
  ctx.inject(['skills'], (scoped) => {
    const skill = readCardSkill(scoped)
    if (skill === undefined) return
    const registry = scoped.get('skills') as SkillRegistrySlice | undefined
    if (registry === undefined) return
    disposers.push(scoped.effect(() => registry.register(skill)))
  })
  return () => { for (const disposer of disposers.reverse()) disposer() }
}
