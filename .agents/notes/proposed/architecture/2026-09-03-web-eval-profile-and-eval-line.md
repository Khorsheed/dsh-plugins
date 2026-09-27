# Agent Note: web-eval profile and the eval line

Status: proposed

[English](2026-09-03-web-eval-profile-and-eval-line.md) | [中文](2026-09-03-web-eval-profile-and-eval-line.zh.md)

## Problem

The roadmap lists a `dsh-eval` domain pack (base + local-agent family + mission + datasets + lab) as ⬜ and defers it to P2, but the three mechanism plugins have shipped M1–M4 without a single real evaluation run: the task-set repository's `runs/` and `exports/` are empty, the operating playbook's orchestrator role is marked ❌ throughout, and the design conversation keeps re-opening decisions (rep versus attempt, drive mode, sandbox, prompt provenance) because no document fixes the target architecture. Work on the eval line is scattered across three fronts at once — plugin generality, task-set content, and fairness baseline — with no ordering and no done criteria.

Two review passes (2026-09-02/03) found that the generic mechanisms are sound but the evaluation itself has no first-class subject (a "player" is a free label string), no verdict output contract, no model pinning or read-back in the local-agent providers, mixed exec/live driving across harnesses, an uncontrolled reasoning-effort asymmetry (kimi provisioning hardcodes `effort = high`), and a parent-agent-authored prompt that makes the task text an unmeasured factor.

## Proposal

Stand up `profiles/web-eval/` now, in the same shape as `dev` (package.json member list, `[]` patch layer, install/update/restart scripts by name-swap only), and make its README the single document that fixes the **target** before any more code:

- a six-layer architecture (conversation / contract / orchestration / mechanism / execution / storage) with the rule that the orchestrator is the only executor, the agent only plans and drafts, and the human approves, writes final verdicts, and exports;
- three contract schemas to be finalized in I1 — `condition.json` (the hashable subject: scoped home content + env keys + argv template + packs), `plan.json` (snapshot × conditions × reps × stages × order × budget × judge), `verdict.json` (the probe/judge output contract) — placed in the dataset authoring protocol next to `dataseek.verify/1`;
- a member list of 22 plugins plus one package to build, `@khorsheed/dsh-eval` (host plugin + CLI + `eval-planning` skill), grown from `scripts/integration-triad.mts`;
- twelve frozen fairness decisions (rep = mission, all exec, container-boundary sandboxing, pinned reasoning effort, model pin + read-back, byte-exact prompt, orchestrator-owned timeouts, active-time budgets, judge ≠ contestant, cost not tokens across harnesses, randomized interleave, single destroy path);
- an iteration plan I0–I6 with observable done criteria, ordered contracts → one cell by hand → orchestrator v0 + pilot on stages 1–2 → containers + stages 3–4 → factor widening → agent-configured experiments + surfaces → external task sets + release.

The roadmap's domain table now points at the profile README; the pack name is `dsh-web-eval`, consistent with `dsh-dev`. No plugin code changes in I0.

## Alternatives considered

**Keep the plan in a `proposals/` file instead of a profile README.** The `package-management` proposal already owns the pack's distribution form (form B); what was missing is the pack's own target architecture and iteration order, which every profile carries in its README. A second proposal would duplicate the distribution story and still leave the profile directory absent.

**Start with the orchestrator code and let the architecture emerge.** This is how the last three weeks went: verbs without a driver. The playbook's ❌ list shows the driver is the product; writing it without a fixed contract shape would rebuild it once conditions widen beyond harness.

**Widen factors first (harness × model, preset, skill) since that is the stated goal.** Rejected in favor of fixing the condition hash's shape in I1 and only teaching providers more fields in I4; producing one four-harness conclusion first surfaces the judge, rubric, and de-fingerprinting problems that any multi-factor run would inherit.

**Ship the evaluation pins as the profile's patch layer now.** The loader patch syntax for each provider's config was not verified against a live instance in this pass; I1 decides pack-owned patch versus user layer once the pins are exercised.

## Acceptance criteria

- `profiles/web-eval/` exists with README (zh + en, sidecar recorded), package.json listing the 22 members, `[]` patch layer, LICENSE, workspace file, CHANGELOG, and the three scripts; the restart script differs from dev's only by name.
- `docs/roadmap.md`'s domain table names `dsh-web-eval` and links the profile README.
- The README states the target architecture, member changes per plugin, the three schema intents, the tool-exposure-by-domain table, the target flow, the final UI surfaces, the twelve frozen decisions, and I0–I6 with done criteria.
- `profiles/web-eval/docs/architecture.md` carries the capability map (plugin × face × eval-domain user), the 24-step trace from natural language to execution with the capability and the generated file per step, the file-location table, and the four invariants a report must verify; `docs/iterations.md` carries the plugin × layer landing matrix (each item marked satisfied / needs change / to build, with its iteration), the per-iteration task tables T1–T36 with dependencies, the four I1 briefs verbatim, and the acceptance procedure.
- Repo gates pass: hygiene (no absolute local paths), agent-note format and classification, translation pairing.

## Risks

- **The plan can rot like the previous ones.** Mitigation: every iteration has a done criterion that is an observable state, and the README says the next iteration does not start until it is reached.
- **Unverified install path.** Three members are unpublished rc lines; the profile installs only from source tarballs until the second npm wave. The README says so.
- **The frozen decisions are opinions until I1 exercises them.** Some (composite fingerprint, model read-back) require provider changes that may reveal CLI limitations; those are recorded as I1/I3 findings, not as reasons to relax the decision silently.
- **Naming.** `dsh-eval` is used both for the roadmap's pack and for the orchestrator package; the README disambiguates (pack = `dsh-web-eval`, orchestrator = `@khorsheed/dsh-eval`) but readers of older documents may still conflate them.
