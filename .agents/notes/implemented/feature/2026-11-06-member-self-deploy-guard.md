# Agent Note: A member cannot restart the instance it runs in

Status: implemented

## Problem

On 2026-11-06 a Kimi room member on 3080 (kimi-canvas) was told to "deploy to 3080". It started `pnpm deploy:3080 --package packages/canvas-novel` as a Kimi background task, said it would report when the task finished, and ended its round. The deploy restarted the host. The restart killed the member's resident Kimi process and the background task with it. The task file still says `running`, and the promised report never came.

The deploy script could not tell that the caller was a member. A CLI member's child environment is an allowlist (`packages/local-agent/src/env.ts`), and nothing in it named the member. The member self-started rounds design (`proposals/active/2026-11-06-member-self-started-rounds.md`, outside the repo, section D and step M7; user decision 4) chose two things: the deploy script refuses a restart that comes from a member, and the room briefing tells members so.

## Decision

- **Two environment variables name the member to its CLI process.** `DSH_LOCAL_AGENT_MEMBER` is the member's dsh child session id. `DSH_LOCAL_AGENT_ROOM` is the parent session id, set only when the parent is a room. The constants and `memberIdentityEnv` live in `packages/local-agent/src/env.ts` and are exported from the package root. Anything the CLI runs (its shell tool, a script) inherits them.
- **The core sets them. The providers do not name them.** `delegationEnv` reads an `AsyncLocalStorage` identity, and `withMemberProcessIdentity` enters it. The store sits on `globalThis` under a `Symbol.for` key, so a core module that loads twice still shares one store. `LocalAgentRegistry.asMemberProcess(binding, body)` enters the identity around every place the core hands work for one member to a provider:
  - each round start (`withMemberConfigurationRound`, which every provider start goes through);
  - native preparation (`prepareMember`);
  - the start without a round (`startMemberProcess`, the room's "load now");
  - a reload (`reloadMemberTools`);
  - the configuration adapter's `prepare`, `validate`, `apply` and `reconcile`, because applying a configuration can restart the process.

  Each provider spawn that builds its env with `delegationEnv` inside that work carries the identity. That covers the exec spawns and the resident (live) runtime spawns of Kimi, Codex, Claude Code and dsh. Provider files are unchanged.
- **The room is detected by a probe.** The core asks the optional `room` service `isRoom({ sessionId })` once per parent and caches the answer, because a room marker never changes. If the service is absent or the probe fails, only `DSH_LOCAL_AGENT_MEMBER` is set.
- **`scripts/deploy-3080.mts` refuses the restart.** When `DSH_LOCAL_AGENT_MEMBER` is non-empty and `--no-restart` is absent, the script exits with status 2 before it runs any command or takes the deploy lock. It prints two commands, in English and Chinese. The first is the same command with `--no-restart`, which still packs, refreshes the profile and runs the preflight. The second is the full command that the coordinator or the human should run. `--no-restart` runs from a member unchanged.
- **The briefing gets one sentence.** The room briefing (`briefingSection` in `packages/room/src/dispatch.ts`) is Chinese only, and every member reads it on its first dispatch. It now says that deploying 3080 restarts the member's own instance: prepare and verify with `--no-restart`, then hand the final restart to the coordinator or the human.

## Alternatives considered

- **Briefing sentence only (option A).** Rejected by the user. In the incident a human explicitly asked for the deploy. A soft rule loses to a direct request.
- **Route the restart receipt to the room (option C).** Rejected. The member still kills itself and its background tasks. Waking the room agent to read the receipt also costs a round.
- **Each provider passes the identity explicitly in its `delegationEnv` call.** This was about eleven call sites across four packages. Kimi's live driver is also being edited concurrently. A provider could forget the call, and a new spawn site would ship unguarded. The core already wraps every member start for configuration admission, so the identity rides that seam instead.
- **Set `DSH_LOCAL_AGENT_ROOM` from the caller kind (`caller: 'room'`).** Rejected. A resident process first spawned by a composer round would then carry no room for its whole life. The `isRoom` probe answers from the room log itself.

## Consequences

- Kimi, Codex and Claude Code members cannot restart 3080 through the deploy script. They can still do every step before the restart. Running the guard CLI directly bypasses the script, and step M10 (the `initiatorMember` restart record) is aimed at that case.
- **Gap: dsh-harness members.** A nested `dsh` child gets the variables, but its own shell tool runs through the host subprocess seam. `scrubbedParentEnv` drops every `DSH_*` key, so the script inside a dsh member does not see the variable. The briefing sentence is the only guard there.
- A resident runtime takes the identity of the work that spawned it. A spawn that happens outside the member's work, such as a respawn fired from an unrelated timer, carries no identity. The variables can be missing in that case, but they never name the wrong member.
- Each member round makes one extra `await`, and the `isRoom` probe runs once per parent.
- `scripts/deploy-3080.spec.ts` sets both variables to empty by default. The spec therefore passes even when it runs from inside a member.

## Testing

- `scripts/deploy-3080.spec.ts`: with the member variables set, a restarting run exits 2, runs no command, takes no lock, and prints the `--no-restart` command and the hand-off. With the variables set and `--no-restart`, the run packs, refreshes and preflights, and never calls `schedule-exit`. With no variables, the run restarts as before.
- `packages/local-agent/tests/env.spec.ts`: inside an identity the variables appear, also across awaits. The room is omitted for a non-room member. Nothing is named outside an identity, even when the host process itself carries the variable. The provider's own entries win.
- `packages/local-agent/tests/prepared-members.spec.ts`: a prepared member's preparation and its first round both build an env that names the member and its room. `isRoom` is probed once. A member without the room service gets only `DSH_LOCAL_AGENT_MEMBER`.
- `packages/room/tests/dispatch.host.spec.ts`: the first briefing contains the sentence.
