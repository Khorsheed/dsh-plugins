// @vitest-environment jsdom
/**
 * The edit dialog's 模式工具 line (every state of the approved design) and the
 * room's mode-tools notice line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LocalAgentMemberToolsReload, LocalAgentMemberToolsStatus } from '@khorsheed/dsh-local-agent/types'
import { MemberToolsLine } from '../src/client/MemberToolsLine.tsx'
import { InviteDialog } from '../src/client/InviteDialog.tsx'
import type { RoomMember, RoomMemberRun } from '../src/types.ts'
import { RoomEventView } from '../src/client/RoomEventView.tsx'
import { memberToolsLine, modeShortName } from '../src/client/member-tools-view.ts'
import { en, zh } from '../src/client/locales.ts'
import type { RoomEventViewProps } from '../src/client/slots.ts'

afterEach(() => { cleanup() })

const GAME = ['game_open', 'game_read', 'game_propose', 'game_publish', 'typesafe_judge']
const AT = new Date(2026, 10, 2, 22, 36).getTime()

function status(patch: Partial<LocalAgentMemberToolsStatus> = {}): LocalAgentMemberToolsStatus {
  return { preset: 'dsh-gamedev', expected: GAME, process: 'full', received: GAME, loadedAt: AT, reloadable: true, ...patch }
}

describe('memberToolsLine (the line\'s state)', () => {
  it('folds each status into one state', () => {
    expect(memberToolsLine(null)).toEqual({ kind: 'hidden' })
    expect(memberToolsLine(undefined)).toEqual({ kind: 'hidden' })
    expect(memberToolsLine(status())).toMatchObject({ kind: 'ok', names: GAME })
    expect(memberToolsLine(status({ process: 'placeholder', received: [] }))).toMatchObject({ kind: 'missing', missing: GAME, received: [], cause: 'failed', afterReload: false })
    expect(memberToolsLine(status({ process: 'empty', received: [] }))).toMatchObject({ kind: 'missing', cause: 'empty' })
    expect(memberToolsLine(status({ received: GAME.slice(0, 3) }))).toMatchObject({ kind: 'missing', cause: 'partial', missing: GAME.slice(3) })
    expect(memberToolsLine(status({ process: 'unreported', received: [] }))).toEqual({ kind: 'unknown', total: 5, hint: 'old' })
    expect(memberToolsLine(status({ process: 'none', received: [] }))).toEqual({ kind: 'unknown', total: 5, hint: 'no-process' })
    expect(memberToolsLine(status({ reload: { state: 'reloading', since: AT } }))).toEqual({ kind: 'reloading', total: 5 })
    expect(memberToolsLine(status({ process: 'placeholder', received: [], reload: { state: 'scheduled', since: AT } }))).toEqual({ kind: 'scheduled', received: 0, total: 5 })
  })

  it('a reload that did not help says so; one that did is "just reloaded" only for the dialog that asked', () => {
    expect(memberToolsLine(status({ process: 'placeholder', received: [], lastReload: { at: AT, by: 'manual', outcome: 'missing' } }))).toMatchObject({ afterReload: true })
    const done = status({ lastReload: { at: AT + 10, by: 'manual', outcome: 'loaded' } })
    expect(memberToolsLine(done, AT)).toMatchObject({ kind: 'ok', note: { kind: 'reloaded' } })
    expect(memberToolsLine(done)).not.toHaveProperty('note')
    expect(memberToolsLine(status({ autoReloadAt: AT }))).toMatchObject({ note: { kind: 'auto', at: AT } })
    expect(memberToolsLine(status({ process: 'unreported', received: [], lastReload: { at: AT, by: 'manual', outcome: 'pending' } }))).toMatchObject({ hint: 'next-message' })
  })

  it('shortens the mode name the meta row already calls a mode', () => {
    expect(modeShortName('游戏开发模式')).toBe('游戏开发')
    expect(modeShortName('Game dev mode')).toBe('Game dev')
    expect(modeShortName('模式')).toBe('模式')
  })
})

function line(read: LocalAgentMemberToolsStatus | null, options: { running?: boolean; reload?: (child: string) => Promise<LocalAgentMemberToolsReload | undefined>; locale?: Record<string, string> } = {}) {
  const reads = vi.fn(async () => read)
  const reload = vi.fn(options.reload ?? (async () => ({ ok: true as const, when: 'now' as const })))
  const view = render(
    <MemberToolsLine
      childSessionId="child-gm"
      modeName="游戏开发"
      provider="kimi-cli"
      running={options.running ?? false}
      read={reads}
      reload={reload}
      t={makeTranslate(options.locale ?? zh)}
    />,
  )
  return { reads, reload, view }
}

describe('MemberToolsLine', () => {
  it('normal: one quiet line; 查看 expands the chips, the footnote and a neutral 重新载入', async () => {
    line(status())
    await screen.findByText('游戏开发 5')
    expect(screen.getByText('模式工具')).toBeTruthy()
    expect(screen.getByText('✓')).toBeTruthy()
    expect(screen.queryByText('重新载入')).toBeNull()
    fireEvent.click(screen.getByText('查看 ▾'))
    for (const name of GAME) expect(screen.getByText(name)).toBeTruthy()
    expect(screen.getByText(/另有房间协作工具.*kimi-cli 自带/)).toBeTruthy()
    expect(screen.getByText('重新载入')).toBeTruthy()
    expect(screen.getByText('上次载入：22:36')).toBeTruthy()
    expect(screen.getByText('收起 ▴')).toBeTruthy()
  })

  it('missing (idle): amber count, the button inline, a plain reason, the missing tools dashed', async () => {
    const { reload } = line(status({ process: 'placeholder', received: [] }))
    await screen.findByText('游戏开发 0/5')
    expect(screen.getByText(/未载入/)).toBeTruthy()
    expect(screen.getByText('22:36 取工具清单失败，这个成员现在用不了游戏开发工具')).toBeTruthy()
    expect(screen.getByText('game_publish').className).toMatch(/missingChip/)
    fireEvent.click(screen.getByText('重新载入'))
    await waitFor(() => { expect(reload).toHaveBeenCalledWith('child-gm') })
  })

  it('missing (running): 结束后重新载入, and no chips', async () => {
    line(status({ process: 'placeholder', received: [] }), { running: true })
    await screen.findByText('结束后重新载入')
    expect(screen.getByText('运行中不能换进程；这一轮结束后会自动重新载入，不点也会')).toBeTruthy()
    expect(screen.queryByText('game_publish')).toBeNull()
  })

  it('scheduled, reloading, reloaded, still missing, auto-reloaded', async () => {
    line(status({ process: 'placeholder', received: [], reload: { state: 'scheduled', since: AT } }), { running: true })
    await screen.findByText('已安排')
    expect(screen.getByText('这一轮结束后马上重新载入，对话照常接续')).toBeTruthy()
    cleanup()
    line(status({ reload: { state: 'reloading', since: AT } }))
    await screen.findByText('重新载入中…')
    expect((screen.getByText('重新载入') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    line(status({ process: 'placeholder', received: [], lastReload: { at: AT, by: 'manual', outcome: 'missing' } }))
    await screen.findByText(/^重新载入后仍取不到：22:36/)
    cleanup()
    line(status({ autoReloadAt: AT }))
    await screen.findByText('22:36 发现游戏开发工具没载入，已自动重新载入')
  })

  it('an idle reload shows 刚刚重新载入完成 in place once the new process listed', async () => {
    let current = status({ process: 'placeholder', received: [] })
    const reads = vi.fn(async () => current)
    const reload = vi.fn(async () => {
      current = status({ loadedAt: Date.now(), lastReload: { at: Date.now() + 1, by: 'manual', outcome: 'loaded' } })
      return { ok: true as const, when: 'now' as const }
    })
    render(<MemberToolsLine childSessionId="child-gm" modeName="游戏开发" provider="kimi-cli" running={false} read={reads} reload={reload} t={makeTranslate(zh)} />)
    fireEvent.click(await screen.findByText('重新载入'))
    await screen.findByText('刚刚重新载入完成')
    expect(screen.getByText('游戏开发 5')).toBeTruthy()
  })

  it('unreported is neutral, never broken; no process says when it loads', async () => {
    line(status({ process: 'unreported', received: [] }))
    await screen.findByText('未上报')
    expect(screen.getByText('这个成员的进程启动得比较早，没有上报工具清单；重新载入后就能看到')).toBeTruthy()
    expect(screen.queryByText(/⚠/)).toBeNull()
    cleanup()
    line(status({ process: 'none', received: [] }))
    await screen.findByText(/下一条消息时载入/)
    expect(screen.queryByText('重新载入')).toBeNull()
  })

  it('立即载入: no process but one can start — the button, then 载入中…, then the result in place', async () => {
    let current = status({ process: 'none', received: [], startable: true })
    const reads = vi.fn(async () => current)
    let finish!: () => void
    const reload = vi.fn(async () => {
      current = status({ process: 'none', received: [], reload: { state: 'reloading', since: Date.now() } })
      finish = () => { current = status({ loadedAt: Date.now(), lastReload: { at: Date.now() + 1, by: 'manual', outcome: 'loaded' } }) }
      return { ok: true as const, when: 'now' as const }
    })
    render(<MemberToolsLine childSessionId="child-gm" modeName="游戏开发" provider="codex-local" running={false} read={reads} reload={reload} t={makeTranslate(zh)} />)
    await screen.findByText(/下一条消息时载入/)
    expect(screen.getByText('启动这个成员的进程并载入工具，对话照常接续')).toBeTruthy()
    fireEvent.click(screen.getByText('立即载入'))
    await screen.findByText('载入中…')
    expect((screen.getByText('立即载入') as HTMLButtonElement).disabled).toBe(true)
    expect(reload).toHaveBeenCalledWith('child-gm')
    finish()
    await screen.findByText('刚刚载入完成', {}, { timeout: 3_000 })
    expect(screen.getByText('游戏开发 5')).toBeTruthy()
  })

  it('立即载入 that still cannot get the tools, or could not start, says so', async () => {
    let current = status({ process: 'none', received: [], startable: true })
    const reads = vi.fn(async () => current)
    const reload = vi.fn(async () => {
      current = status({ process: 'placeholder', received: [], lastReload: { at: AT, by: 'manual', outcome: 'missing' } })
      return { ok: true as const, when: 'now' as const }
    })
    render(<MemberToolsLine childSessionId="child-gm" modeName="游戏开发" provider="codex-local" running={false} read={reads} reload={reload} t={makeTranslate(zh)} />)
    fireEvent.click(await screen.findByText('立即载入'))
    await screen.findByText(/^载入后仍取不到：22:36/)
    cleanup()
    expect(memberToolsLine(status({ process: 'none', received: [], startable: true, lastReload: { at: AT + 5, by: 'manual', outcome: 'failed' } }), AT))
      .toMatchObject({ kind: 'unknown', hint: 'no-process', startable: true, startFailed: true })
  })

  it('no process and nothing to start: text only, as before', async () => {
    line(status({ process: 'none', received: [] }))
    await screen.findByText(/下一条消息时载入/)
    expect(screen.queryByText('立即载入')).toBeNull()
  })

  it('an unknown mode size reads 「—」, never 0', async () => {
    expect(memberToolsLine(status({ process: 'none', expected: [], expectedUnknown: true, received: [] }))).toMatchObject({ kind: 'unknown', total: undefined })
    line(status({ process: 'none', expected: [], expectedUnknown: true, received: [], startable: true }))
    await screen.findByText(/^游戏开发 —/)
    expect(screen.queryByText(/游戏开发 0/)).toBeNull()
    cleanup()
    line(status({ process: 'placeholder', expected: [], expectedUnknown: true, received: [] }))
    await screen.findByText('游戏开发 0/—')
  })

  it('the English 立即载入', async () => {
    line(status({ process: 'none', received: [], startable: true }), { locale: en })
    await screen.findByText('Load now')
    expect(screen.getByText('Starts this member’s process and loads its tools; the conversation carries on')).toBeTruthy()
  })

  it('a member without a mode has no line at all', async () => {
    const { reads, view } = line(null)
    await waitFor(() => { expect(reads).toHaveBeenCalled() })
    expect(view.container.textContent).toBe('')
  })

  it('a refused reload explains itself', async () => {
    line(status({ process: 'unreported', received: [] }), { reload: async () => ({ ok: false, reason: 'no-process' }) })
    fireEvent.click(await screen.findByText('重新载入'))
    await screen.findByText('这个成员现在没有在运行的进程，下一条消息时会重新载入')
  })

  it('the English line', async () => {
    line(status({ process: 'placeholder', received: [] }), { locale: en })
    await screen.findByText('Mode tools')
    expect(screen.getByText(/Not loaded/)).toBeTruthy()
    expect(screen.getByText('Reload')).toBeTruthy()
  })

  it('no internal words reach the user in either language', () => {
    for (const dictionary of [zh, en]) {
      for (const [key, text] of Object.entries(dictionary)) {
        if (!key.startsWith('tools.') && !key.startsWith('event.tools.')) continue
        expect(text).not.toMatch(/token|socket|bridge|MCP|桥接/i)
      }
    }
  })
})

function notice(data: Record<string, unknown>, extra: Partial<RoomEventViewProps> = {}, locale: Record<string, string> = zh) {
  const props = {
    node: { data: { seq: 1, time: 1, sub: 'member-tools', member: '游戏大师', ...data } },
    sessionId: 'room-1',
    modeNames: async () => new Map([['dsh-gamedev', '游戏开发模式']]),
    t: makeTranslate(locale),
    ...extra,
  } as unknown as RoomEventViewProps
  return render(<RoomEventView {...props} />)
}

describe('the room\'s mode-tools notice', () => {
  it('an automatic reload before the round: one amber line, no action', async () => {
    notice({ tools: { kind: 'reloaded', preset: 'dsh-gamedev', during: 'round' } })
    await screen.findByText(/的游戏开发工具没有载入，已在这一轮开始前自动重新载入（对话照常接续）/)
    expect(screen.getByText('游戏大师').tagName).toBe('B')
    expect(screen.queryByText('编辑成员')).toBeNull()
  })

  it('still unavailable: the line offers 编辑成员 when the members face is there', async () => {
    const members = { roomStore: { getCached: () => undefined } } as never
    notice({ tools: { kind: 'unavailable', preset: 'dsh-gamedev', during: 'round' } }, { members })
    await screen.findByText(/的游戏开发工具暂时取不到，这一轮先用房间工具；结束后会再试一次/)
    expect(screen.getByText('编辑成员')).toBeTruthy()
  })

  it('without the mode names it still reads, and the English line', async () => {
    notice({ tools: { kind: 'unavailable', preset: 'x', during: 'idle' } }, { modeNames: undefined }, en)
    await screen.findByText(/’s mode tools are still unavailable after reloading/)
  })
})

describe('the edit dialog head agrees with the 模式工具 line', () => {
  const member: RoomMember = { id: 'm1', name: 'gm', kind: 'cli', provider: 'kimi-cli', preset: 'dsh-gamedev', invitedBy: 'human', childSessionId: 'child-gm' as never }
  function dialog(run: RoomMemberRun | undefined) {
    const running = run?.state === 'running'
    return render(
      <InviteDialog
        mode="edit"
        member={member}
        presets={[{ id: 'dsh-gamedev', name: '游戏开发模式', isDefault: false }]}
        localAgentAvailable
        existingNames={['gm']}
        browseDirectory={async () => null}
        memberRunning={running}
        memberRun={run}
        memberTools={async () => status({ process: 'placeholder', received: [] })}
        reloadMemberTools={async () => ({ ok: true, when: running ? 'after-round' : 'now' })}
        onSubmit={async () => ({ ok: true })}
        onClose={() => {}}
        t={makeTranslate(zh)}
      />,
    )
  }

  it('a running member reads 运行中 in the head card, never 空闲, while the line offers 结束后重新载入', async () => {
    const view = dialog({ member: 'gm', state: 'running', startedAt: Date.now() - 65_000 } as RoomMemberRun)
    await screen.findByText('结束后重新载入')
    const card = view.container.querySelector('[data-member="gm"]')!
    expect(card.textContent).toContain(zh['members.status.running'])
    expect(card.textContent).not.toContain(zh['members.status.idle'])
  })

  it('an idle member reads 空闲, a failed one 失败', async () => {
    const idle = dialog(undefined)
    await screen.findByText('重新载入')
    expect(idle.container.querySelector('[data-member="gm"]')!.textContent).toContain(zh['members.status.idle'])
    cleanup()
    const failed = dialog({ member: 'gm', state: 'failed', startedAt: 1 } as RoomMemberRun)
    expect(failed.container.querySelector('[data-member="gm"]')!.textContent).toContain(zh['members.status.failed'])
  })
})
