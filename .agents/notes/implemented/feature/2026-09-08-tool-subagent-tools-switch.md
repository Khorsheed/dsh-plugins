# Agent Note: tool-subagent — a mount-time switch for the delegation tool

Status: implemented

English | [中文](2026-09-08-tool-subagent-tools-switch.zh.md)

## Problem

A profile that installs the local-agent family gets more than a delegation provider. Each harness bundle's patch inserts two rows at the **profile root**: the provider, and one `@khorsheed/dsh-local-agent-tool-subagent` row carrying the model-visible tool — `subagent_codex`, `subagent_claude_code`, `subagent_kimi`, `subagent_dsh`. That tool is exactly the thing that starts a coding-agent CLI on the host, with whatever sandbox the provider is pinned to.

For the everyday development profile that is the point. For an evaluation instance it is a hole. `dsh-web-eval` freezes decision 12 — the apparatus has one destruction path, so the instance's agent gets no shell and no container control — and [the eval preset](../process/2026-09-08-web-eval-agent-preset.md) executes that decision by shipping a composition with the execution rows removed. A preset cannot reach these four: it filters what it mounts, and these mount above it, at the profile root. So the preset could take away `bash` while leaving four tools that each start a CLI on the host with `sandbox: workspace-write` or `permissionMode: skip`.

The orchestrator does not need them. It drives the players through the local-agent service face (`packages/eval/src/run.ts` uses only `LocalAgentFace`, i.e. the provider registered in `ctx.subagents`), and `/codex login`, `/kimi status` and the rest are the provider's own slash verbs. Nothing in the evaluation flow passes through the model-visible tool.

## Decision

Plugin config gains `tools`, defaulting to `all`:

| `tools` | Registered |
|---|---|
| `all` (the default) | the row's one model-visible tool — byte-identical to the behavior before this option existed |
| `none` | nothing |

Under `none`, `apply` logs which tool it is not registering and returns before anything else: no tool, and no `subagent/provider-added` / `subagent/provider-removed` listeners either, since those exist only to mount and unmount that tool. Everything else the family owns is registered by the **provider package** — the harness, the `ctx.subagents` provider, the slash verbs, the `ctx.localAgent` service face — so a `none` row leaves every non-model path to that CLI open. `inject` is unchanged in both values.

**Two values, not a group list.** Each loaded row registers exactly one tool, so there is nothing to group. `datasets` and `mission` have graded `tools` groups because each registers a dozen tools whose roles differ; here the only question is whether the model sees this row's tool at all.

**The switch has to live in the package.** A preset selects among registered tools and cannot subtract one, and these rows mount at the profile root, above every preset. Registration is the only place the decision can be made, which is the same reasoning [mission's tool groups](2026-09-07-mission-tool-groups.md) recorded.

`profiles/web-eval/cordis.patch.yml` sets `tools: none` on the three rows that have one — `tool-subagent-codex-local`, `tool-subagent-claude-code-local`, `tool-subagent-kimi` — as frozen decision 12's third execution point, after tool-exposure-by-domain and the `eval` preset default.

**Each patch row restates the whole config.** A patch layer's `config` is a whole-value replace, not a deep merge (`vendor/include`'s `applyEntryPatches` does `target[key] = value`), so a row carrying only `tools: none` would erase the `provider` and `toolName` the provider bundle wrote, and `provider` is required — the composition would fail schema validation. Each row therefore restates `provider` and `toolName` beside `tools`, and carries `name:` so a row id claimed by some other plugin is reported as a name mismatch and skipped rather than handed a config it cannot read. Under `none` those two keys only satisfy the schema: the plugin returns before either is read.

**The fourth tool has no row to patch.** `subagent_dsh` is mounted from inside `local-agent-dsh`: the DeepSeek switch is off by default, and while ON the controller calls `ctx.plugin(toolModule, { provider: 'dsh-cli', toolName: 'subagent_dsh' })` with a hardcoded config the profile layer cannot reach. By default it registers nothing, so it is absent from an evaluation instance's tool list — but a person who turns that switch on in Settings gets the tool with the default `tools: all`. Closing that path means passing `tools` through `local-agent-dsh`, which this change deliberately leaves alone: the task that commissioned the switch scoped provider packages out, and the dsh player is driven through the same service face as the other three, so the gap is a default a person can flip, not a path the agent can take on its own. Both READMEs and the pack's patch say so where a reader will meet it.

The in-process `subagent` and `subagent_fork` are untouched. They inherit the parent's preset, so a delegation cannot hand a child a shell the preset does not carry.

## Alternatives considered

