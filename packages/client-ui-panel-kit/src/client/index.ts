/**
 * Panel kit surface: the type tokens, the panel root, and the shared compact
 * controls, re-exported from one specifier.
 *
 * Consumers import these through the package's `./src/*` export
 * (`@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts`) so tsdown
 * inlines the kit into their own client bundle.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
export * from './tokens.ts'
export * from './PanelRoot.tsx'
export * from './PanelHeader.tsx'
export * from './UnderlineTabs.tsx'
export * from './ChipRow.tsx'
export * from './ListRow.tsx'
export * from './AdaptiveSplit.tsx'
export * from './host.ts'
