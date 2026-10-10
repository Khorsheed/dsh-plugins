/**
 * The novel engine's GESTURE verbs as shared cores, plus the agent-free
 * adapter factory over them ({@link createNovelGestureAdapter}).
 *
 * The Remote face (`remote.novel.*`) takes the calling `agent` first — the
 * wire's lookup convention. A trusted server-side caller that already holds
 * the real {@link NovelService} (an instance mounted on its own Context) must
 * not fake an Agent to borrow that face, nor copy the text-plan parsing
 * rules: the Remote verbs and the adapter run the SAME cores below, so their
 * receipts are identical by construction (the file-preview read-surface
 * precedent).
 *
 * The full `NovelRemoteService` inventory, for orientation: the seven
 * gestures — `decidePending`, `reviewChapter`, `decideOutline`,
 * `confirmPlan`, `editPlan`, `starForeshadow`, `setCurrentState` — are all
 * here. The eight reads (`pending`, `ledger`, `storyLog`, `chapters`,
 * `chapter`, `outline`, `recentUpdates`, `card`) add only browser-surface
 * shaping over core projections; a server-side caller reads the core it
 * already holds (`readEntries`, `listChapters`, `readOutline`, …) directly,
 * so they are not duplicated here.
 *
 * The session the adapter closes over is OPTIONAL: a session-less gesture
 * resolves the deployment-default policy at the store's fence (never skipped
 * — a policy home that cannot resolve session-less refuses coded `denied`),
 * and a disposed core refuses every verb with `NovelDisposedError` — the same
 * semantics the Remote path has, because it IS the same code.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { NovelService } from './store.ts'
import { planFromText } from './text-forms.ts'
import type {
  NovelChapterRequest, NovelDecideRequest, NovelError, NovelGestureResult, NovelOutlineDecideRequest,
  NovelPlanEditRequest, NovelPlanEditResult, NovelStarRequest, NovelStateRequest,
} from './types.ts'

/** The wire receipt of a gesture core call: ok, or the failure code (defaulting to io). */
function gestureReceipt(result: { readonly ok: boolean; readonly error?: NovelError }): NovelGestureResult {
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
}

/** Accept or discard one pending item. */
export function decidePendingGesture(core: NovelService, session: Session | undefined, request: NovelDecideRequest): Promise<NovelGestureResult> {
  return core.decidePending({ workId: request.canvasId, id: request.id, action: request.action }, session)
}

/** The person's ✓ 审过: closes an extracted chapter. */
export async function reviewChapterGesture(core: NovelService, session: Session | undefined, request: NovelChapterRequest): Promise<NovelGestureResult> {
  return gestureReceipt(await core.reviewChapter({ workId: request.canvasId, n: request.n }, session))
}

/** The person's 采用 / 不采用 on the outline proposal. */
export async function decideOutlineGesture(core: NovelService, session: Session | undefined, request: NovelOutlineDecideRequest): Promise<NovelGestureResult> {
  return gestureReceipt(await core.decideOutline({ workId: request.canvasId, action: request.action }, session))
}

/** The person's ✓ 确认计划 on a planned chapter. */
export async function confirmPlanGesture(core: NovelService, session: Session | undefined, request: NovelChapterRequest): Promise<NovelGestureResult> {
  return gestureReceipt(await core.confirmChapterPlan({ workId: request.canvasId, n: request.n }, session))
}

/**
 * The person's own edit of a plan (the page's edit box), saved and confirmed
 * at once. The text form is parsed by {@link planFromText} — the ONE place
 * the parsing rules live; the Remote verb and the adapter share this call.
 */
export async function editPlanGesture(core: NovelService, session: Session | undefined, request: NovelPlanEditRequest): Promise<NovelPlanEditResult> {
  const result = await core.editPlan({ workId: request.canvasId, n: request.n, plan: planFromText(request.text) }, session)
  if (!result.ok) return { ok: false, error: result.error ?? 'io', ...(result.unknown === undefined ? {} : { unknown: result.unknown }) }
  return { ok: true, changed: result.changed ?? [] }
}

/** The person's ★ on a foreshadow. */
export async function starForeshadowGesture(core: NovelService, session: Session | undefined, request: NovelStarRequest): Promise<NovelGestureResult> {
  return gestureReceipt(await core.starForeshadow({ workId: request.canvasId, cardId: request.cardId, starred: request.starred }, session))
}

/** The person's edit of a character's 此刻. */
export async function setCurrentStateGesture(core: NovelService, session: Session | undefined, request: NovelStateRequest): Promise<NovelGestureResult> {
  return gestureReceipt(await core.setCurrentState({ workId: request.canvasId, cardId: request.cardId, state: request.state }, session))
}

/**
 * The agent-free native-gesture face: the Remote's seven gesture verbs as
 * plain calls on a real core. Requests and receipts are the Remote's own
 * wire types, so an answer here is the answer `remote.novel.*` would give.
 */
export interface NovelGestureAdapter {
  /** Accept or discard one pending item. */
  decidePending(request: NovelDecideRequest): Promise<NovelGestureResult>
  /** The person's ✓ 审过: closes an extracted chapter. */
  reviewChapter(request: NovelChapterRequest): Promise<NovelGestureResult>
  /** The person's 采用 / 不采用 on the outline proposal. */
  decideOutline(request: NovelOutlineDecideRequest): Promise<NovelGestureResult>
  /** The person's ✓ 确认计划 on a planned chapter. */
  confirmPlan(request: NovelChapterRequest): Promise<NovelGestureResult>
  /** The person's own plan edit as edit-box text, saved and confirmed at once. */
  editPlan(request: NovelPlanEditRequest): Promise<NovelPlanEditResult>
  /** The person's ★ on a foreshadow. */
  starForeshadow(request: NovelStarRequest): Promise<NovelGestureResult>
  /** The person's edit of a character's 此刻. */
  setCurrentState(request: NovelStateRequest): Promise<NovelGestureResult>
}

/**
 * Build the agent-free gesture face over one real engine core. The adapter
 * closes over the core and the optional session; it never touches an Agent,
 * the host's agent lookup, or the `agents` service — construction touches
 * nothing at all.
 * @param core - the engine instance the caller already holds.
 * @param session - the fencing session every gesture runs under, when there is one.
 * @returns the gesture face.
 */
export function createNovelGestureAdapter(core: NovelService, session?: Session): NovelGestureAdapter {
  const at = session
  return {
    decidePending: request => decidePendingGesture(core, at, request),
    reviewChapter: request => reviewChapterGesture(core, at, request),
    decideOutline: request => decideOutlineGesture(core, at, request),
    confirmPlan: request => confirmPlanGesture(core, at, request),
    editPlan: request => editPlanGesture(core, at, request),
    starForeshadow: request => starForeshadowGesture(core, at, request),
    setCurrentState: request => setCurrentStateGesture(core, at, request),
  }
}
