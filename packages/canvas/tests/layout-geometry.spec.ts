/**
 * The link view's geometry, judged against numbers rather than screenshots: lane
 * membership on the center point, the dominant-axis control push (including the
 * 24-unit floor that keeps near neighbours curved), the marquee normalized from
 * all four drag directions, and the three clamps a lane drag answers to — the
 * title band, the stage, and the cards it carries.
 *
 * Each rule is one a person can disagree with after moving one card, so each is
 * pinned to the exact edge it turns on here: whether a touch counts as covered,
 * whether a center on the border counts as held, which axis a 45° pair reads as,
 * and where a group that no longer fits gets pinned. A corner drag carries
 * nothing on purpose — that is a lane MOVE's rule, not a resize's.
 */
import { describe, expect, it } from 'vitest'
import {
  LANE_MIN_Y, MARQUEE_CLICK_THRESHOLD, MIN_LANE,
  clampInside, dragLane, groupOf, isLinked, isMarqueeClick, laneAt, laneHolds, marqueeHits,
  marqueeRect, rectsOverlap, resizeLane, wirePathOf,
  type LaneRect, type LinkPair, type PlacedCard, type Rect, type Size,
} from '../src/client/space/layout-geometry.ts'

/** The prototype's card box: the sizes the view measures, handed in as numbers. */
const CARD_W = 152
const CARD_H = 60
/** A stage nobody has to scroll on. */
const STAGE: Size = { w: 1000, h: 600 }

/** A card parked with its top-left at (x, y). */
const card = (id: string, x: number, y: number): PlacedCard => ({ id, x, y, w: CARD_W, h: CARD_H })
/** A box by its four edges, so the expected numbers read like the assertion's name. */
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

/* ── 「顺线扩一圈」的那块板 ─────────────────────────────────── */
const CHAIN: Record<string, PlacedCard> = {
  p1: card('p1', 0, 0), // 中心 76,30
  p2: card('p2', 0, 200), // 中心 76,230
  p3: card('p3', 0, 400), // 中心 76,430
  q1: card('q1', 200, 0), // p1 的同区邻居，一条线都没有
  q2: card('q2', 200, 200), // p2 的同区邻居，而 p2 只是被线带进来的
  r1: card('r1', 400, 0), // p1 的另一位邻居，但它自己有条线通向场外
  s1: card('s1', 400, 400), // 只跟 r1 连着，落在任何分区之外
}
const LOOKUP = (id: string): PlacedCard | undefined => CHAIN[id]
/** 板上每一张卡的 id，就是视图该传给 pool 的那一份。 */
const POOL: string[] = ['p1', 'p2', 'p3', 'q1', 'q2', 'r1', 's1']
const LANES: LaneRect[] = [
  { id: 'LA', x: 0, y: 0, w: 600, h: 100 }, // 装 p1 / q1 / r1
  { id: 'LB', x: 0, y: 200, w: 600, h: 100 }, // 装 p2 / q2
]
const LINKS: LinkPair[] = [
  { from: 'p1', to: 'p2' },
  { from: 'p2', to: 'p3' },
  { from: 'r1', to: 's1' },
]

describe('isLinked', () => {
  it('认得同一条线的两个方向', () => {
    expect(isLinked(LINKS, 'p1', 'p2')).toBe(true)
    expect(isLinked(LINKS, 'p2', 'p1')).toBe(true)
  })

  it('一张卡连到自己不算线，哪怕文件里真写了这么一行', () => {
    expect(isLinked([{ from: 'p1', to: 'p1' }], 'p1', 'p1')).toBe(false)
  })

  it('没连过的两张就是没连过', () => {
    expect(isLinked(LINKS, 'q1', 'q2')).toBe(false)
    expect(isLinked([], 'p1', 'p2')).toBe(false)
  })
})

