# Agent Note: presets branch syncs main — restoring 游戏开发模式, landing 剪辑模式 on 3080

Status: implemented

## Problem

The user reported "剪辑模式 is missing on 3080". The investigation peeled two layers apart:

1. **A prod regression from a stale branch (what this note fixes)**: the feat/video-studio branch forked from main before 76ea67d7 (the game-development preset, 2026-10-09) landed. Packing and deploying presets 0.3.0 from that branch shipped a tarball without the `preset-dsh-gamedev` row — 3080's composition became "剪辑模式 in, 游戏开发模式 out". The game mode was knocked off by the deploy; the video mode itself had landed correctly.
2. **One boot serving a stale row set (later proven by `2026-10-12-ankh-guard-node-path-scrub` to be a NODE_PATH resolution hijack)**: after the 20:06 instance start, the roster and the plugin inventory still showed the earlier rows (gamedev in, video out) even though every mtime says the profile's patch files on disk were already the new content before the boot; a probe instance booted from a byte-copy of the same profile (3397) showed the new rows. An install/boot race or a skipped path for same-version file: tarballs was suspected at the time; the real root cause is the NODE_PATH in the watchdog's environment hijacking bundle resolution onto the main checkout's workspace copy — same symptom, see the root-cause note.

The diagnosis went wrong twice, both times corrected by the user's screenshots: first "stale browser cache, hard-refresh", then "the screenshots came from the frozen roster of the 3098 instance" (right shape, wrong instance). Lesson: trust the user's evidence before modeling; when the user says "it IS 3080", prove what the live process serves instead of shopping for other instances.

## Decision

- Cherry-pick 76ea67d7 (the gamedev preset) into the branch first, then `git merge main` wholesale — the branch fully catches up, which brings the game package into the tree (check:plugins hard-requires every `dsh.references` name to exist in the repo) and removes the whole class of "deploying from a stale branch knocks out somebody else's new rows". The merge conflicts concentrated in the five presets files (resolved to the branch side, already the union) and the sanctioned-edge table in check-plugin-independence.ts (union of both sides' additions).
- presets bumps to 0.3.1: npm already carries 0.3.0, and a same-version tarball with changed content is exactly what made this incident's "live rows vs disk mismatch" so hard to read.
- The package description and locales move from "three presets" to "five" (dev / dsh-eval / dsh-writing / dsh-gamedev / dsh-video); READMEs and the spec follow; dsh-video's tool-set description is corrected to the post-standalone reality (no shell, no web).

## Alternatives considered

- **Cherry-pick only the gamedev preset, without the game package**: presets' `dsh.references` must name `@khorsheed/dsh-game` (pinned by the spec), and check:plugins requires every referenced name to exist in the repo — the gate fails without the package.
- **Cherry-pick only the game package, not the rest of main**: the game package builds against newer main-side package surfaces (capability-catalog et al.); a half-synced tree is the bigger build risk. A full merge is cleaner.
- **Keep presets at 0.3.0**: see above — same-version content swaps are incident fuel, and npm 0.3.0 is out, so the content evolution deserves a bump anyway.

## Consequences

- The branch now carries all of main up to 1c9780a0 (the game package, the capability-catalog batches, etc.); the next presets / video-studio deploy from this branch will not knock out anybody else's rows.
- Once presets 0.3.1 deploys, 3080 shows both 剪辑模式 and 游戏开发模式; the 剪辑 tab's self-hide criterion (whether the composition names the `@khorsheed/dsh-video-studio/tool` row) is unaffected.
- One operational habit added: after deploying a package that removes or replaces rows, verify the roster / component inventory before declaring done — this incident's two deploy rounds were both waved through on canary PASS alone.

## Testing

The presets package builds green; `tests/presets.spec.ts` passes 14/14 (the gamedev composition pinned, all five preset rows in order, dsh-video naming no evaluation rows); `pnpm check:plugins` green; the post-merge full-tree `pnpm run build` / `pnpm run test` results are on the commit record. Probe verification: a 3397 instance booted from a byte-copy of the prod profile lists 剪辑模式 in its mode selector; live 3080 confirmation by the user after the deploy.
