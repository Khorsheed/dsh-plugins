import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import type { LocalAgentMemberMessage, RoomMemberMessageReceipt } from '@khorsheed/dsh-local-agent'
import { MemberChannel } from '../src/member-channel.ts'

const PROVIDER = 'fake-cli'
const PARENT = 'parent-1'
const CHILD_A = 'child-a'
const CHILD_B = 'child-b'

/** A minimal controllable run for the fake provider. */
function makeRun(id: string): SubagentRun {
  return {
    id: SessionId(id),
    localAgent: undefined,
    result: Promise.resolve({ stopReason: 'completed', output: [] }),
    dispose: () => Promise.resolve(),
  }
}

interface ChannelHarness {
  ctx: Context
  registry: localAgent.LocalAgentRegistry
  channel: MemberChannel
  /** Requests the fake subagents provider received. */
  requests: SubagentStartRequest[]
  /** A's registered member run token. */
  tokenA: string
  enterParent(id: string): void
  provideRoom(gate: (message: LocalAgentMemberMessage) => Promise<RoomMemberMessageReceipt>): ReturnType<typeof vi.fn>
}

/**
 * Mount the registry stack (as in delegation-facade.spec.ts) plus a fake
 * subagents provider, one harness claiming it, A's registered member run, and
 * B's recorded delegation with a live child session.
 */
