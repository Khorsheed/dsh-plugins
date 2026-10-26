# Agent Note: Package directories match their npm names

Status: implemented

## Problem

Eleven directories under `packages/` did not match the package they publish: the mode suites (`dev`, `writing`, `learning`, `video`, `gamedev` publish `@khorsheed/dsh-<mode>-suite`; `bundle-eval` publishes `@khorsheed/dsh-eval-suite`, a leftover of its pre-release name `dsh-bundle-eval`), the client packages (`message-tools`, `session-title-edit`, `ui-panel-kit`, `ui-content-preview` publish `@khorsheed/dsh-client-*`) and `dsh-reader` (publishes `@khorsheed/dsh-reader`). Readers had to know two names for one package; `bundle-eval` next to `eval` was the confusing case that prompted the change.

## Decision

Every directory is now the npm name without `@khorsheed/dsh-`: `eval-suite`, `dev-suite`, `writing-suite`, `learning-suite`, `video-suite`, `gamedev-suite`, `client-message-tools`, `client-session-title-edit`, `client-ui-panel-kit`, `client-ui-content-preview`, `reader`. Package names, loader row ids and preset ids are unchanged, so installs, sessions and settings see nothing.

Two names were derived from the directory and are kept stable explicitly:

- **Mirror repos.** `scripts/sync-mirror.mts` pushed `packages/<dir>` to `Khorsheed/dsh-<dir>`. The mode-suite mirrors are the collections' front doors and keep their short names through `MIRROR_REPO_NAMES` (`writing-suite` → `Khorsheed/dsh-writing`, likewise dev, learning, video, gamedev).
- **Release tags.** Tags are `<dir>-v<version>`. The three renamed packages with release history had every historical tag duplicated under the new directory name (`client-message-tools-v0.3.4` points where `message-tools-v0.3.4` does), so `release:wave plan` still finds "changes since the last release". The old tags stay.

Every `packages/<old>` path in the tree (docs, Agent Notes, sidecars, specs, scripts, the publish workflow example) was rewritten, and the directory-keyed tables in `scripts/check-plugin-independence.ts` follow the new names.

## Alternatives considered

**Rename only `bundle-eval`, or the suites now and the client/reader packages later.** The user chose one pass: the in-flight branches touching `dsh-reader` / `message-tools` are later merges, and git follows the renames.

**Rename the mirror repos too.** Rejected: `Khorsheed/dsh-writing` etc. are public URLs already linked from the READMEs.

## Consequences

- Branches cut before this change that touch a renamed directory merge through git's rename detection; check the result builds.
- New packages: name the directory after the npm name without the scope prefix.

## Testing

Full workspace build; tests of every renamed package and the datasets organizing-preset spec; `pnpm test:scripts` (check-plugin-independence, remote-namespaces, gen-typert, eval-preset-parity specs read the new paths); `check:plugins`, `check:profiles`, `check:collections`, `check:packages`, translation pairing.
