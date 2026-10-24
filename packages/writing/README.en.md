# @khorsheed/dsh-writing-suite

English | [中文](README.md)

Write with the agent: ideas, settings and drafts all live on a canvas, a novel keeps a memory of its characters, foreshadowing and chapters, and the good articles you read become notes you can discuss.

Writing a novel with a model used to mean character settings, foreshadowing and chapter plans scattered across several documents, with the background pasted in again at every new conversation; good articles could only be copy-pasted into the chat. Install the writing suite and switch a session to 「写作模式」 (writing mode), and the agent writes with you as a writer: ideas, questions, agreements, sources and drafts are cards on the right-sidebar canvas, and the model's proposals land as ghost cards that stay only when you click ✓; set a canvas to the 「长篇小说」 (novel) genre and its character, world, principle and foreshadowing cards become the canonical setting, with chapters filed only after review; articles you subscribe to or save are read in the reader (「灵感空间」), where you highlight to take notes and discuss with the notes at hand — and notes can sync to the canvas as cards. This suite is for people who write fiction, articles and copy.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-writing-hero.png" width="640" alt="a writing-mode session: the conversation on the left, idea, character and foreshadowing cards on the right-sidebar canvas, one of them a ghost card proposed by the model">

## Things you can say to the agent

- "Create a canvas called *Fog Harbor* and write each of the three characters we just discussed as a character card."
- "Write chapter three from the chapter plan, and hand it to me for review before filing it."
- "Make this paragraph more conversational — leave the facts and opinions alone."
- "Read the article I just opened, discuss its argument against my notes, and record the conclusion in the notes."
- "When would be a good time to reveal this foreshadowing?"

## Features

- **A writer's identity and style rules** — the writing-mode agent first works out whether you want writing, analysis or editing (editing changes only the expression, leaving facts, opinions and intensity alone); it follows the punctuation and style rules of Chinese or English, with no jargon or vague filler and no aphorism-style parallelism.
- **The ideas canvas** — in the right-sidebar 「画布」 (canvas), each canvas is one topic, accumulating five card kinds: ideas, questions, agreements, sources and documents; the agent can create or switch canvases, edit cards and write drafts onto the board, and its proposals land as ghost cards whose fate you decide with ✓ / ✗.
- **The novel genre** — a work is a canvas whose genre is 「长篇小说」: character, world, principle and foreshadowing cards are the single canonical setting, each pair of characters has a relationship card advanced by scores, and a chapter is filed only after review; the canvas gains a review strip, a story log and a chapter reading page.
- **The reader** — subscribe to RSS or paste a link to save an article, read the body right in dsh and translate it with the browser's on-device translation; highlight a sentence to take a note, discuss with the agent with your notes at hand, write the conclusions back into the notes, and sync notes to the canvas as idea cards.
- **Videos and podcasts are readable too** — videos and podcasts without subtitles are transcribed to text on this machine, then read in the reader.
- **Script-rendered pages captured whole** — pages that depend on scripts to render are rendered in a background Chrome before the body is extracted.
- **Only in writing-mode sessions** — the canvas, novel and reading model tools are granted per session; no other session sees any of them.

## Members

| Member | What it does |
| --- | --- |
| Ideas canvas (`@khorsheed/dsh-canvas`) | a topic canvas of cards, links and model proposals |
| Novel (`@khorsheed/dsh-canvas-novel`) | the 「长篇小说」 genre: a work memory of characters / foreshadowing / chapters, a reconciliation gate, the canvas review strip and chapter pages |
| Reader (`@khorsheed/dsh-reader`) | subscriptions and article reading, notes, discussion with the notes at hand; notes can sync to canvas cards (joined 2026-10-19) |
| Local transcription (`@khorsheed/dsh-transcribe`) | transcribes subtitle-less videos and podcasts in the reader to text on this machine (joined 2026-10-20) |
| Rendered capture (`@khorsheed/dsh-capture`) | renders script-dependent pages in a background Chrome so the reader can extract the body (moved over from the basic bundle on 2026-10-20) |

## Install

Paste the package name `@khorsheed/dsh-writing-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and this package mounts the mode and the members. Then switch a session to 「写作模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-writing-suite
```

<!-- collection:start -->
Recommended: install it together with the basic suite (the Writing collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-writing-suite
```

Removing the bundle removes the whole family, writing mode included; to keep the family and turn off a single member, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.2`): ✅ full — pure composition; the floor is the members' highest (minHost `0.2.0-rc.2`, canvas-novel's floor; canvas itself from `0.1.5-rc.1`). Per-member behavior differences are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.2.0-rc.2` and up.

## Known Limitations

- **Local transcription needs ffmpeg** — transcription needs `ffmpeg` on this machine, and the speech models download on first use.
- **On-device translation depends on the browser** — the reader's translation uses the browser's built-in translation capability, so it needs a desktop browser that supports it.
- **Uninstall is family-wide** — removing this package removes every member together; there is no "drop one member from the bundle" operation. To disable a single member, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode pack = a family bundle + one mode preset row.** The package registers no service, tool, slot, or command. The member rows in `cordis.patch.yml` come verbatim from each member package's own `cordis.patch.yml` (the members' `./agent` / `./tool` companion composition rows stay out of the patch and live only in the preset composition); the final row, `preset-dsh-writing` (an `@deepseek-ai/dsh-agent-preset` declaration, mode id `dsh-writing`), is this package's own canonical copy — it once mirrored `@khorsheed/dsh-presets`, which retired on 2026-10-24. The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from "the members' canonical rows − the companion composition rows + exactly one preset-<mode> row", every subtracted companion row must be granted by name in this package's preset composition, every member must be a real self-mounting package, every member contributes at least one row, and the mode value is unique across the tree.

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-canvas` | `canvas`; `canvas-agent` (granted by this package's preset) |
| `@khorsheed/dsh-canvas-novel` | `canvas-novel`; `canvas-novel-agent` (granted by this package's preset) |
| `@khorsheed/dsh-reader` | `reader`; `reader-tool` (granted by this package's preset) |
| `@khorsheed/dsh-transcribe` | `transcribe` |
| `@khorsheed/dsh-capture` | `capture` |

**Model tools granted per session.** Writing mode = the writer identity and style constraints (task mode, bilingual style rules, voice rules), file read/write and web search, Skills, plus the rows the preset composition names: `canvas-agent` (the canvas tools such as `canvas_read` / `canvas_write` / `canvas_propose_type`), `canvas-novel-agent` (the `novel_*` chapter / ledger / review tools that appear when a session is bound to a novel canvas) and `reader-tool`. The canvas tool row (canvas `./agent`) is open to **every** session by default in the member's own patch; the mode pack neither mounts these companion rows at the profile root nor overrides them disabled any more — the grant lives only in the preset composition, and on host 0.2.x writing-mode sessions see the scoped copy shadow the global row, so there is no double registration crashing boot (pinned by the host's scoped.spec.ts).

**Installing me = installing a family + one mode, never a double mount.** Every member is listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members' own patches are not applied, so no row is ever mounted twice. A member installed on its own still self-mounts; the bundle detail page's row-level switches resolve any overlap.

**`src/index.ts` exports constants only** (`MODE` / `FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/writing`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
