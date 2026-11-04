# Agent Note: writing mode restores native subagents for novel reconciliation

Status: implemented

English | [中文](2026-11-05-writing-novel-native-subagent.zh.md)

## Problem

The 2026-09-30 writing-preset diet removed every delegation tool, but the later canvas-novel reconciliation workflow requires one: `novel_extract(prepare)` produces a self-contained material pack for a fresh subagent, `novel_extract(import)` accepts its strict JSON, and failed evidence goes back to the same child for repair. The skill expressly forbids the parent from manufacturing that JSON itself. A production writing session therefore had `novel_extract` but no `subagent` tool and started looking for an external CLI workaround.

The host already mounts its subagent service and in-process backends in the base bundle. The Web bundle disables the global model-facing delegation rows so that each preset can choose its own tools; the writing preset simply never opted back in.

## Decision

- `packages/writing-suite/cordis.patch.yml` grants the official `tool-subagent-control` root row and one `tool-subagent` row configured with `provider: spawn` and `toolName: subagent`.
- The host base continues to own the registry and spawn backend. The mode adds no package dependency, external process, CLI account, or second provider.
- A spawn child starts with an empty conversation, which fits the self-contained extract pack. The control row provides `send_message` for evidence repair in the same child and `interrupt_agent` for basic cancellation.
- This is a narrow exception to the [writing-preset minimal tool diet](../simplification/2026-09-30-writing-preset-minimal-tool-diet.md), whose delegation exclusion it partially supersedes. `list_agents`, fork, child-model selection, workflows, jobs, and external-agent providers remain out of the writing composition.
- `packages/writing-suite/tests/bundle.spec.ts` parses the preset grant list, pins both official rows and the spawn configuration, and rejects reintroduction of the fork and list-agents rows through that grant list.

## Alternatives considered

- **Let the parent write the extract JSON.** Rejected by the reconciliation workflow itself: the production failure that motivated the evidence gates came from parent-authored quotes that did not match the manuscript.
- **Delegate through Claude Code, Codex, Kimi, or the community local-agent family.** Rejected: reconciliation needs only an in-process model child. External CLIs add installation, authentication, process, and data-routing requirements without helping this task.
- **Use fork or restore the full standard delegation stack.** Rejected: fork duplicates completed parent history that the self-contained pack does not need, while model selection, agent listing, workflows, and jobs add prompt surface beyond the requested basic capability.

## Consequences

- Writing requests gain `subagent`, `send_message`, and `interrupt_agent`, but not `list_agents` or `list_subagent_models`. The model can run the documented prepare → delegate → import loop and repair failed quotes without shelling out.
- The child inherits the parent's model, working directory, and writing preset but not its transcript. The extract pack must therefore remain self-contained.
- No host change is required. Production use still requires the normal writing-suite deployment and live writing-session acceptance; this source change does not restart 3080.

## Validation

- The bundle regression test covers the two grant rows, `provider: spawn`, `toolName: subagent`, and the continued absence of fork and list-agents grants.
- Package build/test and repository composition checks remain the delivery gates; live delegation is verified separately from the static composition assertions.
