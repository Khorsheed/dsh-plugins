/**
 * Host-side settings section of the context-guard plugin: the schemastery
 * schema of the `context-guard` configuration entry. rc.1's SettingsForms
 * serves the entry's own Config and edits only its volatile fields; 0.1.5
 * validates the legacy `settings.register` namespace with the same schema.
 * The browser half reads the resolved section through whichever settings
 * scope the line serves (see client/scope.ts); the composition entry (the
 * cordis.yml row) becomes the section's base layer, so YAML values keep
 * working as the defaults the card can override.
 *
 * These two fields tune ONLY when the compact button appears — the official
 * compaction engine (compaction-basic) reads its own `thresholdRatio` /
 * `maxTokens` config and never touches this section.
 */

import z from '@deepseek-ai/schemastery'

const thresholdField = z.number().min(0.01).max(1).default(0.8)
type VolatileCapable = { volatile?: () => typeof thresholdField }

/**
 * Section shape: the context-occupancy fraction at which the button appears.
 * The field is marked `.volatile()` when the running schemastery supports it
 * (3.18.4, host rc.1 — SettingsForms serves and edits ONLY volatile fields);
 * 0.1.5's schemastery (3.18.2) has no such method, the probe leaves the field
 * plain, and the legacy register path carries the section (the marker is
 * inert there). The inline probe (not a helper) keeps the emitted type
 * nameable under pnpm's layout.
 */
export const ContextGuardSettingsSchema: z = z.object({
  thresholdRatio: typeof (thresholdField as VolatileCapable).volatile === 'function'
    ? (thresholdField as Required<VolatileCapable>).volatile()
    : thresholdField,
})