describe('wirePathOf', () => {
  it('左右一对：两个端点就是两张卡的中心', () => {
    expect(wirePathOf(card('a', 0, 0), card('b', 200, 0))).toBe('M 76 30 C 176 30, 176 30, 276 30')
  })

  it('反过来的一对：外推换个符号，线型照旧不打结', () => {
    expect(wirePathOf(card('b', 200, 0), card('a', 0, 0))).toBe('M 276 30 C 176 30, 176 30, 76 30')
  })

  it('贴得太近的一对：外推有 24 的地板，所以线是鼓的而不是压成一条直缝', () => {
    expect(wirePathOf(card('a', 0, 0), card('d', 40, 0))).toBe('M 76 30 C 100 30, 92 30, 116 30')
    expect(wirePathOf(card('d', 40, 0), card('a', 0, 0))).toBe('M 116 30 C 92 30, 100 30, 76 30')
  })

  it('上下一对：走纵轴，横的不推', () => {
    expect(wirePathOf(card('a', 0, 0), card('f', 10, 200))).toBe('M 76 30 C 76 130, 86 130, 86 230')
  })

  it('正好四十五度的一对按横向读，因为那才是板子的流向', () => {
    expect(wirePathOf(card('a', 0, 0), card('h', 60, 60))).toBe('M 76 30 C 106 30, 106 90, 136 90')
  })

  it('不管朝向哪边，起始终点是两头的中心', () => {
    const numbers = wirePathOf(card('f', 10, 200), card('a', 0, 0))
      .match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(numbers.slice(0, 2)).toEqual([86, 230])
    expect(numbers.slice(-2)).toEqual([76, 30])
  })
})

describe('laneHolds / laneAt', () => {
  const LANE = rect(0, 0, 100, 100)

  it('按中心判：压进来一大半但中心在外面的不归它', () => {
    expect(laneHolds(LANE, card('overhang', 80, 20))).toBe(false)
  })

  it('中心正好落在边线上算在里面：resize 追上来那一刻不该把卡弹出去', () => {
    expect(laneHolds(LANE, { id: 'flush', x: 24, y: 70, w: CARD_W, h: CARD_H })).toBe(true)
  })

  it('中心在框里的当然归它', () => {
    expect(laneHolds(LANE, { id: 'in', x: 10, y: 10, w: 20, h: 20 })).toBe(true)
  })

  it('两个分区叠着时先到先得，答案得稳定', () => {
    const placed = card('a', 0, 0)
    expect(laneAt(LANES, placed)?.id).toBe('LA')
    expect(laneAt([{ id: 'ZZ', ...LANE }, ...LANES], placed)?.id).toBe('ZZ')
  })

  it('不在任何分区里就是 undefined，不是抛', () => {
    expect(laneAt(LANES, card('loose', 0, 500))).toBeUndefined()
  })
})

describe('rectsOverlap', () => {
  it('真占了同一块地才算', () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(99, 99, 100, 100))).toBe(true)
  })

  it('挑明了：只边线相切不算——看不见的覆盖不该选中', () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false)
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(0, 100, 50, 50))).toBe(false)
  })

  it('整张被包住也算，各在一边不算', () => {
    expect(rectsOverlap(rect(0, 0, 400, 400), rect(10, 10, 20, 20))).toBe(true)
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(500, 500, 10, 10))).toBe(false)
  })
})

describe('marqueeRect', () => {
  const BOX = rect(10, 20, 40, 60)

  it('四个拖拽方向归一成同一个框', () => {
    expect(marqueeRect(10, 20, 50, 80)).toEqual(BOX)
    expect(marqueeRect(50, 80, 10, 20)).toEqual(BOX)
    expect(marqueeRect(10, 80, 50, 20)).toEqual(BOX)
    expect(marqueeRect(50, 20, 10, 80)).toEqual(BOX)
  })

  it('原地点下就是一个零尺的框', () => {
    expect(marqueeRect(7, 9, 7, 9)).toEqual(rect(7, 9, 0, 0))
  })
})

describe('isMarqueeClick', () => {
  it('两个维度都不到门槛才算点一下', () => {
    expect(isMarqueeClick(rect(0, 0, 7, 7))).toBe(true)
    expect(isMarqueeClick(rect(0, 0, 0, 0))).toBe(true)
  })

  it('7×9 不算点：只要有一维拉够了，就是一次认真的框选', () => {
    expect(isMarqueeClick(rect(0, 0, 7, 9))).toBe(false)
    expect(isMarqueeClick(rect(0, 0, 9, 7))).toBe(false)
  })

  it('门槛本身是「不到」，不是「不到等于」', () => {
    expect(MARQUEE_CLICK_THRESHOLD).toBe(8)
    expect(isMarqueeClick(rect(0, 0, 8, 8))).toBe(false)
  })
})

