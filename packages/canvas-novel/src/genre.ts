/**
 * The long-novel genre (长篇小说) as the canvas sees it: the definition this
 * package registers with `ctx.canvasBoard`, and the narrow slice of the canvas
 * service the engine reads through.
 *
 * The slice is structural on purpose: the canvas is probed, never imported
 * (`pnpm check:plugins` keeps plugins free of cross-package edges), and a
 * deployment without the canvas simply has no novel works — every engine verb
 * answers `missing` and nothing throws.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import { NOVEL_GENRE_ID, NOVEL_IDEAS_FACE, NOVEL_PLAN_FACE, NOVEL_STORY_FACE, RELATION_TYPES } from './types.ts'

/** One field of a seeded category's card type (the canvas `FieldDef` shape). */
interface GenreField {
  readonly key: string
  readonly label: string
  readonly type: 'line' | 'text' | 'select' | 'tags' | 'ref' | 'number'
  readonly hint: string
  /** A ref field's target: a category's role (the canvas matches it against each category's id or role). */
  readonly refKind?: string
  readonly options?: readonly string[]
  readonly required?: boolean
  readonly face?: boolean
}

/** One role category the genre seeds (the canvas `GenreCategorySeed` shape). */
export interface NovelCategorySeed {
  readonly role: string
  readonly label: string
  readonly definition?: {
    readonly version: number
    readonly layout: 'note' | 'profile' | 'entry'
    readonly fields: readonly GenreField[]
    readonly guide?: string
    readonly example: Readonly<Record<string, string | number | string[]>>
  }
}

/** The genre definition (the canvas `CanvasGenreDefinition` shape). */
export interface NovelGenreDefinition {
  readonly id: string
  readonly label: string
  readonly version: string
  readonly description: string
  readonly categories: readonly NovelCategorySeed[]
  readonly agentRow: string
  /** The chapters are this canvas's 成稿: the canvas renders the genre's chapter book there. */
  readonly ownsManuscripts: true
  /**
   * The top faces read 规划 · 章节 · 设定 · 故事: the outline as the lead
   * face (keyed `novel:plan`), the book, the cards, and the story log as the
   * genre's own face (keyed `novel:story`).
   */
  readonly faces: { readonly view: string; readonly lead: string; readonly extra?: string }
  /** canvas_read / canvas_write hand the role categories and the chapters to the engine. */
  readonly agent?: NovelGenreAgent
}

/** One card write handed over by canvas_write (the canvas `CanvasGenreCardWrite` shape). */
export interface NovelCardWrite {
  readonly canvasId: string
  readonly kind?: string
  readonly cardId?: string
  readonly fields?: Readonly<Record<string, unknown>>
  readonly text?: string
  readonly comment?: string
}

/** The genre's hooks into the canvas tools (the canvas `CanvasGenreAgent` shape); undefined = not the genre's, generic handling. */
export interface NovelGenreAgent {
  cardLines(request: { readonly canvasId: string; readonly kind?: string; readonly includeArchived: boolean }, session: FenceSession): Promise<readonly string[]>
  cardDetail(request: { readonly canvasId: string; readonly cardId: string }, session: FenceSession): Promise<string | undefined>
  writeCard(request: NovelCardWrite, session: FenceSession): Promise<string | undefined>
  resolveCard(request: { readonly canvasId: string; readonly token: string }, session: FenceSession): Promise<string | undefined>
  manuscripts(request: { readonly canvasId: string }): Promise<string>
  readonly manuscriptGuide: string
}

/** A card field value (the canvas `FieldValue` shape). */
export type NovelFieldValue = string | number | string[]

/** The card statuses: proposed awaits the user's ✓ (canvas-native proposals only), kept is on the board, archived is hidden. */
export type NovelCardStatus = 'proposed' | 'kept' | 'archived'

/** Where a card came from (the canvas `BoardCardSource` shape). */
export interface NovelCardSource {
  readonly type: 'url' | 'file' | 'paste'
  readonly ref: string
  readonly title?: string
}

