import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MarkdownDelegateFenceInfo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HocShare, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { mountCardFrame } from './frame.ts'
import { CARD_INFO_STRING } from './renderer.ts'
import { createLinkOpener } from './index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.chat.markdown.fence': { kind: 'hoc'; scope: 'session'; owner: MarkdownDelegateFenceInfo }
  }
}

export interface CardFenceProps extends MarkdownDelegateFenceInfo {
  readonly children: ReactNode
  readonly openLink: (url: string) => void
}

const FENCE_SLOT = 'conversation.chat.markdown.fence'

export function CardFence({ code, streaming, children, openLink }: CardFenceProps) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming || code.trim() === '' || container.current === null) return
    const mounted = mountCardFrame(container.current, code, { openLink })
    return () => { mounted.dispose() }
  }, [code, streaming, openLink])

  if (streaming || code.trim() === '') return children
  return <div ref={container} className="dsh-inline-card-container" style={{ position: 'relative', width: '100%' }} />
}

export function registerCardFence(ctx: Context, onRegistered?: () => void): void {
  const openLink = createLinkOpener(ctx)
  ctx.slots.inject(FENCE_SLOT, () => {
    const unregister = ctx.slots.register({
      name: FENCE_SLOT,
      key: CARD_INFO_STRING,
      id: '@khorsheed/dsh-inline-html-render/fence/dsh-card',
    }, function InlineCardFence(props: PropsRuntime<'conversation.chat.markdown.fence'> & HocShare<SlotMap['conversation.chat.markdown.fence']>) {
      return <CardFence {...props} openLink={openLink} />
    })
    onRegistered?.()
    return unregister
  })
}
