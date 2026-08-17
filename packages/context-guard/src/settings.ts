/**
 * Host-side settings section of the context-guard plugin: the schemastery
 * schema that validates the `context-guard` settings namespace. The browser
 * half reads the resolved section through `ctx.settingsScope` and the
 * settings page renders it as a plugin card; the composition entry (the
 * cordis.yml row) becomes the section's `base` layer, so YAML values keep
 * working as the defaults the card can override.
 *
 * These two fields tune ONLY when the compact button appears — the official
 * compaction engine (compaction-basic) reads its own `thresholdRatio` /
 * `maxTokens` config and never touches this section.
 */

import z from '@deepseek-ai/schemastery'

/** Section shape: the fraction of the window at which the button appears, plus the output budget it reserves. */
export const ContextGuardSettingsSchema = z.object({
  thresholdRatio: z.number().min(0.01).max(1).default(0.8),
  maxTokens: z.number().step(1).min(1).default(256_000),
})