/** One card as the engine reads it. */
export interface NovelCardView {
  readonly id: string
  readonly kind: string
  readonly text: string
  readonly status: NovelCardStatus
  readonly fields?: Readonly<Record<string, NovelFieldValue>>
  readonly source?: NovelCardSource
  readonly comments: readonly { readonly author: 'user' | 'agent'; readonly text: string }[]
  readonly createdBy: 'user' | 'agent'
}

/** One category as the engine reads it: the role is how a genre row is found. */
export interface NovelCategoryView {
  readonly id: string
  readonly role?: string
}

/** The board as the engine reads it: identity, title, workspaces, genre, cards. */
export interface NovelBoardView {
  readonly id: string
  readonly title: string
  readonly attachedWorkspaces: readonly string[]
  readonly genre?: { readonly id: string }
  readonly categories: readonly NovelCategoryView[]
  readonly cards: readonly NovelCardView[]
}

/** A card mutation's outcome: the fresh board, or the canvas failure code. */
export type NovelBoardMutation =
  | { readonly ok: true; readonly board: NovelBoardView }
  | { readonly ok: false; readonly error: string }

/** The fencing session a mutation runs under (the canvas takes the host `Session`); `undefined` means the caller carries none and the canvas's own default resolution applies. */
type FenceSession = object

/** The slice of `ctx.canvasBoard` the engine uses. */
export interface CanvasBoardSlice {
  readBoard(request: { readonly canvasId: string }): Promise<NovelBoardMutation>
  boundCanvasId(sessionId: string): Promise<string | undefined>
  listCanvases(): Promise<{
    readonly items: readonly { readonly id: string; readonly title: string; readonly archivedAt: string | null; readonly genre?: string }[]
  }>
  bindSession(request: { readonly canvasId: string | null }, session: FenceSession): Promise<
    { readonly ok: true; readonly canvasId: string | null } | { readonly ok: false; readonly error: string }
  >
  registerGenre(definition: NovelGenreDefinition): () => void
  proposeCard(request: {
    readonly canvasId: string
    readonly kind: string
    readonly text: string
    readonly source?: NovelCardSource
    readonly comment?: string
    readonly fields?: Readonly<Record<string, NovelFieldValue>>
    /** Kept at once and marked new (✦) on the board, instead of a proposal awaiting ✓. */
    readonly live?: boolean
  }, session: FenceSession | undefined): Promise<NovelBoardMutation>
  patchCard(request: {
    readonly canvasId: string
    readonly cardId: string
    /** Refile the card under another category (整理设定). */
    readonly kind?: string
    readonly status?: NovelCardStatus
    readonly fields?: Readonly<Record<string, NovelFieldValue>>
  }, session: FenceSession | undefined): Promise<NovelBoardMutation>
  /**
   * Attach a workspace (optional: a canvas from before 2026-10-09 lacks it,
   * and the engine then reports `no-workspace` as it always did).
   */
  setWorkspace?(request: { readonly canvasId: string; readonly workspace: string; readonly attached: boolean }, session: FenceSession): Promise<NovelBoardMutation>
  /** Rewrite the category catalog (整理设定 switches the emptied old 世界 category off); optional — absent on canvases without it. */
  setCategories?(request: { readonly canvasId: string; readonly categories: readonly Record<string, unknown>[] }, session: FenceSession): Promise<NovelBoardMutation>
  addComment(request: {
    readonly canvasId: string
    readonly cardId: string
    readonly text: string
    readonly author?: 'user' | 'agent'
  }, session: FenceSession): Promise<NovelBoardMutation>
}

/** The roles the engine looks its categories up by (a renamed label keeps its role). */
export const NOVEL_ROLES = {
  character: 'character',
  world: 'world',
  principle: 'principle',
  foreshadow: 'foreshadow',
  relation: 'relation',
} as const

/** The agent row that grants the novel tools. */
export const NOVEL_AGENT_ROW = '@khorsheed/dsh-canvas-novel/agent'

