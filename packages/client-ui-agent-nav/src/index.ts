/**
 * Host-plane entry for `@khorsheed/dsh-client-ui-agent-nav`: the destination
 * line format only. A source-plane library — consumers import `./src/*`
 * directly so their client bundle inlines it; host halves write the line
 * through their own inline copy of `destinationLine` (host faces are not
 * bundled), checked against this one by their tests.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav
 */
export * from './destination.ts'
