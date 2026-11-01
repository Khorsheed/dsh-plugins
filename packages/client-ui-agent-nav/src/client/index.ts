/**
 * Browser entry for `@khorsheed/dsh-client-ui-agent-nav`: the destination
 * reader, the one follow rule, and the one conversation card. Consumers import
 * this file directly (`@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts`)
 * so their own client bundle inlines it.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav/client
 */
export * from '../destination.ts'
export * from './follow.ts'
export * from './open.ts'
export * from './card.tsx'
