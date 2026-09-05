# Agent Note: local-agent eval effective-settings snapshots

Status: implemented

English | [中文](2026-09-04-local-agent-eval-effective-settings.zh.md)

## Problem

The web-eval profile's frozen fairness baseline (decisions 2 to 4: exec drive, the container-side approval boundary, per-harness reasoning effort) requires that every harness's currently-effective settings enter the evaluation's condition hash. Nothing could read them: each provider's knobs were scattered across its own config surface, kimi's reasoning effort was hardcoded `high` inside the provisioning code, and the status surfaces reported only auth facts. An evaluator had to trust that two condition rows differed by exactly the declared factor — the exact trust the condition hash exists to remove.

## Decision

- The core `LocalAgentHarness` contract gains an optional `effectiveSettings()` declaration; the registry resolves it by name via a read-only `effectiveSettings(name)` method, and both status surfaces — the `/<harness> status` reply and the `LocalAgentStatus` Remote — attach the snapshot as an additive optional field, so pre-existing clients are unaffected.
- The snapshot shape (`LocalAgentEffectiveSettings`) is a closed vocabulary of pure JSON: `drive`, `sandbox`/`permissionMode`/`autoApprove` (each harness's own boundary term), `reasoningEffort`, `baseUrlSet` + `baseUrlHost` (hostname only, never the full URL — its path can carry credential-adjacent segments), and a reserved `cliVersion`. Credentials never enter the type. A field the harness has no knob for stays ABSENT, and absence is deliberate: it is the honest condition-hash input ("dsh unrestricted" is expressed by having no boundary field, not by inventing a value).
- Snapshots are LIVE reads, not config echoes: kimi and codex read their scoped `config.toml` (effort, endpoint, kimi's `Bash(*)` allow rule detected with the exact substring the provisioning gate keys on), claude-code mirrors the provider's own resolution order (config `baseUrl` wins over `ANTHROPIC_BASE_URL`), and each reports the drive from the live settings preference. A person-edited scoped config therefore reports the edited values — what would actually run is what gets hashed.
- Kimi's `thinking.effort` leaves the provisioning hardcode as the `thinkingEffort` config item (default `high`, the previous hardcode). It applies at provision time only, exactly like the mirrored model: an existing config is respected untouched, and the snapshot reads the file rather than the item, so the two can never disagree silently.
- No CLI-version probe was added: probing would spawn every CLI at status time. `cliVersion` is reserved so a later probe is purely additive.

Along the way, kimi's apply path chains the permission bootstrap after config provisioning. Both used to fire concurrently; on a fresh home the bootstrap could read ENOENT and return early, leaving the `Bash(*)` allow rule unwritten until the next boot — first-boot delegations answered without executing tools. The chain makes the bootstrap comment ("provisioning will write one with the rules when it runs") true instead of aspirational.

## Extension: the configured model joins the snapshot

The web-eval condition contract requires `model.declared`, and the readiness check compares the declaration against the model a round would actually run with — so the snapshot gains an optional `model` field, read from each harness's own configuration surface with the same live-read discipline as every other field: kimi reads its scoped config's top-level `default_model`, codex its scoped config's `model`, claude-code its scoped `settings.json`'s `model`, and dsh the host `agentDefaultModel.currentSelection()` the headless sub-dsh inherits (formatted `provider/model`). The absence rule is unchanged and load-bearing: a model the harness has not named is NOT substituted with a guessed default (claude's default model belongs to the CLI; dsh without a readable selection reports nothing), because the readiness check must compare the declaration against a real configured value or detect its absence, never against an invented one. Reading adds an optional peer dependency on `@deepseek-ai/dsh-agent-default-model` to local-agent-dsh (type-only; the service stays optional at runtime and degrades to an absent field). No model selection, no CLI arguments, and no default behavior change anywhere — this is the read side only.

## Alternatives considered

**Report only plugin-config values (echo, not live read).** Rejected: the mirrored-config path means the config item and the scoped file diverge routinely (a user's real config mirrors in without any effort key); a snapshot of the item would hash a value the rounds never used.

**A uniform `permissions` string across harnesses.** Rejected: it forces either codex's sandbox vocabulary into claude's permission slot or a prefixed pseudo-vocabulary (`sandbox:workspace-write`) nobody's CLI speaks. The eval condition contract owns the cross-harness normalization; the snapshot reports each harness's own term, traceable to the config that produced it.

**Per-condition effort overrides now (I4's parameterized model).** Out of scope by the iteration plan: I3 pins the vocabulary, I4 makes providers accept per-condition model parameters. Making the effort configurable (not per-condition) was the minimal un-controlling step that keeps defaults frozen.

**Deep TOML parsing for the config readers.** Rejected: the existing `readKimiBaseUrl`/`readCodexBaseUrl` line-scans are already section-aware and dependency-free; a parser dependency (or hand-rolled grammar) adds attack surface to a diagnostics path. The new readers follow the same shape, including the honest `undefined` when a key is absent.

## Consequences

- The condition hash's fairness inputs are readable at runtime by the evaluator, the status surfaces, and a human running `/kimi status`; two rows differing by one factor are checkable, not declarable.
- The snapshot is advisory evidence, not enforcement: a person editing a scoped config mid-run changes the NEXT read, not the already-recorded condition. The orchestrator must snapshot at condition-provision time and re-read at run start to detect drift.
- Provider-side vocabulary additions (a new boundary kind, a version probe) are additive optional fields; consumers hash `JSON.stringify` of the object, so field order is irrelevant but adding fields changes hashes — acceptable because a condition-hash change must mean a declared-factor change, and these fields ARE declared factors.
- kimi's `thinkingEffort` only reaches fresh homes; an eval instance must provision its scoped homes with the desired pin in place (the profile patch layer sets the item before first boot), and changing the pin afterwards requires re-provisioning the home.
- Test determinism: the kimi specs pin `os.homedir()` to a location without a real `~/.kimi-code/config.toml`, because the mirror path otherwise copies the developer machine's real config into every fresh-home assertion.