/** The kinds a world card can be (类型), the game-codex way: a place, a faction, an item, a rule, history. */
export const WORLD_KINDS: readonly string[] = ['地点', '势力', '道具', '规则', '历史', '其他']

/**
 * The four 世界观 categories (novel@5, 2026-11-01). The engine reads them all
 * as settings (EntryRole `world`); the sort says which shelf a card sits on.
 * A board from before keeps its old 世界 category until it is reorganized.
 */
export const SETTING_SORTS = { system: '体系', place: '地点', faction: '势力', item: '物种与道具' } as const
export type SettingSort = keyof typeof SETTING_SORTS
export const SETTING_SORT_KEYS = Object.keys(SETTING_SORTS) as SettingSort[]

/** The shelf an old 世界 card's 类型 belongs on (规则/历史/其他 are rules until the timeline takes history). */
export function sortOfWorldKind(kind: string | undefined): SettingSort {
  if (kind === '地点') return 'place'
  if (kind === '势力') return 'faction'
  if (kind === '道具' || kind === '物种') return 'item'
  return 'system'
}

/** The sort a word names: a shelf's key or label (体系、地点、势力、物种与道具、道具), or undefined. */
export function settingSortOf(word: string | undefined): SettingSort | undefined {
  const text = word?.trim()
  if (text === undefined || text === '') return undefined
  if ((SETTING_SORT_KEYS as string[]).includes(text)) return text as SettingSort
  const hit = SETTING_SORT_KEYS.find(key => SETTING_SORTS[key] === text)
  if (hit !== undefined) return hit
  if (text === '道具' || text === '物种' || text === '生物') return 'item'
  if (text === '规则' || text === '世界' || text === '历史' || text === '组织') return text === '组织' ? 'faction' : 'system'
  return undefined
}

/** A 世界观 category's fields: a name, the setting itself, where it sits (its parent shelf entry). */
function settingFields(text: { readonly rule: string; readonly ruleHint: string; readonly parent: string; readonly parentHint: string }, sort: SettingSort): GenreField[] {
  return [
    { key: 'name', label: '名称', type: 'line', hint: '叫什么', required: true, face: true },
    { key: 'rule', label: text.rule, type: 'text', hint: text.ruleHint, required: true, face: true },
    { key: 'parent', label: text.parent, type: 'ref', refKind: sort, hint: text.parentHint },
  ]
}

/** The old 世界 card type (boards from before novel@5): what the engine still reads and writes on them. */
export const LEGACY_WORLD_SEED: NovelCategorySeed = {
  role: 'world',
  label: '世界',
  definition: {
    version: 2,
    layout: 'entry',
    fields: [
      { key: 'name', label: '名称', type: 'line', hint: '这条设定叫什么：一个地点、一件道具、一条规则的名字', required: true, face: true },
      { key: 'kind', label: '类型', type: 'select', options: WORLD_KINDS, hint: '它是哪一类设定', face: true },
      { key: 'rule', label: '设定', type: 'text', hint: '具体的设定，能复述、能照着写', required: true, face: true },
    ],
    example: { name: '镇上的钟', kind: '规则', rule: '雨季里镇上的钟会慢半小时，没人知道为什么' },
  },
}

/**
 * The cold-start version. The cards are the single source of truth for what
 * gets injected into writing. A foreshadow card stores only first-hand facts —
 * question, status, planted chapter, answer; dormancy is computed from the
 * mention journal, and the user's star, a character's where-and-now and the
 * card evidence live in the engine's sidecar — never on the card. A pair of
 * characters is one relation card (novel@3); a character's 关系 is read off
 * those cards, so the character card no longer carries a typed field for it.
 */
