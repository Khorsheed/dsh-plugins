// @vitest-environment jsdom
/**
 * The external-CLI member reminder (registered into local-agent's member-tool
 * registry): when it shows, by which ratio, and what the per-member field writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { MemberGuard, type MemberGuardProps, type MemberToolFace } from '../src/client/MemberGuard.tsx'
import { resolveConfig } from '../src/client/config.ts'
import type { GuardScope, GuardScopeSnapshot } from '../src/client/scope.ts'

afterEach(() => { cleanup() })

const t = ((key: string) => en[key as keyof typeof en] ?? key) as MemberGuardProps['t']

function scopeOf(value: Record<string, unknown>): GuardScope & { set: ReturnType<typeof vi.fn> } {
  const snapshot: GuardScopeSnapshot = { status: 'ready', value: value as never, base: undefined, user: undefined, revision: 1, writable: true }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, set: vi.fn(async () => true), unset: vi.fn(async () => true) }
}

function face(over: Partial<MemberToolFace> = {}): MemberToolFace {
  return { childSessionId: 'child-a', memberName: '尼尔盖曼', provider: 'kimi-cli', harness: 'kimi', harnessDisplayName: 'Kimi', state: 'idle', placement: 'composer', compact: vi.fn(async () => {}), ...over }
}

const fallback = resolveConfig(undefined)

describe('MemberGuard', () => {
  it('shows 压缩 only past the member\'s CLI ratio, and runs the member\'s compaction', () => {
    const scope = scopeOf({ thresholdRatio: 0.8, harnessThresholds: { kimi: 0.5 } })
    const under = render(<MemberGuard face={face({ ratio: 0.4 })} scope={scope} fallback={fallback} t={t} />)
    expect(under.container.textContent).toBe('')
    under.unmount()
    const compact = vi.fn(async () => {})
    render(<MemberGuard face={face({ ratio: 0.55, compact })} scope={scope} fallback={fallback} t={t} />)
    fireEvent.click(screen.getByRole('button'))
    expect(compact).toHaveBeenCalledTimes(1)
  })

  it('a member\'s own ratio wins; the dot marks it; compacting shows its state instead of the button', () => {
    const scope = scopeOf({ thresholdRatio: 0.8, harnessThresholds: { kimi: 0.5 }, memberThresholds: { 'child-a': { ratio: 0.9 } } })
    const quiet = render(<MemberGuard face={face({ ratio: 0.6, placement: 'dot' })} scope={scope} fallback={fallback} t={t} />)
    expect(quiet.container.textContent).toBe('')
    expect(quiet.container.querySelector('[role="img"]')).toBeNull()
    quiet.unmount()
    const dot = render(<MemberGuard face={face({ ratio: 0.95, placement: 'dot' })} scope={scope} fallback={fallback} t={t} />)
    expect(dot.container.querySelector('[role="img"]')).not.toBeNull()
    dot.unmount()
    render(<MemberGuard face={face({ ratio: 0.95, state: 'compacting' })} scope={scope} fallback={fallback} t={t} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(en['member.compacting'])
  })

  it('the panel field writes the whole member table with the name and CLI it was set for; empty clears it', () => {
    const scope = scopeOf({ thresholdRatio: 0.8, harnessThresholds: {}, memberThresholds: { other: { ratio: 0.2 } } })
    const view = render(<MemberGuard face={face({ ratio: 0.3, placement: 'panel' })} scope={scope} fallback={fallback} t={t} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '0.4' } })
    fireEvent.click(screen.getByRole('button', { name: en['settings.save'] }))
    expect(scope.set).toHaveBeenCalledWith('memberThresholds', { other: { ratio: 0.2 }, 'child-a': { ratio: 0.4, name: '尼尔盖曼', harness: 'kimi' } })
    view.unmount()
    const set = scopeOf({ thresholdRatio: 0.8, memberThresholds: { 'child-a': { ratio: 0.4 } } })
    render(<MemberGuard face={face({ placement: 'panel' })} scope={set} fallback={fallback} t={t} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en['settings.save'] }))
    expect(set.set).toHaveBeenCalledWith('memberThresholds', {})
  })
})
