# Agent Note: Message timeline plugin carries the community @khorsheed scope

Status: implemented

English | [中文](2026-08-15-message-timeline-khorsheed-scope.zh.md)

## Problem

The message-timeline plugin shipped as `@deepseek-ai/dsh-client-message-timeline` with `publishConfig.access: public`, but the `@deepseek-ai` npm scope belongs to the upstream vendor: this fork cannot publish there, and the next upstream-style release run would have tried (and failed) to publish the plugin under a scope the maintainers of this fork do not control.

## Decision

The package is renamed to `@khorsheed/dsh-message-timeline` — the scope this fork's other community plugin (`@khorsheed/dsh-ui-shortcuts`) already uses — and marked `private: true` with `publishConfig` and the upstream `repository` pointer dropped. Every reference moved together: the web-app bundle's `cordis.patch.yml` row and `package.json` dependency, the package's own `cordis.patch.yml`, the invariant companion's `PACKAGE_NAME`, the tsdown bundle id, the apply spec import, both README titles, and explicit `tsconfig.base.json` paths entries (bare, `/client`, `/invariant`) — the `@deepseek-ai/dsh-*` wildcard cannot map a foreign-scope name. The explicit paths entries also fix a pre-existing gate violation: the old name's `dsh-client-message-timeline` suffix never matched the `packages/client/message-timeline` directory through the wildcard, so `verify-cordis-config`'s source-plane resolution was already failing for this plugin.

## Alternatives considered

**Keep the `@deepseek-ai` name while never publishing.** Rejected: a publishable-looking package under a scope the fork cannot publish is a broken promise — the release machinery treats in-repo packages as release members.

**Move the package out to a standalone plugin repository** (the dsh-ui-shortcuts model). Deferred: the package's tests lean on the repo's vitest workspace, tsconfig bases, and coverage gates; extraction is cheap to do later because the package is self-contained, and `private: true` keeps today's link/tarball distribution working meanwhile.

## Consequences

Ownership is honest and the workspace-constraints gate passes (non-`@deepseek-ai` packages under `packages/` must be private, which now holds). Gates that key on the `@deepseek-ai/` prefix — the client bundle purity spec's entry filter, the publish baseline — silently skip this package; the purity loss is accepted because the package's composition is still covered by its own specs. Distribution is `dsh plugin add link:`/tarball only; an npm release under `@khorsheed` would first need the extraction above plus real (non-`workspace:`) dependency ranges on the `@deepseek-ai/dsh-client-*` peers.