describe('rectsOverlap', () => {
  it('两个方向的问法给同一个答案：这条规则是对称的', () => {
    const band = rect(200, 0, 210, 210)
    const node = rect(300, 60, 180, 60)
    expect(rectsOverlap(band, node)).toBe(true)
    expect(rectsOverlap(node, band)).toBe(true)
  })

  it('压在顶边之上的扁框，抓不到落在它下面的卡', () => {
    // 框高 3、卡的顶在 y 14：把卡自己的高度当成框的高度去加就会说抓到了。
    // 这一条钉的是「哪一个 h 参与比较」，MARQUEE 那批夹具全都在 y=0 同高，
    // 恰好让那次笔误一个测试都惊不动。
    expect(rectsOverlap(rect(0, 0, 210, 3), rect(14, 14, CARD_W, CARD_H))).toBe(false)
    expect(rectsOverlap(rect(14, 14, CARD_W, CARD_H), rect(0, 0, 210, 3))).toBe(false)
  })
})

describe('marqueeHits', () => {
  const CARDS = [card('a', 0, 0), card('b', 200, 0), card('c', 400, 0)]

  it('框住的按板上的顺序交出来', () => {
    expect(marqueeHits(marqueeRect(0, 0, 250, 60), CARDS)).toEqual(['a', 'b'])
  })

  it('边只擦到卡的边，就一张都不抓', () => {
    expect(marqueeHits(rect(0, 0, 200, 60), CARDS)).toEqual(['a'])
    expect(marqueeHits(rect(600, 600, 20, 20), CARDS)).toEqual([])
  })
})

describe('clampInside', () => {
  it('把跑出去的按最近的那条边拽回来，尺寸不动', () => {
    expect(clampInside(rect(-40, 20, 100, 50), STAGE)).toEqual(rect(0, 20, 100, 50))
    expect(clampInside(rect(1200, 690, 100, 50), STAGE)).toEqual(rect(900, 550, 100, 50))
  })

  it('比舞台还大的东西钉在左上角，而不是在两条已经交叉的界之间发抖', () => {
    expect(clampInside(rect(50, 50, 1400, 900), STAGE)).toEqual(rect(0, 0, 1400, 900))
  })
})

describe('dragLane', () => {
  const LANE: LaneRect = { id: 'L1', x: 100, y: 100, w: 340, h: 200 }
  const INSIDE = card('a', 120, 120)
  /** 看着压在分区右边线上（x 从 400 起），中心却在 476——分区宽到 440 为止。 */
  const OUTSIDE = card('b', 400, 120)

  it('分区带着里面的一起走，外面那张不动', () => {
    const moved = dragLane(LANE, [INSIDE, OUTSIDE], 50, -10, STAGE)
    expect(moved.lane).toEqual({ id: 'L1', x: 150, y: 90, w: 340, h: 200 })
    expect(moved.cards).toEqual([{ id: 'a', x: 170, y: 110 }])
  })

  it('挪不动的时候一张卡都不报，省得调用方以为全场都动了', () => {
    const still = dragLane(LANE, [INSIDE], 0, 0, STAGE)
    expect(still.cards).toEqual([])
    expect(still.lane).toEqual(LANE)
  })

  it('往上顶到极限时，标题条还留在视线里', () => {
    const top: LaneRect = { id: 'T', x: 10, y: 30, w: 200, h: 120 }
    const moved = dragLane(top, [], 0, -100, STAGE)
    expect(moved.lane.y).toBe(LANE_MIN_Y)
    expect(moved.lane.x).toBe(10)
  })

  it('分区自己先撞墙就整个停下，卡一张都不必报', () => {
    const edge: LaneRect = { id: 'R', x: 900, y: 100, w: 100, h: 100 }
    const blocked = dragLane(edge, [], 500, 0, STAGE)
    expect(blocked.lane).toEqual(edge)
    expect(blocked.cards).toEqual([])
  })

  it('里面的卡先撞墙时整组一起停在那儿，谁也别想撕开谁', () => {
    const tight: Size = { w: 300, h: 600 }
    const lane: LaneRect = { id: 'G', x: 0, y: 100, w: 200, h: 200 }
    const moved = dragLane(lane, [card('a', 120, 120)], 90, 0, tight)
    expect(moved.lane.x).toBe(28)
    expect(moved.cards).toEqual([{ id: 'a', x: 148, y: 120 }])
  })

  it('入参一个字节都不动：冻结的卡照样拖', () => {
    const lane = Object.freeze({ id: 'P', x: 100, y: 100, w: 340, h: 200 })
    const cards = Object.freeze([Object.freeze(card('a', 120, 120)), Object.freeze(OUTSIDE)])
    const before = JSON.stringify({ lane, cards })
    dragLane(lane, cards, 50, -10, STAGE)
    expect(JSON.stringify({ lane, cards })).toBe(before)
  })
})

