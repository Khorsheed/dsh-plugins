/**
 * The session-granted library tools AND the coach's prompt section — this
 * package's `./tool` composition entry for agent-preset compositions. The row
 * provides NO service (the preset-mount isolate-realm rule forbids service
 * rows); it registers the three model tools into the host tools registry,
 * contributes their guidance section, and ships the `library` skill into the
 * skills registry, all delegating to the global `ctx.library` service core
 * the core row provides at the profile root — the official tool-row shape
 * (the evaluation-family fold, T88). Granting is therefore per-session: a
 * preset names the row, its sessions get the tools, the section and the
 * skill; every other preset's sessions get none of them.
 *
 * @module @khorsheed/dsh-library/tool
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls this package's `Context.library` service augmentation.
import type {} from './index.ts'
import { libraryToolDefinitions } from './tool-definition.ts'

const PACKAGE_NAME = '@khorsheed/dsh-library'

/**
 * Tag the model-visible tools with their origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the library tools attribute to THIS
 * package (the row the preset mounts). The tag is host-side only and never
 * travels on the model wire. Inlined (the eval precedent) — importing the
 * helper from capability-catalog would be a cross-package edge.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Plugin configuration. */
export interface LibraryToolConfig {
  /**
   * Whether this row grants the library tools: `all` (the default) or `none`
   * (no tools, no guidance section, no skill — a deployment where the model
   * must not even read the library). The service core and the right-Sidebar
   * tab are the core row's own faces and stay mounted either way.
   */
  tools?: 'all' | 'none'
}

export const Config: z = z.object({
  tools: z.union([z.const('all'), z.const('none')]).default('all'),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'library-tool'

/**
 * The `library` core is a declared inject (the owning-family companion
 * exception to the community-service probe rule): a preset's standing scope
 * mounts at registry-activation time, BEFORE the profile's later bundle rows
 * provide the core, so a one-shot ctx.get probe at apply saw ABSENT there and
 * nothing re-ran the row (rc.1 boot order; 3080 production 2026-09-27). The
 * declared inject pends the row until the core provides, then the body
 * applies. The tools registry, the prompt assembly and the skills registry
 * still join through deferred injection so their mount order cannot strand
 * the registrations.
 */
export const inject = ['library']

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/** The narrow skill-registry slice this entry registers into (the canvas/datasets precedent). */
interface SkillRegistrySlice {
  register(skill: { name: string; description: string; content: string; source: string; provider?: string }): () => void
}

/** This package's root (`src/` in the source plane, `lib/` once built — both one level down). */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The shipped skill's file (`skills/library/SKILL.md`, listed in package.json `files`). */
export const LIBRARY_SKILL_FILE = join(PACKAGE_ROOT, 'skills', 'library', 'SKILL.md')

/** The shipped skill, parsed from its SKILL.md frontmatter. */
interface SkillFile {
  readonly name: string
  readonly description: string
  readonly content: string
}

/**
 * Load the shipped `library` skill. A missing or malformed file is a warning,
 * never a boot failure (the datasets precedent).
 * @returns the parsed skill, or undefined when it cannot be read.
 */
export function loadLibrarySkill(): SkillFile | undefined {
  let raw: string
  try {
    raw = readFileSync(LIBRARY_SKILL_FILE, 'utf8')
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

/**
 * The coach's guidance, registered beside the tools it describes (order 114,
 * the eval line). The whole working contract — reading aloud, logging notes,
 * composing quizzes, grading — is here; the per-`what` payload shapes are the
 * skill's, loaded on demand.
 */
const LIBRARY_PROMPT = `This session is a guided deep-reading session, and the library is its memory. The library_read / library_write / library_assess tools are its whole surface; the library skill carries every payload shape — load it before your first write.

The working contract:

- Read with the person, not at them: open the current chapter (library_read · chapter, paged), explain as you go, and ask before moving on. A Socratic follow-up beats a summary.
- Notes go to the vocab book as they happen (library_write · notes): one entry per term or key point, kind vocab | keypoint, chapterRef as ch:<n>. When the person sends a photo of handwritten notes, transcribe it into entries and record the photo as each entry's source — copy the image block's durable reference (attachmentId, mediaType, bytes, width, height) verbatim. When you cannot see images on this route, say so and ask for the notes as text instead.
- Quizzes mix the book and the vocab book: lean on low-box and due cards (library_read · due), and gate every question on the evidence rule — chapterRef plus a verbatim passage. library_write · quiz refuses a question without them; read the refusal, it says how to fix the call.
- Grading is two steps, always: judge each answer in the conversation against the question's answer and evidence, then library_assess with one verdict per question. The assess is what moves mastery and unlocks the next node — a judged quiz that was never assessed never happened.
- Spaced repetition is the point: due cards come first in a session, and a card the person fails comes back tomorrow.
- The library skill (library) has one full example per what; when a call fails, the error text teaches the correct shape — follow it rather than guessing.`

/**
 * Plugin body: register the three tools, their guidance section and the
 * skill. The declared `library` inject pends the row until the core provides,
 * so mount order can no longer strand it; the in-body guard stays as the
 * defensive direct-call path.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: LibraryToolConfig = {}): void {
  const service = ctx.get('library')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this profile,
    // so there is nothing to delegate to.
    ctx.logger.info(`${PACKAGE_NAME}: the global library service is absent — the library tools are not registered`)
    return
  }
  // `none` grants nothing at all: no tools, no section, no skill (guidance
  // about an absent tool is a wrong instruction, not a harmless one).
  if ((config.tools ?? 'all') === 'none') return
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tools. `ctx.inject` fires when the registry
  // appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of libraryToolDefinitions(service)) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definePluginTool(definition)),
        `${PACKAGE_NAME}: ${definition.name} tool`,
      )
    }
  })
  // The guidance describes those tools, so it rides with them — and through
  // the same deferred door, for the same reason.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({ name: 'tool:library', order: 114, text: LIBRARY_PROMPT })
  })
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    const skill = loadLibrarySkill()
    if (skill === undefined) {
      ctx.logger.warn(`${PACKAGE_NAME}: the shipped library skill could not be read — not registered`)
      return
    }
    skillCtx.effect(() => skills.register({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source: 'runtime',
      provider: PACKAGE_NAME,
    }), `${PACKAGE_NAME}: ${skill.name} skill`)
  })
}

export { libraryToolDefinitions, LIBRARY_TOOL_NAMES } from './tool-definition.ts'
