/**
 * The《梦境监护者》seed: one work with canon rules, a principle, a
 * canvas-native proposed card (never in the brief), the three-chapter foreshadow ledger (plus one resolved with its
 * answer), two characters with their experience journal, five extracted
 * chapters with recaps and manuscripts, and the sixth chapter in planning
 * with its plan — the CP1 brief fixture (proposal §9's acceptance data:
 * 赵启明/艾文/门缝伏笔/蓝色叶子). The settings are canvas cards
 * (`dreamCards`, served by tests/fake-canvas.ts); the engine's sidecar and
 * journals are files (`seedDreamKeeper`). Dates are fixed so the brief
 * snapshots are deterministic.
 */
import { join } from 'node:path'
import type { NovelCardView } from '../src/genre.ts'
import type { FakeFs } from './fake-fs.ts'

/** The seeded work's coordinates (the work is the canvas `workId`; tests/fake-canvas.ts serves its board). */
export const DREAM = {
  workId: 'canvas_dream0001',
  title: '梦境监护者',
  workspace: '/home/user/workspace',
  stateRoot: '/dsh/state/novel',
  createdAt: '2026-10-01T09:00:00.000Z',
} as const

/** The seeded card ids (real canvas ids are `c_<…>`, never a `c<n>` ref). */
export const CARD = {
  trueName: 'c_trueName',
  leafCarrier: 'c_leafCarrier',
  openEnding: 'c_openEnding',
  dreamLayers: 'c_dreamLayers',
  towerShadow: 'c_towerShadow',
  doorGap: 'c_doorGap',
  leafGlow: 'c_leafGlow',
  formerKeeper: 'c_formerKeeper',
  zhao: 'c_zhao',
  aiwen: 'c_aiwen',
} as const

/** The seeded cards, in board order. */
export function dreamCards(): NovelCardView[] {
  const card = (id: string, role: string, status: NovelCardView['status'], fields: NovelCardView['fields'], createdBy: 'user' | 'agent' = 'user'): NovelCardView => ({
    id, kind: `cat_${role}`, text: '', status, fields, comments: [], createdBy,
  })
  return [
    card(CARD.trueName, 'world', 'kept', { rule: '监护者不能在梦里说出自己的真名——真名是锚，说出即被梦主锁定。' }),
    card(CARD.leafCarrier, 'world', 'kept', { rule: '蓝色叶子是梦主意识碎片的载体；叶子发光，说明梦主开始苏醒。' }),
    card(CARD.openEnding, 'principle', 'kept', { principle: '每章结尾留一个未解的画面，不在章内合拢。' }),
    card(CARD.dreamLayers, 'world', 'proposed', { rule: '梦境有层数，越深越接近梦主的伤口。' }, 'agent'),
    card(CARD.towerShadow, 'foreshadow', 'kept', { question: '钟楼为什么没有影子', status: '已揭晓', plantedAt: 1, answer: '钟楼立在两层梦之间，影子落在了下一层。' }),
    card(CARD.doorGap, 'foreshadow', 'kept', { question: '门缝里的东西', status: '推进中', plantedAt: 1 }),
    card(CARD.leafGlow, 'foreshadow', 'kept', { question: '蓝色叶子为什么发光', status: '推进中', plantedAt: 2 }),
    card(CARD.formerKeeper, 'foreshadow', 'kept', { question: '失踪的前任监护者是谁', status: '已埋', plantedAt: 1 }),
    card(CARD.zhao, 'character', 'kept', {
      name: '赵启明', identity: '梦境监护者新人',
      want: '找到失踪的前任监护者', lack: '他不记得自己的童年梦', wound: '妹妹走失于一场白日梦，他至今自责',
      appearance: '二十七八，总带着一本牛皮封面的《监护守则》', voice: '说话简短，引用守则条文时会先报编号',
      knows: '监护守则的全部条文\n二层梦的基本规则',
      unaware: '门缝里有什么\n蓝色叶子的来历\n艾文的真实身份',
      secrets: '他在梦里见过走失的妹妹',
      relations: '艾文：从戒备到勉强信任的引路关系（第4章二层梦脱险后升温）',
    }),
    card(CARD.aiwen, 'character', 'kept', {
      name: '艾文', identity: '活了三百年的梦引者',
      want: '引导梦主苏醒', lack: '他无法离开梦境',
      appearance: '看不出年纪，袖口永远别着一片蓝色叶子', voice: '自称「在下」，从不说谎但也从不把话说完',
      knows: '蓝色叶子的来历\n门后空间的结构',
      unaware: '赵启明妹妹的下落',
      secrets: '他就是失踪的前任监护者',
    }),
  ]
}

