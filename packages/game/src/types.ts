/**
 * Wire and storage shapes shared by the host half, the Remote face and the
 * browser half. Pure types and constants — no node imports, so the client
 * type program includes this file as-is.
 * @module @khorsheed/dsh-game/types
 */

/** The project manifest's file name, at the project root. */
import type { KitRef } from './kits/types.ts'

export const MANIFEST_FILE = 'game.json'

/** The plugin's own directory inside a project (snapshots, check results, logs). */
export const STATE_DIR = '.game'

/** One art style the gate accepts: a stable id, its label, a one-line look and its palette. */
export interface ArtStyle {
  readonly id: string
  readonly label: string
  readonly look: string
  /** The style's palette: element looks and the pixel editor draw from it. */
  readonly palette: readonly string[]
}

/**
 * The example styles the user picks from (decision D10). Without image
 * generation the game draws everything in code, so each style is one a
 * canvas/HTML game can render faithfully; `custom:<text>` covers the rest.
 */
export const ART_STYLES: readonly ArtStyle[] = [
  {
    id: 'pixel', label: '像素', look: '16×16 / 32×32 像素块，有限调色板，整数倍放大不糊',
    palette: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
      '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
  },
  {
    id: 'flat', label: '扁平矢量', look: '纯色几何形，圆角，少量阴影，配色明快',
    palette: ['#264653', '#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#e76f51', '#fefae0', '#3d405b'],
  },
  {
    id: 'line', label: '手绘线稿', look: '黑色描线 + 淡彩填充，线条略抖',
    palette: ['#222222', '#f7f3e8', '#f2c6c2', '#c9e4de', '#c6def1', '#faedcb', '#dbcdf0', '#8a8a8a'],
  },
  {
    id: 'neon', label: '霓虹几何', look: '深色底，发光的线框与粒子',
    palette: ['#0d0221', '#261447', '#ff3864', '#2de2e6', '#f6019d', '#fdf500', '#7b2cbf', '#ffffff'],
  },
  {
    id: 'paper', label: '剪纸拼贴', look: '纸张纹理色块，轻微投影，层叠感',
    palette: ['#f2e8cf', '#e0c9a6', '#bc4749', '#6a994e', '#386641', '#a7c957', '#3d348b', '#5c4033'],
  },
  {
    id: 'mono', label: '极简单色', look: '一种主色加黑白，靠形状和留白区分',
    palette: ['#111111', '#f5f5f5', '#e63946', '#9a9a9a', '#5a5a5a', '#d0d0d0'],
  },
]

/**
 * The 3D example styles (the 3d-three kit, proposal 2026-10-21-game-3d G8):
 * toon shading with an ink outline over a paper ground. The ids are what
 * `dsh3d.createWorld({ style })` takes.
 */
export const ART_STYLES_3D: readonly ArtStyle[] = [
  {
    id: 'ink', label: '水墨', look: '低多边形 + 墨线描边 + 宣纸底与远雾，留白多',
    palette: ['#2a2622', '#efe7d6', '#e9dfcc', '#b8442f', '#8f897b', '#4c5747', '#a7bab4', '#46698a'],
  },
  {
    id: 'qinglv', label: '青绿山水', look: '石青石绿的山、赭色描边、暖纸底，色块鲜明',
    palette: ['#4f3b28', '#f1e8cf', '#3c8a78', '#3a6f93', '#d9d9b0', '#2c6a57', '#77a9bb', '#b8442f'],
  },
]

/**
 * A 3D project's rendering style as data (`game.json` `style3d`): the model
 * writes it from the user's own description; `preset` names the built-in
 * starting point (`ink` / `qinglv`) the other keys override. dsh3d applies
 * it at `createWorld`.
 */
export interface Style3D {
  readonly preset?: string
  readonly bg?: string
  readonly ground?: string
  readonly ground2?: string
  readonly water?: string
  readonly outline?: string
  /** Outline thickness in world units; 0 turns the ink line off. */
  readonly outlineWidth?: number
  /** Toon shading bands (2 = hard cel, 5 = soft). */
  readonly shades?: number
  /** Fog start and end distance. */
  readonly fog?: readonly [number, number]
  /** Sun intensity. */
  readonly light?: number
  /** The sun casts shadows (game-wide; off unless set). */
  readonly shadows?: boolean
  /**
   * Per-scene overrides, keyed by the game's own scene names (dsh3d
   * `enterScene(name)`): background, ground colors, water, fog and light.
   * Shading bands and the outline stay global.
   */
  readonly scenes?: Readonly<Record<string, SceneStyle3D>>
}

