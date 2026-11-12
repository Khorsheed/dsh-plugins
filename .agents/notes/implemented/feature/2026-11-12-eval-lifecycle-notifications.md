# Agent Note: eval lifecycle notifications return to the conversation without waking an Agent

Status: implemented

English | [中文](2026-11-12-eval-lifecycle-notifications.zh.md)

## Problem

A person approves an experiment in one session and later has to discover its run, judging and human-review outcomes somewhere else. The existing lab groups and tab count help, but they do not tell that originating conversation which experiment changed or where to open it. A notification must not start a model turn or invent a second run, and several experiments in one session must not be collapsed into one current-experiment slot.

## Decision

Use one versioned `plugin:eval/lifecycle` record per run/stage or human-final ticket. `EvalRunJobs` reports completed runs and actually configured, fully judged stages after the real run report exists; `EvalService.humanFinal` reports successful, non-duplicate verdict writes. Cancelled, failed, unjudged and duplicate work does not emit a false completion notice. Records carry the experiment/run identity, title, stage and dedupe key, so retries cannot overwrite another experiment and repeated completion cannot duplicate a notice.

The notifier resolves an already mounted Session through `sessions` or `agents`, never creates or wakes an Agent, and appends with `appendPluginRecord`. It validates reads with `pluginRecordOf` and keeps the existing lab list, attention groups and `eval_run_status` intact. A failed notification is a diagnostic, never a failed experiment. The new notification surface moves eval and the evaluation suite to host 0.2.2-rc.2; older hosts stay on the previous release line and unknown records remain skippable.

The browser uses a small structural parser so the client bundle does not import the host Session runtime. Its Conversation Definition renders one `eval-lifecycle-notice` per identity at `groupTree: 'turn'`, outside the collapsed process group. The button submits the existing lab-focus request for that experiment. It does not switch tabs, submit text or start an Agent turn; the person opens Experiments when ready.

## Alternatives considered

**Notify by appending assistant text.** Rejected: plugin records never enter the model surface, do not impersonate a model and do not need a turn. Restored-assistant projection is a separate, still unsupported seam.

**Wake the originating Agent with a result message.** Rejected: it can start new model work and duplicate the experiment's purpose. These are facts for the person and the session history, not prompts.

**Show only a badge or a single current-experiment slot.** Rejected: independent experiments and stages need independent durable identities. The existing badge, list and status query remain as secondary surfaces.

**Put the notice in the normal collapsed process group.** Rejected after real browser acceptance: the content existed but was hidden. The public `groupTree: 'turn'` position makes the notice visible without DOM overrides.

**Navigate immediately when a notice arrives or when it is clicked.** Rejected: notification is not permission to change the person's context. The existing lab-focus request only marks the experiment; tab selection remains a human action.

## Consequences

Notifications now survive a real JSONL restart and remain independent across experiments and human-final tickets. The host owns completion truth; the browser owns presentation and navigation. The new minimum host is intentional rather than a mechanical floor move, and no production deployment or npm publication is implied by the source change.

The run and judge stages can be emitted close together when the run already includes judging. A run with no configured judge gets no fabricated judge-complete notice. A real composition currently renders persisted records and lab-focus navigation; the audit does not claim a generic Remote forwarding channel for every future plugin record.

## Testing

Passed on rc.2: 94 eval test files / 1491 tests, including four notifier tests covering dedupe, no-judge/cancel, malformed records and real JSONL restart, and three client tests covering projection, exact experiment navigation and malformed/non-ignorable records. The package and browser bundles build successfully.

A real rc.2 Chromium composition with the evaluation suite displayed `Judging completed: Alpha comparison` and its `Open experiment` button. After the human selected Experiments, `New experiment` and `Alpha comparison` were visible. Page and console error counts were zero. No Agent was created or woken by notification emission.

## Related

- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Official-capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [Upstream seam registry](../../../../docs/upstream-seam-registry.md)
