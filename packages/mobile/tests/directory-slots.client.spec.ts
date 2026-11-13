import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { injectMobileDirectoryFlow } from '../src/client/directory-slots.ts'

const PICKER = 'workspace.picker.directoryFlow'

describe('the optional reusable Workspace directory flow', () => {
  it('stays inert without the optional declaration and disposes its wait', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(SlotRegistry)
    await fiber.await()
    const contribute = vi.fn()
    const dispose = injectMobileDirectoryFlow(ctx, PICKER, contribute)
    expect(ctx.slots.snapshot(PICKER)).toEqual([])
    expect(contribute).not.toHaveBeenCalled()
    dispose()
    await fiber.dispose()
    expect(contribute).not.toHaveBeenCalled()
  })

  it('connects a later declaration and cleans up with its lifetime', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(SlotRegistry)
    await fiber.await()
    const cleanup = vi.fn()
    const contribute = vi.fn(() => cleanup)
    const dispose = injectMobileDirectoryFlow(ctx, PICKER, contribute)
    const declaration = ctx.slots.registerFactory({
      name: 'workspace.picker', scope: 'root',
      children: { 'workspace.picker.directoryFlow': { kind: 'single', scope: 'root' } },
    }, () => null)
    expect(contribute).toHaveBeenCalledOnce()
    declaration()
    expect(cleanup).toHaveBeenCalledOnce()
    dispose()
    await fiber.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('uses an already declared picker immediately', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(SlotRegistry)
    await fiber.await()
    const declaration = ctx.slots.registerFactory({
      name: 'workspace.picker', scope: 'root',
      children: { 'workspace.picker.directoryFlow': { kind: 'single', scope: 'root' } },
    }, () => null)
    const cleanup = vi.fn()
    const dispose = injectMobileDirectoryFlow(ctx, PICKER, () => cleanup)
    expect(cleanup).not.toHaveBeenCalled()
    dispose()
    declaration()
    expect(cleanup).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
})
