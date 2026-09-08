# Agent Note: lab — network, volume mounts, in-container user

Status: implemented

English | [中文](2026-09-09-lab-network-volume-user.zh.md)

## Problem

Building the evaluation image (T16) read `packages/lab/src` against what a containerized run actually needs and found three things lab could not say. `AcquireSpec` had no network field and `docker.ts` never passed `--network`, so every unit landed on docker's default bridge — a NAT'd network with egress. The whole point of the evaluation topology is an `--internal` network where the only routes out are a whitelist proxy and a local package mirror, and lab could not express it: the isolation existed only inside the dataset repo's own `run-unit.sh`. That was recorded as I3's hardest gap, because "the unit cannot reach the internet" is a claim the orchestrator has to be able to make.

Two smaller gaps sat in the same place. `mounts` only ever emitted `type=bind`, so the per-harness credential volumes — the writable state that has to outlive one unit, since an OAuth refresh is written back to it — could not be attached. And there was no `user`: the image runs as non-root `node` because one CLI refuses `--dangerously-skip-permissions` under root, which is the sandbox tier a frozen decision assigns it, so a root unit would put one of four contestants in a different tier than the other three.

Underneath all three: whatever lab cannot declare, it also cannot fingerprint. Two units on different networks, or as different users, were reported as the same environment.

## Decision

**Three fields, applied and hashed.** `AcquireSpec` gains `network?: string` (a network name or `'none'`) and `user?: string` (`uid[:gid]` or a name); `MountSpec` gains `type?: 'bind' | 'volume'`, where a volume's `source` is the volume name. `acquire` passes `--network`, `--user`, and `type=volume,source=…` through to `docker run`, and all three enter the fingerprint components. Undeclared keeps meaning exactly what it meant before — docker's default bridge, the image's own `USER`, a bind mount — and the README says so where it matters, because "undeclared network" is not the same claim as "no egress".

