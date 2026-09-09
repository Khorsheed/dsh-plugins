# Agent Note: 0.1.2 baseline sync — client-runtime removal, wrapper-wrapped tool scan

Status: implemented

English | [中文](2026-09-09-012-baseline-sync.zh.md)

## Problem

`deepseek-harness` released `0.1.2-rc.1` (tag `dsh-v0.1.2-rc.1`, now `latest` on npm). The line removes `@deepseek-ai/dsh-client-runtime` and adds new packages (dsh-client-store, dsh-client-ui-chat, dsh-api-session-controller, dsh-api-workspace-controller, dsh-client-ui-session, dsh-util-values, …). The repo had merged the 0.1.2 source-adaptation branch, but every dependency declaration and the baseline files still sat on `0.1.1-rc.2`, and seven packages still devDep-linked `dsh-client-store`/`dsh-util-workspace-path` into a sibling alpha checkout.

## Decision

Baseline move only — source adaptation is explicitly a later phase, so a red tree is expected.

- **devDependencies swept to `^0.1.2-rc.1`** in all 26 packages (cordis untouched). `dsh-client-runtime` entries deleted everywhere — devDeps, and also `peerDependencies`/`peerDependenciesMeta`: keeping the peer made pnpm auto-install the last published runtime (`0.1.0-rc.8`), which dragged `dsh-host-apiproxy@0.1.1-rc.2` (removed upstream at 0.1.2, never published past 0.1.1-rc.2) into the lockfile. Stale `link:../../../deepseek-harness-alpha/...` devDeps (7× dsh-client-store, 1× dsh-util-workspace-path) replaced with `^0.1.2-rc.1` — both are published now.
- **Missing declarations filled from actual imports**: `dsh-client-ui-renderer` added to 8 packages whose client specs import `SlotRegistry` from it; `dsh-client-store` to message-timeline; `dsh-system-prompt` to local-agent-tool-subagent. room's rc.6-line devDeps and the other stragglers (`^0.1.0-rc.8` dsh-skill in ankh-guard, `^0.1.0-rc.6` dsh-subprocess in local-agent) were swept to the same line.
- **`pnpm-workspace.yaml` regenerated from the lockfile**, not hand-edited: 73 `@deepseek-ai/dsh-*` packages resolve, every one at exactly `0.1.2-rc.1`; `overrides` and `minimumReleaseAgeExclude` list the identical 73-entry set. The old list's `dsh-host-apiproxy` is gone (no 0.1.2-rc.1 exists); 14 new entries arrived (dsh-client-store, dsh-client-ui-chat, dsh-client-ui-session, dsh-api-session-controller, dsh-api-workspace-controller, dsh-cmdline, dsh-code-runtime-worker-thread, dsh-mcp-client, dsh-deque, dsh-session-persistence-jsonl, dsh-util-crypto, dsh-util-time, dsh-util-values, dsh-util-workspace-path). `allowBuilds` untouched.
- **`pnpm dedupe` was required, not optional.** Official 0.1.2 packages peer on `@deepseek-ai/cordis@^4.0.2` while the repo declares `^4.0.1`; the graph carried two physical cordis@4.0.1 instances (split by cordis-plugin-loader 1.0.2 vs 1.0.3), so module augmentation (`declare module '@deepseek-ai/cordis'`) landed on the copy the plugin code did not import — taskpilot's host face failed with `Property 'agents' does not exist on type 'Context'` despite a correct `import type {}`. Dedupe collapsed cordis to one instance; taskpilot's host face compiles clean. Its client face stays red on purpose: sources still import `@deepseek-ai/dsh-client-runtime/client` (the type migration to dsh-client-store/dsh-client-ui-chat is the next phase). `@deepseek-ai/dsh-compact` remains unpublished but is no longer referenced anywhere — it is not a blocker.
- **CI seed tag** `dsh-v0.1.1-rc.2` → `dsh-v0.1.2-rc.1` (gates job); the alpha-compat job still follows the npm alpha tag.
- **gen-official-tools scanner fixed for rc.1**: 0.1.2 registers `send_message` as `ctx.tools.register(markAdjacentAgentSendMessageTool(defineTool({…})))`, invisible to the `register(defineTool({` regex — the regenerated list silently dropped it. The regex now tolerates marker wrappers; the rc.1 list is 41 tools, delta vs 0.1.1-rc.2: `+list_subagent_models` (and `send_message` correctly retained; no `report` anywhere).

## Alternatives considered

- **Keep the `dsh-client-runtime` peer and let the lockfile carry 0.1.1-rc.2 residue** — rejected: the task's acceptance check is zero `0.1.1-rc` in the lockfile, and peering on a package the host no longer ships would install a dead plugin into consumers.
- **Also rewrite `dsh.client.inject` arrays and `dsh.compat.verifiedHost` in the same pass** — deferred deliberately: the correct inject set per client depends on the source-level migration (what replaces the runtime import), and `verifiedHost` flips only after the re-audit. Both are flagged as leftovers.
- **Leave the gen-official-tools regex as-is and hand-add `send_message`** — rejected: a generated file must be reproducible; fixing the scanner is the durable fix.

## Consequences

- `pnpm install` regenerates a lockfile with 0 occurrences of `0.1.1-rc`; all 73 official dsh packages sit at one version, one instance.
- Install currently exits non-zero at taskpilot's `prepare` (its client-face build is red until the source migration lands); every pnpm script run that triggers a deps-status check hits the same wall — pass `--config.verifyDepsBeforeRun=false` until then.
- Left for the adaptation phase: `dsh.client.inject` arrays still naming `@deepseek-ai/dsh-client-runtime` (taskpilot and others), `dsh.compat.verifiedHost` still `0.1.1-rc.2` in package.json files, README Compatibility re-audit, and the source migration of the remaining `dsh-client-runtime/client` imports (notably taskpilot's client face).
