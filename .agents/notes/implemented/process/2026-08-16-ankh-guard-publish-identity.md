# Agent Note: ankh-guard publish identity — khorsheed is the channel

Status: implemented

English | [中文](2026-08-16-ankh-guard-publish-identity.zh.md)

## Problem

ankh-guard lived under two names: `@deepseek-ai/dsh-ankh-guard` in the deepseek-harness monorepo (release-family member, mounted by the base bundle) and `@khorsheed/dsh-ankh-guard` on npm. Documentation flip-flopped between them — the install section named a scope that has never been published, and a README "fix" on 2026-08-16 pointed users at the wrong name. The official channel is not available to the maintainers: the npm `@deepseek-ai` org and the `deepseek-ai/deepseek-harness` GitHub repo are both read-only for the working account, so no family release can be triggered from here, and none should be attempted.

## Decision

The published identity is **`@khorsheed/dsh-ankh-guard`**, and it is now the only package name: the package lives in the `dsh-plugins` monorepo at `packages/ankh-guard` (the single source of truth, published via `scripts/pack-dist.ts`), and the deepseek-harness in-tree family member was removed on 2026-08-16 (harness commit `48a9e1735d`, "chore: remove migrated plugin packages now hosted in dsh-plugins"). Install documentation names the khorsheed package everywhere. The version line follows the official family (rc.6.x while the family is rc.6; rc.7 when the family ships).

## Alternatives considered

- **Publish under @deepseek-ai via the family release** — not available: no npm org membership and no repository write access; the maintainer accounts must not attempt the official channel.
- **Rename the monorepo package to the khorsheed scope** — rejected: violates the repo convention that every npm package is `@deepseek-ai/dsh-<name>`, breaks the base bundle row, and buys nothing the standalone publish repo doesn't already provide.
- **Keep both names undocumented** — rejected: that is exactly the state that produced the wrong install instructions.

## Consequences

- One name everywhere: users install `@khorsheed/dsh-ankh-guard`, and no current official image mounts a conflicting row — the published npm `@deepseek-ai/dsh-base` line never carried one (verified rc.6/rc.7 tarballs), and upstream master never had it; the base-bundle row existed only in the local deploy fork, which dropped it in the migration cleanup. The duplicate-id hazard survives only for compositions that still mount an `ankh-guard` row by other means; both READMEs and `cordis.patch.yml` carry that warning with a `--dump-config` check.
- Publishing runs from this monorepo via `scripts/pack-dist.ts`, then `npm publish` (the account's 2FA applies).