/** What one scene may override in `style3d`. */
export interface SceneStyle3D {
  readonly bg?: string
  readonly ground?: string
  readonly ground2?: string
  readonly water?: string
  readonly fog?: readonly [number, number]
  readonly light?: number
}

/** The project manifest (`game.json`). Everything but id/title is the agent's to fill over time. */
export interface GameManifest {
  readonly schema: 1
  readonly id: string
  readonly title: string
  /** The one-pager's core: what the player does and why it is fun, in a sentence or two. */
  readonly pitch: string
  /** Element categories the game has (角色 / 敌人 / 道具 …); element files declare one of these. */
  readonly elementTypes: readonly string[]
  /** An {@link ART_STYLES} id, or `custom:<description>`. */
  readonly artStyle: string
  /** Design pillars, pinned at the top of the design doc. */
  readonly pillars: readonly string[]
  /** Passing candidates deploy into the play area without a click (default on, decision D6). */
  readonly autoConfirm: boolean
  /** The tunable numbers the 试玩 drawer shows; `value` is the finalized default. */
  readonly params: readonly GameParam[]
  /** The palette element looks draw from (the style's, unless the agent set its own). */
  readonly palette: readonly string[]
  readonly createdAt: string
  /** The runtime kit the project is pinned to; absent = `2d-canvas` v1 (projects made before kits). */
  readonly runtime?: KitRef
  /** 3D projects: the rendering style as data (see {@link Style3D}). */
  readonly style3d?: Style3D
}

/** One tunable number (`game.json` `params[]`); the game reads it from `window.dshParams[key]` every frame. */
export interface GameParam {
  readonly key: string
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly unit?: string
}

/**
 * An element's appearance (`look` in an element file): pixel rows per
 * state. Each row is a string; `.` is transparent, `0-9a-z` index the
 * look's own `palette` (base 36).
 */
export interface ElementLook {
  readonly palette: readonly string[]
  readonly states: Readonly<Record<string, readonly string[]>>
}

/** Body archetypes a `parts3d` look builds on. */
export const BODY_BASES = ['quadruped', 'bird', 'fish', 'serpent', 'humanoid'] as const
export type BodyBase = typeof BODY_BASES[number]

/** Built-in parts a `parts3d` look can attach; a project can register more with `dsh3d.definePart`. */
export const PART_TYPES = ['ear', 'horn', 'tail', 'wing', 'fin', 'eye', 'face'] as const
export type PartType = typeof PART_TYPES[number]

/** One part of a `parts3d` look; sizes are in body units (body length ≈ 1). */
export interface PartSpec {
  readonly type: PartType | (string & {})
  readonly count?: number
  readonly size?: number
  readonly length?: number
  /** Spread of a multi-part fan (tails, wings), degrees. */
  readonly fan?: number
  readonly thickness?: number
  /** A `palette` key or a `#rrggbb` color. */
  readonly color?: string
  /** `face` only: `human` gives a human face. */
  readonly style?: string
  /** A project-defined part's own parameters (anything beyond the shared keys). */
  readonly extra?: Readonly<Record<string, number | string>>
}

/** One procedural motion: amplitude (degrees, or a fraction for breath/bob) and period (seconds). */
export interface MotionSpec {
  readonly amplitude?: number
  readonly period?: number
}

/**
 * A 3D look built from a parts recipe: a body archetype, its proportions,
 * attached parts, a named palette and procedural motions. The 3d-three kit's
 * `dsh3d.build` turns it into a model; bodies and parts are an open set (a
 * project registers its own with `defineBase` / `definePart`).
 */
