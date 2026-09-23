/**
 * The card-detail chip's title (stage ⑧): the grammar's placeholder followed by
 * the card's live heading, so two open cards read differently and re-opening a
 * card after an edit shows its new first line.
 *
 * The heading comes from `navigation.params` because that is the only channel
 * the host re-delivers on a re-open: a tab's captured `title` is written once
 * and never refreshed. Registered under `sidebar.right.pane.tab.title`; without
 * it the chip would keep saying 卡片详情 for every card.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { CanvasDetailParams } from '../definition.ts'

/** The chip and a floating panel's header, for one detail tab. */
export function CanvasDetailTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  const params = tab.navigation.params as CanvasDetailParams | undefined
  const heading = params?.heading ?? ''
  return <>{heading === '' ? tab.title : `${tab.title} · ${heading}`}</>
}
