/** A task rooted in a member's dispatch names that member as its sender, never the human. */
import { describe, expect, it } from 'vitest'
import { replayJobs } from '../src/jobs.ts'

describe('task message sender', () => {
  it('keeps the coordinator\'s id on a task it started; a human root carries none', () => {
    const events = [
      { type: 'room/dispatch', seq: 1, time: 1, data: { id: 'd1', origin: 'coordinator', from: 'gm', targets: ['m'], targetIds: ['m'], text: '精修四项建模', task: 'd1' } },
    ] as never
    const deliveries = [{ id: '1:m', dispatchSeq: 1, memberId: 'm', status: 'running', origin: 'coordinator', text: '精修四项建模', task: 'd1', queuedAt: 1 }] as never
    expect(replayJobs(events, deliveries)[0]!.messages[0]).toMatchObject({ text: '精修四项建模', from: 'gm' })
    const human = [{ type: 'room/dispatch', seq: 1, time: 1, data: { id: 'd1', origin: 'human', targets: ['m'], targetIds: ['m'], text: '做吧', task: 'd1' } }] as never
    expect(replayJobs(human, deliveries)[0]!.messages[0]!.from).toBeUndefined()
  })
})
