# Agent Note: mission — bundle export, leak gate, expectedNs report (milestone M2, second half)

Status: implemented

English | [中文](2026-08-19-mission-m2-export.zh.md)

## Problem

The [mission proposal](../../../proposals/active/2026-08-19-mission-tasks.md) makes sharing a run an initiating-class human decision behind a **leak gate** (§5): a bundle that includes a `modelFacing: false` layer burns that batch of scenes, so export needs interactive human confirmation, must refuse non-TTY callers fail-closed, and must exist only where a human can actually confirm — never as a model tool. Alongside it, §6 requires the bundle to be self-contained and the `expectedNs` completeness report to mark missing namespaces honestly (never substituted). After [M2's first half](2026-08-19-mission-m2-slash.md) shipped the slash face without export, this slice delivers `dsh-mission export` + `/mission export` + the gate + the report.

## Decision

The export core is `src/export.ts`, face-agnostic: `planExport` computes what a bundle WOULD contain (included layers with pre-resolved guarded flags, the `guardedLayers` trigger list, the ns completeness report) and writes nothing; `exportRun` writes the bundle and trusts the caller to have passed the gate. The bundle (`<outDir>/<runId>-bundle/`) follows §6: `manifest.json` (frozen state machine, snapshot `{repo, commit, dataset}` reference, per-layer sha256 content hashes over sorted path+content, the layer list with guarded layers restated, the ns report), `run.json`, `missions/<id>/attempt-N/{meta.json, annotations.json, artifacts/}` (artifact bytes copied from the run-data tree), `dataset/<layer>/` per included layer, and a `methodology.md` stub. An existing bundle directory is never overwritten (append-only stance). Declaring `--layer` requires `--snapshot-dir` — a bundle is self-contained or it isn't.

The **leak gate** lives in the faces, by shape of what each face honestly is:

- **CLI**: guarded layers → per-layer `y/N` confirmation over a readline prompt, but only when stdin AND stdout are TTYs; non-TTY refuses with exit 1 (fail-closed) naming the layers and stating no flag bypasses. `runCli` takes an injectable `tty: { isTTY?, confirm? }` so tests drive both branches; the bin entry passes the real streams.
- **Slash**: a command invocation is one-shot text with NO follow-up channel, so `/mission export` refuses guarded layers and points at the TTY CLI — refusing is the gate working, not a missing feature. When the datasets plugin is mounted, the slash face probes `ctx.get('datasets')` (duck-typed `list({repo}, dataset, commit)` → `dataset.nonModelFacingLayers`) for layer visibility; absent or any drift → explicit `--guarded` declarations only.
- Unguarded exports run on every face with no ceremony.

The **expectedNs report** (`nsCompleteness` in export.ts; `run status` prints it via the shared `renderStatus`, export prints and embeds it): per cell — `present` (all namespaces), `expectedPresent`, `missing` (expectedNs minus present, reported as missing, NEVER substituted), and `onlyUnlisted` (annotations exist but none from expectedNs — the "looks reviewed, actually only a draft" case the proposal's llm-draft example motivates, flagged without hardcoding scene vocabulary).

Export is registered NOWHERE as a model tool; the system-prompt section keeps saying so.

## Alternatives considered

- **A `--include-guarded` bypass flag** — rejected per the proposal: an agent adds flags by itself; only an interactive per-layer confirmation counts as a human decision, so the CLI accepts no such flag and the refusal message says why.
- **Slash-side textual "type yes to confirm"** — rejected: a slash handler returns one CommandResult; it cannot ask a question and read an answer within one invocation, and a pre-typed `--yes` is the bypass flag in disguise. Refusal + pointer to the TTY CLI is the honest mapping.
- **CLI reads dataset.yml for layer visibility** — rejected: the CLI is out-of-process (no ctx) and mission carries no YAML parser; the CLI takes explicit `--guarded` declarations, the in-host faces probe the datasets plugin.
- **Enforcing the gate inside `exportRun`** — rejected: the core cannot know whether the caller is interactive; it computes the trigger list (`planExport.guardedLayers`) and the faces own the interaction, so the web tab (M4) can implement the same gate as a confirm dialog listing guarded layers.

## Consequences

- The leak gate now exists on both v1 faces with tests pinning non-TTY refusal (guarded + flag present or not), TTY accept/abort per layer, slash refusal with the CLI pointer, and the datasets-probe path.
- Bundles are verifiably self-contained (test reads every fact from the bundle alone) and content-hashed per layer and per attempt-artifact tree.
- `run status` gained the expectedNs block — the M1 note deferred exactly this to M2.
- The gate's face-split (core computes, faces confirm) is the contract the M4 tab's export button reuses: the Remote carries `guardedLayers` to the browser, the dialog confirms per layer, the confirmed list rides the export call back.

## Testing

`packages/mission/tests/export.spec.ts` (12 tests): bundle shape and self-containment (manifest/run/mission cells/artifacts/dataset layers/methodology), per-layer and per-attempt content hashes, ns report semantics (complete cell, only-unlisted cell, missing never substituted), run-status report rendering, overwrite refusal, layers-without-snapshot-dir refusal; CLI gate — non-TTY refusal (nothing written), TTY decline aborts before writing, TTY accept exports with `guardedLayers` in the manifest, no-TTY-needed unguarded path, usage errors; slash gate — guarded refusal naming the CLI, probe-resolved guarded refusal, unguarded success with the ns report in the output. `tests/bin.spec.ts` adds the built-artifact export smoke (spawned = non-TTY: guarded refused exit 1, unguarded writes the bundle). Suite: 97/97.

## Cross-references

- [Mission proposal](../../../proposals/active/2026-08-19-mission-tasks.md) — §5 (leak gate) and §6 (bundle format, ns integrity) this implements.
- [mission M2 slash](2026-08-19-mission-m2-slash.md) — the face export extends; [mission M1](2026-08-19-mission-m1.md) — the store and service kernel.
