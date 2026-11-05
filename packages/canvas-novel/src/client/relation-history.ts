import { relationProgress, type CodexRelation, type CodexRelationStep, type RelationType } from '../types.ts'

export interface RelationHistoryState {
  readonly type: string
  readonly stage: string
  readonly level?: number
  readonly progress: number
  readonly latest?: CodexRelationStep
  readonly trend: 'new' | 'up' | 'down' | 'repair' | 'type' | 'same'
}

function trendOf(step: CodexRelationStep | undefined): RelationHistoryState['trend'] {
  if (step === undefined) return 'same'
  if (step.kind === 'points') return (step.delta ?? 0) < 0 ? 'down' : (step.delta ?? 0) > 0 ? 'up' : 'same'
  if (step.event === 'start') return 'new'
  if (step.event === 'up') return 'up'
  if (step.event === 'crack' || step.event === 'break') return 'down'
  if (step.event === 'fix') return 'repair'
  if (step.event === 'type') return 'type'
  return 'same'
}

/** Reconstruct one relation as its journal said it stood at the end of a chapter. */
export function relationAt(relation: CodexRelation, chapter: number): RelationHistoryState | undefined {
  const steps = relation.steps.filter(step => step.chapter <= chapter)
  if (steps.length === 0) return undefined
  const firstTypeChange = relation.steps.find(step => step.kind === 'stage' && step.event === 'type')
  let type = firstTypeChange?.fromType ?? relation.type
  const firstStage = steps.find(step => step.kind === 'stage')
  let stage = firstStage?.stage ?? relation.stage
  let level = firstStage?.level
  for (const step of steps) {
    if (step.kind !== 'stage') continue
    type = step.toType ?? type
    stage = step.stage ?? stage
    level = step.level
  }
  const progress = relationProgress(steps.map(step => step.kind === 'points'
    ? { relationId: relation.cardId, chapter: step.chapter, kind: 'points', delta: step.delta ?? 0, createdAt: '' }
    : { relationId: relation.cardId, chapter: step.chapter, kind: 'stage', event: step.event ?? 'set', stage: step.stage ?? stage, ...(step.level === undefined ? {} : { level: step.level }), ...(step.fromType === undefined ? {} : { fromType: step.fromType as RelationType }), ...(step.toType === undefined ? {} : { toType: step.toType as RelationType }), createdAt: '' }))
  return { type, stage, ...(level === undefined ? {} : { level }), progress, ...(steps.at(-1) === undefined ? {} : { latest: steps.at(-1)! }), trend: trendOf(steps.at(-1)) }
}

/** The visible graph view box for zoom and pan. */
export function relationViewBox(scale: number, center: { readonly x: number; readonly y: number }, width = 560, height = 320): string {
  const w = width / scale, h = height / scale
  return `${center.x - w / 2} ${center.y - h / 2} ${w} ${h}`
}
