/**
 * Wire and storage shapes shared by the host half, the Remote face and the
 * browser half. Pure types and constants — no node imports, so the client
 * type program includes this file as-is.
 * @module @khorsheed/dsh-game/types
 */

/** The project manifest's file name, at the project root. */
export const MANIFEST_FILE = 'game.json'

/** The plugin's own directory inside a project (snapshots, check results, logs). */
export const STATE_DIR = '.game'

/** One art style the gate accepts: a stable id, its label and a one-line look. */
export interface ArtStyle {
  readonly id: string
  readonly label: string
  readonly look: string
}

/**
 * The example styles the user picks from (decision D10). Without image
 * generation the game draws everything in code, so each style is one a
 * canvas/HTML game can render faithfully; `custom:<text>` covers the rest.
 */
export const ART_STYLES: readonly ArtStyle[] = [
  { id: 'pixel', label: '像素', look: '16×16 / 32×32 像素块，有限调色板，整数倍放大不糊' },
  { id: 'flat', label: '扁平矢量', look: '纯色几何形，圆角，少量阴影，配色明快' },
  { id: 'line', label: '手绘线稿', look: '黑色描线 + 淡彩填充，线条略抖' },
  { id: 'neon', label: '霓虹几何', look: '深色底，发光的线框与粒子' },
  { id: 'paper', label: '剪纸拼贴', look: '纸张纹理色块，轻微投影，层叠感' },
  { id: 'mono', label: '极简单色', look: '一种主色加黑白，靠形状和留白区分' },
]

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
  readonly createdAt: string
}

/** One design-doc chapter. `generated` chapters are written by the plugin, never by hand. */
export interface ChapterSpec {
  readonly id: string
  readonly title: string
  readonly file: string
  readonly generated?: boolean
}

/** The chaptered design doc (decision D12): fixed chapters, pillars pinned first. */
export const CHAPTERS: readonly ChapterSpec[] = [
  { id: 'pillars', title: '设计支柱', file: 'design/pillars.md' },
  { id: 'core-loop', title: '核心循环', file: 'design/core-loop.md' },
  { id: 'mechanics', title: '机制与规则', file: 'design/mechanics.md' },
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
}

/** One element file (`elements/*.json`) after validation. */
export interface ElementView {
  readonly file: string
  readonly id: string
  readonly type: string
  readonly name: string
  /** Every other top-level scalar, for the numbers table. */
  readonly stats: Readonly<Record<string, string | number | boolean>>
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
  /** One line the agent's turn left, when known. */
  readonly note?: string
}

/** A project row in the deployment-level registry. */
export interface ProjectRow {
  readonly id: string
  readonly title: string
  readonly root: string
  readonly createdAt: string
  readonly updatedAt: string
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
