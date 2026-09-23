# Agent Note: Share browser member subscriptions

Status: implemented

## Problem

The isolated Room acceptance page and a member page opened independent persistent Remote streams for configuration, model discovery and live output. Multiple pages exhausted the browser's HTTP/1 same-origin connection pool: history, Room refreshes and message submission waited while already-connected output kept arriving. Closing the duplicate pages immediately released those requests. Per-component subscription sharing did not bound the page's total connections, and several concurrent Room members multiplied the problem.

## Decision

Core exposes one `followMembers` stream for the current set of member/channel pairs. The client multiplexes every configuration, directory and output subscriber in the plugin instance over that connection. Membership changes are batched in a microtask and replace the connection with fresh native baselines. Duplicate consumers share the channel; disposing the last consumer releases it.

Server fan-in keeps one outstanding pull per source. A quiet or failed directory/control source cannot block another member's output. Client delivery coalesces configuration snapshots and output suffixes instead of retaining token-event queues. New local output consumers receive a complete active baseline, never an isolated suffix. Existing single-channel Remote methods remain available for compatibility.

## Alternatives considered

**Document a one-tab restriction.** Rejected because opening a member's own conversation is an existing supported workflow.

**One connection per member.** Rejected because a Room can render several running members simultaneously and still exhaust the pool.

**Require HTTP/2 or a host transport rewrite.** This may improve the general host limit, but is unnecessary for bounding this plugin's own subscriptions and would violate the no-host-edit development scope.

## Consequences

A browser page uses one persistent member feed regardless of member count. The host's other transports still consume connections, so this is not an unlimited-tab guarantee. Changing the visible set reconnects with baselines and may briefly repeat a current snapshot; consumers already use revisions and native identities to avoid duplicating content.

Tests cover eight members with all three channels sharing one connection, slow-consumer suffix coalescing, late-consumer baselines, membership cancellation, disposal, isolated source errors and a silent source alongside active output. Real multi-page and latency acceptance remain required.
