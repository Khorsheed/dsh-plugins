---
name: plugin-upgrade
description: Upgrade this dsh instance across a host release. Use when the user asks to upgrade/migrate the instance or its plugins to a new host version (e.g. "upgrade this instance to 0.1.2", "adapt the plugins to the new host", "move this deployment onto the latest release").
---

# Plugin upgrade runbook

You are an agent running INSIDE the instance being upgraded. Your job: move the
instance onto a new host version without losing the deployment — fetch the new
host safely, find what breaks, fix it so the artifacts run on BOTH host lines,
prove it on a live instance, then restart yourself and resume the conversation.

Work through the phases in order. Never skip a verification rung. If any step
fails and you cannot fix it, STOP and report — never restart into known-broken
code.

**Keep the user working while you work.** Phases 0–4 touch nothing the running
instance serves — do them in a background subagent when the host offers one
(e.g. a subagent tool with background mode), so the user's own session stays
usable. The only user-visible seam is the restart in Phase 5: seconds on the
guarded path, one short planned outage on the manual path — always scheduled
with the user, never a surprise mid-activity.

## Ground rules

- **Never modify the running host's checkout in place.** The process you live
  in executes those files; editing them under a running instance can kill you
  mid-write and leaves no clean rollback point. Always stage the new host
  beside the old one.
- **Probe features, never version numbers.** A capability check
  (`if (host.newSurface !== undefined)`) runs correctly on every line; a
  version comparison rots the moment a backport lands.
- **Green typecheck/tests is not runtime-clean.** Dev-time type resolution can
  keep deleted host exports compiling. Only a live boot catches load-time and
  apply-time breaks. The verification ladder below ends in a live instance for
  exactly this reason.

## Phase 0 — Baseline

1. Record the current host version (`dsh --version`, or the host package's
   `package.json`) and the target version. If you cannot name both, stop and
   ask.
