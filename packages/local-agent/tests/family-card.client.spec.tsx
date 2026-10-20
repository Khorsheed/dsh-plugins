// @vitest-environment jsdom
/**
 * The「本机 Agent 委派」family card: the HarnessCardRegistry behind the
 * localAgentUi service's registerHarnessCard (ordering, replacement,
 * subscription), and the plugins.item entry component itself — sections from
 * the registry sorted by their retired standalone-card orders, all collapsed
 * on mount, the per-section credential dot fed by the card's own gateway
 * probe, and the grey CLI-missing tag when an answered probe carries no
 * cliVersion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { LocalAgentFamilyCard, type LocalAgentFamilyCardProps } from '../src/client/FamilyCard.tsx'
import { HarnessCardRegistry, type HarnessCardRegistration, type HarnessCardRenderProps } from '../src/client/harness-cards.ts'
import { resetAuthStatuses } from '../src/client/auth-status.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  resetAuthStatuses()
})

const t = makeTranslate(zh)

function useSessionsWith<T>(current: string | undefined) {
  const state = {
    ids: current === undefined ? [] : [current],
    byId: {},
    current,
    phase: 'ready',
  } as unknown as SessionListState
  return function useSessions<R>(select: (snapshot: SessionListState) => R): R {
    return select(state)
  }
}

function harnessStatus(name: string, authenticated: boolean, cliVersion?: string): LocalAgentStatus {
  return {
    name,
    displayName: name,
    authenticated,
    homeDir: '/h',
    ...cliVersion === undefined ? {} : { effectiveSettings: { drive: 'exec' as const, baseUrlSet: false, cliVersion } },
  }
}

/** A fake harness section: a marker body recording the render props it got. */
function fakeSection(name: string, order: number, label: string, seen?: HarnessCardRenderProps[]): HarnessCardRegistration {
  return {
    name,
    order,
    locale: `fake-${name}`,
    label: () => label,
    render: (props) => {
      seen?.push(props)
      return <div data-section-body={name}>{`body:${name}:${String(props.active)}`}</div>
    },
  }
}

function cardProps(over: Partial<LocalAgentFamilyCardProps> = {}): LocalAgentFamilyCardProps {
  return {
    view: 'page',
    harnessCards: new HarnessCardRegistry(),
    harnessStatus: () => Promise.resolve(undefined),
    useSessions: useSessionsWith('session'),
    t,
    ...over,
  } as unknown as LocalAgentFamilyCardProps
}

/** The disclosure header of one section: the button carrying its label text. */
function sectionHeader(label: string): HTMLButtonElement {
  const header = screen.getByRole('button', { name: new RegExp(label) })
  return header as HTMLButtonElement
}

