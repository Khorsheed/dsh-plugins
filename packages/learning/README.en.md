# @khorsheed/dsh-learning-suite

English | [中文](README.md)

Let the agent be your close-reading coach: work through a book or a course project by project, while the library remembers where you are, what you have not yet understood, and which questions you got wrong.

Learning with an agent used to fall apart once the chat ended: which chapter you reached, which concept did not sink in, which question you missed last time — all of it had to be explained again next time. Install the learning suite and switch a session to 「学习模式」 (learning mode), and the agent becomes a close-reading coach — it reads with you, not for you: it first asks about your goal and background, then picks textbooks and lays out a path; when no textbook is given, it chooses an existing book or course, or authors one itself when nothing fits, numbered in learning order. The right-sidebar 「图书馆」 (library) shows what to continue today, what is due for review, and each textbook's progress; photograph your highlights and annotations and they become cards, chapter quizzes are graded on the spot, and weak points come first next round. Articles and podcasts go into the reader (「灵感空间」), where the agent can quiz you, and once you finish reading you write it up in your own words as canvas cards. This suite is for people who want to read a book through or learn a course properly.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-learning-hero.png" width="640" alt="a learning-mode session: the conversation with the close-reading coach on the left, the right-sidebar library showing today's continue-learning, due reviews and textbook progress">

## Things you can say to the agent

- "I want to get started with linear algebra in three months — ask about my background first, then pick textbooks and lay out a path."
- "Here is a photo of page 3 in chapter two — turn what I highlighted into knowledge cards."
- "Give me a chapter quiz for chapter two."
- "Quiz me on the article I read in the reader yesterday."
- "Write this section's key points as a canvas card in my words, and pick holes in it."

## Features

- **A close-reading coach** — reads with you, explaining and asking as it goes, never reading the book for you; it first breaks the goal down into the capabilities it needs and asks about each, then drafts the path — skipping what you already have, slowing down where you are thin.
- **Textbooks from you, or picked by the coach** — your own book, an existing book or digital course the coach picks, or an outline the coach authors all count as textbooks; numbered in learning order, one path per textbook, and a path draft takes effect only when you click 「采用」 (adopt).
- **Books are registered, not uploaded** — only title, edition, ISBN and table of contents are recorded; a page photo captures the printed text and all your highlights and annotations, and confirmed marks become cards in one click.
- **The library sidebar** — the right-sidebar 「图书馆」 runs from today (continue learning, due reviews) down through projects, textbooks, this section, knowledge cards and chapter quizzes; one layout that adapts to its width, full screen on a phone.
- **Quizzes and review** — multiple-choice and fill-in questions are graded on the spot, open questions go to the coach; review means answering — fill the word in the original sentence, pick the meaning, spell, explain the concept — ending with a summary and 「再练错的」 (practice the misses).
- **The reader** — subscriptions and article reading, notes, discussion with your notes at hand, and 「让Agent考考我」 (let the agent quiz me); subtitle-less videos and podcasts are transcribed on this machine, and script-rendered pages still yield their body.
- **Learn by producing** — after reading, write it up in your own words as cards and drafts on the ideas canvas.
- **Only in learning-mode sessions** — the library, canvas and reading model tools are granted per session, and the canvas and reader right-sidebar tabs appear only in learning-mode and writing-mode sessions.

## Members

| Member | What it does |
| --- | --- |
| Library (`@khorsheed/dsh-library`) | project-organized close reading: book registration, roadmaps, knowledge cards and quiz grading, the right-sidebar learning panel |
| Ideas canvas (`@khorsheed/dsh-canvas`) | write up what you read in your own words as cards and drafts — learning by producing (joined 2026-10-19) |
| Reader (`@khorsheed/dsh-reader`) | subscriptions and article reading, notes, discussion with the notes at hand, 「让Agent考考我」 (joined 2026-10-19) |
| Local transcription (`@khorsheed/dsh-transcribe`) | transcribes subtitle-less videos and podcasts in the reader to text on this machine (joined 2026-10-20) |
| Rendered capture (`@khorsheed/dsh-capture`) | renders script-dependent pages in a background Chrome so the reader can extract the body (moved over from the basic bundle on 2026-10-20) |

## Install

Paste the package name `@khorsheed/dsh-learning-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and this package mounts the mode and the members. Then switch a session to 「学习模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-learning-suite
```

<!-- collection:start -->
Recommended: install it together with the basic suite (the Learning collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-learning-suite
```

Removing the bundle removes the members too, learning mode included; to keep the members and turn off just one, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — pure composition; the floor is the member's own (minHost `0.1.7-rc.1`, library's floor; the preset row mechanism is on the same line). Member behavior details are in their own Compatibility sections.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.

## Known Limitations

- **Book files are not parsed** — EPUB and PDF are neither uploaded nor parsed; a book's content comes from your photos and the sources the coach verifies.
- **Local transcription needs ffmpeg** — transcription needs `ffmpeg` on this machine, and the speech models download on first use.
- **Uninstall is family-wide** — removing this package removes the members too; to turn off just one, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode pack = a family bundle + one mode preset row.** The package registers no service, tool, slot, or command. The member rows in `cordis.patch.yml` come verbatim from the member packages' own `cordis.patch.yml`; the final row, `preset-dsh-learning` (an `@deepseek-ai/dsh-agent-preset` declaration, mode id `dsh-learning`), is this package's own canonical copy — it once mirrored `@khorsheed/dsh-presets`, which retired on 2026-10-24. The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from "the members' canonical rows + exactly one preset-<mode> row", every member must be a real self-mounting package, every member contributes at least one row, and the mode value is unique across the tree.

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-library` | `library`; `library-tool` (granted by this package's preset) |
| `@khorsheed/dsh-canvas` | `canvas`; `canvas-agent` (granted by this package's preset) |
| `@khorsheed/dsh-reader` | `reader`; `reader-tool` (granted by this package's preset) |
| `@khorsheed/dsh-transcribe` | `transcribe` |
| `@khorsheed/dsh-capture` | `capture` |

**Model tools granted per session.** Learning mode = the close-reading coach persona (reading with you, not for you) plus the library's model surface: `library_read`, one write tool per noun, and `library_assess` for grading; web tools handle sourcing and edition checks, long sessions get compaction, the skill surface is an allowlist, and the shell is guarded. The library's model surface (tools, coach guidance section, library skill) is not a profile-root row: it is the library package's `./tool` composition entry, granted per session at the `library-tool` grant point in this package's preset row. The canvas `./agent` and the reader `./tool` are likewise granted per session through `canvas-agent` and `reader-tool`, and both right-sidebar tabs self-hide on those rows — appearing only in learning-mode and writing-mode sessions.

**Installing me = installing the members + one mode, never a double mount.** The members are listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members' own patches are not applied, so no row is ever mounted twice. A member installed on its own still self-mounts; the bundle detail page's row-level switches resolve any overlap.

**`src/index.ts` exports constants only** (`MODE` / `FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/learning`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
