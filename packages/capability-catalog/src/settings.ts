/**
 * Host-side settings section of the capability-catalog plugin: the schemastery
 * schema that registers the `capability-catalog` settings namespace. The
 * ConfigurablePluginsTab dispatches `settings.plugin.item` cards keyed by the
 * namespaces the Host serves — so registering this namespace is what makes
 * the browser card appear. The card edits nothing through the schema: its data
 * arrives through the capabilityCatalog Remote.
 *
 * The namespace ALSO carries the plugin's persisted MCP state (`mcp`): server
 * configs, credential values (namespaced refs), and discovered tools, so MCP
 * servers survive a restart instead of living only in the in-process store.
 * The MCP block is declared permissively (`z.any()`) because the catalog card
 * reads/writes it through the Remote, and a hand-typed schemastery shape for the
 * nested config/tuple/secret structure is fragile. Credential values are stored
 * here (the user's own config document) but are never exposed over the Remote —
 * `mcpSnapshot` reports only `configured` state.
 */
import z from '@deepseek-ai/schemastery'

/** The persisted MCP state block lives under this key of the namespace. */
export const MCP_SETTINGS_KEY = 'mcp'

/** Section shape: the MCP management state block (permissive) + nothing else. */
export const CapabilityCatalogSettingsSchema = z.object({
  [MCP_SETTINGS_KEY]: z.any().default({}),
})
