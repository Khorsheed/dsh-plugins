# Agent Note: the members usage table groups by member id and adds input, cache hit and output beside the total

Status: implemented

## Problem

Room 75844e33: the human renamed the Codex member 顾言 to Susan. The members chip's breakdown then showed two rows, 顾言 (2 rounds) and Susan (1 round), because `memberUsage` grouped execution records by `member`, the name each round ran under. The 用量 column was also one opaque total, while every execution record already carries the billed split (`usage`: input, cache read and write, output).

## Decision

- Rows key on `memberId` (falling back to the name for records without one) and show only the member's current roster name (earlier names are not listed: a member renamed several times needs no special case). The main agent is recognized by its roster kind through the id.
- The 用量 column becomes 总量 and is followed by 输入 (all input, cache reads and writes included), 缓存命中 (the cache-read share of that input, as a percent) and 输出, each summed over the rounds that recorded a split. Records with no split exist only because of past bugs: their split cells read 「—」 while 总量 still shows the total, with no special handling.
- The breakdown widens to 540px and scrolls sideways on a phone instead of overflowing.

## Alternatives considered

- **Drop the total column and span an unsplit row's three cells with its total, marked 「（未拆分）」.** Such rows come only from past bugs; keeping the total column (the human's call) removes the special case, at the cost of a wider table.

## Consequences

A renamed member reads as one member with its whole history. The table shows where each member's tokens went: how much was input, how much of it the cache served, and how much was output.

## Testing

`room`: the usage spec renames a member between its two rounds and expects one row (current name only, rounds 2, split sums). The breakdown renders 剪刀手 without the old name, 10.5K and 86%. A member whose records hold only a total still shows it in the total column.
