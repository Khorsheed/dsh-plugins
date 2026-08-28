/**
 * The settings namespace owned by the capability-catalog plugin. Plain string
 * so both the host half (settings registration) and the browser half (the
 * settings.plugin.item card key) import it without dragging host-only
 * dependencies into the client bundle.
 */

/** Settings namespace owned by the capability-catalog plugin. */
export const CAPABILITY_CATALOG_NS = 'capability-catalog'
