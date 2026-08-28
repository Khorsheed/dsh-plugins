/**
 * Host-side settings section of the capability-catalog plugin: the schemastery
 * schema that registers the `capability-catalog` settings namespace. The
 * ConfigurablePluginsTab dispatches `settings.plugin.item` cards keyed by the
 * namespaces the Host serves — so registering this namespace is what makes
 * the browser card appear. The card does not edit persistent settings (its
 * data arrives through the capabilityCatalog Remote); the schema is a minimal
 * placeholder that keeps the namespace valid.
 */

import z from '@deepseek-ai/schemastery'

/** Section shape: a minimal placeholder so the namespace is served. */
export const CapabilityCatalogSettingsSchema = z.object({})
