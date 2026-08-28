/**
 * The family-internal live-driver wire between the `local-agent-dsh` provider
 * (parent side) and this bundle's serve mode (the resident sub-dsh). Newline-
 * delimited JSON-RPC 2.0 over the sub-dsh's stdio, framed exactly like the
 * official `JsonRpcLineTransport` (`@deepseek-ai/dsh-sdk-protocol`) so a
 * future swap to the official SDK server stays mechanical. The official
 * server is NOT usable today: its wire has no turn-level interrupt
 * (`initialize` / `session/prompt` / `shutdown` only), and graceful interrupt
 * is the live driver's core win — serve mode drives the in-process
 * `Agent.cancel` instead (upstream seam registry, SDK-wire-interrupt entry).
 *
 * One resident process serves one member (one session). All requests are
 * quick acknowledgements; the turn's events and terminal outcome flow back as
 * notifications, never as the request response, so a long turn never holds a
 * request open.
 * @module @khorsheed/dsh-local-agent-dsh-headless/wire
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Wire contract version; bumped on any incompatible shape change. */
export const LIVE_WIRE_PROTOCOL_VERSION = 1

/** The serve mode's identity, reported by the `initialize` handshake. */
export const LIVE_SERVER_NAME = '@khorsheed/dsh-local-agent-dsh-headless/serve'

/** A wire request (parent → sub-dsh). */
export interface LiveWireRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: string
  readonly params?: Record<string, unknown>
}

/** A wire response (sub-dsh → parent): exactly one of result/error. */
export interface LiveWireResponse {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

/** A wire notification (sub-dsh → parent). */
export interface LiveWireNotification {
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: Record<string, unknown>
}

/** `initialize` result: the handshake proving the channel speaks this wire. */
export interface LiveInitializeResult {
  readonly serverInfo: { readonly name: string }
  readonly protocolVersion: number
}

/** `turn/start` params: drive one turn of the named session. */
export interface LiveTurnStartParams {
  /** Caller-supplied session id (the parent-side child session id). */
  readonly sessionId: string
  /** The turn's prompt text (the family's text-only task contract). */
  readonly text: string
  /** True on a resume round: load the existing session, never create it. */
  readonly resume: boolean
  /**
   * The parent's delegation-round number (fresh = 1, each resume +1). The
   * serve side echoes it on every `session/event` / `session/idle` of this
   * turn, so the parent can drop a cancelled round's late unwind
   * notifications instead of letting them mis-settle the next round.
   */
  readonly turn: number
}

/** `turn/start` result: the turn was accepted; its outcome arrives as `session/idle`. */
export interface LiveTurnStartResult {
  readonly accepted: true
}

/** `turn/interrupt` params: gracefully cancel the named session's active turn. */
export interface LiveTurnInterruptParams {
  readonly sessionId: string
}

/** `turn/interrupt` result: whether the session is loaded in this runtime. */
export interface LiveTurnInterruptResult {
  readonly interrupted: boolean
}

/** The sub-dsh turn's terminal reason, mirrored from its `turn/end` event. */
export type LiveTurnReason = SessionEvent<'turn/end'>['data']['reason']

/** `session/event` notification params: one live session event, in order. */
export interface LiveSessionEventParams {
  readonly sessionId: string
  /**
   * The round this event belongs to (the echo of `turn/start`'s `turn`), or
   * null when the event landed outside any round — the parent mirrors only
   * its own round's events.
   */
  readonly turn: number | null
  readonly event: SessionEvent
}

/**
 * `session/idle` notification params: the session's active turn settled and
 * its session log was flushed to disk, so a file-based reconciliation pass
 * right after this notification sees the complete round.
 */
export interface LiveSessionIdleParams {
  readonly sessionId: string
  /** The round this idle closes (the echo of `turn/start`'s `turn`). */
  readonly turn: number
  /** Null when the owned interval recorded no turn (a broken turn). */
  readonly reason: LiveTurnReason | null
}

/** JSON-RPC error codes this wire uses. */
export const LIVE_WIRE_ERROR_METHOD_NOT_FOUND = -32601
export const LIVE_WIRE_ERROR_INTERNAL = -32603
