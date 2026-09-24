/**
 * @khorsheed/dsh-bundle-conversation-toolbox — the conversation toolbox family
 * (message-tools / message-timeline / session-title-edit / quote /
 * inline-html-render / context-guard / taskpilot) as one thin meta package.
 * The bundle is composition data: cordis.patch.yml re-mounts the members'
 * canonical rows and package.json carries the members as npm dependencies;
 * this module exists so the package has a buildable `lib/` (pack-dist
 * requires one). It registers no service, tool, slot, or command of its own.
 */

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-client-message-tools',
  '@khorsheed/dsh-message-timeline',
  '@khorsheed/dsh-client-session-title-edit',
  '@khorsheed/dsh-quote',
  '@khorsheed/dsh-inline-html-render',
  '@khorsheed/dsh-context-guard',
  '@khorsheed/dsh-taskpilot',
] as const
