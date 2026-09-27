/** Manual UI fixture: pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1 */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RoomActivityDock } from '../../src/client/RoomActivityDock.tsx'
import { zh } from '../../src/client/locales.ts'
import type { RoomState } from '../../src/types.ts'

const t = ((key: keyof typeof zh, vars?: Record<string, unknown>) => zh[key].replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
const initial: RoomState = {
  members: [{ id: 'd', name: 'dsh', kind: 'main-agent', invitedBy: 'human' }, { id: 'c', name: 'codex', kind: 'cli', provider: 'codex', invitedBy: 'human', childSessionId: 'child-c' as never }, { id: 'k', name: 'kimi', kind: 'cli', provider: 'kimi', invitedBy: 'human', childSessionId: 'child-k' as never }],
  tasks: [], relays: [], runs: [],
  executions: [{ id: '1:c', runId: '1:c', memberId: 'c', member: 'codex', childSessionId: 'child-c' as never, state: 'running', startedAt: Date.now() - 272000 }, { id: '2:k', runId: '2:k', memberId: 'k', member: 'kimi', childSessionId: 'child-k' as never, state: 'done', startedAt: Date.now() - 300000, elapsedMs: 78000, model: 'K3', effort: 'high', tokens: 18421 }],
  deliveries: [{ id: '1:c', dispatchSeq: 1, memberId: 'c', origin: 'coordinator', status: 'running', text: '实现 Agent 执行面板与会话跳转' }, { id: '2:k', dispatchSeq: 2, memberId: 'k', origin: 'coordinator', status: 'done', text: '检查子会话流式输出' }],
  plan: { version: 1, id: 'goal', revision: 1, objective: 'Room 体验优化', status: 'running', activeMs: 0, budget: { maxParallel: 2, maxAttempts: 12, maxAttemptsPerTask: 3, maxActiveMs: 1800000 }, stages: [{ id: 'stage', title: '实现与联调' }], tasks: [{ id: 'task', title: '实现 Agent 执行面板与会话跳转', stageId: 'stage', kind: 'task', ownerMemberId: 'c', status: 'running', instruction: '保留任务记录、查看会话和中止入口。', criteria: ['桌面与窄屏可用'], inputRefs: [], artifactPaths: [], dependsOn: [], attempts: [] }] },
}

function Preview() {
  const [state, setState] = useState(initial)
  const [notice, setNotice] = useState('实际 Room 组件 · 隔离示例数据')
  return <main style={{ maxWidth: 780, margin: '40px auto', padding: 16, fontFamily: 'system-ui', color: 'var(--dsw-alias-label-primary)' }}>
    <style>{`:root{color-scheme:light dark;--dsw-alias-label-primary:light-dark(#222,#eee);--dsw-alias-label-tertiary:light-dark(#747980,#a6abb2);--dsw-alias-bg-layer-1:light-dark(#fff,#202124);--dsw-alias-bg-layer-2:light-dark(#f3f4f6,#2a2b2e);--dsw-specific-menu:var(--dsw-alias-bg-layer-1);--dsw-alias-state-success-primary:#34a853}body{margin:0;background:light-dark(#fff,#17181a)}button,textarea{font:inherit}*{box-sizing:border-box}`}</style>
    <p style={{ marginBottom: 32 }}>我把界面实现交给 Codex，流式链路检查交给 Kimi，完成后汇总验收。</p>
    <RoomActivityDock state={state} t={t} openSession={id => setNotice(`打开会话：${id}`)} stopExecution={async (_name, run) => {
      setState(previous => ({ ...previous, executions: previous.executions!.map(row => row.runId === run.runId ? { ...row, state: 'cancelled', elapsedMs: Date.now() - row.startedAt } : row), deliveries: previous.deliveries!.map(row => row.id === run.runId ? { ...row, status: 'cancelled' } : row) }))
      return { ok: true }
    }} planCommand={async () => ({ ok: false, message: '此预览不提交真实目标操作' })} />
    <div style={{ padding: 16, border: '1px solid #8884', borderRadius: 22, background: 'var(--dsw-alias-bg-layer-2)' }}><small>协调者 · dsh</small><textarea aria-label="给协调者发消息" placeholder="跟协调者对话；@ 指定其他成员" style={{ display: 'block', width: '100%', minHeight: 90, border: 0, background: 'transparent', color: 'inherit', resize: 'vertical', marginTop: 12 }} /></div>
    <p role="status" style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{notice}</p>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