**`disabled: true` on the four tool rows in the pack's patch** (option 2 of the three [the eval-preset note](../process/2026-09-08-web-eval-agent-preset.md) recorded). Rejected as the place to put the decision, not as a mechanism that works: it does work, and needs no package change. But it states the intent in the layer furthest from the thing being switched off — a reader of the tool package would find no trace that "do not register" is a supported state, there is nothing to test in CI, and every future composition wanting the same thing re-derives the row ids by hand. The config option is versioned with the code it governs and has tests; the patch row then says *why*, not *how*.

**`ctx.tools.restrict({ deny: [...] })` from a row inside the preset** (option 3). Rejected: it is the general answer to "a preset cannot subtract profile-layer tools" and would need a new package, but it fails loud when a denied name is absent — an instance without the codex provider could not mount the preset at all. It also denies by name, so the deny list drifts silently as tool names change.

**Per-tool booleans or `registerTool: false`.** Rejected as the same switch with a worse name. `tools` matches what `datasets`, `mission`, and `eval` already call this knob, so a profile author reads one vocabulary across the four rows of `cordis.patch.yml` instead of four spellings of the same idea.

**Keep the provider lifecycle listeners under `none`, with a no-op mount.** Rejected: the listeners exist solely to register and unregister the tool. Kept alive under `none` they would watch for an event whose only handler does nothing, and the "will register when it appears" log line would be false. Returning early makes the mount's own logs true.

**Make `provider` optional when `tools` is `none`.** Rejected: it buys three shorter patch rows and costs the schema its meaning — `provider` would become required-except-sometimes, and a typo'd provider name in a `none` row would then be accepted silently, only to fail the day someone flips the row back to `all`.

**Pass `tools` through `local-agent-dsh` so all four close together.** Not done here: the commissioning task scoped provider packages out, and the honest state — three closed, one off-by-default with a documented way for a person to reopen it — is better recorded than quietly half-claimed. The change is small when it is wanted: one config key threaded to the existing `ctx.plugin(toolModule, …)` call.

## Consequences

- Default mounts do not move: `all` registers the same tool with the same schema, description, and origin tag, so the dev-domain profiles are byte-identical after upgrading.
- The evaluation instance's agent has no model-visible path to a host CLI, while the orchestrator's path to the same CLIs is untouched. That asymmetry is the whole point of putting the switch at registration rather than at the provider.
- **A person at the tab loses something too.** These are model-visible tools, so the only way a human reached them was by asking the model to delegate. In a `none` profile that request now has nowhere to go; the human's remaining paths to those CLIs are the provider slash verbs and the orchestrator. In the eval domain that is intended — the model is there to plan and analyze — but it is a real reduction, not just a guardrail against agent misoperation.
- Any layer overriding one of these rows must restate `provider` and `toolName`, because patch `config` replaces rather than merges. That is a property of the loader, not of this option, but this is the first row in the pack's patch whose upstream config is non-empty, so it is the first place it bites.
- `subagent_dsh` remains reachable behind the default-off DeepSeek switch. Recorded above, in `cordis.patch.yml`, and in both README languages.

## Testing

`packages/local-agent-tool-subagent/tests/tool-subagent.spec.ts` adds three cases to the existing suite (15 tests, all green): an explicit `tools: 'all'` registers and executes exactly as the default does; `tools: 'none'` with the provider already present registers no tool and leaves `ctx.subagents.getProvider` intact; and `tools: 'none'` with the provider arriving *after* the mount stays unregistered — pinning that `none` does not reopen through the late-mount path the `all` case relies on.

End to end, on a throwaway `$DSH_HOME` with a fresh source-mode install of the pack (23 members, 160 patch rows): `--dump-config` shows the three rows composed with `provider`, `toolName`, and `tools: none`; the capability-catalog snapshot Remote — which reads `ctx.tools.schemas()` under the default preset's standing scope, i.e. what the agent actually sees — returns **36 tools**, down from the 39 the eval preset produced at T21, with the difference being exactly `subagent_codex`, `subagent_claude_code`, and `subagent_kimi`, and with in-process `subagent` and `subagent_fork` still present. On the same instance `/codex status`, `/kimi status`, and `/claude-code status` all report their pinned configuration, and `/eval run <plan> --dry-run` validates a plan, expands the matrix, and prints the execution order.

## Cross-references

- [The eval preset](../process/2026-09-08-web-eval-agent-preset.md) — frozen decision 12's second execution point; it recorded this gap and the three options, of which this note takes the first.
- [mission — model tools register as a mount-time group](2026-09-07-mission-tool-groups.md) — the same "a preset cannot subtract what the profile registered" reasoning, for a package with a dozen tools rather than one.
