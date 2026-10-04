# bundle-writing (the writing-mode preset)

One line: **installing it makes canvas-novel's agent surface (novel_read/write/extract, the novel:pointer prompt section, the novel skill) exist ONLY inside sessions running the writing preset** — ordinary sessions see no novel tool in their list and no novel trace in their prompt.

This package is a **declarative preset bundle** (`dsh.bundle.kind: preset-declarations`, the AGENTS.md convention): its patch carries a single `@deepseek-ai/dsh-agent-preset` row (loader id `preset-writing`) and no runtime code of its own.

## What it does

The writing preset is a named scope. Sessions switched to it compose with:

- **persona**: a collaborative editor for long-form fiction (probe ideas, put the ledger and the cast on the table when planning, hold canon and character consistency when writing, report reconcile hits and misses honestly; the work's assets are what the novel_* tools return, never conversation memory).
- **canvas-novel's agent surface**: mounts `@khorsheed/dsh-canvas-novel/agent` inside the scope — the same entry canvas-novel's shipped patch keeps DISABLED at the profile root. The two must never be live at once (the tools would register twice and fail the boot).
- **The writing tool list**: tool-fs (manuscript read/write/edit), skill-filesystem + tool-skill (how the novel skill loads), tool-ask-user (the confirmation gates), and the compaction group (long sessions fold context). No shell, no search, no delegation, no jobs — the writing flow needs none of them.

## Install and enable

```sh
dsh plugin --profile <name> add @khorsheed/dsh-canvas-novel
dsh plugin --profile <name> add @khorsheed/dsh-bundle-writing
```

- **canvas-novel alone**: the novel engine's store, and the canvas gains the 长篇小说 genre — zero agent tools in any session.
- **plus bundle-writing**: the 写作 preset appears; switching a session to it is what brings the three tools, the pointer and the skill into existence.

Absence behavior: installing bundle-writing WITHOUT canvas-novel leaves the grant inert (the tools simply never exist; nothing throws) — they appear once canvas-novel is installed. Hosts before 0.1.7-rc.1 have no `@deepseek-ai/dsh-agent-preset` row type and cannot mount this bundle at all (see package.json `dsh.compat`).

## Compatibility

| Host line | Verdict |
|---|---|
| npm releases from 0.1.7-rc.1 on (incl. 0.2.0-rc.2) | ✅ (verifiedHost `0.2.0-rc.2`): the preset row type and every official tool row are present |
| 0.1.5 and earlier | ❌ no `@deepseek-ai/dsh-agent-preset` row type — cannot mount |

中文: [README.md](README.md)