export interface Parts3DLook {
  readonly kind: 'parts3d'
  /** A built-in {@link BodyBase} or a body the project registers with `dsh3d.defineBase`. */
  readonly base: BodyBase | (string & {})
  readonly proportions: Readonly<Record<string, number>>
  readonly parts: readonly PartSpec[]
  /** Named colors: `body`, `accent`, `eye`, `belly`… */
  readonly palette: Readonly<Record<string, string>>
  /** `tailSway`, `breath`, `flap`, `swim`, `bob`. */
  readonly motion: Readonly<Record<string, MotionSpec>>
  /** Overall size in world units (default 1). */
  readonly scale?: number
  /** Refine-path (Blender) knobs; ignored by the live builder. */
  readonly refine?: Readonly<Record<string, number>>
}

/** A 3D look loaded from a project glTF file; `recipe` keeps the parts it was baked from. */
export interface GltfLook {
  readonly kind: 'gltf'
  /** Project-relative path to a `.glb` / `.gltf`. */
  readonly src: string
  readonly scale?: number
  /** `toon` (default): the style's toon shading over the model's colors, vertex colors and textures; `original`: its own materials. */
  readonly material?: 'toon' | 'original'
  /** Ink outline around the model (default: on with toon, off with original). */
  readonly outline?: boolean
  /** The clip that plays on its own (default: one named idle / 待机 / stand, else the first). */
  readonly animation?: string
  readonly recipe?: Parts3DLook
}

/** Any 3D look. */
export type Look3D = Parts3DLook | GltfLook

/** Any look a kit may accept: 2D pixel rows or a 3D look. */
export type AnyLook = ElementLook | Look3D

/** Whether a look is the 2D pixel-row kind. */
export function isPixelLook(look: AnyLook): look is ElementLook {
  return !('kind' in look)
}

/** The characters a look row may use, in palette-index order. */
export const LOOK_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** One design-doc chapter. `generated` chapters are written by the plugin, never by hand. */
export interface ChapterSpec {
  readonly id: string
  readonly title: string
  readonly file: string
  readonly generated?: boolean
}

/** The chaptered design doc (decision D12): fixed chapters, pillars pinned first. */
export const CHAPTERS: readonly ChapterSpec[] = [
  { id: 'pillars', title: '支柱说明', file: 'design/pillars.md' },
  { id: 'core-loop', title: '核心循环', file: 'design/core-loop.md' },
  { id: 'mechanics', title: '机制与规则', file: 'design/mechanics.md' },
  { id: 'lore', title: '元素设定', file: 'design/lore.md', generated: true },
  { id: 'elements', title: '元素与数值', file: 'design/elements.md', generated: true },
  { id: 'levels', title: '关卡与节奏', file: 'design/levels.md' },
  { id: 'art-audio', title: '美术与音效', file: 'design/art-audio.md' },
  { id: 'playtest', title: '试玩记录', file: 'design/playtest.md', generated: true },
]

/** A chapter's state: nothing yet, being written, or marked final with a `状态：定稿` line. */
export type ChapterStatus = 'todo' | 'draft' | 'done'

/** One chapter as the panel shows it. */
export interface ChapterView {
  readonly id: string
  readonly title: string
  readonly file: string
  readonly status: ChapterStatus
  readonly text: string
  readonly generated: boolean
  /** Last-modified time (ms) of the chapter's source, 0 when unknown. */
  readonly mtime: number
}

/** One element file (`elements/*.json`) after validation. */
export interface ElementView {
  readonly file: string
  /** Position inside the file when it holds an array, else -1. */
  readonly index: number
  readonly id: string
  readonly type: string
  readonly name: string
  /** Every other top-level scalar, for the numbers table and the field editor. */
  readonly stats: Readonly<Record<string, string | number | boolean>>
  /** The 2D pixel look, if the element has one. */
  readonly look: ElementLook | null
  /** The 3D look, if the element has one (3d-three projects). */
  readonly look3d: Look3D | null
  /** The 设定 text (the element's `lore` field): who it is, its temper, how it meets the player. '' when unwritten. */
  readonly lore: string
}

/** Longest 设定 the panel saves. */
export const LORE_MAX = 2000

/** What 提交为新版本 did. */
export type CommitResult =
  | { readonly ok: true; readonly kind: 'deployed' | 'candidate'; readonly version: number }
  | { readonly ok: true; readonly kind: 'failed'; readonly failures: readonly { readonly where: string; readonly message: string }[] }
  | { readonly ok: true; readonly kind: 'unchanged' | 'no-entry' }