async function mountChannel(): Promise<ChannelHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const requests: SubagentStartRequest[] = []
  ctx.provide('subagents', {
    getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
    start: (_name: string, request: SubagentStartRequest) => {
      requests.push(request)
      registry.takeDelegationIntent(request.parent.session.id, PROVIDER)
      return Promise.resolve(makeRun(String(request.parent.session.id)))
    },
  })
  ctx.provide('sessionPersistence', {
    // Host 0.1.5 handle API: open hands back an empty-log write handle.
    open: (id: SessionId, _access: string) => Promise.resolve({
      id,
      header: { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false },
      inheritedEventCount: 0,
      read: () => Promise.resolve({ events: [], eventState: 'detached' }),
      append: () => Promise.resolve(),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  })
  const homesRoot = mkdtempSync(join(tmpdir(), 'member-channel-'))
  await ctx.plugin(localAgent, { homesRoot })
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  const harness: LocalAgentHarness = {
    name: 'fake',
    displayName: 'Fake Agent',
    homeEnvVar: 'FAKE_HOME',
    delegationProvider: PROVIDER,
    records: { listSessions: async () => [] },
  }
  registry.register(harness)
  registry.recordDelegation({ childSessionId: CHILD_B, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-b' })
  ctx.sessions.create(SessionId(CHILD_B))
  const tokenA = registry.registerMemberRun({ childSessionId: CHILD_A, parentSessionId: PARENT, provider: PROVIDER })
  // The chain logic under test needs no listener; handle() stands alone.
  const channel = new MemberChannel(ctx, registry, join(homesRoot, 'test.sock'))
  return {
    ctx,
    registry,
    channel,
    requests,
    tokenA,
    enterParent(id) {
      const sessionId = SessionId(id)
      const agent = { id: sessionId, session: { id: sessionId, header: { id: sessionId } } } as unknown as Agent
      ctx.agents.enter(agent, undefined)
    },
    provideRoom(gate) {
      const receiveMemberMessage = vi.fn(gate)
      ctx.provide('room' as never, { receiveMemberMessage } as never)
      return receiveMemberMessage
    },
  }
}

describe('MemberChannel delivery chain', () => {
  it('rejects an unknown token and an expired (settled) token', async () => {
    const h = await mountChannel()
    const unknown = await h.channel.handle({ token: 'nope', to: CHILD_B, text: 'hi' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toMatch(/unknown or expired member token/)

    h.registry.unregisterMemberRun(h.tokenA)
    const expired = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'hi' })
    expect(expired.ok).toBe(false)
    expect(h.requests).toHaveLength(0)
  })

  it('token-only auth: the per-run token is the sole credential (host 0.1.5 removed child pids)', async () => {
    // No parentage cross-check exists anymore: a well-formed request carrying
    // a live token delivers, and a run registered but never otherwise
    // exercised works the same. The residual same-host sibling-replay exposure
    // is documented in the README (auth-hardening proposal tracks a second
    // factor).
    const h = await mountChannel()
    h.enterParent(PARENT)
    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'hi' })
    expect(outcome).toEqual({ ok: true, receipt: 'sent' })
    expect(h.requests).toHaveLength(1)

    const second = h.registry.registerMemberRun({ childSessionId: 'child-c', parentSessionId: PARENT, provider: PROVIDER })
    const again = await h.channel.handle({ token: second, to: CHILD_B, text: 'hi' })
    expect(again).toEqual({ ok: true, receipt: 'sent' })
  })

  it('direct-sends with provenance when room is absent: facade resume with the recorded parent/provider', async () => {
    const h = await mountChannel()
    h.enterParent(PARENT)

    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'X 已完成' })

    expect(outcome).toEqual({ ok: true, receipt: 'sent' })
    expect(h.requests).toHaveLength(1)
    const request = h.requests[0]!
    expect(request.parent.session.id).toBe(PARENT)
    // The resume intent for B was staged and consumed by the provider.
    expect(h.registry.takeDelegationIntent(PARENT, PROVIDER)).toBeUndefined()
    // Provenance: the text names A (harness label + child session id for the
    // reply channel) and never carries B's CLI-session resume handle.
    const text = (request.prompt[0] as { type: 'text'; text: string }).text
    expect(text).toContain(`成员 Fake Agent（会话 ${CHILD_A}）转告：`)
    expect(text).toContain('X 已完成')
    expect(text).toContain(`to 填 "${CHILD_A}"`)
    expect(text).not.toContain('cli-b')
  })

  it('rejects a member of another parent session (cross-room)', async () => {
    const h = await mountChannel()
    h.registry.recordDelegation({ childSessionId: 'child-x', provider: PROVIDER, parentSessionId: 'parent-2', cliSessionId: 'cli-x' })

    const outcome = await h.channel.handle({ token: h.tokenA, to: 'child-x', text: 'hi' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toMatch(/another parent session/)
    expect(h.requests).toHaveLength(0)
  })

  it('answers busy when the target member has an in-flight resume', async () => {
    const h = await mountChannel()
    h.enterParent(PARENT)
    expect(h.registry.acquireResumeLock(CHILD_B)).toBe(true)

    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'hi' })

    expect(outcome).toEqual({ ok: true, receipt: 'busy' })
    expect(h.requests).toHaveLength(0)
    h.registry.releaseResumeLock(CHILD_B)
  })

  it('hands the notification to a claiming room and passes its receipt verbatim', async () => {
    const h = await mountChannel()
    h.enterParent(PARENT)
    const gate = h.provideRoom(async () => 'pending-confirm')

    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'X 已完成' })

    expect(outcome).toEqual({ ok: true, receipt: 'pending-confirm' })
    // Room claimed the dispatch: the family does NOT send.
    expect(h.requests).toHaveLength(0)
    expect(gate).toHaveBeenCalledWith({
      from: CHILD_A,
      to: CHILD_B,
      content: 'X 已完成',
      parentSessionId: PARENT,
      provenance: {
        childSessionId: CHILD_A,
        provider: PROVIDER,
        parentSessionId: PARENT,
        harnessDisplayName: 'Fake Agent',
      },
    })
  })

  it('direct-sends when room is present but declines (parent not its room)', async () => {
    const h = await mountChannel()
    h.enterParent(PARENT)
    const gate = h.provideRoom(async () => { throw new Error('room: not a room session (not-a-room)') })

    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'hi' })

    expect(outcome).toEqual({ ok: true, receipt: 'sent' })
    expect(gate).toHaveBeenCalled()
    expect(h.requests).toHaveLength(1)
  })

  it('lets room resolve a member name the family registry cannot', async () => {
    const h = await mountChannel()
    const gate = h.provideRoom(async () => 'sent')

    const outcome = await h.channel.handle({ token: h.tokenA, to: 'coder-B', text: 'hi' })

    expect(outcome).toEqual({ ok: true, receipt: 'sent' })
    expect(gate.mock.calls[0]?.[0].to).toBe('coder-B')
    expect(h.requests).toHaveLength(0)
  })

  it('rejects a name-addressed member when room is absent', async () => {
    const h = await mountChannel()

    const outcome = await h.channel.handle({ token: h.tokenA, to: 'coder-B', text: 'hi' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toMatch(/unknown member/)
    expect(h.requests).toHaveLength(0)
  })

  it('returns the facade failure as an error receipt when the parent is not live', async () => {
    const h = await mountChannel()

    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'hi' })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.receipt).toMatch(/^error: .*no live agent/)
    expect(h.requests).toHaveLength(0)
  })

  it('direct-sends when the room gate throws', async () => {
    const h = await mountChannel()
    h.enterParent(PARENT)
    h.provideRoom(async () => { throw new Error('gate exploded') })

    const outcome = await h.channel.handle({ token: h.tokenA, to: CHILD_B, text: 'hi' })

    expect(outcome).toEqual({ ok: true, receipt: 'sent' })
    expect(h.requests).toHaveLength(1)
  })
})
