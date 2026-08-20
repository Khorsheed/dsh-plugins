// @vitest-environment jsdom
/**
 * MissionsView spec under the four-share props form: a real store instance
 * (createMissionsViewStore().create()) and injected Remote mocks. Asserts the
 * bucket chips and scope selector driving the queue request, the table rows
 * with plan/duration cells, the unreleased warning, the detail panel's
 * retry/release-check gestures, and the export dialog's guarded-layer gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  MissionDetail, MissionQueueResult,
} from '../src/types.ts'
import type { MissionsViewProps } from '../src/client/contract.ts'
import { MissionsView } from '../src/client/MissionsView.tsx'
import { createMissionsViewStore } from '../src/client/store.ts'

/** Selector hook over the store engine instance (the test-sanctioned engine path). */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

type Store = ReturnType<typeof createMissionsViewStore>
type Instance = ReturnType<Store['create']>

interface Harness {
  instance: Instance
  actions: Instance['actions']
  fetchQueue: ReturnType<typeof vi.fn>
  fetchMission: ReturnType<typeof vi.fn>
  retryMission: ReturnType<typeof vi.fn>
  checkReleasable: ReturnType<typeof vi.fn>
  planExport: ReturnType<typeof vi.fn>
  exportRun: ReturnType<typeof vi.fn>
}

const QUEUE: MissionQueueResult = {
  sessionId: 's1',
  runs: [{
    run: { id: 'session-s1', createdAt: 1, state: 'active', missions: 2 },
    rows: [
      {
        runId: 'session-s1', id: '12', title: '整理内容包', labels: {}, state: 'queued',
        bucket: 'ready', currentAttempt: 1, blockedOn: [], releasable: false,
        resourceHeld: false, enteredCurrentAt: Date.now() - 60_000,
      },
      {
        runId: 'session-s1', id: '18', title: 'dwd→dws 汇总', labels: {}, state: 'queued',
        bucket: 'blocked', currentAttempt: 1, blockedOn: ['17'], dependsOn: ['17'],
        releasable: false, resourceHeld: false, enteredCurrentAt: Date.now() - 60_000,
      },
    ],
  }],
}

const DETAIL: MissionDetail = {
  runId: 'session-s1',
  view: QUEUE.runs[0]!.rows[0]!,
  title: '整理内容包',
  attempts: [{
    attempt: 1, state: 'queued', refs: {}, enteredAt: { queued: 1 },
    checkpoints: [], history: [], artifacts: [], attestations: [],
  }],
  annotations: [],
}

function makeHarness(): Harness {
  const instance = createMissionsViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchQueue: vi.fn(async (): Promise<Result<MissionQueueResult>> => ({ ok: true, value: QUEUE })),
    fetchMission: vi.fn(async (): Promise<Result<MissionDetail>> => ({ ok: true, value: DETAIL })),
    retryMission: vi.fn(async (): Promise<Result<{ attempt: number }>> => ({ ok: true, value: { attempt: 2 } })),
    checkReleasable: vi.fn(async (): Promise<Result<{ releasable: boolean }>> => ({ ok: true, value: { releasable: true } })),
    planExport: vi.fn(async () => ({
      ok: true as const,
      value: { bundleDir: '/out/session-s1-bundle', guardedLayers: ['answers'], expectedNs: null, missions: 2, attempts: 2 },
    })),
    exportRun: vi.fn(async () => ({ ok: true as const, value: { bundleDir: '/out/session-s1-bundle', files: 9 } })),
  }
}

