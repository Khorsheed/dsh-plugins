# bundle-writing (the writing-mode preset)

One line: **installing it makes story-bible's agent surface (story_read/write/extract, the story:pointer prompt section, the story skill) exist ONLY inside sessions running the writing preset** — ordinary sessions see no story tool in their list and no story trace in their prompt.

This package is a **declarative preset bundle** (`dsh.bundle.kind: preset-declarations`, the AGENTS.md convention): its patch carries a single `@deepseek-ai/dsh-agent-preset` row (loader id `preset-writing`) and no runtime code of its own.

## What it does

The writing preset is a named scope. Sessions switched to it compose with:

- **persona**: a collaborative editor for long-form fiction (probe ideas, put the ledger and the cast on the table when planning, hold canon and character consistency when writing, report reconcile hits and misses honestly; the work's assets are what the story_* tools return, never conversation memory).
- **story-bible's agent surface**: mounts `@khorsheed/dsh-story-bible/agent` inside the scope — the same entry story-bible's shipped patch keeps DISABLED at the profile root. The two must never be live at once (the tools would register twice and fail the boot).
- **The writing tool list**: tool-fs (manuscript read/write/edit), skill-filesystem + tool-skill (how the story skill loads), tool-ask-user (the confirmation gates), and the compaction group (long sessions fold context). No shell, no search, no delegation, no jobs — the writing flow needs none of them.

## Install and enable

```sh
dsh plugin --profile <name> add @khorsheed/dsh-story-bible
dsh plugin --profile <name> add @khorsheed/dsh-bundle-writing
```

- **story-bible alone**: the store, the `story` Remote data face and the two right-Sidebar tabs — global UI and data, zero agent tools in any session.
- **plus bundle-writing**: the 写作 preset appears; switching a session to it is what brings the three tools, the pointer and the skill into existence.

Absence behavior: installing bundle-writing WITHOUT story-bible leaves the grant inert (the tools simply never exist; nothing throws) — they appear once story-bible is installed. Hosts before 0.1.7-rc.1 have no `@deepseek-ai/dsh-agent-preset` row type and cannot mount this bundle at all (see package.json `dsh.compat`).

## Compatibility

| Host line | Verdict |
|---|---|
| npm releases from 0.1.7-rc.1 on (incl. 0.2.0-rc.2) | ✅ (verifiedHost `0.2.0-rc.2`): the preset row type and every official tool row are present |
| 0.1.5 and earlier | ❌ no `@deepseek-ai/dsh-agent-preset` row type — cannot mount |

中文: [README.md](README.md)
