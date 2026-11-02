/**
 * Manual UI fixture for the edit dialog's 模式工具 line and the room's
 * mode-tools notice (the real components, with a scripted local-agent read):
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /member-tools.html?state=<ok|okOpen|missing|queued|reloaded|running|scheduled|healed|unknown|nomode|feed>[&lang=en][&dark=1]
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { LocalAgentMemberToolsReload, LocalAgentMemberToolsStatus } from '@khorsheed/dsh-local-agent/types'
import { InviteDialog } from '../../src/client/InviteDialog.tsx'
import { RoomEventView } from '../../src/client/RoomEventView.tsx'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomMember } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'ok'
const dictionary: Record<string, string> = params.get('lang') === 'en' ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const GAME = ['game_open', 'game_read', 'game_propose', 'game_publish', 'typesafe_judge']
const at = (hours: number, minutes: number) => new Date(2026, 10, 2, hours, minutes).getTime()
const base: LocalAgentMemberToolsStatus = { preset: 'dsh-gamedev', expected: GAME, process: 'full', received: GAME, loadedAt: at(22, 54), reloadable: true }
const missing: LocalAgentMemberToolsStatus = { ...base, process: 'placeholder', received: [], loadedAt: at(22, 36) }
const STATUS: Record<string, LocalAgentMemberToolsStatus | null> = {
  ok: base,
  okOpen: base,
  missing,
  queued: { ...missing, reload: { state: 'reloading', since: Date.now() } },
  reloaded: { ...base, loadedAt: Date.now(), lastReload: { at: Date.now() + 60_000, by: 'manual', outcome: 'loaded' } },
  running: missing,
  scheduled: { ...missing, reload: { state: 'scheduled', since: Date.now() } },
  healed: { ...base, autoReloadAt: at(23, 41) },
  unknown: { ...base, process: 'unreported', received: [] },
  stillMissing: { ...missing, lastReload: { at: at(22, 40), by: 'manual', outcome: 'missing' } },
  nomode: null,
}

const member: RoomMember = {
  id: 'm1',
  name: '人物建模大师',
  kind: 'cli',
  provider: 'kimi-cli',
  role: '人物建模',
  ...state === 'nomode' ? {} : { preset: 'dsh-gamedev' },
  invitedBy: 'human',
  instructions: '你是一个游戏开发会话里的协作成员，名字叫「人物建模大师」。会话主人正在和我（协调者）一起设计并开发一个小型网页游戏，右侧游戏面板会展示设计文档和可玩版本……',
  childSessionId: 'child-gm' as never,
}

function Dialog() {
  // 查看 opens on its own for the expanded state; 重新载入完成 needs the click the dialog remembers.
  useEffect(() => {
    const click = (label: string) => {
      const timer = setInterval(() => {
        const button = [...document.querySelectorAll('button')].find(entry => entry.textContent === label)
        if (button !== undefined) { button.click(); clearInterval(timer) }
      }, 50)
    }
    if (state === 'okOpen') click(dictionary['tools.view']!)
    if (state === 'reloaded') click(dictionary['tools.reload']!)
  }, [])
  let current = state === 'reloaded' ? missing : STATUS[state] ?? null
  const read = async () => current
  const reload = async (): Promise<LocalAgentMemberToolsReload> => {
    current = STATUS['reloaded']!
    return { ok: true, when: 'now' }
  }
  return (
    <InviteDialog
      mode="edit"
      member={member}
      presets={[{ id: 'dsh-gamedev', name: params.get('lang') === 'en' ? 'Game dev mode' : '游戏开发模式', isDefault: false }]}
      localAgentAvailable
      existingNames={[member.name]}
      browseDirectory={async () => null}
      memberRunning={state === 'running' || state === 'scheduled'}
      memberTools={read}
      reloadMemberTools={reload}
      onSubmit={async () => ({ ok: true })}
      onClose={() => {}}
      t={t}
    />
  )
}

function Feed() {
  const notice = (seq: number, member: string, tools: Record<string, string>) => (
    <RoomEventView
      {...{
        node: { data: { seq, time: 1, sub: 'member-tools', member, tools } },
        sessionId: 'room-1',
        modeNames: async () => new Map([['dsh-gamedev', params.get('lang') === 'en' ? 'Game dev mode' : '游戏开发模式']]),
        members: { roomStore: { getCached: () => undefined } },
        t,
      } as never}
    />
  )
  const bubble = (who: string, text: string) => (
    <div style={{ background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 14, padding: '12px 16px' }}>
      <b>{who}</b><p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)' }}>{text}</p>
    </div>
  )
  return (
    <main style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {bubble('你', '@人物建模大师 把阿沅的脸再修一下，修完直接发布。')}
      {notice(1, '人物建模大师', { kind: 'reloaded', preset: 'dsh-gamedev', during: 'round' })}
      {bubble('人物建模大师 · kimi-cli', '阿沅的五官已重新雕刻……检查 71/71 通过，已用 game_publish 发布 v34 到试玩区。')}
      {notice(2, '游戏大师', { kind: 'unavailable', preset: 'dsh-gamedev', during: 'round' })}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(state === 'feed' ? <Feed /> : <Dialog />)
