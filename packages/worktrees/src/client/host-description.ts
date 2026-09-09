/**
 * Host-description feed behind the drawers' external-open gating. rc hosts
 * answered this shape from `Connection.hostDescription`; host 0.1.2 removed
 * that property and folded the facts into the connection generation's opening
 * frame (`connection.generation`, upstream e14d354e83) — `canOpenPath` left
 * the wire with the fold (it became an RPC probe), so on 0.1.2 it reads as
 * unavailable and the open-in-finder affordances hide. The type was retired
 * from the official connection package with the same change, so the narrow
 * face the drawers consume is mirrored here.
 *
 * @module dsh-worktrees/client/host-description
 */

/** Host facts carried by one connection generation. */
export interface HostDescription {
  /** Host account home, used to abbreviate displayed paths. */
  readonly home?: string
  /** Whether the host can open paths with native handlers (rc-only wire field). */
  readonly canOpenPath?: boolean
}

/** Observable Host-description source bound into the drawers' hooks compartment. */
export interface HostDescriptionSource {
  getSnapshot(): HostDescription | undefined
  subscribe(listener: () => void): () => void
}
