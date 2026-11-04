import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it } from 'vitest'
import { QuoteChatInteraction, registerQuoteChatInteraction } from '../src/client/chat-interaction.ts'

const SLOT = 'conversation.chat.text-interaction'
const OfficialQuoteAction = () => '引用文本'

async function compose(order: 'official-first' | 'community-first') {
  const root = new Context()
  const slots = new SlotRegistry(root)
  root.effect(() => root.slots.register({
    name: 'root',
    children: { [SLOT]: { kind: 'keyed', scope: 'session' } },
  }, (() => null) as never), 'test Chat frame')
  const official = () => root.plugin({
    name: 'official-quote',
    apply(ctx) {
      ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        key: 'quote',
      }, OfficialQuoteAction)), 'official quote')
    },
  })
  const community = () => root.plugin({ name: 'community-quote', apply: registerQuoteChatInteraction })
  if (order === 'official-first') await official()
  const communityFiber = await community()
  if (order === 'community-first') await official()
  return { root, slots, communityFiber }
}

describe('the community Chat quotation surface', () => {
  for (const order of ['official-first', 'community-first'] as const) {
    it(`shadows only the built-in action with ${order}, then restores it on unload`, async () => {
      const { root, slots, communityFiber } = await compose(order)
      try {
        expect(slots.entriesOfSlot(SLOT)).toHaveLength(1)
        expect(slots.entriesOfSlot(SLOT)[0]).toMatchObject({
          component: QuoteChatInteraction,
          options: { key: 'quote', priority: -1 },
        })
        await communityFiber.dispose()
        expect(slots.entriesOfSlot(SLOT)[0]).toMatchObject({ component: OfficialQuoteAction })
      } finally {
        await root.fiber.dispose()
      }
    })
  }

  it('stays absent when an older host has no Chat interaction seat', async () => {
    const root = new Context()
    const slots = new SlotRegistry(root)
    try {
      await root.plugin({ name: 'community-quote', apply: registerQuoteChatInteraction })
      expect(slots.entriesOfSlot(SLOT)).toEqual([])
    } finally {
      await root.fiber.dispose()
    }
  })
})
