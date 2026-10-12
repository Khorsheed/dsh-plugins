# bundle-learning (the learning-mode preset)

In one line: **install it, and the library's agent face (the library_read / library_write / library_assess tools, the coach prompt section, the per-turn bound context) exists only in sessions on the 学习模式 preset** — every other session's tool list and system prompt carry no trace of the library tools.

This package is a **declarative preset bundle** (`dsh.bundle.kind: preset-declarations`, the AGENTS.md convention): the patch holds a single `@deepseek-ai/dsh-agent-preset` row (loader id `preset-learning`) and no runtime code of its own.

## What it does

The learning preset is a named scope. A session switched to it composes:

- **The persona**: a close-reading coach — reads WITH the learner (explain as you go, Socratic follow-ups); replies in the learner's language; the library tools are the memory; never invents what a book says — the book and the learner's photos win over memory; the learner's weak points come first; grading is two steps (judge in the conversation, then `library_assess`).
- **The library's agent face**: `@khorsheed/dsh-library/tool` mounts in the scope (config `tools: all`) and quiets root prompt sections that do not apply to learning (the host source path, the Web GUI address, deliverable-link conventions) and the `list_capabilities` tool in that scope.
- **The learning tool list** (a strict diet of the official standard preset): tool-ask-user (which project, which book, which edition), tool-web (verifying editions and contents, quoting a web copy), the compaction group (long sessions fold context), and tool-skill as a whitelisted skill face — without skill-filesystem no local skill enters the registry, so only skills explicitly scoped to this mode (via the capability catalog) are visible. No fs (books are registered, so there are no book files — a scoped skill's bundle files stay unreadable too, only its SKILL.md reaches the model), no todo (the roadmap is the study plan), and no shell, goal, plan-mode or delegation.

## Install and enable

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
dsh plugin --profile <name> add @khorsheed/dsh-bundle-learning
```

- **library alone**: the Library tab and the data face; no session holds the library tools.
- **plus bundle-learning**: the 学习模式 preset appears; switch a session to it and the three tools, the coach section and the bound context exist.

Absent-core behaviour: bundle-learning without library leaves the preset row's grant pending (the registry shows `waiting for library`); installing library activates it. Hosts before 0.1.7-rc.1 have no `@deepseek-ai/dsh-agent-preset` row type and the bundle cannot mount there (see package.json `dsh.compat`).

## Compatibility

| Host line | Verdict |
|---|---|
| npm release line (0.2.0-rc.x) | Full support (`minHost: 0.1.7-rc.1` — the preset row type's floor) |
| deepseek-harness master (the 0.2.0-rc.2 dev line) | Verified (`verifiedHost: 0.2.0-rc.2`) |
