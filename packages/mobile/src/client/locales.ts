/** Copy for controls owned by mobile; all conversation copy stays with its owner. */
export const NS = 'mobile'
export const en = {
  menu: 'Conversations', close: 'Close navigation', title: 'Your workspace, with you',
  settings: 'Mobile settings', back: 'Back', display: 'Display',
  automatic: 'Follow screen size', mobile: 'Mobile', desktop: 'Desktop',
  appearance: 'Layout applies only to this browser.',
  connection: 'Connection', reconnect: 'Reconnect', connected: 'Connected',
  connecting: 'Connecting…', disconnected: 'Connection interrupted',
  server: 'Host', privacy: 'Models, tools and files run on your host.',
  done: 'Done', brand: 'DSH',
  grouping: 'Conversation view', byTime: 'Time', byWorkspace: 'Workspace', today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier', unassignedWorkspace: 'No workspace', scan: 'Scan to connect', conversation: 'Conversation', options: 'Conversation options', connectionSettings: 'Connection settings',
  libraryEyebrow: 'YOUR WORKSPACE', libraryTitle: 'Pick up where you left off.', librarySubtitle: 'A thought, a conversation, a little progress.', newSession: 'New conversation', searchTitles: 'Search titles or workspaces', searchResults: 'Results', recent: 'Recent conversations', workspaces: 'Workspaces', loadingSessions: 'Loading conversations…', noMatches: 'No matching conversations.', noSessions: 'Your conversations will appear here.', navigationError: 'Could not open this conversation. Please try again.', running: 'Working', completed: 'Completed', libraryFooter: 'A little closer, wherever you are.',
  workspace: 'Open workspace', hostPath: 'Computer directory', hostPathHelp: 'Enter an existing absolute directory on your computer. This does not select a folder on your phone.', openWorkspace: 'Open', cancel: 'Cancel',
} as const
export const zh: Record<keyof typeof en, string> = {
  menu: '会话', close: '关闭会话导航', title: '工作空间，随身同行',
  settings: '移动端设置', back: '返回', display: '界面',
  automatic: '跟随屏幕尺寸', mobile: '移动布局', desktop: '桌面布局',
  appearance: '布局设置仅对当前客户端生效。',
  connection: '连接', reconnect: '重新连接', connected: '已连接',
  connecting: '正在连接…', disconnected: '连接已中断',
  server: '主机', privacy: '模型、工具与文件操作由电脑执行。',
  done: '完成', brand: 'DSH',
  grouping: '会话查看方式', byTime: '时间', byWorkspace: '工作区', today: '今天', yesterday: '昨天', earlier: '更早', unassignedWorkspace: '未指定工作区', scan: '扫码连接电脑', conversation: '会话', options: '会话选项', connectionSettings: '连接设置',
  libraryEyebrow: '随身工作空间', libraryTitle: '继续你的想法。', librarySubtitle: '从一段对话，开始新的进展。', newSession: '新建会话', searchTitles: '搜索标题或工作区', searchResults: '搜索结果', recent: '最近会话', workspaces: '工作区', loadingSessions: '正在加载会话…', noMatches: '没有匹配的会话。', noSessions: '新的对话，会出现在这里。', navigationError: '暂时无法打开这段会话，请重试。', running: '进行中', completed: '已完成', libraryFooter: '让每一个想法，向前一步。',
  workspace: '打开工作区', hostPath: '电脑目录', hostPathHelp: '输入电脑上已有目录的完整路径。这里选择的是电脑工作区，不是手机文件夹。', openWorkspace: '打开', cancel: '取消',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { mobile: keyof typeof en }
}