export const NOVEL_GENRE: NovelGenreDefinition = {
  id: NOVEL_GENRE_ID,
  label: '长篇小说',
  version: 'novel@5',
  description: '人物、世界观（体系、地点、势力、物种与道具）、伏笔、关系与写作原则做成卡片；章节正文是工作区里的 md 文件，写完一章对一次账。',
  agentRow: NOVEL_AGENT_ROW,
  ownsManuscripts: true,
  faces: { view: NOVEL_STORY_FACE, lead: NOVEL_PLAN_FACE, extra: NOVEL_IDEAS_FACE },
  categories: [
    {
      role: NOVEL_ROLES.character,
      label: '人物',
      definition: {
        version: 3,
        layout: 'profile',
        fields: [
          { key: 'name', label: '名字', type: 'line', hint: '书里怎么称呼他', required: true, face: true },
          { key: 'identity', label: '身份', type: 'line', hint: '一句话：他是谁', face: true },
          { key: 'want', label: '想要', type: 'line', hint: '他在追什么' },
          { key: 'lack', label: '缺失', type: 'line', hint: '他自己没看见的缺口' },
          { key: 'wound', label: '旧伤', type: 'line', hint: '让他成为现在这样的那件事' },
          { key: 'ambition', label: '抱负', type: 'line', hint: '这个故事之外，他想过成什么样的一生' },
          { key: 'values', label: '价值观', type: 'line', hint: '他坚持什么、绝不做什么' },
          { key: 'appearance', label: '外貌', type: 'text', hint: '读者第一眼看到的' },
          { key: 'voice', label: '说话方式', type: 'text', hint: '口头禅、语速、用词' },
          { key: 'knows', label: '知道的事', type: 'text', hint: '他已经知道、写他时可以用的事，一行一件' },
          { key: 'unaware', label: '不知道的事', type: 'text', hint: '读者知道而他还不知道的事，一行一件' },
          { key: 'secrets', label: '秘密', type: 'text', hint: '他瞒着别人的事，一行一件' },
          { key: 'faction', label: '所属势力', type: 'ref', refKind: 'faction', hint: '他属于哪个组织、门派、阵营' },
          { key: 'home', label: '常在地点', type: 'ref', refKind: 'place', hint: '他平时待在哪里' },
        ],
        example: { name: '老周', identity: '镇上唯一的钟表匠，四十岁', want: '把父亲留下的怀表修好', wound: '十二岁那年父亲没回家' },
      },
    },
    {
      role: 'system',
      label: SETTING_SORTS.system,
      definition: {
        version: 1,
        layout: 'entry',
        fields: settingFields({ rule: '设定', ruleHint: '这条规则或这套体系怎么运作，能复述、能照着写', parent: '上级体系', parentHint: '它是哪套体系里的一条（可空）' }, 'system'),
        example: { name: '命名', rule: '为失稳者起名，能让它获得暂时稳定的形体' },
      },
    },
    {
      role: 'place',
      label: SETTING_SORTS.place,
      definition: {
        version: 1,
        layout: 'entry',
        fields: settingFields({ rule: '描述', ruleHint: '这里是什么样、有什么规矩', parent: '属于', parentHint: '它在哪个更大的地方里（可空）' }, 'place'),
        example: { name: '无水井', rule: '镇民在井边祈愿，井底偶尔亮起一点光' },
      },
    },
    {
      role: 'faction',
      label: SETTING_SORTS.faction,
      definition: {
        version: 1,
        layout: 'entry',
        fields: [
          ...settingFields({ rule: '描述', ruleHint: '这是个什么组织、想要什么、怎么行事', parent: '上级势力', parentHint: '它隶属于哪个更大的势力（可空）' }, 'faction'),
          { key: 'base', label: '据点', type: 'ref', refKind: 'place', hint: '它的据点在哪里' },
        ],
        example: { name: '睡眠公司', rule: 'DreamWaver 的运营方，以稳定和安全为名标记异常' },
      },
    },
    {
      role: 'item',
      label: SETTING_SORTS.item,
      definition: {
        version: 1,
        layout: 'entry',
        fields: settingFields({ rule: '描述', ruleHint: '它是什么、有什么用、有什么规矩', parent: '所在', parentHint: '它在哪里出现或属于谁（可空）' }, 'item'),
        example: { name: '黑玉令', rule: '公司配发的工作终端，在山海以朱砂小字显示悬赏' },
      },
    },
    {
      role: NOVEL_ROLES.principle,
      label: '写作原则',
      definition: {
        version: 1,
        layout: 'entry',
        fields: [
          { key: 'principle', label: '原则', type: 'text', hint: '写这部书时始终遵守的一条', required: true, face: true },
        ],
        example: { principle: '不写全知视角，读者只知道主角知道的' },
      },
    },
    {
      role: NOVEL_ROLES.foreshadow,
      label: '伏笔',
      definition: {
        version: 2,
        layout: 'entry',
        fields: [
          { key: 'question', label: '悬念', type: 'line', hint: '读者心里的那个问题', required: true, face: true },
          { key: 'status', label: '状态', type: 'select', options: ['未埋', '已埋', '推进中', '已揭晓', '已放弃'], hint: '整理章节时按正文自动更新；不再用这条伏笔时手动选「已放弃」', face: true },
          { key: 'plantedAt', label: '埋于第几章', type: 'number', hint: '第一次出现的章号' },
          { key: 'reveal', label: '揭晓时机', type: 'line', hint: '本章内，或在哪一卷揭晓：卷二、卷三、终局' },
          { key: 'answer', label: '答案', type: 'text', hint: '揭晓时写下谜底' },
        ],
        example: { question: '父亲为什么不回家', status: '已埋', plantedAt: 1 },
      },
    },
    {
      role: NOVEL_ROLES.relation,
      label: '关系',
      definition: {
        version: 1,
        layout: 'entry',
        fields: [
          { key: 'name', label: '名称', type: 'line', hint: '两人的名字，如「老周 × 小满」', required: true, face: true },
          { key: 'pair', label: '双方', type: 'ref', hint: '这段关系的两个人物' },
          { key: 'type', label: '类型', type: 'select', options: RELATION_TYPES, hint: '两人是什么关系', required: true, face: true },
          { key: 'stage', label: '阶段', type: 'line', hint: '这一类型的四个阶段之一（如爱情：相遇 / 心动 / 动情 / 相守），或「裂痕」「决裂」；升级由整理章节提出、你采纳', face: true },
          { key: 'now', label: '现状', type: 'line', hint: '一句话：两人眼下处在什么状态', face: true },
          { key: 'views', label: '各自怎么看', type: 'text', hint: '可选，一行一方：谁怎么看对方' },
        ],
        example: { name: '老周 × 小满', type: '师徒', stage: '受教', now: '小满偷偷在学修表，老周装作没看见' },
      },
    },
  ],
}

