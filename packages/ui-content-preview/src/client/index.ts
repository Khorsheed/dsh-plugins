/**
 * Kernel surface: everything a consuming file/preview surface needs from the
 * shared content pane, re-exported from one specifier.
 *
 * Consumers import these through the package's `./src/*` export
 * (`@khorsheed/dsh-client-ui-content-preview/src/client/index.ts`) so tsdown
 * inlines the kernel into their own client bundle.
 *
 * @module @khorsheed/dsh-client-ui-content-preview/client
 */
export * from './contract.ts'
export * from './labels.ts'
export * from './language.ts'
export * from './structured.tsx'
export * from './html-src-doc.ts'
export * from './html-bridge.ts'
export * from './rendered-search.ts'
export * from './ContentPane.tsx'