/** One appearance proposal set from `game_propose`: up to 3 variants, the user picks one. */
export interface LookProposal {
  readonly elementId: string
  readonly at: string
  readonly request: string
  readonly variants: readonly { readonly label: string; readonly note: string; readonly look: AnyLook }[]
  /** Index the user picked, once picked. */
  readonly picked?: number
}

/**
 * The opening of the message the panel writes into the composer for its
 * changes (「写进对话」). The pre-step hook recognizes a sent message by it and
 * clears exactly the changes the message lists.
 */
export const PANEL_CHANGES_MARK = '【面板改动】'

/** One net change the user made in the panel and has not yet sent to the agent. */
export interface PendingChange {
  /** Stable key so repeated edits of one thing collapse into one entry (`param:speed`, `look:fog`, `design:core-loop`). */
  readonly key: string
  /** Short label for the dock and the model (`参数 移动速度 1.4→1.8`). */
  readonly text: string
}

/** One check failure, already worded for the model and the panel. */
export interface CheckFailure {
  /** `smoke`, `data`, or the test file's project-relative path. */
  readonly where: string
  readonly message: string
}

/** One check run's result, persisted at `.game/checks.json`. */
export interface CheckRecord {
  readonly fingerprint: string
  readonly at: string
  readonly ok: boolean
  readonly failures: readonly CheckFailure[]
  /** Test cases that ran and passed. */
  readonly passed: number
  /** Why the browser part did not run (no Chrome found, say); the data part still did. */
  readonly skipped?: string
  /** The automatic fix round this run belongs to (1-based), 0 when not steered. */
  readonly attempt: number
  /** Set when the fix cap was hit and the plugin stopped steering. */
  readonly gaveUp?: boolean
}

/** A deployed (or candidate) version. */
export interface VersionRecord {
  readonly version: number
  readonly at: string
  readonly fingerprint: string
  /** Who cut it: the user (检查并发版 / 提交), the agent (\`game_publish\`), or the end-of-turn check. Absent on older versions. */
  readonly by?: VersionSource
  /** One line about what changed (the turn's last words, or the plugin's own note). */
  readonly note?: string
}

/** Who cut a version. */
export type VersionSource = 'user' | 'agent' | 'turn'

/** What the working files hold that the play area does not (the panel's 有新改动还没进游戏 bar). */
export interface WorkingChanges {
  /** The version compared against (the waiting candidate, else the live one); null before any. */
  readonly against: number | null
  readonly hasEntry: boolean
  /** Build files added, changed or removed (first 30 of \`count\`). */
  readonly count: number
  readonly files: readonly { readonly path: string; readonly kind: 'added' | 'changed' | 'removed' }[]
  /** The newest change's time. */
  readonly lastAt: string | null
  /** Someone is still writing: a bound session's turn is running, or a file changed in the last 20 s. */
  readonly busy: 'turn' | 'recent' | null
  /** The panel edits among them. */
  readonly edits: readonly PendingChange[]
  /** The last check ran after the newest change and failed: its findings. */
  readonly failed: readonly { readonly where: string; readonly message: string }[] | null
}

/** A version's place in the history. */
export type VersionStatus = 'current' | 'candidate' | 'rejected' | 'past'

/** One row of the 版本 view. */
export interface VersionRow extends VersionRecord {
  readonly status: VersionStatus
  /** Test cases that passed when this version was checked. */
  readonly passed?: number
}

/** Files that differ between two versions. */
export interface VersionDiff {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly changed: readonly string[]
}

/** One playtest-log line. */
export interface LogEntry {
  readonly at: string
  readonly text: string
}

