/**
 * `@khorsheed/dsh-video-studio/tool` — the model-facing composition entry:
 * the video_* tools and the `video-studio` skill, granted per session by the
 * dsh-video preset (剪辑模式). It injects the core's `videoStudio` service, so
 * without the core row it stays pending instead of probing at apply time.
 *
 * @module @khorsheed/dsh-video-studio/tool
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls this package's `Context.videoStudio` service augmentation.
import type {} from './index.ts'
import { VIDEO_SKILL_CONTENT, VIDEO_SKILL_DESCRIPTION, VIDEO_SKILL_NAME } from './skill.ts'
import { defineVideoTools } from './tool-definition.ts'

const PACKAGE_NAME = '@khorsheed/dsh-video-studio'

/** Tag a tool with its origin (the capability catalog reads this host-side). */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

export const name = 'video-studio-tool'

export const inject = ['videoStudio']

interface SkillsRegistry {
  register(skill: { name: string; description: string; content: string; source: string; provider?: string }): () => void
}

export function apply(ctx: Context): void {
  const service = ctx.get('videoStudio')
  if (service === undefined) {
    ctx.logger.info(`${name}: the videoStudio service is absent — the video tools are not registered`)
    return
  }
  ctx.inject(['tools'], (toolsCtx) => {
    for (const def of defineVideoTools(service)) {
      toolsCtx.effect(() => toolsCtx.tools.register(definePluginTool(def)), `video-studio-tool: ${def.name}`)
    }
  })
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillsRegistry | undefined
    if (!skills) return
    skillCtx.effect(
      () => skills.register({ name: VIDEO_SKILL_NAME, description: VIDEO_SKILL_DESCRIPTION, content: VIDEO_SKILL_CONTENT, source: 'runtime', provider: PACKAGE_NAME }),
      'video-studio-tool: skill',
    )
  })
}
