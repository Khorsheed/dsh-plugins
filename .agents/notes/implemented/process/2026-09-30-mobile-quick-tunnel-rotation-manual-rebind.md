# Agent Note: mobile Quick Tunnel rotation refused by deploy-3080; manual rebind healed the launch spec

Status: implemented

## Problem

On 2026-09-30 the 3080 mobile public entry (`…trycloudflare.com` Quick Tunnel) was dead — its cloudflared process was gone (Quick Tunnel domains die with their process). The sanctioned operator rotation `pnpm deploy:3080 --package packages/mobile --mobile-origin <new>` completed steps 1–4, then **refused at step 5**: a rotation always routes through `reconfigure` (the origin lives in the launch command), and `restartVerb()` requires the live `launch-spec.json` to carry `preflight.candidateProbeCommand` before it will automate a rebind. The live spec had been written by an older guard generation without that field, so the automation stopped with "rebind by hand" by design.

## Decision

Ran the manual runbook from [the self-deploy reconfigure note](2026-09-26-ankh-guard-self-deploy-reconfigure.md), unchanged:

1. Started a new Quick Tunnel for 3080 by hand: `cloudflared tunnel --url http://127.0.0.1:3080 --protocol http2 --no-autoupdate`, detached, log at `~/.dsh-official/state/cloudflared-mobile.log`. Verified end-to-end before touching the host: `https://<new-domain>/` → 401 through the edge (a 401/403 from the dsh fence proves forwarding; 530/000 would mean a broken tunnel).
2. Diagnostic preflight: `preflight --profile web --preflight-surface built --preflight-install-anchor <harness>/apps/cli/package.json --timeout-ms 300000` → PASS.
3. Re-recorded the green credential immediately before the restart (the 10-minute freshness window must cover reconfigure's double preflight + boot + canary).
4. `reconfigure --on-failure restore-previous` with every field copied from the live spec, plus `--candidate-probe-command` derived per the bundled Skill's rule: same executable and launcher argv as `--start`, with the long-running `web …` action replaced by the one-shot `--profile web --dump-config`.

Result: cutover `ready`, canary PASS at 13:59:36, deployment proof recorded. The new spec now **persists `candidateProbeCommand`** (reconfigure co-binds it), so future `--mobile-origin` rotations on this spec will not hit the refusal.

## Alternatives considered

**Teach deploy-3080 to derive the probe itself, in this session.** Deferred, not rejected: the refusal is the correct conservative behavior — the guard cannot prove semantic provenance of arbitrary shell — but the deploy orchestrator *is* the caller-side trust boundary and could apply the Skill's documented derivation. With the spec now healed the gap is latent on this machine, so the improvement lost to operational urgency; it remains a follow-up candidate.

**Rotate via schedule-exit with an edited environment.** Not possible: the origin is bound inside the launch command (env + `--trusted-host`), and schedule-exit restarts the *recorded* command unchanged. Only reconfigure rebinds the spec.

**Regenerate the spec from scratch (configure-launch / re-supervise).** Heavier and it discards the persisted previous side that `--on-failure restore-previous` relies on; reconfigure is the transactional path that keeps rollback intact.

## Consequences

- 3080's mobile entry is live again at `bridge-spider-rely-studios.trycloudflare.com`; the phone must rescan the QR after every rotation (old QR codes are permanently dead).
- The tunnel is a plain detached cloudflared process (pid was 98789, started 2026-09-30 ~13:51). **Nothing supervises it** — the automatic tunnel manager was removed on 2026-09-28 ([note](../bug-fix/2026-09-28-remove-mobile-tunnel-manager.md)). It does not survive reboot; on failure, repeat this rotation. A stable named tunnel would end the rescan ritual but needs the operator's Cloudflare account — an explicit product decision, not something to automate quietly.
- A second cloudflared on this machine targets `127.0.0.1:3182` (a live, unrelated service) — not ours, leave it alone.
- An orphaned `dsh-watchdog.sh` from the 02:42 supervisor generation (pid 61186) was killed during this session; it was outside the live supervision chain (launchd `com.dsh.watchdog` → 66070 → 66253).
- Unexplained and being watched: the instance restarted once at 13:56 (attempt=5) with no visible operator action; it self-healed with canary PASS before the rotation cutover.
- Composition warnings observed via `--dump-config` (non-blocking, profile hygiene, unrelated to this rotation): bundle patch entries `tool-subagent-codex`/`tool-subagent-claude-code` not found after the family retreat; stale profile patch entries `ui-brain-3d` (not found), `llm-deepseek` and `ui-shortcuts` (name mismatch, skipped). Worth a dedicated cleanup pass; do not hand-edit casually — the profile is shared state.
