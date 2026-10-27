# Agent Note: A running member's card stays at the bottom of the room

Status: implemented

English | [中文](2026-10-27-room-running-card-floats.zh.md)

## Problem

A member's run card is anchored at the moment its run starts. When a member that started first is still working, the replies that land later sit below its card. Its live output then reads as if it had answered first. The human asked for the still-running member's card to read as the latest message.

## Decision

- New presentation-only event `room/run-moved` `{ member, startedAt }`. After a member's reply (`room/speech`) or a human message lands, every member still running except the one that just replied gets one move, in start order.
- The client's run Definition takes a move as an update of the same Context: a running card's `seq` becomes the move's seq. The node's `anchorSeq` is that seq, and the host chat builder re-sorts on an `anchorSeq` change, so the card re-seats below what just landed. Settled cards ignore moves.
- Node identity, terminal edges, replay and the run itself are untouched. The final reply still lands where the run ended, which is the bottom.

## Alternatives considered

**A new node per move, hiding the old one.** Rejected: every terminal `room/run-state` (seven sites) would have to carry the current anchor to reach the moved node.

**A client-side live dock above the composer.** Rejected: a full live card there squeezes the composer, and the order would not survive a reload.

## Consequences

- Each reply or human message adds one small event per running member.
- Question and approval cards do not move running cards, so a card that needs the human's action stays last.
