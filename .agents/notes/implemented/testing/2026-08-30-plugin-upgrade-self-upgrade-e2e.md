# Agent Note: plugin-upgrade self-upgrade e2e — a deliberately broken fixture and a browserless driver

Status: implemented

English | [中文](2026-08-30-plugin-upgrade-self-upgrade-e2e.zh.md)

## Problem

How do we prove the plugin-upgrade skill actually works — that an instance told one sentence can upgrade itself across a host release without losing its plugins? A live e2e needs a plugin that is broken in a known way on the new host, an environment builder, and out-of-band assertions; none existed.

## Decision

`@khorsheed/dsh-plugin-upgrade` carries an end-to-end acceptance rig under
`packages/plugin-upgrade/tests/e2e/` (outside `files`, never published):

- `fixtures/fixture-legacy-store/` — a build-free, deliberately outdated plugin.
  Its host half logs and writes `$DSH_HOME/state/legacy-store-alive.json` (with
  the process pid); its browser half is handwritten in the
  `window.__ModuleLoader__.load({id, factory})` format and hard-`require`s
  `@deepseek-ai/dsh-client-runtime/client`, a frozen-module-table row that
  0.1.1-rc.2 serves and 0.1.2 removed. It therefore works on rc.2 and throws at
  client load on 0.1.2 until the upgrading agent fixes it. The fixture is
  committed in the BROKEN state — the break is the test input. The sources
  live in `src/`, not the conventional `lib/`: the repo hygiene gate forbids
  tracking anything under a `lib/` segment (build output), and these files are
  handwritten. (The client
  bundle must export a no-op `apply`: the browser-side cordis runner applies
  every composed bundle as a plugin and an exports object without `apply` logs a
  console error that pollutes the zero-console-errors baseline.)
- `run-self-upgrade.mjs` — `up | assert | cleanup`. `up` builds a throwaway
  HOME (symlinked official credentials, pinned default model), composes a web
  profile whose `dsh-base`/`dsh-web-app` are `file:` links into the stable
  toolchain plus the fixture and the plugin-upgrade tarball, boots rc.2 on a
  free 32xx port, verifies readiness (HTTP 200 + marker + client.js), and
  prints the handoff guidance. It never drives a browser; a human or an agent
  with playwright sends the one sentence. `assert` verifies the upgrade
  out-of-band: the port's listener runs from the alpha toolchain, the fixture
  marker's pid equals the live listener (i.e. it re-applied on the NEW boot),
  and the fixture client bundle serves 200. `cleanup` tears everything down.

## What the first live run (rc.2 -> 0.1.2-alpha.2, one Chinese sentence) taught

The in-instance agent completed the full upgrade: it discovered the skill
pull-based, ran Phase 0-5, fixed the fixture with a dual-line try/catch probe,
re-pointed the profile with npm, trial-booted the alpha host on a spare port,
wrote a handoff note, spawned a supervisor, and killed itself. All four asserts
passed. Two host-contract changes in 0.1.2 broke assumptions the skill and the
first version of the driver shared:

- **The web UI is token-gated now.** Bare `GET /` returns 401; the boot log
  prints `http://127.0.0.1:<port>/?token=...` which 303s into an auth cookie.
  The skill's supervisor template and any health check that demand 2xx on `/`
  misread a healthy 0.1.2 host as dead (the agent rewrote its supervisor's
  health probe to "answers at all", and `assert` accepts 401 as alive).
- **Plugin client bundles are served only via the boot-manifest batch URL**
  (`/plugins/??<id>/client.js,...&rev=...`); the rc.2-era single-file
  `/plugins/<id>/client.js` 404s. `assert` now follows the manifest with the
  auth cookie instead of probing the old URL.

Two environment gotchas also surfaced: `setsid` does not exist on macOS (the
agent reimplemented `assets/restart-resume.sh` in Node with
`spawn(..., {detached: true})`), and a guard-less restart never resumes the
in-flight turn — the session transcript survives, but the agent stops at the
interrupted kill until a human nudges it; the handoff note's "first sentence"
only gets delivered after that nudge.

## Consequences

- SKILL.md improvement candidates from this run (token-gated health checks,
  batch-URL client assets, macOS `setsid` absence, guard-less resume
  semantics) are tracked in the worktree branch report; the skill itself is
  unchanged by this commit.
- The fixture must stay broken on `main`-ward merges; "fixing" it outside an
  upgrade run destroys the rig.

## Alternatives considered

- **Embedding browser automation in the driver** — rejected: the playwright
  browser is shared with other agents; the driver prints the sentence and
  leaves driving to the operator.
- **Committing the agent-fixed fixture** — rejected: the rig's value is the
  broken starting state; the applied fix is recorded in the run report and the
  instance's handoff note.
