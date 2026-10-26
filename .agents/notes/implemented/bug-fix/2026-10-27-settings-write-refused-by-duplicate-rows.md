# Agent Note: Settings writes refused when several suites insert the same row

Status: implemented

English | [中文](2026-10-27-settings-write-refused-by-duplicate-rows.zh.md)

## Problem

On a profile with several mode suites installed (3080: dev, eval, gamedev, video; the desktop app: dev and gamedev), the local-agent settings cards could not change anything. Turning off DeepSeek delegation (enabled) or a provider's live switch showed 「已保存」 but the switch stayed where it was, and a restart did not help.

Every suite's bundle patch inserts the same local-agent family rows: `local-agent`, `-kimi`, `-codex`, `-claude-code`, `-dsh`. A dump of the composed config (`dsh --profile web --dump-config`) shows `- id: local-agent-dsh` four times. The loader keeps one running instance. The host's `ConfigEditor.edit` (`packages/boot/config-editor/src/index.ts:137-140` at harness 1600d8a1e1) checks the write against `flatten(...).find(row => row.id === id)`, which is the **first** duplicate: a suite's insert with no config. The check fails with "Configuration for … is overridden by a home patch or command-line overlay" before the file is written. The client `ConfigForm.set` resolves `false` on a refusal instead of rejecting, and the cards treated any resolution as success.

This was reproduced on a throwaway instance with the 3080 composition. With four suites, writes to dsh, kimi and codex were refused while a singly-inserted row wrote fine. With one suite, every toggle wrote and showed at once.

## Decision

- **Cards say so.** The four provider cards treat a `false` answer as a failed write and show 保存失败 instead of 已保存. The switch stays on the value the host holds.
- **Root cause left open.** The duplicate insert needs a choice:
  - The host's write check should pick the row the loader picks (`findLast`, or the loaded row). This goes through the upstream pipeline.
  - Alternatively, our suites stop each inserting the family rows. But a bundle's member patches stay inert, so two suites that both need local-agent cannot avoid inserting it twice.
  The owner decides.

## Alternatives considered

**Treat the duplicate as harmless.** Rejected: every volatile setting on a shared row is unwritable while two suites are installed.

## Consequences

- Until the root cause is fixed, users with two mode suites cannot change these settings; the card now at least says the save failed.
- Other rows inserted by several suites (room, worktrees, typesafe, context-lens) are probably affected the same way. Not checked one by one.
- Test: a refused write (`set` resolves `false`) shows 保存失败 and leaves the switch unchanged.
