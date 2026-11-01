# Agent Note: The novel deletes anything, finds what a change touches through its graph, and aligns from a list

Status: implemented

## Problem

The person wants both themselves and the agent to change or delete anything at any time, without the model rereading the whole book after each change.

The situation before this change:

- Settings, people, relations and foreshadows could only be deleted from the canvas card page. A deletion left every reference to the deleted card dangling: an event's place, a person's faction, a child setting's parent, an idea's binding. Nothing reported it.
- After a setting or a passage of text changed, nothing said which chapters or passages it touched. The only remedy was for the agent to reread the book.

## Decision

### The book is a graph (`graph.ts`)

Chapters, settings, characters, relations, foreshadows, events and ideas are nodes. The references the data already holds are the edges:

| Edge | Meaning |
|---|---|
| `told-in` | the chapter that tells an event |
| `at` | the setting where an event happens |
| `with` | a character an event involves |
| `cause` | the event that leads to this one |
| `reveals` | a derived reveal event pointing at its foreshadow |
| `parent` | the setting a setting sits under |
| `base` | a faction's base |
| `faction` / `home` | a character's faction and usual place |
| `pair` | the two characters of a relation |
| `uses` | settings a chapter uses: its plan's `uses`, or the settings its reconcile found |
| `advances` | events a plan advances |
| `cast` | a plan's cast and POV |
| `moves` | chapters where a foreshadow advanced |
| `bound` | the event an idea is bound to |

The graph is computed from the data on every read, never stored. It carries a reverse index, so a lookup goes straight from any node to whatever points at it.

### Deleting (`deletePreview` / `deleteNode`, and `novel_write(what=delete)`)

A deletion first follows the edges pointing at the node, one step out, and lists the impact. The rules then fix what they can at once, without the model:

- child settings move under the deleted setting's parents;
- the node is removed from people's faction / home and from factions' bases;
- the node is removed from events' places, people and causes;
- deleting a person also deletes their relation cards;
- deleting an event unbinds its ideas, and deleting a foreshadow unbinds the ideas bound to its reveal.

Written text is never changed. The confirm and the tool's answer name the written chapters that still carry the node.

On the page, the details on 世界观, 人物, 关系, 伏笔 and 时间轴 carry 删除…, which opens an in-place confirm listing the impact. Chapters cannot be deleted this way. Card deletion needs the canvas service's `deleteCard`; without it the call answers `unsupported`.

### 待对齐 (`align.ts`, `align.json`)

**Baseline.** An alignment fingerprints every node and records its kind, its name and the written chapters that carried it then; the text of each written chapter is kept as well. The first read of a book's list takes the book as it stands as the baseline.

**A change.** A change is a node whose fingerprint differs from the baseline, or that no longer exists. Changes therefore show up wherever they came from: the 设定 page, the canvas card page, a hand-edited file or a tool. A node edited many times counts once, and a node edited back to its baseline drops out. A new node is not a change, because no written chapter points at it yet.

**Impact.** Each change follows the graph one step to the written chapters it touches. From those chapters only the paragraphs that name the node are taken; for a change in a chapter's text, only the paragraphs that changed. The agent receives just this list and these passages (`novel_read(what=changes)`) and ticks items off with `novel_write(what=aligned, id)`.

**Changes needing no model.** Changes that no written chapter carries are listed under 已自动处理.

**What stays off the list.** The agent's own writes happen in the visible turn, so the following bring the baseline up to date at once:

- card writes (the genre agent's `writeCard`), event writes and tool deletes;
- a reconcile, which marks the chapter and everything it moved as aligned;
- the fixes the rules make when the person deletes something. The deleted node itself still goes to the list or to 已自动处理, by the same rules.

**The page.**

- On 章节, 接下来 leads with 「待对齐 N 处 · 查看」 when the list is not empty.
- 设定 and 时间轴 show a 「待对齐 N」 badge.
- The 待对齐 page (`novel:align`):
  - its top line says what the agent would read (which chapters, how many passages, about how many characters) and offers 让 Agent 对齐 N 处, which sends one message;
  - each item draws a one-step graph with the passages to read, and has its own 忽略;
  - 已自动处理 is folded at the bottom.

### 对账 no longer writes 人物经历

The reconcile schema drops `experiences`. In the write brief, a person's recent past now comes from events in written chapters that involve them. Chapters that no event covers yet keep their old experience entries.

## Alternatives considered

- **Log every operation and hand the model the sequence.** Rejected. Repeated edits to one node pile up as separate entries, an edit made and then undone stays in the log, and direct file edits and canvas card-page edits are never logged.
- **Refresh everything after a change.** Rejected: the token cost grows with the length of the book.
- **Store the graph as an index file.** Rejected: it would drift from the data. Computing the graph costs one pass over the record files; written text is read only when the 待对齐 list is read.
- **Edit the text as part of a delete.** Rejected: the text belongs to the person, and whether to change it is decided in the conversation.

## Consequences

- **Gained.** The person and the agent can change or delete freely. Mechanical consequences are fixed at once, and model judgement is spent only on the affected passages, so the cost follows the number of passages touched rather than the length of the book.
- **Cost.** Reading the list rereads the written text to compare it with the baseline, which slows down on long books. The baseline holds a copy of the text, so `align.json` grows with the book.
- **Misses.** A setting's passages are found by its name, so a passage that uses a nickname or a pronoun is missed. Text changes are compared paragraph by paragraph, so moving a paragraph counts as changing it.
- **Not handled.** Deleting a card on the canvas card page does not run the rule fixes; readers ignore the dangling references, and the deleted node still enters the list. Deleting a chapter is not implemented.
