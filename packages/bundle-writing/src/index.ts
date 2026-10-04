/**
 * @khorsheed/dsh-bundle-writing — the 写作 preset as one declarative
 * `@deepseek-ai/dsh-agent-preset` loader row. The bundle is data:
 * cordis.patch.yml carries the declaration; this module exists so the
 * package has a buildable `lib/` (pack-dist requires one) and so the preset
 * id has a home the specs import.
 */

/** The preset id this bundle declares. */
export const WRITING_PRESET_ID = 'writing'
