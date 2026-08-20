# Agent Note: local-agent member-to-member notification — bridge MCP + token auth + gate handoff (M3)

Status: implemented

English | [中文](2026-08-19-local-agent-member-notification.zh.md)

## Problem

Members of one delegation group (a room, or the main agent's parallel delegations) had no way to reach each other: a CLI member mid-run could not notify a sibling member, and every cross-member nudge had to be routed by the human. This is milestone M3 of the [member-channel proposal](../../../proposals/active/2026-08-19-local-agent-member-channel.md): member A calls a `member_message(to, text)` tool mid-run; the host delivers to member B as an async one-way handoff (A never waits on B), through a **gate handoff** that keeps dispatch-gate ownership single — room when present, the family when not. M1/M2 (the gateway remotes and the writable composer) are recorded in the [member-channel note](2026-08-19-local-agent-member-channel.md); this note covers M3 as a separate decision set (bridge transport, token auth, gate contract).

## Decision

**Bridge MCP server** (`packages/local-agent/src/member-bridge.ts`, built to `lib/member-bridge.js`, declared as the package bin `dsh-local-agent-member-bridge`). No MCP SDK exists anywhere in the dependency tree (the harness's `packages/mcp` is a host-side client), so the bridge is a hand-rolled, dependency-free stdio JSON-RPC server — newline-delimited framing, exactly the `initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call` subset — exposing one tool `member_message(to, text)`. Each call is one NDJSON round trip to the host's loopback listener; the host's receipt is the tool result verbatim, and channel failures are MCP tool errors (`isError`).

**Host side** (`packages/local-agent/src/member-channel.ts`): the `MemberChannel` owns a loopback-only unix-socket listener at `<homesRoot>/member-bridge.sock`, mounted by the plugin's `apply` and disposed with its fiber; a failed bind degrades the channel to absent (warn, never throw). The delivery chain: token → registered run (sender identity, never self-reported) **cross-checked against the spawned CLI's pid** (the bridge reports its `process.ppid`) → resolve B (`to` = child session id; member names resolve only through a claiming room's roster) → same-parent check → gate handoff → family direct-send.

**Token lifecycle** (registry): `registerMemberRun` mints a per-run token before spawn (fresh AND resume rounds), `bindMemberRunPid` binds the CLI pid right after spawn, `unregisterMemberRun` invalidates on any settle path. Unknown/expired token or foreign pid → tool error, nothing else.

**Duck-typed room gate** — the contract room implements to own the dispatch gate, probed via `ctx.get('room')` with a `typeof` check, importing NO room package (so the independence checker needs no sanction):

```ts
receiveMemberMessage(message: LocalAgentMemberMessage): Promise<RoomMemberMessageReceipt>
// returns 'sent' | 'pending-confirm' | 'busy' — room owns dispatch; the receipt passes to A verbatim
// throws                                 — decline: the parent is not a room this instance manages; family direct-sends
```

`LocalAgentMemberMessage` is `{ from: string, to, content, parentSessionId, provenance }` — the frozen shape from the proposal (`{ from, to, content, parentSessionId, provenance }`, receipt passed back verbatim). `from` is the sender's dsh child session id (the bridge cannot speak roster names — only room owns the roster, and room resolves both endpoints to names); the full delegation view rides as `provenance`. A throwing gate is logged and treated as a decline. Family-side receipts: `sent` / `busy` (B's resume lock held) / `error: <reason>` (e.g. parent not live). The direct-send prompt carries provenance (`成员 <harness>（会话 <childSessionId>）转告：…`) plus a reply hint naming A's child session id — never the CLI-session resume handle. (As first shipped, M3 had drifted to a `{ claimed, receipt }` envelope with `from` as the delegation VIEW object — room journals the raw `from`, so one real bridge call poisoned a room journal with an object and the wire-validated `getState` rejected the state. The joint room × member-channel acceptance caught it; the contract now matches room's frozen shape, and room validates the untyped boundary at runtime.)

**Provider injection** — one mechanism per CLI's config surface, all sharing the kimi-established register → bind(pid) → unregister-on-settle pattern and the same degrade rule (a core predating the member channel is detected by probing `typeof registry.registerMemberRun`; the run then proceeds unchanged):

- **kimi** (`packages/local-agent-kimi/src/member-bridge-config.ts`): kimi's ONLY MCP config surface is the scoped-home-shared `$KIMI_CODE_HOME/mcp.json` (verified against the official docs: no per-invocation flag, and only an entry's own `env` is documented to reach the server child — the CLI's process env is not a reliable channel). Sharing one file across concurrent runs rules out a single mutable entry, so the provider writes a **per-run server entry** `dsh-member-<token8>` carrying the socket path and token in its `env` — race-free by construction — prunes it at settle, and drops other family entries (crashed-host residue) on every write. kimi's documented mid-session semantics make both safe: config edits never interrupt an open session.
- **claude-code** (spike-verified END-TO-END against the real CLI: the model called the tool, the bridge round-tripped, zero permission prompts): per-invocation flags, no config file at all — `--mcp-config <json>` (a single JSON string declaring `dsh-member-<token8>` with command/args/env) plus `--allowedTools mcp__<server>__member_message` (claude `-p` auto-denies permission prompts), appended to both the fresh and resume argv, skip and normal permission modes alike.
- **codex**: per-process inline-TOML override `-c 'mcp_servers.dsh-member-<token8>={command=…,args=[…],env={…}}'` on both `codex exec` and `codex exec resume`; nothing lands in the shared `config.toml`, so there is nothing to prune. Spike status: the override PARSES and the run reaches model invocation; the model-call leg is **verified-pending** (account quota reset, rerun scheduled).
- **dsh**: the sub-dsh is a dsh profile, so the member bridge rides the harness's own `@deepseek-ai/dsh-mcp-client` — one stdio row in the family headless bundle's `cordis.patch.yml` reading the per-run coordinates through `!!js` env lookups (`DSH_MEMBER_SOCKET` / `DSH_MEMBER_TOKEN` / `DSH_MEMBER_BRIDGE_ENTRY`, handed over via the sub-dsh spawn env's explicit layer). The package resolves from the dsh installation's dependency closure (linked into the scoped home's `profiles/node_modules` fallback at boot; the published app has carried it since rc.6, the family's minHost). `failOnStartupError: false` keeps a core without the member channel fail-open.

## Alternatives considered

- **Pulling in `@modelcontextprotocol/sdk`** — rejected: it is nowhere in the dependency tree, and adding a dependency to serve one tool over newline-delimited JSON-RPC buys nothing over the ~200-line standalone server.
- **Token via the CLI's process env** (inherited by the bridge as its child) — rejected: the official MCP SDK's stdio transport filters the inherited environment to a safe-variable whitelist, so only the config entry's own `env` is a documented channel. (The proposal's "token via env" is honored — via the MCP config entry's env.)
- **A single stable `dsh-member` server entry rewritten per run** — rejected: concurrent delegations of one scoped home race on the shared file, and kimi offers no per-invocation config flag to sidestep it. Per-run keys cost a per-run tool-name suffix (each `kimi -p` round is a fresh session that re-discovers tools anyway) and the pid cross-check makes a sibling's visible entry unusable for impersonation.
- **Importing room's types for the gate contract** — rejected: a duck-typed local interface plus a `ctx.get` probe keeps the edge dependency-free (room's own suggestion), so `check-plugin-independence` needs no new sanction and room's absence is invisible.
- **Family-side member-name resolution** — rejected: names belong to room's roster; without room the family accepts only child session ids, which are unambiguous and always available.

## Consequences

- Kimi members can notify each other mid-run today; the receipt vocabulary (`sent` / `pending-confirm` / `busy` / `error: …`) is stable for the sender's conclusion regardless of which side (room gate or family direct) produced it.
- Gate ownership is single: when room claims, the family never delivers, so room's confirm-card flow cannot be bypassed.
- A crashed host leaves stale `dsh-member-*` kimi config entries; the next run's write prunes them. A run whose token outlives its host process fails closed (unknown token).
- The codex model-call leg remains **verified-pending** (injection syntax accepted by the real CLI; the model call awaits the quota-reset rerun) — the argv shape is unit-tested either way. claude-code and kimi are end-to-end spike-verified; dsh rides the harness's own mcp-client, whose tool-call path is upstream-tested.
- The per-provider argv/env surface is the provider's own business (kimi's mcp.json entries, claude's `--mcp-config` JSON, codex's `-c` TOML, dsh's bundle row) — four mechanisms, one registry contract.
- The bridge speaks NDJSON stdio (the MCP TypeScript SDK's framing); a client using header framing would not interop — accepted: the bridge targets the documented kimi client behavior.

## Testing

`packages/local-agent/tests/member-channel.spec.ts` (11 tests): token auth (unknown/expired rejected, foreign or unbound pid rejected), full direct-send path with provenance (facade resume called with B's recorded parent/provider, prompt names A and never carries B's CLI-session handle), cross-parent rejection, busy receipt, all three gate branches (room claims → receipt verbatim and NO family send; room declines → direct send; room absent → direct send), name resolution only via a claiming room, parent-not-live as an `error:` receipt, and a throwing gate falling back to direct send. `packages/local-agent/tests/member-bridge.spec.ts` (5 tests): initialize/tools-list handshake over in-memory stdio, a tools/call round trip against a fake socket listener asserting the `{token, pid, to, text}` payload, host rejection mapped to a tool error, unconfigured/unreachable channel tool errors, and JSON-RPC error codes for unknown tools/methods. `packages/local-agent-kimi/tests/member-bridge-injection.spec.ts` (6 tests): config write preserving user servers and pruning stale family entries, settle-time removal, the per-run key shape, fresh- and resume-round injection (entry with socket+token env, pid binding, settle cleanup), and degrade-and-proceed against a member-channel-less core. The claude-code (3 tests), codex (3), and dsh (3 + 1 patch-shape) `member-bridge-injection.spec.ts` suites assert the per-run argv/env injection (fresh + resume), pid binding, settle cleanup, and the degrade path; the dsh suite also pins the headless bundle's mcp-client row shape. Suites: local-agent 134/134, local-agent-kimi 62/62, local-agent-claude-code 28/28, local-agent-codex 35/35, local-agent-dsh 37/37, local-agent-dsh-headless 19/19, local-agent-tool-subagent 10/10.

## Cross-references

- [Member-channel proposal](../../../proposals/active/2026-08-19-local-agent-member-channel.md) — the milestone plan (this implements M3 for kimi).
- [Member channel M1+M2](2026-08-19-local-agent-member-channel.md) — the gateway remotes and writable composer this builds on.
- [Delegation facade](2026-08-18-local-agent-delegation-facade.md) — the resume/lock primitives the delivery chain reuses.
