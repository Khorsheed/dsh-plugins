# Relation evaluation criteria

[中文](relation-criteria.md)

How a relation card moves from one level to the next comes down to three things:

1. **One score per chapter**: the model only answers "how much closer, or further apart, did these two get in this chapter".
2. **Code banks the points**: the scores accumulate within the current level.
3. **A level-up takes a scene**: once the points are banked, the pair moves up only when the next level's event actually happens in the text, and you review it.

The model never scores a relation's total. Each call cannot see the scale the last one used. If chapter 8 scores 40 and chapter 14 scores 55, there is no telling whether the relation changed or the scale did. A small per-chapter score that code adds up keeps the scale stable.

This standard is the reference the model scores against. The matching constants live in `src/types.ts`:

- the score bands: `RELATION_POINT_SCALE`
- each type's four levels and level-up conditions: `RELATION_LADDERS`
- the points each level needs: `PTS_PER_LEVEL`
- the per-chapter cap: `MAX_RELATION_DELTA`

To change the standard, change the constants first, then bring this document along.

## 1. Scoring each chapter

**Which pairs**: only pairs on the relation list whose two characters both appear in this chapter. A pair with no real exchange in the chapter gets no score.

**How**: one score per pair per chapter, set by the weightiest exchange in the chapter.

| Score | Meaning | Examples |
|---|---|---|
| +2 | A key exchange | entrusting something, saving a life, confessing, taking the fall for the other |
| +1 | A positive exchange | lending a hand, getting along, taking the other's side |
| 0 | No change | not written |
| −1 | Friction | an argument, a concealment found out, disappointment |
| −2 | A serious hurt | betrayal, humiliation, violence (short of a rift) |

**Evidence**: every score carries a quote of at most 50 characters, copied verbatim from this chapter's text. A score whose quote cannot be found in the text is dropped and never reaches the journal.

**Cap**: a score beyond ±2 is recorded as ±2.

## 2. Progress

- **Banking**: once a level has banked **3 points**, the pair is marked 可升 (ready to move up).
- **Range**: progress stays within 0…3. A negative score only takes back progress within the current level and never drops a level; points banked past the full bar do not carry into the next level.
- **Reset**: moving up, a rift, a break, a repair and a type change all reset progress to 0. Editing the stage or type on the card yourself resets it too.

## 3. Moving up

- **Only ready pairs are asked**: when the model reconciles a chapter, it judges only the pairs marked 可升: did the next level's event happen in this chapter? The event is the next level's "level-up condition" in the tables below.
- **Evidence required**: it counts only when it happened and carries a quote. It then goes to review, and the card's stage changes once you adopt it.
- **One level per chapter**: a pair moves up at most one level per chapter and never skips a level.

Each type has four levels, lowest first. A level's "level-up condition" is what has to happen in the text for the pair to reach that level.

**爱情 (romance)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 相遇 | They have dealt with each other face to face and made an impression |
| 2 | 心动 | One starts to care, gets distracted by the other or finds excuses to come close |
| 3 | 动情 | Both show their true feelings or a weak spot, and the other catches it |
| 4 | 相守 | The feeling is spoken aloud, or a promise to be together is made |

**亲情 (family)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 相认 | They learn they are family, or are treated as family |
| 2 | 接纳 | They start treating each other as their own, willing to care or be cared for |
| 3 | 交底 | Old stories or secrets kept from outsiders are told |
| 4 | 认定 | "You are my family" is affirmed, or one pays a price for the other |

**友情 (friendship)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 结识 | They meet and have one proper exchange |
| 2 | 投缘 | They seek each other out, get along, and do things together |
| 3 | 知己 | One confides in the other and is understood |
| 4 | 结义 | They promise to stand together, or one takes a risk for the other |

**师徒 (mentor and student)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 拜见 | They meet, and one shows a skill the other wants to learn |
| 2 | 受教 | Teaching begins, with one concrete lesson |
| 3 | 传承 | The real trump card or core method is handed over, and the student grasps its weight |
| 4 | 出师 | The student achieves something alone, and the mentor approves or lets go |

**对手 (rivals)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 交锋 | One direct clash, and they know who the other is |
| 2 | 较劲 | Each treats the other as the one to beat and prepares against them |
| 3 | 惺惺相惜 | One sees the other's strengths or hardships and comes to respect them |
| 4 | 宿命对决 | Both accept that only they can settle it with each other, heading to a final duel |

**同盟 (allies)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 接触 | They meet over a shared goal and talk terms |
| 2 | 合作 | They get something done together, each taking what they need |
| 3 | 托底 | One steps in when the other is in danger, beyond the terms of the deal |
| 4 | 结盟 | They formally ally or swear a pact, trusting each other with their backs |

**其他 (other)**

| Level | Stage | Level-up condition |
|---|---|---|
| 1 | 相识 | One direct exchange, and they know the other bears on them |
| 2 | 亲近 | One starts to come close or rely on the other, and the other responds |
| 3 | 交心 | One shows a side rarely shown, and the other does not betray it |
| 4 | 确立 | Both settle their place in each other's life, and pay a price or make a promise for it |

## 4. Rifts, breaks and repairs

A rift (裂痕) or a break (决裂) is a change in kind and never goes through points. When reconciling a chapter, the model judges directly whether a rift or break happened, quotes the text, and the item goes to review.

- **Any level**: a rift or break can happen at any level. While in a rift or break, the pair cannot move up.
- **Repair**: a repair returns the pair to the level it held before the rift, with progress starting from 0.
- **Versus −2**: −2 is one serious hurt and only takes back progress; a rift breaks the relation itself, and the stage becomes 裂痕.

## 5. Changing type

A relation may become another kind, say friendship turning into romance. A type change also needs evidence from the text and goes to review.

- **Among 友情, 亲情, 爱情, 师徒, 同盟 and 其他**: the level is kept, with the new type's stage name at that level, e.g. 友情 · 知己 becomes 爱情 · 动情.
- **Into 对手**: the pair must already be in a rift or break, and starts at 对手's first level (交锋).
- **Out of 对手**: starts at the new type's first level.

## 6. How planning uses it

When planning a chapter, the model sees each pair's stage and progress in the writing brief, e.g. 「同盟 · 合作（可升 → 托底：在对方遇险时出手，超出交易的范围）」.

- **Ready to move up**: the brief suggests arranging a key scene in this chapter or one of the next few, so the event in the parentheses happens in the text.
- **Not yet banked**: the brief shows only the progress (e.g. 1/3) and reminds the model not to let the relation jump ahead.

This is the "once the points are in, prompt the model to arrange the key scene" design you approved in the prototype.
