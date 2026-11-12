// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { EVAL_LIFECYCLE_RECORD } from '../src/lifecycle-notices.ts'
import { evalLifecycleDefinition, EvalLifecycleNoticeRow } from '../src/client/LifecycleNotice.tsx'

afterEach(cleanup)

function event(data: unknown) {
  return { type: EVAL_LIFECYCLE_RECORD, ignorable: true, seq: 7, time: 11, data } as never
}

const payload = {
  version: 1 as const,
  stage: 'judge-completed' as const,
  runId: 'run-alpha',
  experimentId: 'alpha',
  title: 'Alpha comparison',
  dedupeKey: 'run-alpha:judge-completed',
}

describe('eval lifecycle conversation notice', () => {
  it('projects a plugin record into a visible chat node', () => {
    const current = event(payload)
    expect(evalLifecycleDefinition.match(current)).toEqual({ id: payload.dedupeKey, role: 'start' })
    const state = evalLifecycleDefinition.start({} as never, { event: current, role: 'start', location: { kind: 'session' } } as never, {} as never)
    const node = evalLifecycleDefinition.buildViewNode?.({ state, key: 'notice', id: payload.dedupeKey } as never)
    expect(node).toMatchObject({ kind: 'eval-lifecycle-notice', visibility: 'visible', groupTree: 'turn', data: payload })
  })

  it('opens the exact experiment and translates each lifecycle stage', () => {
    const openExperiment = vi.fn()
    const t = vi.fn((key: string, params?: { title?: string }) => key === 'lifecycle.open' ? 'Open experiment' : `${key}:${params?.title ?? ''}`)
    render(<EvalLifecycleNoticeRow node={{ data: { ...payload, seq: 7, time: 11 } } as never} openExperiment={openExperiment} t={t as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open experiment' }))
    expect(openExperiment).toHaveBeenCalledWith('alpha')
    expect(t).toHaveBeenCalledWith('lifecycle.judge-completed', { title: 'Alpha comparison' })
  })

  it('rejects malformed and non-ignorable records', () => {
    expect(evalLifecycleDefinition.match(event({ ...payload, stage: 'unknown' }))).toBeNull()
    expect(evalLifecycleDefinition.match({ ...event(payload), ignorable: false })).toBeNull()
    expect(evalLifecycleDefinition.match({ ...event(payload), type: 'turn/start' })).toBeNull()
  })
})
