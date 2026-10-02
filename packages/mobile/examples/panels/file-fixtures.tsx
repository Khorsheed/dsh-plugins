/** Actual plugin views/stores with delayed sample Remotes; no host filesystem access. */
import { useSyncExternalStore } from 'react'
import { WorkspaceView } from '../../../local-files/src/client/WorkspaceView.tsx'
import { createLocalFilesStore } from '../../../local-files/src/client/store-local.ts'
import { zh as filesZh } from '../../../local-files/src/client/locales.ts'
import { WorktreesTab } from '../../../worktrees/src/client/WorktreesTab.tsx'
import { createWorktreesStore } from '../../../worktrees/src/client/store.ts'
import { zh as worktreesZh } from '../../../worktrees/src/client/locales.ts'
const translate = dictionary => (key, params = {}) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
const reply = value => new Promise(resolve => setTimeout(() => resolve({ ok: true, value }), 350))
const hook = instance => selector => selector(useSyncExternalStore(instance.subscribe, instance.getSnapshot))
const noop = () => {}
const files = createLocalFilesStore().create()
const fileProps = {
  sessionId: 'preview', useStore: hook(files), actions: files.actions, t: translate(filesZh),
  useSessions: selector => selector({ byId: { preview: { cwd: '/workspace/dsh-plugins' } } }),
  listDirectory: () => reply({ entries: [{ name: 'AGENTS.md', isDir: false }, { name: 'README.md', isDir: false }] }),
  readFile: ({ path }) => reply({ path, kind: 'text', content: '# Mobile 面板验收\n\n这里使用真实文件浏览器和状态仓库，内容为异步样例数据。\n\n返回文件列表后再次打开同一文件，正文应仍然存在。\n\n- 横向滑动切换标签\n- 读取期间显示加载状态\n- 返回按钮保留图标与文字间距' }),
  pickWorkspace: async () => null, useOpenInApps: selector => selector([]), openFolder: noop, openIDE: noop,
}
export function Files() { return <WorkspaceView {...fileProps as any}/> }
const worktrees = createWorktreesStore().create()
const changed = Array.from({ length: 8 }, (_, i) => ({ path: `file-${i + 1}.ts`, status: 'M', additions: i + 1, deletions: 0 }))
const tab = { id: 'worktrees-preview', signal: new AbortController().signal, navigation: { address: 'sidebar://worktrees', params: { mode: 'commits' }, revision: 1 } }
const worktreeProps = {
  sessionId: 'preview', useStore: hook(worktrees), actions: worktrees.actions, t: translate(worktreesZh),
  useTabInfo: () => ({ tab }), useOpenInApp: selector => selector([]),
  fetchSummary: () => reply({ isRepo: true, repo: '/workspace/dsh-plugins', repoName: 'dsh-plugins', branch: 'main', isMain: true, head: 'abc12345', ahead: 0, behind: 0, dirty: 0, uncommitted: { additions: 0, deletions: 0 }, committed: { additions: 36, deletions: 0 }, baseRef: 'main' }),
  fetchChanges: () => reply({ uncommitted: [], committed: [] }),
  fetchRepoFiles: () => reply(changed.map(file => file.path)),
  fetchCommitLog: () => reply([{ sha: 'abc12345', subject: 'fix(mobile): 保留文件和提交详情', author: 'Preview', time: 1790953200, branches: 'main', files: 8 }]),
  fetchCommitFiles: () => reply({ sha: 'abc12345', files: changed, body: '真实组件 · 异步样例数据' }),
  fetchWorktrees: () => reply([{ path: '/workspace/dsh-plugins', branch: 'main', isMain: true, dirty: 0, stale: false }]),
  fetchFileDiff: () => reply({ diff: 'diff --git a/file-1.ts b/file-1.ts\n--- a/file-1.ts\n+++ b/file-1.ts\n@@ -0,0 +1 @@\n+// retained preview\n' }),
  fetchReadFile: () => reply({ content: '// retained preview\n' }), fetchReadFileAtCommit: () => reply({ content: '// retained preview\n' }),
  fetchReadRepoImage: noop, switchWorktree: noop, directAgent: noop, bumpVersion: noop, openExternal: noop, copyBranch: async () => true,
}
export function Worktrees() { return <WorktreesTab {...worktreeProps as any}/> }
