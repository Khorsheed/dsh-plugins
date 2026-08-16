# Agent Note: ankh-guard publish identity — khorsheed is the channel

Status: implemented

English | [中文](2026-08-16-ankh-guard-publish-identity.zh.md)

## Problem

ankh-guard lived under two names: `@deepseek-ai/dsh-ankh-guard` in the deepseek-harness monorepo (release-family member, mounted by the base bundle) and `@khorsheed/dsh-ankh-guard` on npm. Documentation flip-flopped between them — the install section named a scope that has never been published, and a README "fix" on 2026-08-16 pointed users at the wrong name. The official channel is not available to the maintainers: the npm `@deepseek-ai` org and the `deepseek-ai/deepseek-harness` GitHub repo are both read-only for the working account, so no family release can be triggered from here, and none should be attempted.

## Decision

The published identity is **`@khorsheed/dsh-ankh-guard`**; the publish source is the standalone repo `Khorsheed/dsh-ankh-guard` (local mirror at `$DSH_HOME/scratch/ankh-guard-ref`), synced from the monorepo package at publish time. The monorepo package keeps its `@deepseek-ai` family name — renaming inside the fork would fight the monorepo naming convention and churn the base bundle reference. Install documentation names the khorsheed package everywhere. The version line follows the official family (rc.6.x while the family is rc.6; rc.7 when the family ships).

## Alternatives considered

- **Publish under @deepseek-ai via the family release** — not available: no npm org membership and no repository write access; the maintainer accounts must not attempt the official channel.
- **Rename the monorepo package to the khorsheed scope** — rejected: violates the repo convention that every npm package is `@deepseek-ai/dsh-<name>`, breaks the base bundle row, and buys nothing the standalone publish repo doesn't already provide.
- **Keep both names undocumented** — rejected: that is exactly the state that produced the wrong install instructions.

## Consequences

- One name per home: users install `@khorsheed/dsh-ankh-guard`; the monorepo composes `@deepseek-ai/dsh-ankh-guard` through the base bundle. Both patches insert the row id `ankh-guard`, so installing the khorsheed package onto an image that already composes the family member fails boot on a duplicate entry id — the READMEs carry that warning.
- Publishing is a sync from the monorepo package to the standalone repo, then `npm publish` from there (the account's 2FA applies).
