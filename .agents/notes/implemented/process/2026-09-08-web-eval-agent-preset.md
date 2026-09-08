# Agent Note: The web-eval agent preset ships with the pack, and what it still cannot subtract

Status: implemented

## Problem

[Frozen decision 12](../../../../profiles/web-eval/README.md#冻结决策) says the evaluation apparatus has a single destroy path: only the orchestrator holds the docker socket, and the evaluation instance's agent preset carries no Bash and no docker. Through I2 the decision existed only as a sentence. The instance ran on the shipped `standard` preset — the full coding agent, shell included — because that is what `@deepseek-ai/dsh-web-app` pins as the roster default.

I2 ran on the host with no container boundary, so nothing was at stake beyond a real home directory. I3 hands the orchestrator a docker socket and puts every unit behind `lab`'s release gate, and at that point a shell in the agent's catalog is a second door into the same room: one `docker rm` mid-run, or one write into an archived unit, and the gate's guarantee — no unit is released without a passing file-check — is no longer a property of the apparatus, just of the agent's restraint.

The preset is also the *only* place the decision can be executed. The web surface moved every model-facing row onto the agent plane: `packages/bundle/web-app/cordis.patch.yml` disables `tool-bash`, `tool-fs`, `tool-skill` and the rest at the profile root and lets each session mount a preset instead. So the profile's own `cordis.patch.yml` has no shell row to disable — the shell arrives with whichever preset a session mounts, and a pack that wants no shell has to ship a preset.

## Decision

The pack ships `profiles/web-eval/presets/eval/` (`agent.cordis.yml` + `preset.yml`, display name 评测模式). Its composition is the shipped `standard` preset minus two classes of row:

| Removed | Class | Why |
|---|---|---|
| `tool-bash` / `tool-pwsh` | host execution | the shell itself — decision 12, verbatim |
| `tool-workflow` | host execution | a workflow script is **model-authored JavaScript** run as an async function body inside a Node worker thread (`packages/workflow/workflow-worker-thread`), so `node:child_process` is one dynamic `import` away, with no shell anywhere in the path |
| `workflow-worker-thread` | host execution | the engine `tool-workflow` needs; nothing else in this composition consumes `ctx.workflowEngine` |
| `tool-ralph` | host execution | drives the same engine, and a 64-round self-driving loop is not what a planning agent is for |
| `plan-mode` | vocabulary | its prompt plans an *implementation* and forbids writing files, while this agent's whole output is a `dataseek.plan/1` written to disk for a person to approve. Two things called "plan" in one session is the confusion, not a missing capability |

What stays is reading, drafting, and delegation to an agent **running on this same preset**: an in-process child runs on its parent's preset (`packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts` in the harness asserts exactly that), so `subagent` and `subagent_fork` cannot hand a child the shell the parent does not carry. `tool-fs` keeps `write` and `edit` because the agent's deliverable *is* files, and writing one executes nothing. `glob`/`grep` stay because they spawn the packaged ripgrep binary through `ctx.subprocess` and take no command from the model.

Docker never had to be removed: `@khorsheed/dsh-lab` registers no model-facing tool at all, and every container verb lives on the orchestrator's service face.

**The preset belongs to the pack**, on the same argument that moved `cordis.patch.yml` there (see [the pins Agent Note](2026-09-07-web-eval-pins-belong-to-the-pack.md)): it is apparatus, not preference, and a person's edit to it must not survive an update in silence. `install.sh` gained `PRESET_IDS` beside `PROFILE_FILES` and `update.sh` gained the same list beside `UPDATE_FILES`; both replace `$DSH_HOME/.agent-presets/<id>` whole. The destination is outside the profile directory because the preset roster is per-`$DSH_HOME`, not per-profile — which is why uninstalling the profile no longer removes everything the pack installed, and the README says so beside the `rm -rf`.

`cordis.patch.yml` pins the roster default:

```yaml
- id: agent-presets
  config:
    default: eval
```

A patch's `config` override is a whole-value **replace**, not a deep merge (`vendor/include`'s `applyEntryPatches` does `target[key] = value`). What it replaces here is the web-app bundle's `{default: standard}`, which carries no other key, so nothing is lost: `roots` is written afterwards by `apps/cli`'s `composeProfile`, which appends the shipped preset root as the last overlay, and `includeUserRoot` keeps its schema default of `true` — the root under which the pack's preset was just installed.

