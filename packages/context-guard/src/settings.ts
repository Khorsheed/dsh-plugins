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

/**
 * Section shape: the context-occupancy fraction at which the button appears.
 * The field is marked `.volatile()` when the running schemastery supports it
 * (3.18.4, host rc.1 — SettingsForms serves and edits ONLY volatile fields);
 * 0.1.5's schemastery (3.18.2) has no such method, the probe leaves the field
 * plain, and the legacy register path carries the section (the marker is
 * inert there). The probe reads the typed method directly (3.18.4 declares
 * `Schema.prototype.volatile`); the dev line resolves 3.18.4, older floors
 * keep the runtime fallback.
 */
const harnessField = z.dict(z.number().min(0.01).max(1)).default({})
const memberField = z.dict(z.object({
  ratio: z.number().min(0.01).max(1).required(),
  name: z.string(),
  harness: z.string(),
})).default({})

/** Mark a field volatile where the running schemastery can (see above). */
function volatile<S extends z>(field: S): S {
  return typeof field.volatile === 'function' ? field.volatile() as S : field
}

/*
 * The external-CLI ratios (local-agent members; read only when that family is
 * installed): `harnessThresholds` by harness name (`kimi`, `codex`, …), and
 * `memberThresholds` by member session id, each carrying the name and harness
 * it was set for so the card can list it. Precedence: member > CLI > global.
 */
export const ContextGuardSettingsSchema: z = z.object({
  thresholdRatio: volatile(thresholdField),
  harnessThresholds: volatile(harnessField),
  memberThresholds: volatile(memberField),
})