describe('resizeLane', () => {
  const LANE: LaneRect = { id: 'L', x: 10, y: 100, w: 200, h: 200 }

  it('角往里拉过头，就停在最小分区', () => {
    expect(resizeLane(LANE, [], -500, -500, STAGE)).toEqual({
      id: 'L', x: 10, y: 100, w: MIN_LANE.w, h: MIN_LANE.h,
    })
  })

  it('角往外拉过头，就停在舞台还剩的那点地方', () => {
    const grown = resizeLane(LANE, [], 5000, 5000, STAGE)
    expect(grown.w).toBe(STAGE.w - LANE.x)
    expect(grown.h).toBe(STAGE.h - LANE.y)
  })

  it('装不下的时候按小的那边留，跟夹子的取向一致', () => {
    const tall: LaneRect = { id: 'T', x: 0, y: 550, w: 200, h: 100 }
    const squeezed = resizeLane(tall, [], 0, -10, { w: 800, h: 600 })
    expect(squeezed.h).toBe(MIN_LANE.h)
    expect(squeezed.w).toBe(200)
  })

  it('只交回一个矩形：拉伸从不搬卡，归属是调用方重读的事', () => {
    const out = resizeLane(LANE, [card('a', 120, 120)], 10, 10, STAGE)
    expect(Object.keys(out).sort()).toEqual(['h', 'id', 'w', 'x', 'y'])
    expect(out).toEqual({ id: 'L', x: 10, y: 100, w: 210, h: 210 })
  })
})

describe('groupOf', () => {
  it('顺线是可传递的：两条线以外的邻居照样带进来', () => {
    const group = groupOf(['p1'], LINKS, LANES, LOOKUP)
    expect(group.seeds).toEqual(['p1'])
    expect(group.viaLine).toEqual(['p2', 'p3'])
  })

  it('同分区只走一跳：种子的邻居进来，被线带进来的那位不配带人', () => {
    const group = groupOf(['p1'], LINKS, LANES, LOOKUP, POOL)
    expect(group.viaLane).toEqual(['q1', 'r1'])
    expect(group.viaLane).not.toContain('q2')
    expect(group.ids).toEqual(['p1', 'p2', 'p3', 'q1', 'r1'])
  })

  it('不给候选池时，只能从线已经点过名的 id 里找邻居', () => {
    const group = groupOf(['p1'], LINKS, LANES, LOOKUP)
    expect(group.viaLane).toEqual(['r1'])
  })

  it('认不出的种子丢掉，跟归档卡一个待遇', () => {
    const group = groupOf(['ghost', 'p1'], LINKS, LANES, LOOKUP, POOL)
    expect(group.seeds).toEqual(['p1'])
  })

  it('重复点同一张只算一个种子', () => {
    const group = groupOf(['p1', 'p1'], LINKS, LANES, LOOKUP, POOL)
    expect(group.seeds).toEqual(['p1'])
    expect(new Set(group.ids).size).toBe(group.ids.length)
  })

  it('已经是种子的邻居不会被当成带进来的', () => {
    const group = groupOf(['p1', 'q1'], LINKS, LANES, LOOKUP, POOL)
    expect(group.viaLane).toEqual(['r1'])
    expect(group.ids).toEqual(['p1', 'q1', 'p2', 'p3', 'r1'])
  })

  it('种子不在任何分区里时，一条 lane 边都不长', () => {
    const group = groupOf(['p3'], LINKS, LANES, LOOKUP, POOL)
    expect(group.viaLane).toEqual([])
    // 逆着线的方向也是可传递的：先 p2（挨着 p3 的那头），再 p1。
    expect(group.viaLine).toEqual(['p2', 'p1'])
  })

  it('线指向一张不存在的卡时，那半条线作废，也接不通后面', () => {
    const ghosts: LinkPair[] = [{ from: 'p1', to: 'ghost' }, { from: 'ghost', to: 'p3' }]
    const group = groupOf(['p1'], ghosts, LANES, LOOKUP, POOL)
    expect(group.viaLine).toEqual([])
    expect(group.viaLane).toEqual(['q1', 'r1'])
    expect(group.ids).toEqual(['p1', 'q1', 'r1'])
  })

  it('一个种子都不剩时交回空组，不抛', () => {
    expect(groupOf([], LINKS, LANES, LOOKUP, POOL)).toEqual({
      seeds: [], viaLine: [], viaLane: [], ids: [],
    })
  })
})