### What this preset cannot subtract

A preset filters only the rows it mounts itself. Four delegation tools are inserted at the **profile root** by the providers' own bundle patches (`tool-subagent-kimi`, `tool-subagent-codex-local`, and their claude-code and dsh siblings, each an instance of `@khorsheed/dsh-local-agent-tool-subagent`), and they are execution-class by construction: each starts a vendor CLI on the host under the sandbox tier [frozen decision 3](../../../../profiles/web-eval/README.md#冻结决策) opens up. A fresh instance shows three of them — `subagent_codex`, `subagent_claude_code`, `subagent_kimi`; `subagent_dsh` appears only after the DeepSeek switch in Settings → 本地 Agent is turned on, which is off by default.

Three ways to close that, none taken in this change:

1. **A tool-registration config on `@khorsheed/dsh-local-agent-tool-subagent`** — the T12/T13 pattern that gave `datasets` and `mission` their `tools` groups. Each row here registers exactly one tool, so the knob is a switch rather than a group list (`tools: all | none`, or `registerTool: false`). The provider row stays mounted, so the orchestrator's delegation path and `/codex login` are untouched. Costs a package change and a release.
2. **`disabled: true` on the four tool rows in the pack's `cordis.patch.yml`** — no package change, and it disables only the tool rows, never the provider rows; it is exactly what the web-app bundle does to move tools onto the agent plane. It needs one fact confirmed first: that the orchestrator delegates through the provider registered on `ctx.subagents` rather than through the model-facing tool.
3. **A scope-restriction row mounted inside the preset**, calling `ctx.tools.restrict({ deny: [...] })`. This is feasible and is the general answer to "a preset cannot subtract profile-layer tools": `restrict()` refuses an unscoped context, and `mountPreset` mounts the composition under exactly such a scope, so a row in `agent.cordis.yml` can deny inherited global tools by name for every agent on that preset. It costs a new package, and it fails loud when a denied name is absent from the composition — an instance without the codex provider would not boot its preset.

Two limits of the preset mechanism itself, both worth stating rather than discovering later:

- **The pin sets the default, not the reachable set.** `composeProfile` writes the shipped preset root into `roots` unconditionally as the last overlay, so 标准 / 代码 / 极简 / cordis stay on the roster and no profile layer can remove them. A person can put a blank session on 标准模式 and get Bash back. Decision 12 is aimed at agent misoperation, and an agent has no tool for switching its own preset — selection is a human act, logged as `agent-preset/selected`.
- **`run_code` is unrestrictable by design.** `tools.restrict()` refuses to name the reserved Code Mode transport, and a Code Mode program is an async function body in a Node worker, i.e. the same reach as a workflow script. It is absent because `tools.mode` defaults to `native` and nothing in this profile changes it. Do not set `DSH_TOOLS_MODE` on an evaluation instance; when per-session Code Mode selection ships, this becomes a live question.

## Verification

A fresh source-mode install into a throwaway `$DSH_HOME` (`install.sh --source <checkout> --fresh`, 23 `@khorsheed` members, 160 patch rows), booted on a spare port, then asked for its own catalog through `capability-catalog`'s snapshot Remote — which reads `ctx.tools.schemas()` at the default preset's standing scope, i.e. the list an agent on that preset actually sees:

- 39 tools, and **no `bash`, no `pwsh`, no `terminal_*`, no `str_replace_editor`, no `run_code`, and no container tool of any kind**.
- `datasets_*` (the `authoring` group), `mission_get` / `mission_list` / `mission_run_list` / `mission_run_status`, and `eval_conditions` / `eval_plan_validate` / `eval_run_status` are all present — the tool-by-domain table still holds.
- The same instance re-booted with a one-row `--patch` overlay putting the default back on `standard` shows 43 tools. The difference is exactly `bash`, `exit_plan_mode`, `ralph`, `workflow` — the four this preset drops, and nothing else in either direction.
- `update.sh` run over a hand-edited copy of the installed preset restores it byte for byte.

