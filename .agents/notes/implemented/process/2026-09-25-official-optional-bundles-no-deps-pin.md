# Agent Note: official optional bundles stay out of the prod profile's dependency list

Status: implemented

## Problem

The host installation ships two bundles for the person to switch on —
`OPTIONAL_BUNDLES` in `packages/boot/app-boot/src/profile.ts`
(`@deepseek-ai/dsh-experimental-agent-team-profile` and
`@deepseek-ai/dsh-experimental-voice-input-bundle`), each a runtime dependency
of the `apps/cli` installation. The Web plugin page groups cards by
`optional && !installed`: an optional bundle appears in the top **官方**
(Official) group only while the profile's `dependencies` do NOT name it; the
moment it is pinned there, the card drops into the installed list.

On the 0.1.7-rc.1 upgrade the prod profile carried both agent-team packages as
dependency pins from 0.1.5. Upstream had deleted
`dsh-experimental-agent-team-web-profile` (folded into `-profile`, one bundle
enables tools + Web UI), so that pin had to go; re-pinning `-profile` to
`0.1.7-rc.1` kept the plugin working but silently moved its card out of the
Official group, and would have forced a re-pin chore on every future host
upgrade with a version-compatibility refusal whenever the pin lagged.

## Decision

Official optional bundles are selected in the prod profile's
`dsh.profile.bundles` roster ONLY — never in `dependencies`. Composition and
the inventory both resolve them from the install anchor
(`apps/cli/package.json` ships them as `workspace:*`), so the running copy
always matches the host checkout exactly. Executed on the 3080 `web` profile
on 2026-09-25: the `0.1.7-rc.1` dependency pin was removed (deps 31 → 30),
`pnpm install` pruned the profile-local copy, the `--dump-config` probe
showed all three rows (`agent-team`, `tool-agent-team`, `ui-agent-team`)
composing from the anchor, and the watchdog restart canary recorded
deployment proof `ec8c9087aee44da6` at harness HEAD `46a7f68b09`.

## Alternatives considered

- **Keep re-pinning on every host upgrade** (what the 0.1.7-rc.1 upgrade first
  did): works functionally, but locks the bundle to whatever was pinned, adds a
  manual step that a missed checklist item turns into a version-compatibility
  refusal, and costs the card its Official-group placement.
- **Drop the bundle from the roster too and let users opt in per profile**: the
  prod profile deliberately ships 智能体团队 switched on; that decision predates
  this note and is unchanged — only the resolution source moved.

## Consequences

- Host upgrades need no re-pin step for these two bundles; remove them from
  any upgrade checklist that grew one.
- The 智能体团队 card keeps its 官方 tag and follows the host checkout's
  version automatically.
- If upstream deletes an optional bundle (as `agent-team-web-profile` was),
  remove it from the `bundles` roster as well as from any dependency list —
  the roster alone still requires the package to resolve.
- The profile `pnpm-workspace.yaml` `minimumReleaseAgeExclude` entries naming
  the old `0.1.5-rc.1` agent-team pins are inert leftovers of the npm-pin era;
  they gate nothing once nothing resolves those versions from the registry.
