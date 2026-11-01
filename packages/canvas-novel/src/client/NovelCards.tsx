/**
 * The novel's conversation cards, as bodies inside the one shell
 * (`@khorsheed/dsh-client-ui-agent-nav`'s `DestinationCard`, proposal
 * 2026-10-30-agent-sidebar-navigation). The shell owns where a card sits —
 * under `novel_write` / `novel_extract`, and again in the Turn tail — its
 * frame, and its door, which opens the answer's destination. The novel says
 * what the card shows, chosen by that destination:
 *
 * - a chapter on its plan — the plan's 梗概 and shape, 等你确认 / 已确认;
 * - a chapter on its text — its length against the target and its first lines;
 * - the 规划 face — an outline proposal, 等你采用 / 已处理;
 * - 设定 · 最近更新 — a reconciled chapter: what landed.
 *
 * Each body reads its state live and re-reads when the canvas is written (the
 * follower's write signal, or the panel's own confirm), never on a timer.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  DestinationCard, subscribeWrites, type CardCopy, type Destination, type ToolCardModel,
} from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import type { ForeshadowOp } from '../types.ts'
import type { NovelFace } from './contract.ts'
import { useNovelRead } from './use-novel.ts'
import css from './NovelCards.module.css'

const OP_KEYS = { 推进: 'plan.op.advance', 暗示: 'plan.op.hint', 新埋: 'plan.op.plant', 揭晓: 'plan.op.resolve' } as const

/** The canvas tab kind every novel place belongs to. */
const CANVAS_KIND = 'canvas'

/** What the bodies reach outside themselves. */
export interface NovelCardFace extends NovelFace {
  /** Open the canvas tab at the destination; undefined when the canvas is not composed. */
  readonly go: () => ((destination: Destination) => void) | undefined
  readonly t: TranslateNS<'novel'>
}

/** The shell's words for a novel card. */
export function novelCardCopy(t: TranslateNS<'novel'>): CardCopy {
  return { kind: t('card.label'), running: t('card.running'), failed: t('card.failed'), open: t('card.open') }
}

/** A counter that moves whenever a canvas place is written (the bodies re-read on it). */
function useCanvasWrites(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeWrites(CANVAS_KIND, () => { setTick(value => value + 1) }), [])
  return tick
}

