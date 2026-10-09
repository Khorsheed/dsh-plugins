/**
 * @khorsheed/dsh-presets — the community agent presets (dev / dsh-eval /
 * dsh-writing / dsh-gamedev / dsh-video) as declarative
 * `@deepseek-ai/dsh-agent-preset` loader rows.
 * The bundle is data: cordis.patch.yml carries every declaration; this module
 * exists so the package has a buildable `lib/` (pack-dist requires one).
 */

/** Preset ids this bundle declares, in cordis.patch.yml row order. */
export const PRESET_IDS = ['dev', 'dsh-eval', 'dsh-writing', 'dsh-gamedev', 'dsh-video'] as const
