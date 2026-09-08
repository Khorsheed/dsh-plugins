# Agent Note: one `model` key per local-agent harness

Status: implemented

English | [中文](2026-09-08-local-agent-model-key.zh.md)

## Problem

Each of the four local-agent harnesses got its model from a different place,
and none of those places was a switch a person could reach from dsh.

- **codex** read the top-level `model` of its scoped `config.toml`.
- **claude-code** read `model` from its scoped `settings.json`, and with none
  the CLI's own default applied — the plugin never guessed it.
- **kimi** had a `model` plugin-config key, but it applied exactly once, when
  a FRESH scoped home was provisioned: it became the written `config.toml`'s
  `default_model`, and an existing config was left untouched. So on any home
  that had ever been provisioned, the key did nothing.
- **dsh** inherited the host instance's default-model selection; the provider
  never overrode it, and the snapshot reported it as `provider/model`.

Changing a model therefore meant editing that harness's scoped file by hand —
and for dsh, changing the whole host instance's default model. There was no
single entry point, and nothing on the settings page.

The evaluation-side constraint was already right and is kept: frozen decision
5 requires declared model == observed model, the condition hash carries the
model, and a mid-run change makes the next round a `MisattributedRun`.

## Decision

### One optional `model` key on each of the three CLI harnesses

`local-agent-codex`, `local-agent-claude-code`, and `local-agent-kimi` each
accept an optional `model: string` in their plugin config.

**Absent is the whole compatibility story.** With no key, each provider adds
NOTHING to the spawn argv — every argv variant is byte-for-byte the shape that
shipped before, and each harness's scoped file (or the CLI's own default)
decides exactly as it did. A whitespace-only value is treated as absent, so a
cleared settings field cannot produce an empty flag value.

**Set, it starts the CLI on every delegation round** — fresh and resume alike,
and in resident (`live`) mode as well as one-shot. Each harness uses its own
CLI's mechanism:

| harness | one-shot round | resident runtime |
|---|---|---|
| codex | `codex exec -m <model> …` — `-m` belongs to `codex exec`, so it precedes the `resume` subcommand (`codex exec resume` declares no `-m`) | `codex app-server -c model="<model>" --stdio` — no `-m` exists there |
| claude-code | `claude -p … --model <model> …`, ahead of the member channel's variadic `--allowedTools … --` | the same `--model` on the resident spawn |
| kimi | `kimi -m <model> -p <task>`; resume keeps `-S` first and hugs `-p` with `-m` | `kimi acp` has NO model flag: the scoped `config.toml`'s top-level `default_model` is rewritten before each runtime spawns |

Verified against codex-cli 0.144.0, claude 2.1.263, kimi 0.39.1.

kimi's resident path is the one case the "哪家 CLI 没有按次启动的模型参数就写作用域配置"
rule applies to. `writeKimiDefaultModel` is surgical and idempotent: only the
first TOP-LEVEL `default_model` assignment moves (a same-named key inside a
`[models."…"]` table is a different key), comments, tables, providers and key
order stay byte-identical, and a home with no config is left without one —
provisioning owns creation, and inventing a config there would hide a broken
home. The round still spawns when the write fails; the model read-back is what
surfaces the mismatch.

### kimi's key changes meaning, deliberately

`model` used to be provision-time-only; it is now per-round. The provisioning
mirror is KEPT — a fresh scoped home with no user config to mirror still gets
its minimal managed config built around this value — so the old behavior is a
subset of the new one. Both READMEs carry the warning.

### The resolution order `effectiveSettings.model` reports

Plugin config key → the harness's scoped file → absent. The key comes first
because it overrules the file on every launch: reporting the file would report
something that is not what runs. dsh keeps reporting the host
`agentDefaultModel` selection, unchanged.

### The settings card's "Default model"

A dev-domain card row on each of the three harnesses: one free-text input plus
the values saved before as `<datalist>` suggestions, and a save action. **No
model catalog is hardcoded anywhere** — a plugin-side list of model ids would
be stale the week after it shipped. Saving writes the same namespace `model`
field the YAML config feeds as its composition base, so the change reaches the
NEXT round with no reload; clearing the field UNSETS the key rather than
storing an empty string, so it re-inherits the base. The five most recent
values ride a `recentModels` field.

### dsh gets no key

The headless sub-dsh has no place to name a model per launch:
`dsh --profile headless-local-agent-dsh` accepts `--session-id`, `--resume`
and `--serve` only, and `loadSubDshAgent` takes the model from its
`agentDefaultModel` selection. Adding a key here would mean first opening a
per-launch model path in `@khorsheed/dsh-local-agent-dsh-headless`, which this
change deliberately does not do. For dsh, changing the model stays "change the
host instance's default model", and its README says so.

### The run-freeze is the design, not a gap

Nothing new guards a config change mid-run, and nothing needs to: a run freezes
its condition at setup, so the next round's model read-back sees declared ≠
observed and fails the run as misattributed. "A new run follows the new value,
a run in flight is never switched underneath you" therefore falls out of the
existing mechanism. All four READMEs state this rather than leaving it to look
like an oversight.

## Real-machine verification

