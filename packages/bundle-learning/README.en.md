# bundle-learning (the learning-mode preset)

In one line: **install it, and the library's agent face (the library_read / library_write / library_assess tools, the close-reading coach prompt section, the library skill) exists only in sessions on the 学习模式 preset** — every other session's tool list and system prompt carry no trace of the library tools.

This package is a **declarative preset bundle** (`dsh.bundle.kind: preset-declarations`, the AGENTS.md convention): the patch holds a single `@deepseek-ai/dsh-agent-preset` row (loader id `preset-learning`) and no runtime code of its own.

## What it does

The learning preset is a named scope. A session switched to it composes:

- **The persona**: a close-reading coach — reads WITH the learner (explain as you go, Socratic follow-ups); the library tools are the memory (terms logged as they come, photo notes transcribed into the vocab book with the photo as provenance); grading is two steps (judge in the conversation, then `library_assess`); due cards come first.
- **The library's agent face**: `@khorsheed/dsh-library/tool` mounts in the scope (config `tools: all`).
- **The learning tool list** (a dieted copy of the official standard preset, the writing-mode precedent): tool-fs (book source files), skill-filesystem + tool-skill (the library skill loads through them), tool-ask-user (confirmations and choices), tool-todo (study tasks), tool-web (looking things up), the compaction group (long sessions fold context). No shell, no goal, no plan-mode, no delegation — a learning session never needs them.

## Install and enable

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
dsh plugin --profile <name> add @khorsheed/dsh-bundle-learning
```

- **library alone**: the Library tab and the data face; no session holds the library tools.
- **plus bundle-learning**: the 学习模式 preset appears; switch a session to it and the three tools, the coach section and the skill exist.

Absent-core behaviour: bundle-learning without library leaves the preset row's grant pending (the registry shows `waiting for library`); installing library activates it. Hosts before 0.1.7-rc.1 have no `@deepseek-ai/dsh-agent-preset` row type and the bundle cannot mount there (see package.json `dsh.compat`).

## Compatibility

| Host line | Verdict |
|---|---|
| npm release line (0.2.0-rc.x) | Full support (`minHost: 0.1.7-rc.1` — the preset row type's floor) |
| deepseek-harness master (the 0.2.0-rc.2 dev line) | Verified (`verifiedHost: 0.2.0-rc.2`) |