describe('HarnessCardRegistry', () => {
  it('keeps the sections sorted by order, then name', () => {
    const registry = new HarnessCardRegistry()
    registry.register(fakeSection('codex', 120, 'Codex'))
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    registry.register(fakeSection('dsh', 140, 'dsh'))
    expect(registry.cards().map(entry => entry.name)).toEqual(['kimi', 'codex', 'dsh'])
  })

  it('notifies subscribers on register and unregister, and a stale disposer never evicts a replacement', () => {
    const registry = new HarnessCardRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    const retireFirst = registry.register(fakeSection('kimi', 110, 'Kimi'))
    registry.register(fakeSection('kimi', 110, 'Kimi v2'))
    retireFirst()
    // The stale disposer matched nothing, so it neither evicted nor notified.
    expect(registry.cards().map(entry => entry.label())).toEqual(['Kimi v2'])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('returns the same sorted list instance between mutations (uSES snapshot stability)', () => {
    const registry = new HarnessCardRegistry()
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    expect(registry.cards()).toBe(registry.cards())
    expect(registry.snapshotVersion()).toBe(1)
    registry.register(fakeSection('codex', 120, 'Codex'))
    expect(registry.snapshotVersion()).toBe(2)
    expect(registry.cards()).not.toBe(new HarnessCardRegistry().cards())
  })
})

describe('LocalAgentFamilyCard', () => {
  it('renders the summary one-liner and no sections for the summary view', () => {
    const registry = new HarnessCardRegistry()
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    render(<LocalAgentFamilyCard {...cardProps({ view: 'summary', harnessCards: registry })} />)
    expect(screen.getByText(zh['family.description'])).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the empty hint when no harness registered a section', () => {
    render(<LocalAgentFamilyCard {...cardProps()} />)
    expect(screen.getByText(zh['family.empty'])).toBeTruthy()
  })

  it('renders one collapsed section per registered harness in order, and mounts the body on expand with the render props', async () => {
    const registry = new HarnessCardRegistry()
    const seenCodex: HarnessCardRenderProps[] = []
    registry.register(fakeSection('codex', 120, 'Codex', seenCodex))
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    const status = vi.fn(async (name: string) => harnessStatus(name, true, '1.2.3'))
    const useSessions = useSessionsWith('session')
    render(<LocalAgentFamilyCard {...cardProps({ harnessCards: registry, harnessStatus: status, useSessions })} />)

    // Sections sort by their retired standalone orders (kimi 110 before codex
    // 120, regardless of registration order) and start collapsed.
    const headers = screen.getAllByRole('button')
    expect(headers.map(header => header.textContent)).toEqual(['Kimi', 'Codex'])
    expect(document.body.querySelector('[data-section-body]')).toBeNull()
    // Each header ran the card's own gateway probe on mount.
    expect(status).toHaveBeenCalledWith('kimi')
    expect(status).toHaveBeenCalledWith('codex')

    fireEvent.click(sectionHeader('Codex'))
    expect(await screen.findByText('body:codex:true')).toBeTruthy()
    expect(sectionHeader('Codex').getAttribute('aria-expanded')).toBe('true')
    // The render props carry the global session seat forwarded verbatim.
    expect(seenCodex[0]?.useSessions).toBe(useSessions)
    expect(seenCodex[0]?.active).toBe(true)
    // The other section stays collapsed.
    expect(document.body.querySelector('[data-section-body="kimi"]')).toBeNull()

    fireEvent.click(sectionHeader('Codex'))
    expect(screen.queryByText('body:codex:true')).toBeNull()
    expect(sectionHeader('Codex').getAttribute('aria-expanded')).toBe('false')
  })

  it('shows the credential dot the probe publishes (authenticated)', async () => {
    const registry = new HarnessCardRegistry()
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    render(<LocalAgentFamilyCard {...cardProps({
      harnessCards: registry,
      harnessStatus: async name => harnessStatus(name, true, '2.0.0'),
    })} />)
    expect(await screen.findByRole('img', { name: zh['settings.authenticated'] })).toBeTruthy()
  })

  it('tags a section whose answered probe names no cliVersion as CLI-missing, and not otherwise', async () => {
    const registry = new HarnessCardRegistry()
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    registry.register(fakeSection('codex', 120, 'Codex'))
    render(<LocalAgentFamilyCard {...cardProps({
      harnessCards: registry,
      harnessStatus: async name => name === 'kimi' ? harnessStatus(name, false) : harnessStatus(name, false, '0.163.0'),
    })} />)
    // kimi's answer carries no effectiveSettings.cliVersion → the grey tag;
    // codex names one → no tag.
    expect(await screen.findByText(zh['family.cliMissing'])).toBeTruthy()
    expect(screen.getAllByText(zh['family.cliMissing'])).toHaveLength(1)
  })

  it('renders no CLI-missing tag when the probe cannot answer (harness absent host-side reads as unavailable)', async () => {
    const registry = new HarnessCardRegistry()
    registry.register(fakeSection('kimi', 110, 'Kimi'))
    render(<LocalAgentFamilyCard {...cardProps({ harnessCards: registry, harnessStatus: () => Promise.resolve(undefined) })} />)
    expect(await screen.findByRole('img', { name: zh['error'] })).toBeTruthy()
    expect(screen.queryByText(zh['family.cliMissing'])).toBeNull()
  })

  it('re-renders when a harness registers after the card mounted', async () => {
    const registry = new HarnessCardRegistry()
    render(<LocalAgentFamilyCard {...cardProps({ harnessCards: registry })} />)
    expect(screen.getByText(zh['family.empty'])).toBeTruthy()
    await act(async () => {
      registry.register(fakeSection('kimi', 110, 'Kimi'))
    })
    expect(screen.queryByText(zh['family.empty'])).toBeNull()
    expect(sectionHeader('Kimi')).toBeTruthy()
  })
})