/** The chapter a destination names (`item`), or undefined. */
function chapterOf(destination: Destination): number | undefined {
  const n = Number(destination.params['item'])
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** The body for one novel card; the compact line when the destination is not one of the four. */
export function NovelCardBody(props: NovelCardFace & { readonly model: ToolCardModel; readonly destination: Destination }): ReactNode {
  const { destination } = props
  const face = destination.params['face']
  const canvasId = String(destination.params['canvasId'] ?? '')
  const n = chapterOf(destination)
  if (face === 'manuscripts' && n !== undefined && destination.params['focus'] === 'plan') return <PlanBody {...props} canvasId={canvasId} n={n} />
  if (face === 'manuscripts' && n !== undefined) return <TextBody {...props} canvasId={canvasId} n={n} />
  if (face === 'lead') return <OutlineBody {...props} canvasId={canvasId} />
  if (face === 'board' && destination.params['scope'] === 'recent') return <ReconcileBody {...props} />
  return <DestinationCard copy={novelCardCopy(props.t)} model={props.model} go={props.go()} />
}

type BodyProps = NovelCardFace & { readonly model: ToolCardModel; readonly destination: Destination }

/** A chapter plan: it waits for the person, so the card says whether it still waits. */
function PlanBody({ model, destination, remote, go, t, canvasId, n }: BodyProps & { readonly canvasId: string; readonly n: number }): ReactNode {
  const tick = useCanvasWrites()
  const read = useNovelRead(remote(), r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, tick)
  const live = read.state === 'ready' && read.value.ok ? read.value.chapter : undefined
  const plan = live?.plan
  const confirmed = live?.planConfirmedAt !== undefined
  const awaiting = plan !== undefined && !confirmed
  const facts = plan === undefined ? [] : [
    ...(plan.beats.length > 0 ? [t('card.beats', { count: plan.beats.length })] : []),
    ...opCounts(plan.foreshadowOps).map(([op, count]) => t('card.op', { op: t(OP_KEYS[op]), count })),
    ...(plan.cast.length > 0 ? [t('card.cast', { count: plan.cast.length })] : []),
  ]
  return (
    <DestinationCard
      copy={novelCardCopy(t)}
      model={model}
      go={go()}
      body={{
        title: live?.title === undefined ? destination.label : `${t('card.kicker', { n })} · ${live.title}`,
        ...(plan === undefined ? {} : { status: { text: t(confirmed ? 'card.confirmed' : 'card.awaiting'), settled: confirmed } }),
        awaiting,
        open: `${t(awaiting ? 'card.confirm' : 'card.view')} →`,
        children: (
          <>
            {plan !== undefined && plan.summary !== '' && <p className={css.gist}>{plan.summary}</p>}
            {facts.length > 0 && <div className={css.facts}>{facts.map(fact => <span key={fact}>{fact}</span>)}</div>}
          </>
        ),
      }}
    />
  )
}

/** A chapter's text: its length against the target and its first lines; 待对账 until the 对账 lands. */
function TextBody({ model, destination, remote, go, t, canvasId, n }: BodyProps & { readonly canvasId: string; readonly n: number }): ReactNode {
  const tick = useCanvasWrites()
  const read = useNovelRead(remote(), r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, tick)
  const view = read.state === 'ready' && read.value.ok ? read.value : undefined
  const opening = (view?.body ?? '').split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#')).slice(0, 2).join('')
  const count = view?.chapter?.wordCount
  const settled = view?.phase === 'extracted' || view?.phase === 'reviewed'
  return (
    <DestinationCard
      copy={novelCardCopy(t)}
      model={model}
      go={go()}
      body={{
        title: view?.chapter?.title === undefined ? destination.label : `${t('card.bodyKicker', { n })} · ${view.chapter.title}`,
        ...(view === undefined ? {} : { status: { text: t(settled ? 'card.bodySettled' : 'card.bodyWritten'), settled } }),
        open: `${t('card.read')} →`,
        children: (
          <>
            {opening !== '' && <p className={css.opening}>{opening}</p>}
            <div className={css.facts}>
              {count !== undefined && <span>{t('chapter.words', { count })}</span>}
              {view?.targetWords !== undefined && <span>{t('card.target', { words: view.targetWords.toLocaleString() })}</span>}
            </div>
          </>
        ),
      }}
    />
  )
}

/** An outline proposal: it waits on the 规划 face for the person's 采用. */
function OutlineBody({ model, remote, go, t, canvasId }: BodyProps & { readonly canvasId: string }): ReactNode {
  const tick = useCanvasWrites()
  const read = useNovelRead(remote(), r => r.outline({ canvasId }), `outline:${canvasId}`, tick)
  const outline = read.state === 'ready' && read.value.ok ? read.value.outline : undefined
  const awaiting = outline?.proposal !== undefined
  return (
    <DestinationCard
      copy={novelCardCopy(t)}
      model={model}
      go={go()}
      body={{
        title: t('card.outline'),
        ...(outline === undefined ? {} : { status: { text: t(awaiting ? 'card.outlineAwaiting' : 'card.outlineSettled'), settled: !awaiting } }),
        awaiting,
        open: `${t(awaiting ? 'card.outlineAdopt' : 'card.outlineView')} →`,
        children: outline?.proposal?.rationale !== undefined ? <p className={css.gist}>{outline.proposal.rationale}</p> : null,
      }}
    />
  )
}

const NEW_CARDS = /新卡 ×(\d+)/
const UPDATED = /改了已有卡 ×(\d+)/

/**
 * A reconciled chapter: everything already landed, so the card says what it
 * did and opens 设定 · 最近更新. The counts are the answer's own report.
 */
function ReconcileBody({ model, destination, remote, go, t }: BodyProps): ReactNode {
  const canvasId = String(destination.params['canvasId'] ?? '')
  const n = Number(/第 (\d+) 章/.exec(destination.label)?.[1] ?? 0)
  const read = useNovelRead(remote(), r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, 0)
  const live = read.state === 'ready' && read.value.ok ? read.value.chapter : undefined
  const plan = live?.plan
  const delivery = live?.delivery
  const newCards = Number(NEW_CARDS.exec(model.text)?.[1] ?? 0)
  const updated = Number(UPDATED.exec(model.text)?.[1] ?? 0)
  const facts: string[] = [
    ...(plan !== undefined && delivery !== undefined
      ? [t('plan.delivery', {
          beats: delivery.beats.filter(Boolean).length, beatsTotal: plan.beats.length,
          ops: delivery.ops.filter(Boolean).length, opsTotal: plan.foreshadowOps.length,
        })]
      : []),
    ...(newCards > 0 ? [t('card.newCards', { count: newCards })] : []),
    ...(updated > 0 ? [t('card.updated', { count: updated })] : []),
  ]
  return (
    <DestinationCard
      copy={novelCardCopy(t)}
      model={model}
      go={go()}
      body={{
        title: n > 0 ? t('card.extracted', { n }) : destination.label,
        status: { text: t('card.written'), settled: true },
        awaiting: true,
        open: `${t('card.recent')} →`,
        children: facts.length > 0 ? <div className={css.facts}>{facts.map(fact => <span key={fact}>{fact}</span>)}</div> : null,
      }}
    />
  )
}

/** Foreshadow ops counted per kind, in the order the plan first uses them. */
function opCounts(ops: readonly ForeshadowOp[]): Array<[ForeshadowOp['op'], number]> {
  const counts = new Map<ForeshadowOp['op'], number>()
  for (const op of ops) counts.set(op.op, (counts.get(op.op) ?? 0) + 1)
  return [...counts]
}
