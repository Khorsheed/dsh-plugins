/**
 * The capability-catalog row's plugin Config: the `mcp` block carries the
 * persisted MCP management state (server configs, namespaced credential refs,
 * and discovered tools) so MCP servers survive a restart. Credential values are
 * stored here (the user's own config document) but are never exposed over the
 * Remote — `mcpSnapshot` reports only `configured` state.
 *
 * Marked `.volatile()` so store mutations write through the SettingsForms
 * service (host 0.1.7+) without a row reload, and external document updates
 * reach the running fiber's Volatile reference. The block stays permissive
 * (`z.any()`): the catalog card reads/writes it through the Remote, and a
 * hand-typed schemastery shape for the nested config/tuple/secret structure is
 * fragile.
 *
 * Dual-line: `.volatile()` exists only on schemastery 3.18.4+ (the 0.1.7 host
 * line). On 0.1.5's schemastery the call is absent — the plain field then
 * rides the legacy `settings.register` namespace path instead (see index.ts).
 */
import z from '@deepseek-ai/schemastery'

/** The persisted MCP state block lives under this key of the plugin config. */
export const MCP_SETTINGS_KEY = 'mcp'

const mcpField = z.any().default({})

/** Section shape: the MCP management state block (permissive) + nothing else. */
export const CapabilityCatalogSettingsSchema = z.object({
  [MCP_SETTINGS_KEY]: typeof mcpField.volatile === 'function'
    ? mcpField.volatile()
    : mcpField,
})
