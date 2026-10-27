/**
 * The reveal hand-off: the project a first library write lands the pane on.
 */
import { describe, expect, it, vi } from 'vitest'
import { RevealedProject } from '../src/client/reveal.ts'

describe('RevealedProject', () => {
  it('is taken once, so reopening the tab later starts from today', () => {
    const revealed = new RevealedProject()
    expect(revealed.take()).toBeUndefined()
    revealed.reveal('project-math')
    expect(revealed.take()).toBe('project-math')
    expect(revealed.take()).toBeUndefined()
  })

  it('tells a mounted pane at once and stops after it unsubscribes', () => {
    const revealed = new RevealedProject()
    const landed: (string | undefined)[] = []
    const stop = revealed.subscribe(() => { landed.push(revealed.take()) })
    revealed.reveal('project-math')
    expect(landed).toEqual(['project-math'])
    stop()
    const late = vi.fn()
    revealed.reveal('project-physics')
    expect(late).not.toHaveBeenCalled()
    expect(landed).toEqual(['project-math'])
    // Not taken by anyone: the next mount lands on it.
    expect(revealed.take()).toBe('project-physics')
  })

  it('keeps the latest reveal when two arrive before a pane takes one', () => {
    const revealed = new RevealedProject()
    revealed.reveal('project-math')
    revealed.reveal('project-physics')
    expect(revealed.take()).toBe('project-physics')
  })
})
