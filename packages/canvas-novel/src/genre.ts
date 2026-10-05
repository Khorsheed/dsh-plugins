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
import { NOVEL_GENRE_ID } from './types.ts'

/** One field of a seeded category's card type (the canvas `FieldDef` shape). */
interface GenreField {
  readonly key: string
  readonly label: string
  readonly type: 'line' | 'text' | 'select' | 'tags' | 'ref' | 'number'
  readonly hint: string
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
}

/** A card field value (the canvas `FieldValue` shape). */
export type NovelFieldValue = string | number | string[]

/** The card statuses: proposed is the ghost, kept is on the board, archived is hidden. */
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

/** The fencing session a mutation runs under (the canvas takes the host `Session`). */
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
  putCard(request: {
    readonly canvasId: string
    readonly kind: string
    readonly text: string
    readonly source?: NovelCardSource
    readonly fields?: Readonly<Record<string, NovelFieldValue>>
  }, session: FenceSession): Promise<NovelBoardMutation>
  proposeCard(request: {
    readonly canvasId: string
    readonly kind: string
    readonly text: string
    readonly source?: NovelCardSource
    readonly comment?: string
    readonly fields?: Readonly<Record<string, NovelFieldValue>>
  }, session: FenceSession): Promise<NovelBoardMutation>
  patchCard(request: {
    readonly canvasId: string
    readonly cardId: string
    readonly status?: NovelCardStatus
    readonly fields?: Readonly<Record<string, NovelFieldValue>>
  }, session: FenceSession): Promise<NovelBoardMutation>
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
} as const

/** The agent row that grants the novel tools. */
export const NOVEL_AGENT_ROW = '@khorsheed/dsh-canvas-novel/agent'

/** The kinds a world card can be (类型), the game-codex way: a place, a faction, an item, a rule, history. */
export const WORLD_KINDS: readonly string[] = ['地点', '势力', '道具', '规则', '历史', '其他']

/**
 * The cold-start version. The cards are the single source of truth for what
 * gets injected into writing. A foreshadow card stores only first-hand facts —
 * question, status, planted chapter, answer; dormancy is computed from the
 * mention journal, and tension, a character's where-and-now and the audit
 * trail live in the engine's sidecar — never on the card.
 */
export const NOVEL_GENRE: NovelGenreDefinition = {
  id: NOVEL_GENRE_ID,
  label: '长篇小说',
  version: 'novel@2',
  description: '人物、世界、原则与伏笔做成卡片；章节正文是工作区里的 md 文件，写完一章对一次账。',
  agentRow: NOVEL_AGENT_ROW,
  categories: [
    {
      role: NOVEL_ROLES.character,
      label: '人物',
      definition: {
        version: 1,
        layout: 'profile',
        fields: [
          { key: 'name', label: '名字', type: 'line', hint: '书里怎么称呼他', required: true, face: true },
          { key: 'identity', label: '身份', type: 'line', hint: '一句话：他是谁', face: true },
          { key: 'want', label: '想要', type: 'line', hint: '他在追什么' },
          { key: 'lack', label: '缺失', type: 'line', hint: '他自己没看见的缺口' },
          { key: 'wound', label: '旧伤', type: 'line', hint: '让他成为现在这样的那件事' },
          { key: 'appearance', label: '外貌', type: 'text', hint: '读者第一眼看到的' },
          { key: 'voice', label: '说话方式', type: 'text', hint: '口头禅、语速、用词' },
          { key: 'knows', label: '知道的事', type: 'text', hint: '他已经知道、写他时可以用的事，一行一件' },
          { key: 'unaware', label: '不知道的事', type: 'text', hint: '读者知道而他还不知道的事，一行一件' },
          { key: 'secrets', label: '秘密', type: 'text', hint: '他瞒着别人的事，一行一件' },
          { key: 'relations', label: '关系', type: 'text', hint: '他和其他人物的关系，一行一个人' },
        ],
        example: { name: '老周', identity: '镇上唯一的钟表匠，四十岁', want: '把父亲留下的怀表修好', wound: '十二岁那年父亲没回家' },
      },
    },
    {
      role: NOVEL_ROLES.world,
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
    },
    {
      role: NOVEL_ROLES.principle,
      label: '原则',
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
        version: 1,
        layout: 'entry',
        fields: [
          { key: 'question', label: '悬念', type: 'line', hint: '读者心里的那个问题', required: true, face: true },
          { key: 'status', label: '状态', type: 'select', options: ['未埋', '已埋', '推进中', '已揭晓', '已放弃'], hint: '这条伏笔走到哪一步了', face: true },
          { key: 'plantedAt', label: '埋于第几章', type: 'number', hint: '第一次出现的章号' },
          { key: 'answer', label: '答案', type: 'text', hint: '揭晓时写下谜底' },
        ],
        example: { question: '父亲为什么不回家', status: '已埋', plantedAt: 1 },
      },
    },
  ],
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