2. Record how this instance runs: profile name, port, `$DSH_HOME`, and the
   exact launch command (a process listing or the profile's deploy notes).
   You need this verbatim for the restart phase. **Resolve every path to an
   absolute one, and be careful whose `~` you expand**: a path the user quotes
   (`~/...`) means their LOGIN home, while the instance's own `$HOME` may be a
   mktemp or container path — the two differ exactly in the deployments where
   upgrades are trickiest. Record both, expanded.
3. List what is installed: the profile's plugin rows and every package's
   version. Snapshot the working state of any source checkouts you will touch
   (`git status`, current HEAD) so every change is attributable. **Write this
   inventory to a file** — it doubles as the checklist for the post-restart
   fleet verification (Phase 6), and the conversation alone is not durable
   enough to serve as it.

## Phase 1 — Fetch the new host beside the old

The invariant is *beside, never in place*: the new host lands in its own
directory so the running deployment stays intact and rollback is a path swap.
How you stage it is your call — a git worktree, a fresh clone, or an npm
staging dir all satisfy the invariant. Examples:

Source-based deployment (a worktree keeps the checkout's object store shared
and disposable):

```sh
git -C /path/to/host/repo fetch --tags
git -C /path/to/host/repo worktree add /path/to/host-next <new-tag>   # detached
```

npm-based deployment: install the new version into a separate staging
directory, never over the running install:

```sh
mkdir -p /path/to/host-staging && cd /path/to/host-staging
npm install @deepseek-ai/dsh@<target-version>
```

Then read the release notes commit by commit (changelog range
`old-tag...new-tag`) and build a symbol migration map: every removed, renamed,
or moved export/type/package your installed plugins touch. See
`reference/breakage-checklist.md` for the full inventory method.

## Phase 2 — Inventory the breakage surface

For each installed plugin, check every surface the host can break (details and
the why in `reference/breakage-checklist.md`):

- **Externalized value imports** — browser bundles ask the host's frozen module
  table for shared packages at load time. If the host deleted a package from
  that table, the bundle throws at load. Type-only imports of a deleted
  package are erased at build and are compile-time-only migration.
- **Slots, Remote namespaces, settings registration, skills registry, command
  execution signatures, DOM anchors** — verify each against the new host
  source, not against memory.
- **Deleted host packages** — grep every plugin repo for the package name; a
  single leftover reference is a load-time crash.
- **Compile-time blind spots** — when dev dependencies still resolve the OLD
  host's published types, a deleted named export compiles green and only
  explodes on a live boot. Treat "build passed" as a weak signal until Phase 4.

## Phase 3 — Fix with dual-line discipline

Every fix must produce ONE artifact that runs on the old AND the new host
line, so the upgrade never strands a rollback. The full pattern catalog with
worked examples is in `reference/dual-host-fix-patterns.md`; the core moves:

1. **Feature-probe both seats.** A service that moved or was renamed gets a
   probe per line, never a version check:

   ```ts
   const events = ctx.get('newServiceName') ?? ctx.get('legacyServiceName')
   ```

2. **Anchor renamed types to a consumer API.** When the host renames a branded
   type, do not import the name — derive it from a signature that exists on
   both lines:

   ```ts
   // The host renamed the call-id brand; the name you imported is gone.
   // import type { CallId } from 'host-llm/brand'            // breaks
   type CallIdCompat = Parameters<ToolStream['onCall']>[0]['id'] // survives
   ```

3. **Inline deleted value imports.** If the host deleted a package whose
   VALUES you import, bundle the replacement into your own artifact so it
   needs no host row on either line — but only after verifying it carries no
   cross-boundary identity: no `Symbol.for` keys, no `instanceof` against host
   classes, no host-shared singletons. If it does carry identity, probe both
   host seats instead.

4. **Degrade, never explode.** A missing optional capability hides the feature;
   it must never throw inside plugin apply — one throwing loader entry fails
   the whole boot.

## Phase 4 — The verification ladder

Climb in order; each rung's criterion must pass before the next:

1. **Package level** — every touched package builds and tests green against
   BOTH host lines (two runs, two dependency seeds).
2. **Composition level** — all plugins installed TOGETHER into one profile;
   boot it. Catches duplicate loader entry ids and cross-plugin interference
   that per-package runs cannot see.
3. **Live acceptance** — a real instance on a FRESH home directory, every
   candidate package installed from its tarball, then drive the UI in a
   browser: navigate, send messages, open settings. Criterion: **zero plugin
   errors in the browser console**. Green build+test is not runtime-clean —
   load-time `SyntaxError`s, `undefined.subscribe` in plugin apply, and
   renderer crashes from folded-away host members have all shipped past green
   suites and only surfaced here.
4. **Delivery level** — from zero, on a clean profile, following only the
   package README: install, use, uninstall. The README is the product; if the
   install needs a fact that is not in it, fix the README.

Rungs 2–3 have an executable helper: `assets/trial-boot.mjs` beside this skill
boots the NEW host on a spare port against a THROWAWAY copy of the live
profile (symlinks preserved), waits for it to answer, and prints the entry URL
— including the `?token=` one token-gated hosts (0.1.2+) print at boot:

```sh
HOST_BIN=/path/to/new-host/node_modules/.bin/dsh \
PROFILE_FROM=$DSH_HOME/profiles/web \
DSH_HOME_FROM=$DSH_HOME \
node /path/to/trial-boot.mjs
```

A trial that answers and renders the fleet in a browser is the strongest
pre-restart signal available; the running instance stays untouched throughout.

## Phase 5 — Self-restart and resume

**Timing**: the restart is the only user-visible seam. Confirm the moment with
the user ("upgrade verified, restart now?") unless they pre-authorized it —
never surprise-restart while they are mid-task. With the guard the outage is
seconds and sessions resume automatically; without it, schedule one short
planned window.

Pick the path by capability, and prefer the guard when present:

**Path A — the instance has the ankh-guard plugin.** Ask the user (or check the
installed plugin list) whether `@khorsheed/dsh-ankh-guard` is installed. If
yes, follow the `dsh-self-restart-guard` skill: record the green credential,
schedule the guarded restart — the watchdog health-checks the new boot, rolls
back on failure, and resumes the sessions the restart interrupted.

**Path B — no guard.** Do it by hand, in this order:

1. **Write the handoff note FIRST** — a state file under the instance's state
   directory recording: what changed (files/commits), which verification rung
   you reached, the rollback pointer (old host checkout path + old launch
   command), and the exact first sentence to say after the restart. The you
   that wakes up after the restart has this note and nothing else.
2. **Spawn the detached supervisor** — two variants of the same logic ship in
   `assets/` beside this skill. Both wait for the old process to die, start
   the new host, health-check it, and on failure roll back to the old host.
   Both treat ANY HTTP answer from the health URL as alive: a token-gated host
   (0.1.2+) answers a bare `GET /` with **401**, so demanding 2xx misreads a
   healthy new host as dead and triggers a spurious rollback. If you need a
   2xx, extract the `?token=` URL from the new host's boot log and poll that.
   Pick the variant by platform:

   - `assets/restart-resume.sh` — where `setsid` exists (Linux). Launch it
     FULLY detached — a merely backgrounded child dies with the session
     teardown:

     ```sh
     OLD_PID=<pid> NEW_HOST_CMD='<new launch command>' \
     HEALTH_URL='http://127.0.0.1:<port>/' \
     ROLLBACK_CMD='<old launch command>' \
     setsid sh /path/to/restart-resume.sh </dev/null >>/path/to/restart.log 2>&1 &
     ```

   - `assets/restart-resume.mjs` — where `setsid` does NOT exist (macOS):
     Node's `spawn(..., { detached: true })` is the same detach. Same env vars:

     ```sh
     OLD_PID=<pid> NEW_HOST_CMD='<new launch command>' \
     HEALTH_URL='http://127.0.0.1:<port>/' \
     ROLLBACK_CMD='<old launch command>' \
     node /path/to/restart-resume.mjs </dev/null >>/path/to/restart.log 2>&1 &
     ```

   If neither detach is available and the session is sandboxed, STOP and hand
   the command to the user — a reaped supervisor mid-restart strands the
   instance.
3. **Exit the old instance** only after the supervisor is confirmed running
   (its log shows it waiting). Then the supervisor owns the handoff.
   **Before you exit, say so in the conversation** — the session log persists
   across the restart, and your last message is what the user sees when they
   come back: "restarting now; reopen this session when the page returns and
   I will verify the fleet and report." Without a guard, nothing alive remains
   to read the handoff note — the resumed session is the wake-up mechanism.
4. **When the session resumes** (the user reopened it — or the guard resumed
   it on Path A): read the handoff note and the supervisor log, confirm the
   health check passed, then run Phase 6 before saying "done".

## Phase 6 — Post-restart fleet verification

You are back; now prove the fleet survived, not just the host. Walk the Phase 0
inventory file and check each row on the NEW host:

- every plugin row still composes (the host's config dump lists it);
- every browser-facing plugin's bundle serves (`/plugins/<name>/client.js`
  answers 200 — mind the host's bundle URL shape, it differs across lines);
- every skill-bearing plugin still lists its skill (`skill.list` or the
  catalog page);
- every Remote-namespace plugin answers one cheap call.

Present the result as a table against the baseline — what is verified working,
what degraded, what is missing. Anything missing that the ladder had cleared
means the upgrade is NOT done: keep fixing or roll back (Phase 7).

## Phase 7 — Failure fallback

- Any rung of the ladder fails → stop, report what passed and what did not.
  Do NOT restart into code that has not cleared the ladder.
- The new host fails its health check → the supervisor rolls back to the old
  checkout automatically; after you come back, report the rollback and the
  captured boot error — do not retry blindly.
- The rollback itself fails → the instance is down; the handoff note carries
  the old launch command for manual recovery. Say so plainly.

## Feedback board — leave a note when this skill failed you

This skill improves from real failure reports, not from star ratings. If you
hit a problem the runbook did not prepare you for — a missing surface in the
checklist, a step that was wrong or unreadable, a host version whose breakage
looks nothing like the documented patterns — leave a structured note, even if
you eventually solved it yourself:

1. Write it to `$DSH_HOME/skill-feedback/plugin-upgrade/<unix-ms>.md` — the
   shared board root is `skill-feedback/`, one subdirectory per skill, so any
   skill that adopts this convention lands in the same place and attribution
   is the subdir name plus the frontmatter (create the directory) using this
   template:

   ```markdown
   ---
   host-from: <version>   # e.g. 0.1.1-rc.2
   host-to: <version>     # e.g. 0.1.2-alpha.2
   skill-version: <from the package.json of the installed plugin-upgrade>
   outcome: solved | worked-around | stuck
   ---

   ## Where I was
   <phase and step in the runbook, verbatim heading>

   ## What happened
   <the error or confusion, with the actual error text>

   ## What I expected the skill to say
   <what guidance would have unblocked you immediately>

   ## What actually worked
   <the fix you found, if any>
   ```

2. Tell the deployment's operator the note exists and where. **They own this
   copy of the skill**: the runbook deliberately lives in a plain file they
   can patch, and these notes are how it grows to fit their repo — its plugin
   inventory, its conventions, its recurring breakages. If their fix belongs
   upstream, they can optionally share the note with the package maintainers;
   nothing is reported automatically.

Keep the note factual — phase, error text, what unblocked you. The operator
turns these into runbook edits and new reference entries; vague complaints
help no one.
