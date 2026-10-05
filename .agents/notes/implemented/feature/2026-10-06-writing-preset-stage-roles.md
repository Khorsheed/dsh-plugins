# Agent Note: The writing preset's stage-and-role model (editor for structure, partner for company)

Status: implemented

## Problem

The writing preset's persona and the `novel` skill routed intents (chat / cards / planning / writing / reconciling) but said nothing about roles. At the ideation stage the model defaulted to an agreeable chat companion, so a user pouring out a pile of ideas got enthusiasm instead of structure. The concrete ask: as a professional editor, sort the whole thinking out — surface the main line, and set the less important threads aside. And the creator's state matters as much as the stage: the same person needs an editor when the thinking is tangled and a companion when blocked or doubting.

## Decision

- **The persona** (bundle-writing's `cordis.patch.yml`) names the dual role up front — "an editor when the thinking needs structure, a partner when it needs company" — and its Exploring-ideas stance now carries the editor's moves: hear the writer out, then sort what was heard into the one-sentence main line (who wants what, what stands in the way), the threads that serve it, and what to cut or shelve. A cut is always a proposal, argued by why the main line runs cleaner without it; the writer decides. A fifth stance line covers the blocked-or-doubting state: the smallest next step, never an audit.
- **The `novel` skill** gains a 「阶段与角色」 section between the iron rules and the intent routing. Per stage: ideation → the editor's three-bucket sort (keep on the main line / serving it / cut-or-shelve, with good-but-offline material carded and shelved rather than deleted); setting → editor-archivist who flags canon conflicts on the spot; planning → structural editor (ledger and cast on the table first); writing → partner executing the shared plan; reconciling/revision → editor again, structure before sentences. Per state, overriding the stage default: still pouring ideas out → listen and reflect back before structuring; blocked or self-doubting → one smallest next step (a scene, a dialogue, one character's reaction), not an audit; excitedly sharing → respond as a reader first, then ask whether to card it.
- **Discovery**: the pointer section routes ideation chats to the skill's stage-and-role model and drafting to `novel_read(brief)`, the unbound line counts 立意 as a bind-worthy subject, and the skill's catalog description opens with 立意梳理 so the manual is also loaded at the ideation stage. The intent routing's ideation bullet cross-references the three-bucket sort.

## Alternatives considered

- **A separate ideation tool or a second skill.** The stage needs judgment, not storage; another surface would split the manual the model loads, and the iron rules apply at ideation too (a shelved idea still lands as a card).
- **Putting the whole stage-and-role model in the persona.** The persona is always loaded and stays light by contract (the bundle spec pins it single-voice English and free of the skill's workflow sections); the skill is the on-demand manual where the workflow already lives, so the persona carries only the stance and the skill the detail.
- **Touching the brief templates.** The brief copy deck is user-reviewed and serves plan/write/extract; ideation needs no material pack, so `brief.ts` is untouched.

## Consequences

- At the ideation stage the model leads with structure (main line + keep/serve/cut-or-shelve) instead of agreeable elaboration; cuts are proposals, so the user keeps the final say.
- Blocked or doubting users get a companion and a smallest next step rather than an audit — the role follows the state, not just the stage.
- `bundle.spec` pins the persona's role line and main-line sort; `agent.spec` pins the skill's new section. Both packages' READMEs describe the dual role.
