/**
 * The settings namespace owned by the context-guard plugin. Plain string so
 * both the host half (settings registration) and the browser half
 * (settingsScope binding and the settings.plugin.item card key) import it
 * without dragging host-only dependencies into the client bundle.
 */

/** Settings namespace owned by the context-guard plugin. */
export const CONTEXT_GUARD_NS = 'context-guard'
