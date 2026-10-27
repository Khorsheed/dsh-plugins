/**
 * Host-plane entry for `@khorsheed/dsh-client-ui-reveal-kit`.
 *
 * A source-plane library: consumers import `./src/client/*` directly so their
 * own client bundle inlines it. This entry only gives the package root a
 * surface for type-checking and tooling.
 * @module @khorsheed/dsh-client-ui-reveal-kit
 */
export * from './client/index.ts'