/** A project row in the deployment-level registry. */
export interface ProjectRow {
  readonly id: string
  readonly title: string
  readonly root: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** What one agent turn changed in the bound project (the turn-tail card). */
export interface TurnReport {
  readonly turn: number
  readonly projectId: string
  readonly title: string
  readonly at: string
  /** A version that became live (or a candidate) during the turn. */
  readonly version: { readonly kind: 'deployed' | 'candidate'; readonly version: number } | null
  /** The turn's end-of-turn check, when one ran. */
  readonly check: { readonly ok: boolean; readonly fixes: number; readonly gaveUp: boolean; readonly passed: number; readonly failures: number } | null
  readonly elements: readonly {
    readonly id: string
    readonly name: string
    readonly what: 'new' | 'removed' | 'look' | 'fields'
    readonly fields?: readonly string[]
    /** 3D looks before and after the turn (JSON), for the card's side-by-side previews. */
    readonly looks?: { readonly before: string | null; readonly after: string }
  }[]
  readonly chapters: readonly { readonly id: string; readonly title: string }[]
  readonly params: readonly { readonly key: string; readonly label: string; readonly from?: number; readonly to: number }[]
  /** Other changed source files (code, assets, index.html). */
  readonly code: readonly string[]
  readonly tests: readonly string[]
}

/** One project as the switcher shows it. */
export interface ProjectCard {
  readonly id: string
  readonly title: string
  readonly root: string
  readonly updatedAt: string
  readonly pitch: string
  readonly artStyle: string
  readonly version: number | null
  readonly elements: number
  /** The last check's screenshot (webp, base64), when there is one. */
  readonly thumb?: string
}

/** The panel's view of one project. */
export interface ProjectView {
  readonly id: string
  readonly title: string
  readonly root: string
  readonly manifest: GameManifest | null
  /** Why the manifest could not be read, when it could not. */
  readonly manifestError?: string
  readonly chapters: readonly ChapterView[]
  readonly elements: readonly ElementView[]
  readonly elementErrors: readonly CheckFailure[]
  readonly current: VersionRecord | null
  readonly candidate: VersionRecord | null
  readonly lastCheck: CheckRecord | null
  readonly hasEntry: boolean
  /** The user's slider values that differ from the finalized defaults. */
  readonly paramOverrides: Readonly<Record<string, number>>
  /** Panel changes the agent has not read yet (`game_read` shows, then clears them). */
  readonly pending: readonly PendingChange[]
  /** Panel edits in the working files that no version carries yet — the panel's 提交为新版本. */
  readonly uncommitted: readonly PendingChange[]
  /** Open (unpicked) and recent appearance proposals, newest first. */
  readonly proposals: readonly LookProposal[]
  readonly versions: readonly VersionRow[]
  readonly log: readonly LogEntry[]
  /** Set while a style change waits for its candidate (decision: a restyle always goes through a candidate). */
  readonly restyleTo?: string
  /** What the waiting candidate changed against the live version, by element id (the play area's diff rings). */
  readonly candidateDiff: { readonly changed: readonly string[]; readonly added: readonly string[] } | null
}

/** What the tab needs to render a session: its bound project (if any) plus the list to pick from. */
export interface SessionGameState {
  readonly bound: ProjectView | null
  readonly projects: readonly ProjectRow[]
}

/** One file of a playable bundle: text as-is, binary as base64. */
export type BundleFile =
  | { readonly type: string; readonly text: string }
  | { readonly type: string; readonly b64: string }

/** A deployed version's files, ready for the sandbox loader. */
export interface PlayBundle {
  readonly projectId: string
  readonly version: number
  readonly files: Readonly<Record<string, BundleFile>>
}

/** Failure codes the Remote face answers with. */
export type GameError = 'not-found' | 'unbound' | 'denied' | 'invalid' | 'no-version' | 'io'
  /** Project deletion: the folder no longer holds this project's game.json / is the session's own workspace / the trash move failed. */
  | 'not-a-project' | 'is-workspace' | 'trash-failed'

/** A project deletion's answer: done (with where the folder went), or a failure; a failed trash move says why. */
export type DeleteProjectResult =
  | { readonly ok: true; readonly trashedTo?: string }
  | { readonly ok: false; readonly error: GameError; readonly reason?: string }

/** A Remote call's failure. */
export interface GameFailure {
  readonly ok: false
  readonly error: GameError
}

/** A Remote mutation's answer: `T` (which carries `ok: true`) or a failure. */
export type GameResult<T extends { readonly ok: true } = { readonly ok: true }> = T | GameFailure

/** Minimal mirror of the official pluginInventory snapshot (entries + preset groups). */
export interface GamePluginInventorySnapshot {
  readonly entries?: readonly { readonly moduleName: string; readonly enabled?: boolean }[]
  readonly agentPresets?: readonly {
    readonly id: string
    readonly broken?: string
    readonly rows: readonly { readonly moduleName: string; readonly enabled?: boolean }[]
  }[]
}
