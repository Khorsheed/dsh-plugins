/**
 * Host-plane entry for `@khorsheed/dsh-client-ui-panel-kit`.
 *
 * This package is a source-plane library: consumers import `./src/client/*`
 * directly so their own client bundle inlines it, and nothing ever runs this
 * module in a host process. It exists so the package root resolves to the same
 * surface for type-checking and for any tooling that reads the package entry.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit
 */
export * from './client/index.ts'
