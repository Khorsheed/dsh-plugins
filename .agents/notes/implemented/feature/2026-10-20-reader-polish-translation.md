# Agent Note: the agent polishes the reader's translation

Status: implemented

## Problem

The browser's on-device translator works sentence by sentence with a small model: spoken transcripts and long sentences come out stilted, and a speaker's terms drift. The user asked for a gesture that hands the translation to the conversation's model, like 考考我. Prototype `proposals/prototypes/reader-polish-translation.html`; decided 2026-10-20: the whole article in batches, the polished text replaces the machine translation (switchable back, not remembered), no glossary for now, no "polish my selection".

## Decision

- **A request in the draft, not a hidden call.** 「✦ 让 Agent 润色译文」 in the globe menu (and in the title bar / ⋯ when the device has no translator) fills the conversation draft — title, id, paragraph count, the batch-and-write-back contract, a line for the reader's wishes — and the reader sends it. The conversation's model does the work; its cost shows in the conversation.
- **The model translates from the original only.** It reads with `reader_read` (¶-numbered, with time and speaker) and translates whole paragraphs; the machine translation is not sent (it would double the input and pull the model toward its mistakes). Consistency across batches comes from the same turn holding the earlier batches.
- **`reader_translate` writes back plain text** — lines `¶12：译文` (a line without ¶ continues the paragraph), an optional `文章：<id>` line; plain text because some models drop nested arguments. Its answer gives the progress and the next `from`, which drives the loop to the end.
- **The layer belongs to the text.** `polish/<hash>.json` per article holds ¶ → translation, the reader's per-paragraph opt-outs and a source key: the snapshot's paragraphs hashed without their `[mm:ss] 名字：` prefixes, so renaming a speaker keeps the layer and a re-transcription drops it.
- **Showing it.** Each polished block's own content is wrapped once (`span[data-reader-orig-run]`), and the 润色 and the original are appended; the article's `data-polish-view` decides what shows — the globe's view while a machine translation runs, side by side otherwise. 「✦ 润色」 on a paragraph puts that one back to the machine translation; 「看机翻」 hides the layer for this visit. The panel re-reads every 5 s while the agent writes (or for 20 minutes after the request), and offers 继续润色剩下的 N 段 when writes stop short.

## Alternatives considered

**The host calling a model directly.** No public seam for it, and it would hide the cost; the draft keeps the user in charge.

**Paragraphs replaced in the stored body.** Rejected: notes anchor on the original, and the snapshot the model reads must stay the original.

## Consequences

- A note taken on polished text anchors on Chinese text the original does not contain; notes are best taken on the original (both view).
- A paragraph count change (re-transcription) silently starts a fresh layer.