/** Chapter 5's manuscript — the extract tests' evidence source. */
export const CHAPTER_5_BODY = `赵启明在档案室待到后半夜。

半页守则上的字迹很淡，像被橡皮擦过一遍又重写：门后不回答问题。他把这句话读了三遍，门缝后的敲击声变成了明确的三下，停一停，又是三下，像某种耐心的呼吸。

艾文靠在书架旁，袖口的蓝叶在靠近门缝时亮得刺眼。「在下什么都没说。」他说。但他第一次没有拦赵启明。

赵启明想起妹妹走失那天，也是这样的光。他伸手，指尖碰到门缝的边缘，门后传来一个女人的声音，哼着不成调的摇篮曲。

艾文第一次没有自称「在下」。「门后冷。」他只是说，「握着叶子。」

门缝里飘出一片蓝色的叶子，落在赵启明掌心，微微发烫，像一句还没来得及说出口的回答。`

/** The whole《梦境监护者》store, planted. @param ch5Phase - the state chapter 5 seeds with (planning + its manuscript file = the writing state). */
export function seedDreamKeeper(fs: FakeFs, options: { ch5Phase?: 'extracted' | 'reviewed' | 'planning' } = {}): void {
  const dir = join(DREAM.stateRoot, DREAM.workId)
  const stamp = (day: number): string => `2026-10-0${day}T20:00:00.000Z`

  const annotations = {
    version: 1,
    refs: {
      [CARD.trueName]: 1, [CARD.leafCarrier]: 2, [CARD.openEnding]: 4, [CARD.dreamLayers]: 6,
      [CARD.towerShadow]: 9, [CARD.doorGap]: 12, [CARD.leafGlow]: 15, [CARD.formerKeeper]: 18,
      [CARD.zhao]: 1, [CARD.aiwen]: 2,
    },
    notes: {
      [CARD.dreamLayers]: { evidenceInText: '二层梦里的时间比外面慢' },
      [CARD.formerKeeper]: { starred: true },
      [CARD.zhao]: { currentState: { where: '档案室门外走廊', state: '刚经历二层梦脱险，心跳未平', concern: '妹妹的下落' } },
      [CARD.aiwen]: { currentState: { where: '档案室', state: '从容，似乎早有安排', concern: '梦主苏醒的节奏' } },
    },
  }
  fs.seed(join(dir, 'annotations.json'), `${JSON.stringify(annotations, null, 2)}\n`)

  const experiences = [
    { characterId: CARD.aiwen, chapter: 2, entry: '递给赵启明一片蓝色叶子，只说是「护身符」', createdAt: stamp(2) },
    { characterId: CARD.zhao, chapter: 3, entry: '在档案室发现前任监护者留下的半页守则', createdAt: stamp(2) },
    { characterId: CARD.zhao, chapter: 4, entry: '首次独自进入二层梦，迷失后被艾文救下', createdAt: stamp(3) },
    { characterId: CARD.aiwen, chapter: 4, entry: '在二层梦边缘接住赵启明，袖口的蓝叶亮了一下', createdAt: stamp(3) },
    { characterId: CARD.zhao, chapter: 5, entry: '按半页守则的指引找到档案室的门缝，决定一探究竟', createdAt: stamp(4) },
    { characterId: CARD.aiwen, chapter: 5, entry: '默认了门缝的存在，提醒赵启明「门后不回答问题」', createdAt: stamp(4) },
  ]
  fs.seed(join(dir, 'experiences.jsonl'), experiences.map(entry => JSON.stringify(entry)).join('\n') + '\n')

  const mentions = [
    { foreshadowId: CARD.doorGap, chapter: 1, kind: 'planted', planned: false, createdAt: stamp(1) },
    { foreshadowId: CARD.leafGlow, chapter: 2, kind: 'hinted', planned: true, createdAt: stamp(2) },
    { foreshadowId: CARD.doorGap, chapter: 3, kind: 'advanced', planned: true, createdAt: stamp(3) },
    { foreshadowId: CARD.towerShadow, chapter: 4, kind: 'resolved', planned: true, createdAt: stamp(3) },
  ]
  fs.seed(join(dir, 'mentions.jsonl'), mentions.map(entry => JSON.stringify(entry)).join('\n') + '\n')

  const plan5 = {
    summary: '赵启明按半页守则在档案室找到门缝，犹豫要不要推开；艾文劝他先等，叶子却先亮了。',
    beats: [
      { at: '深夜', text: '赵启明照守则数钟声，在档案室墙角找到门缝' },
      { text: '艾文劝他先别推，说门后不回答问题', mark: '转折' },
      { text: '门缝里飘出一片蓝色叶子，他决定推门', mark: '落点' },
    ],
    conflict: '赵启明想知道门后是什么，艾文想拖住他',
    highlight: '守则的第一次应验',
    foreshadowOps: [{ op: '推进', id: CARD.doorGap, note: '门缝第一次被找到' }, { op: '暗示', id: CARD.leafGlow, note: '叶子在门边发亮' }],
    cast: [{ who: CARD.zhao, role: '找门、决定推门' }, { who: CARD.aiwen, role: '劝阻' }],
    pov: CARD.zhao, hook: '门缝里飘出一片蓝色叶子',
  }
  const plan6 = {
    summary: '赵启明跟着艾文穿过门缝，看清门后空间的第一层。',
    beats: [
      { text: '两人穿过门缝，门后是倒置的档案室' },
      { text: '门后传来妹妹的声音', mark: '落点' },
    ],
    foreshadowOps: [{ op: '推进', id: CARD.doorGap, note: '门后第一层' }, { op: '暗示', id: CARD.leafGlow }],
    cast: [{ who: CARD.zhao }, { who: CARD.aiwen, role: '带路' }],
    pov: CARD.zhao, hook: '门后传来妹妹的声音',
  }
  const chapters = [
    { n: 1, seq: 1, title: '入职', file: '第1章.md', phase: 'extracted', recap: '赵启明入职梦境监护所，领到《监护守则》。值夜第一晚，他听见墙内传来敲击，发现档案室的钟楼没有影子。', wordCount: 2800, sessionIds: ['s-seed'], createdAt: stamp(1), updatedAt: stamp(1) },
    { n: 2, seq: 2, title: '蓝叶', file: '第2章.md', phase: 'extracted', recap: '艾文出现，自称梦引者，递给赵启明一片蓝色叶子当「护身符」。夜里，叶子第一次发光。', wordCount: 3100, sessionIds: ['s-seed'], createdAt: stamp(1), updatedAt: stamp(2) },
    { n: 3, seq: 3, title: '半页守则', file: '第3章.md', phase: 'extracted', recap: '赵启明在档案室发现前任监护者留下的半页守则，门缝后的敲击变成明确的三下。守则末尾写着：门后不回答问题。', wordCount: 3300, sessionIds: ['s-seed'], createdAt: stamp(2), updatedAt: stamp(3) },
    { n: 4, seq: 4, title: '二层梦', file: '第4章.md', phase: 'extracted', recap: '赵启明独自进入二层梦差点迷失，被艾文救回。钟楼没有影子的谜底揭开：它立在两层梦之间。赵启明开始怀疑艾文不只是引者。', wordCount: 3600, sessionIds: ['s-seed'], createdAt: stamp(3), updatedAt: stamp(4) },
    { n: 5, seq: 5, title: '门缝', file: '第5章.md', phase: options.ch5Phase ?? 'extracted', plan: plan5, recap: '赵启明按半页守则找到档案室的门缝。门后传来哼摇篮曲的女声。他决定推门，门缝里飘出一片蓝色的叶子。', wordCount: 3200, sessionIds: ['s-seed'], createdAt: stamp(4), updatedAt: stamp(5) },
    { n: 6, seq: 6, title: '门后', file: '第6章.md', phase: 'planning', plan: plan6, sessionIds: ['s-seed'], createdAt: stamp(5), updatedAt: stamp(5) },
  ]
  fs.seed(join(dir, 'chapters.json'), `${JSON.stringify({ version: 1, chapters }, null, 2)}\n`)

  fs.seed(join(dir, 'pending.json'), `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`)

  const bodyDir = join(DREAM.workspace, DREAM.title)
  fs.seed(join(bodyDir, '第1章.md'), '赵启明入职那天，监护所的钟没有影子。\n\n（第 1 章正文略。）\n')
  fs.seed(join(bodyDir, '第2章.md'), '艾文把蓝色叶子递过来的时候，什么都没解释。\n\n（第 2 章正文略。）\n')
  fs.seed(join(bodyDir, '第3章.md'), '半页守则夹在《监护守则》的封皮里，像一句被撕掉的警告。\n\n（第 3 章正文略。）\n')
  fs.seed(join(bodyDir, '第4章.md'), '二层梦的边缘没有路，只有一层叠一层的、别人的昨天。\n\n（第 4 章正文略。）\n')
  fs.seed(join(bodyDir, '第5章.md'), `${CHAPTER_5_BODY}\n`)
}