**The mount component still records no `source`, for volumes as well as binds.** A bind's host path differs per machine; a volume's name differs per cell by design (one credential volume per harness, precisely so no contestant sees another's tokens). What the cells must share is the layout — what is mounted where, and whether it can be written — so the component stays `{target, type, readonly}`. The `type` distinction does enter it: a volume at `/creds` and a bind at `/creds` are different environments.

**A network NAME does enter, and that is not an exception to "no host information".** A network name is a daemon-local label naming a topology, not a location on someone's disk; two machines running the same evaluation both have `eval-net`, and it is the thing whose difference actually changes what the unit can reach.

**An undeclared component contributes nothing to the hash.** The hash preimage is the component set minus every post-initial component that is `null`. So adding `network` and `user` did not move the fingerprint of any unit that declares neither — pinned in tests as two literal hashes produced by the previous implementation, so a future component addition gets caught if it shifts them.

This replaces the versioning stance of [the composite fingerprint note](2026-09-08-lab-composite-fingerprint.md), which said a wider definition must shift every fingerprint. The replacement follows from what a fingerprint is for: it must change when the environment it describes changes, and a unit that declared no network before and declares none now is running in the same place. `components.version` accordingly numbers the hashing *rules* — canonicalization, value normalization, this rule — not the component inventory. The honest cost, recorded as a README limitation: `network: null` cannot distinguish "nobody addressed the networking" from "someone confirmed the default bridge is right". Asserting isolation requires declaring it.

**The pid directory is created as root and made `1777`.** `acquire` prepared `/run/dsh-lab/pids` with a plain `docker exec`, which runs as the container's user. A non-root unit — declared, or the image's own `USER` — cannot create anything under `/run`, so every non-root acquire would have failed at that line; user support that cannot acquire is not support. It is now created via `exec --user 0` and made sticky-writable like `/tmp`, so the pidfile wrapper works whoever the unit runs as and lab never has to learn the uid. Where the daemon refuses `--user 0` (userns-remap) it falls back to the plain create, which is exactly the pre-existing behavior.

**The CLI takes `--network`, `--user`, and a separate `--volume NAME:DST[:ro]`.** The kind of a mount comes from which flag carried it, never from the shape of the source text. docker's own `-v` guesses bind-vs-volume by whether the source looks like a path; a relative path silently becoming a volume is not a guess worth inheriting. `fingerprint` accepts the same spec flags, so the components of a spec can be resolved and diffed before anything is acquired, and `status --json` carries all three on held units.

## Alternatives considered

**Bump `components.version` to 2 and let every fingerprint shift.** This is what the previous note prescribed, and it was rejected here: it would invalidate the fingerprints of units whose environments did not change, which is the failure the fingerprint exists to prevent, in the other direction. The narrower worry that motivated the old stance — that widening reveals a difference that was previously invisible — does not apply to these three, because each has a single well-defined undeclared value that did not change.

**Drop every `null` from the hash preimage, at any depth, as one uniform rule.** Cleaner to state, but it would have moved the fingerprint of every unit with undeclared resource ceilings (`resources: {cpus: null, memory: null}` → `{}`) — that is, nearly all of them. The rule is scoped to components added after the initial set precisely because the initial set's preimage bytes are the anchor the stability claim is made against.

**Infer volume-vs-bind from the source string, like `docker -v`.** Rejected: the inference is exactly wrong in the one case that bites (a relative host path), and it fails silently by creating an empty volume rather than erroring.

**Put the volume name in the fingerprint component.** Rejected: it would make every cell's fingerprint differ, since each harness mounts its own credential volume — the fingerprint would report four incomparable environments where the design says one.

**Move the pid directory to `/tmp` instead of fixing its permissions.** Simpler, but a container acquired by an older lab is reconciled by a newer one, and `terminate` would then sweep a directory the wrapper never wrote to — the orphan compensation would silently cover nothing. Keeping the path and fixing the creation keeps old and new units sweepable by the same code.

**A `--network none` shorthand or a `network: false` boolean.** Rejected: `'none'` is already docker's own name for it, and one string field that passes through is less to explain than two ways of saying the same thing.

## Consequences

- Fingerprints of existing units are unchanged, and the two pinned hashes in `tests/fingerprint.spec.ts` are the regression that says so.
- Non-root units work at all now; before this change any image with a non-root `USER` failed at acquire, which no test covered because every test image ran as root.
- lab can now express the evaluation topology end to end, so "the unit has no egress" becomes an orchestrator-side claim backed by a flag rather than a dataset-side script. lab still does not verify it — a declared network is a declaration, and the README keeps saying the fingerprint records declarations rather than measurements.
- `MountSpec.source` now means two things depending on `type`. The field is documented per-kind rather than renamed; renaming it would break every existing caller for a gain in one word.

## Testing

Package: 120 tests green. Fingerprint layer: the two pinned pre-change hashes, null-keys-hash-as-absent, each of network / `'none'` / user / both producing a distinct fingerprint, volume-vs-bind at one target differing, two volume NAMES at one target agreeing, and a scan proving the volume name never reaches the serialized components. Provider layer: `--network` / `--user` on the wire and absent when undeclared, `type=volume` with and without `readonly`, the pid directory created via `exec --user 0` with `chmod 1777`, and the userns-remap fallback. CLI: acquire with all three plus a bind, a malformed `--volume` as a usage error, `fingerprint` reporting network and user for an unacquired spec, and `status --json` carrying them for a held unit.

Live (the T16 image, on the evaluation network): a unit acquired with `network: eval-net`, `user: 1000:1000`, and a named volume — `id` and `ip route` read from inside the container agree with the declaration.

## Cross-references

- [composite environment fingerprint](2026-09-08-lab-composite-fingerprint.md) — the component set this widens, and the versioning stance it replaces
- [lab M1](2026-08-20-lab-m1.md) · [M2 verbs](2026-08-20-lab-m2-verbs.md) · [M2 CLI](2026-08-20-lab-m2-cli.md)