function renderView(h: Harness) {
  const props = {
    sessionId: 's1' as SessionId,
    useSession: undefined,
    useInput: undefined,
    inputActions: undefined,
    useProjection: undefined,
    useSessions: undefined,
    useWorkspaces: undefined,
    useStore: hookOf(h.instance),
    actions: h.actions,
    fetchQueue: h.fetchQueue,
    fetchMission: h.fetchMission,
    retryMission: h.retryMission,
    checkReleasable: h.checkReleasable,
    planExport: h.planExport,
    exportRun: h.exportRun,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as MissionsViewProps
  return render(<MissionsView {...props} />)
}

afterEach(() => { cleanup() })

describe('MissionsView', () => {
  it('renders the queue table with bucket, template state, plan, and duration cells', async () => {
    const h = makeHarness()
    renderView(h)
    expect(await screen.findByText('整理内容包')).toBeTruthy()
    expect(screen.getByText('dwd→dws 汇总')).toBeTruthy()
    // The bucket column carries the projection, the state column the raw template state
    // (the 'ready' text appears twice: the filter chip and the row's bucket cell).
    expect(screen.getAllByText('ready').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('queued')).toHaveLength(2)
    expect(screen.getByText(/plan\.waiting/)).toBeTruthy()
    // The default scope is the caller's session (no `all`, no runId).
    expect(h.fetchQueue).toHaveBeenCalledWith('s1', {})
  })

  it('bucket chips filter the queue request (multi-select)', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('整理内容包')
    fireEvent.click(screen.getByRole('button', { name: 'blocked' }))
    await waitFor(() => {
      expect(h.fetchQueue).toHaveBeenLastCalledWith('s1', { buckets: ['blocked'] })
    })
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    await waitFor(() => {
      expect(h.fetchQueue).toHaveBeenLastCalledWith('s1', { buckets: ['blocked', 'ready'] })
    })
  })

  it('the scope selector widens to all runs', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('整理内容包')
    fireEvent.change(screen.getByLabelText('detail.run'), { target: { value: 'all' } })
    await waitFor(() => {
      expect(h.fetchQueue).toHaveBeenLastCalledWith('s1', { all: true })
    })
  })

  it('row selection opens the detail panel; retry and release check ride the Remote', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('整理内容包'))
    expect(await screen.findByText(/detail\.attempt/)).toBeTruthy()
    expect(h.fetchMission).toHaveBeenCalledWith('s1', { missionId: '12', runId: 'session-s1' })

    fireEvent.click(screen.getByText('action.retry'))
    await waitFor(() => {
      expect(h.retryMission).toHaveBeenCalledWith('s1', { missionId: '12', runId: 'session-s1' })
    })
    expect(await screen.findByText(/notice\.retried/)).toBeTruthy()

    fireEvent.click(screen.getByText('action.releasable'))
    await waitFor(() => {
      expect(h.checkReleasable).toHaveBeenCalledWith('s1', { missionId: '12', runId: 'session-s1' })
    })
    expect(await screen.findByText(/notice\.releasable/)).toBeTruthy()
  })

  it('the unreleased warning lists resource-holding missions', async () => {
    const h = makeHarness()
    h.fetchQueue.mockResolvedValue({
      ok: true as const,
      value: {
        sessionId: 's1',
        runs: [{
          run: QUEUE.runs[0]!.run,
          rows: [{ ...QUEUE.runs[0]!.rows[0]!, resourceHeld: true }],
        }],
      },
    })
    renderView(h)
    expect(await screen.findByText(/warning\.unreleased/)).toBeTruthy()
  })

  it('export dialog: guarded layers gate the confirm until every one is acknowledged', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('整理内容包'))
    await screen.findByText(/detail\.attempt/)
    fireEvent.click(screen.getByText('action.export'))

    const outDir = await screen.findByLabelText('export.outDir')
    fireEvent.change(outDir, { target: { value: '/out' } })
    fireEvent.change(screen.getByLabelText('export.layers'), { target: { value: 'visible, answers' } })
    const confirmButton = screen.getByText('export.confirm').closest('button')!
    expect(confirmButton.disabled).toBe(true)
    fireEvent.click(screen.getByText('export.plan'))
    await waitFor(() => {
      expect(h.planExport).toHaveBeenCalledWith('s1', {
        runId: 'session-s1', outDir: '/out', layers: ['visible', 'answers'],
      })
    })
    // The guarded layer appears as an individual acknowledgement checkbox.
    const checkbox = (await screen.findByText(/export\.confirmLayer/)).closest('label')!
      .querySelector('input[type="checkbox"]')!
    expect(confirmButton.disabled).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() => {
      expect(confirmButton.disabled).toBe(false)
    })
    fireEvent.click(confirmButton)
    await waitFor(() => {
      expect(h.exportRun).toHaveBeenCalledWith('s1', expect.objectContaining({ confirmed: ['answers'] }))
    })
    expect(await screen.findByText(/export\.done/)).toBeTruthy()
  })
})
