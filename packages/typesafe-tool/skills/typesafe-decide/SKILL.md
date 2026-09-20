---
name: typesafe-decide
description: Make a fast, typed judgement through the typesafe_judge tool — a calibrated yes/no probability, one option from a defined set, or a level on an ordered scale — instead of guessing or writing a prompt-and-parse step. Load when a decision is semantic (does this need a reply, which team owns this, how urgent is this, is this claim supported) and when several such judgements can be asked together. Covers question design, reading probabilities and confidence, and the discipline that keeps TypeSafe a tool call rather than a new CLI.
metadata:
  credentials:
    - key: TYPESAFE_API_KEY
      label: TypeSafe API key (console.typesafe.ai/keys)
---

# typesafe-decide — fast typed judgements through `typesafe_judge`

## What this covers

`typesafe_judge` asks TypeSafe's System One model (Jev) one or more narrow questions about a piece of state and
returns typed answers your next step can consume directly. It is for **semantic** decisions: ones where ordinary
code cannot decide and you would otherwise guess, over-explain, or write a fragile prompt-and-parse step.

This skill covers **how to ask** and **how to read the answer**. The API contract, models, patterns and cookbooks
live in the official docs — read them when you are building an application with TypeSafe, and never guess request
or response fields from memory.

## Use it when

- The next step depends on a judgement about language: routing, ranking, extracting the intended value, checking
  whether a claim is supported, deciding whether something needs attention or a reply.
- You would otherwise answer a yes/no question with a paragraph of reasoning and then parse it.
- Several independent judgements are needed about the same state — ask them together.

Do **not** use it for exact lookups, arithmetic, date math, schema validation, or anything a deterministic rule
already decides. It supplies common sense; code owns the workflow.

## Design the questions

- **One narrow judgement per entry.** Do not ask "is this urgent and about billing and angry". Three questions
  answer three things, and you can ignore the ones you do not need.
- **Put the whole meaning in `instructions`.** Question ids are for your code, not for the model.
- **Define the answers before asking.** `choice` needs `choices` (option name → one-line description); `score`
  needs `levels` (ordered descriptions, first to last). Write descriptions that separate neighbouring options:
  say what an option covers and what belongs to another one instead.
- **`""` is a valid description** when the option name already says everything (`{"calm": "", "angry": ""}`).
- **Add a `none`/`other` option** when the list may not cover every input, and add a separate presence question
  when "is it there at all" matters on its own.
- **Ask independent questions in ONE call**, including speculative ones — they run in parallel, batching is
  markedly cheaper and faster than separate calls. State each speculative premise explicitly and consume only the
  answers that apply.
- **Prefer candidates over open generation.** If you need a value from a document, list the candidates and let a
  judgement select among them rather than asking the model to invent it.

## Read the answers

- `noul` is a **probability of yes** (0–1). It has no separate confidence. Compare it to an explicit threshold;
  a value near 0.5 means "about as likely yes as no", not "medium intensity".
- `choice` returns the winning option plus the full distribution and a `confidence`. `score` returns the level
  index, its `legend`, the distribution and a `confidence`.
- **Confidence measures how concentrated the distribution is**, not whether your workflow is right, and not
  permission to act. Several acceptable alternatives can lower confidence harmlessly.
- **Keep thresholds in code, near the question definition**, and review them as a pair. Tune them on your own
  data; treat published example cutoffs as examples.
- Ignore uncertainty on branches you do not consume.

## Discipline

- **Never build a CLI, shell wrapper, or helper process for TypeSafe.** The tool is the path. In code, the
  equivalent is the host service (`ctx.typesafe`) — not a spawned binary.
- **Never print the API key** and never write it into a file, message, or command line. It is configured once
  under 「设置 → 工具与技能 → typesafe-decide → 凭据配置」 and resolved by the host at call time. If a call fails
  with an unconfigured/unavailable reason, tell the human which credential is missing instead of trying to
  obtain or fake it.
- If a judgement is not essential and the call fails, continue without it and say which decision you skipped.
- These are calibrated model judgements, not ground truth: validate them in the domain you rely on.