Two rounds per harness on this machine, driving the shipped provider entry
points against the real CLIs under a real scoped home, reading the model back
through the provider's own settled observation (`onRoundSettled.observedModel`)
— the same value the evaluation compares against the declared model. Round one
sets the key, round two clears it.

| harness | `model` key | argv the plugin built | model read back | round |
|---|---|---|---|---|
| codex | `gpt-5.6-luna` | `-m gpt-5.6-luna` | `gpt-5.6-luna` | completed |
| codex | unset | no `-m` | `gpt-5.6-sol` (the home's own default) | completed |
| claude-code | `claude-haiku-4-5-20251001` | `--model claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | completed |
| claude-code | unset | no `--model` | `claude-opus-5[1m]` (the CLI's own default) | completed |
| kimi | `kimi-code/k3-256k` | `-m kimi-code/k3-256k` | `k3-256k` | error — see below |
| kimi | unset | no `-m` | `k3` (the home's `default_model = kimi-code/k3`) | error — see below |

Two facts about the kimi rows. The read-back reports the PROVIDER-side model id
(`[models."kimi-code/k3"]` declares `model = "k3"`), not the config key — the
pre-existing behavior of the wire-log read-back, unchanged here. And both kimi
rounds settled `error`: the account was at its monthly quota and the endpoint
answered 403, after the CLI had already resolved the model and written its
request record. So the model selection is verified end to end while a completed
kimi answer was not obtainable on this machine that day.

dsh has no `model` key, so it has no row: its model moves with the host
instance's default-model selection.

## Testing

Per harness: the unset argv asserted as a full array against the pre-key shape
(fresh and resume, and both permission modes for claude); the set argv with the
flag in its required position (`-m` before codex's `resume`, `--model` before
claude's `--allowedTools … --`, `-S` before kimi's `-m` before `-p`); the
resolver reading later settings writes without a reload; a blank value
resolving to unset; and the three-way `effectiveSettings` order (key wins over
the scoped file, file decides without a key, absent when neither names one).
The resident path is pinned per harness too: codex's `-c model=…` on the
app-server argv, claude's `--model` on the resident spawn, and kimi's
`default_model` rewrite — including that an unset key leaves the scoped config
untouched and that a home with no config still runs its round.
`writeKimiDefaultModel` has its own unit tests for in-place replacement,
insertion, the no-op, the absent config, and TOML escaping. The card tests
cover save, trim, clear-to-unset, the deduplicated recents, the suggestions
coming only from saved values, and the disabled-while-unchanged save.

## Alternatives considered

**Write the scoped config for all four harnesses, uniformly.** It would have
been one mechanism instead of two. Rejected because a per-round choice would
then mutate a file the user owns and edits: codex's `config.toml` and claude's
`settings.json` are documented, hand-edited surfaces, and rewriting them on
every round would make "what did I configure" and "what did the last round run"
inseparable. A flag overrules without touching the file. kimi's resident path
takes the config write only because `kimi acp` offers nothing else.

**One family-level model setting on the local-agent core instead of three
keys.** Rejected: the core spawns nothing, and the three CLIs do not share a
model vocabulary — a single field would have to be translated per harness
anyway, and the evaluation pins conditions per harness, not per family.

**A dropdown built from a model catalog.** Rejected: any catalog shipped in a
plugin is stale by the next model release, and a stale list silently prevents
running a model the CLI already supports. Free text plus a memory of what this
instance has actually run keeps the plugin out of the model-naming business.

**Capture the model at apply time, the way `sandbox` is captured.** Rejected:
the settings card has to take effect without a plugin reload, so the value is
read per round through a resolver — the same shape the live toggle already
uses.

**Add `--model` to the headless sub-dsh so dsh gets a key too.** Rejected for
this change: it is a fifth package outside this branch's scope and needs a
per-launch model path through the sub-instance's own model selection, not just
an argv flag. Recorded here as the condition under which dsh could gain the
key.

**Block or warn on a config change while a run is in flight.** Rejected: the
condition hash plus the model read-back already fail such a run loudly, a lock
would be a new mechanism guarding one of several ways the model can move (the
scoped files are still editable by hand), and the READMEs can simply explain
the existing behavior.

**Store an empty string when the card's field is cleared.** Rejected: an empty
string is a model named "" on the argv. Clearing unsets the field so the
composition base — and with no base, the pre-key behavior — takes over.

## Consequences

kimi deployments that set `model` in their YAML get a behavior change: the
value now rides every round instead of only a first provisioning. In this repo
no profile pins it (the web-eval profile sets `live` and `thinkingEffort`
only), so nothing in tree changes; a deployment that did pin it gets the model
it named, which is what the key reads like it should have done.

A kimi round in resident mode now writes to the scoped `config.toml`. The
write is idempotent and confined to one line, but it does mean the file's
`default_model` follows the last resident spawn — visible to anyone reading
the file, and honest: it IS what the next `kimi acp` will run.

The resident drives bind the model at RUNTIME SPAWN, not per round: a member
already holding a runtime keeps its model until that runtime is reclaimed,
crashes, or the live toggle rebuilds the generation. One-shot rounds — the
evaluation's drive, and the default — take the value on every round.

The evaluation package and the profile pins are untouched. Whether the
evaluation instance should pin a model per condition is a separate decision.