## Alternatives considered

**Leave the preset to the operator (copy `standard` in the UI and edit it).** Rejected: that makes decision 12 a habit rather than a file. An instance whose preset is hand-made cannot be reproduced from the pack, nothing detects drift, and the roster's own copy path would not even be reachable on a fresh machine before the first session.

**Ship the preset under the profile directory** (`$DSH_HOME/profiles/web-eval/presets/`). Rejected: `dsh-agent-presets` scans `$DSH_HOME/.agent-presets`; the roster is per-home by design, and a preset the loader cannot find is not a preset. The cost is that uninstall now takes two `rm -rf`s, documented in both READMEs.

**Disable `tool-bash` in `cordis.patch.yml` instead of authoring a preset.** Rejected because there is nothing to disable: the web-app surface already disables that row at the profile root, and the shell reaches the model only through a preset. This is the fact that makes the preset the sole execution point, and it is why the pack has to carry a whole composition rather than one patch line.

**Also disable the four `tool-subagent-*` rows in the same change.** Rejected for this change, and recorded above as option 2. The brief that commissioned the preset holds the patch-layer disable lever for a considered decision rather than a side effect, and the option is only safe once the orchestrator's own delegation path is confirmed to go through `ctx.subagents` rather than the model-facing tool. Silently removing the four tools would also change what a *person* can do from the tab, which is a separate call from what the agent may do.

**Keep `tool-workflow` and drop only the shell.** Rejected: a workflow script is model-authored JavaScript in a Node worker, so keeping it would leave decision 12 true in letter and false in fact. The same reasoning retires `ralph` and the engine, which exist to serve it.

**Drop `tool-fs`'s `write`/`edit` as well, for a strictly read-only agent.** Rejected: the agent's deliverables are files — `plan.json`, `condition.json`, an analysis draft — and writing one executes nothing. The release gate is a file-check on archived units, not on the agent's working directory; a read-only agent would need a different way to hand its output to a person, which is a bigger change than decision 12 asks for.

**Author the preset as a trimmed `minimal` rather than a trimmed `standard`.** Rejected: `minimal` composes a *persistent PTY* shell and a bare local filesystem — it is further from this preset's requirements, not closer, and its fixed `complete: true` persona would drop the runtime context the analysis phase reads.

## Consequences

- Decision 12's first half is now a file that installs itself, and its second half — the profile-root delegation tools — is written down with three costed ways to close it instead of being discovered during I3.
- The preset is a **copy** of a shipped composition, so upstream changes to `standard` do not reach it. When the harness moves, re-diff the two files; the copy's header names its parent for exactly this reason.
- Uninstalling the pack now has two paths (`profiles/web-eval` and `.agent-presets/eval`). Leaving the preset behind is harmless — with no profile pinning it as the default it is one more roster entry — but it is no longer true that one `rm -rf` removes everything the installer wrote.
- A person who wants their own composition on an evaluation instance must author it under a different preset id; `eval` is replaced whole on every install and update, exactly like `cordis.patch.yml`.
- The instance's agent now answers "run this for me" with a request to the person instead of a tool call. The persona says so outright, so the turn is spent on the ask rather than on discovering the absence.
- The fs tools still answer to the host's sandbox policy, which this preset does not change: the preset file itself is ordinary state on disk, and whatever that policy permits, it permits editing there too. Closing that is a sandbox question, not a preset one.

## Related

- [The web-eval evaluation pins belong to the pack](2026-09-07-web-eval-pins-belong-to-the-pack.md) — the same ownership argument, one layer down.
- [web-eval install source mode](../feature/2026-09-04-web-eval-install-source-mode.md) — the installer this change extends.
- [profiles/web-eval/README.md](../../../../profiles/web-eval/README.md#冻结决策-12-的执行点eval-预设) — the operator-facing section, including how to confirm a running instance is on this preset.
- [web-eval iteration plan](../../../../profiles/web-eval/docs/iterations.md) — I3 · T21.
