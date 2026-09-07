# Agent Note: mission — model tools register as a mount-time group

Status: implemented

English | [中文](2026-09-07-mission-tool-groups.zh.md)

## Problem

A profile can mount mission for two very different reasons. In the everyday case the model *is* the one working the queue: it creates missions, moves them along declared edges, submits outputs, and retries with a reason. In the other case something else drives the run — a service-face caller, a script through the CLI, a person at the tab — and the model is only there to read the queue and report on it. On that second kind of mount the write tools are not merely unused, they are a hole: a model holding `mission_transition` can move a mission the driver believes it owns, and `mission_attest` registers the very key an `attested` transition guard checks, so a model holding it can satisfy a guard that exists to require confirmation from outside the model.

A preset cannot close that hole. Presets select among the tools a profile registered; they cannot subtract one. Whatever the profile registers is reachable, so the decision has to be made where registration happens — in the plugin, at mount time.

## Decision

Plugin config gains `tools`, one of three groups, defaulting to `all`:

| `tools` | Registered |
|---|---|
| `all` (default) | all twelve tools — identical to the behavior before this option existed |
| `read` | `mission_run_list`, `mission_run_status`, `mission_list`, `mission_get` |
| `none` | nothing |

`registerMissionTools(ctx, service, tier)` takes the group as a third argument defaulting to `'all'`, returns immediately on `none`, and otherwise routes every definition through one local `register` helper that consults the exported `MISSION_READ_TOOLS` list. The tools themselves are untouched: same definitions, same origin tag, same `tools/pre-execute` approval pipeline, same `tool:<sessionId>` attribution for whatever is registered.

`mission_is_releasable` is read-only but stays out of `read`. It answers whether a mission's held resources may be destroyed — a question belonging to the side that holds the resource, and a `read` mount is by definition not that side. The `read` group is exactly the queue projection plus one mission's detail.

The `tool:mission` system-prompt section follows the group rather than describing tools that are absent. `all` keeps its original text verbatim. `read` gets its own text naming only those four tools and stating that missions are queued and moved by whoever owns the run, so the model reports the queue and asks for changes instead of attempting them. `none` registers no section at all: with no tools there is nothing for a tool-band section to say.

The group trims the model-tool face and nothing else. The service face (`ctx.mission`), the `/mission` slash command, the `dsh-mission` CLI, and the Remote-backed session tab mount identically in all three groups, and `inject` stays `['commands', 'tools', 'systemPrompt']` in every group — a `none` mount still assembles a system prompt and still has a tool registry, it simply adds nothing to either.

## Alternatives considered

**Let the profile's preset drop the write tools.** Rejected because it does not work: a preset chooses among registered tools and cannot subtract one, so every write tool stays reachable no matter what the preset says. This is the whole reason the switch lives in the plugin.

**Per-tool booleans (`tools: { transition: false, … }`).** Rejected as a configuration surface that grows with every new tool and lets a mount describe a combination nobody reasoned about — a mount with `submit` but not `transition`, say. Three named groups make the mount state its role: the model works the queue, reads it, or does not see it.

**Put `mission_is_releasable` in `read` because it does not write.** Rejected because the group is about roles, not about the absence of a write. Releasability is the resource holder's question; answering it for a mount that holds nothing invites the model to reason about destroying resources it does not own.

**Keep one prompt section for every group.** Rejected in both directions: describing all twelve tools under `read` invites calls that will not resolve, and stripping the section to a bare tool list loses the guidance the `all` mount depends on. Two texts, chosen by group, keep each mount's prompt true to what it registered.

**Register nothing but leave the section under `none`.** Rejected because `tool:mission` sits in the tool band and exists to brief the model on callable tools. A section describing an unreachable face is prompt weight with no action behind it.

## Consequences

- Default mounts are unchanged: `all` registers the same twelve tools and the byte-identical prompt text, so no existing profile shifts behavior by upgrading.
- A `read` or `none` mount closes the model's write path to missions without touching the other three faces, which is what makes the trim safe — the run still moves, just not from the model's side.
- The group is chosen at mount time and is not per-session: one instance cannot give one session the write tools and deny another. A profile that needs both mounts two instances or splits the work across profiles.
- `MISSION_READ_TOOLS` is exported, so a mounting profile can assert what `read` means instead of restating the four names and drifting from them.
- A new tool defaults into `all` only. Adding one to `read` is a deliberate edit of the list, which is the direction that fails safe.

## Testing

`packages/mission/tests/tools-config.spec.ts` mounts the plugin over a throwaway data root with a recording context and covers each group: the default and explicit `all` register all twelve names; `read` registers exactly `MISSION_READ_TOOLS`, four tools, without `mission_is_releasable`; `none` registers no tool and no prompt section. The `read` case also asserts the section's text contains each read tool name and none of the eight write tool names, so the prompt cannot drift back into describing tools the group did not register. A fourth case mounts all three groups and checks the slash face still registers in each, pinning the "tool face only" boundary. The mission build and all 128 tests pass.

## Cross-references

- [Mission attempt audit and guard gaps](../bug-fix/2026-09-04-mission-attempt-audit-and-guard-gaps.md) — the retry, submit-intent, and `writtenBy` work on the same tool face; this note adds whether that face exists at all.
- [Mission M1](2026-08-19-mission-m1.md) — owner of the twelve-tool face and the export-is-not-a-tool boundary this group decision extends.