/**
 * The fields a card of an engine role takes. A setting (role \`world\`) takes
 * the union of every 世界观 shelf and the old 世界 type: name, 设定, 类型 (old
 * boards), parent and 据点 — which shelf it sits on is its category, not a field.
 * @param role - the engine role (or a category role).
 */
export function fieldDefsOf(role: string): readonly GenreField[] {
  if (role === 'world') {
    const faction = NOVEL_GENRE.categories.find(row => row.role === 'faction')?.definition?.fields ?? []
    const legacy = LEGACY_WORLD_SEED.definition!.fields
    return [...legacy, ...faction.filter(field => !legacy.some(known => known.key === field.key)).map(field => ({ ...field, label: field.key === 'parent' ? '属于' : field.label }))]
  }
  return NOVEL_GENRE.categories.find(row => row.role === role)?.definition?.fields ?? []
}

/**
 * Probe the canvas service on a context (absent → undefined, never a throw).
 * @param ctx - any context that can reach the profile's services.
 * @returns the slice, or undefined when the canvas is not mounted.
 */
export function canvasBoardOf(ctx: { get(name: string): unknown }): CanvasBoardSlice | undefined {
  try {
    return ctx.get('canvasBoard') as CanvasBoardSlice | undefined
  } catch {
    return undefined
  }
}
