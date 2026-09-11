/** Copy for controls owned by mobile; all conversation copy stays with its owner. */
export const NS = 'mobile'
export const en = {
  currentConversation: 'Current conversation',
  loadingAgents: 'Checking available agents…', noAgents: 'No local agents are available on this host.', loginAgents: 'Sign in to an agent on the computer before inviting it.',
  queued: 'Queued messages', queueError: 'Could not update the queue. Please try again.', editQueued: 'Edit', removeQueued: 'Remove', sendNow: 'Send now', sendingQueued: 'Waiting for host admission…',
  members: 'Members', membersHint: 'Open a member conversation, or adjust its role.', inviteMember: 'Invite member', memberSettings: 'Member settings', duplicateMember: 'This member name is already in use.', invalidMember: 'Use a name without spaces or @.', roomError: 'Could not complete this request. Check the connection and try again.', mainMember: 'Main agent', openMemberChat: 'Open conversation', awaitingMember: 'Waiting for a first task', agentProvider: 'Agent', chooseProvider: 'Choose an available agent', needsLogin: 'Sign in on computer', memberName: 'Name', memberRole: 'Role instructions', memberRoleHint: 'What should this member focus on?', inviteHint: 'Invitation adds the member. Send an @message in the room to start a task.', roleChangeHint: 'Role changes apply to subsequent dispatches.', advanced: 'Advanced', inheritWorkspace: 'Inherit room workspace', saving: 'Saving…', save: 'Save', stopMemberConfirm: 'Stop this member’s current task?', removeMemberConfirm: 'Remove this member from the room? Its conversation history is retained.', confirm: 'Confirm', stopMember: 'Stop task', removeMember: 'Remove member', backMembers: 'Back to members', memberUnit: 'members',
  inputTools: 'Add and configure', closeTools: 'Close input tools', attachments: 'Add attachment', commands: 'Commands', permissions: 'Permissions',
  welcome: 'What would you like to do?', welcomeHint: 'Continue an idea, or start a new task.',
  menu: 'Conversations', close: 'Close navigation', title: 'Your workspace, with you',
  settings: 'Mobile settings', back: 'Back', display: 'Display',
  automatic: 'Follow screen size', mobile: 'Mobile', desktop: 'Desktop',
  restoreMobile: 'Return to mobile layout',
  appearance: 'Layout applies only to this browser.',
  connection: 'Connection', reconnect: 'Reconnect', connected: 'Connected',
  connecting: 'Connecting…', disconnected: 'Connection interrupted',
  server: 'Host', privacy: 'Models, tools and files run on your host.',
  done: 'Done', brand: 'DSH',
  grouping: 'Conversation view', byTime: 'Time', byWorkspace: 'Workspace', today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier', unassignedWorkspace: 'No workspace', scan: 'Scan to connect', conversation: 'Conversation', options: 'Conversation options', connectionSettings: 'Connection settings',
  libraryEyebrow: 'YOUR WORKSPACE', libraryTitle: 'Pick up where you left off.', librarySubtitle: 'A thought, a conversation, a little progress.', newSession: 'New conversation', searchTitles: 'Search', searchResults: 'Results', recent: 'Recent conversations', workspaces: 'Workspaces', loadingSessions: 'Loading conversations…', noMatches: 'No matching conversations.', noSessions: 'Your conversations will appear here.', navigationError: 'Could not open this conversation. Please try again.', running: 'Working', completed: 'Completed', libraryFooter: 'A little closer, wherever you are.',
  workspace: 'Open workspace', hostPath: 'Computer directory', hostPathHelp: 'Enter an existing absolute directory on your computer. This does not select a folder on your phone.', openWorkspace: 'Open', cancel: 'Cancel',
} as const
export const zh: Record<keyof typeof en, string> = {
  currentConversation: '当前会话',
  loadingAgents: '正在检查可用代理…', noAgents: '这台电脑暂时没有可用的本地代理。', loginAgents: '请先在电脑上登录代理，再邀请加入。',
  queued: '排队消息', queueError: '队列更新失败，请重试。', editQueued: '编辑', removeQueued: '移除', sendNow: '立即发送', sendingQueued: '等待主机确认…',
  members: '成员', membersHint: '进入成员对话，或调整成员的分工。', inviteMember: '邀请成员', memberSettings: '成员设置', duplicateMember: '这个成员名称已被使用。', invalidMember: '成员名称不能包含空格或 @。', roomError: '操作未完成，请检查连接后重试。', mainMember: '主代理', openMemberChat: '进入对话', awaitingMember: '等待首个任务', agentProvider: '代理', chooseProvider: '选择可用代理', needsLogin: '需在电脑登录', memberName: '名称', memberRole: '角色指令', memberRoleHint: '这位成员主要负责什么？', inviteHint: '邀请仅添加成员。在群聊中发送 @消息后才开始任务。', roleChangeHint: '角色修改从后续任务开始生效。', advanced: '高级信息', inheritWorkspace: '跟随群聊工作区', saving: '正在保存…', save: '保存', stopMemberConfirm: '停止这位成员当前的任务？', removeMemberConfirm: '将这位成员移出群聊？已有对话记录会保留。', confirm: '确认', stopMember: '停止任务', removeMember: '移出成员', backMembers: '返回成员列表', memberUnit: '位成员',
  inputTools: '添加与设置', closeTools: '关闭输入工具', attachments: '添加附件', commands: '指令', permissions: '会话权限',
  welcome: '今天想做点什么？', welcomeHint: '继续一个想法，或开始新的任务。',
  menu: '会话', close: '关闭会话导航', title: '工作空间，随身同行',
  settings: '移动端设置', back: '返回', display: '界面',
  automatic: '跟随屏幕尺寸', mobile: '移动布局', desktop: '桌面布局',
  restoreMobile: '返回移动布局',
  appearance: '布局设置仅对当前客户端生效。',
  connection: '连接', reconnect: '重新连接', connected: '已连接',
  connecting: '正在连接…', disconnected: '连接已中断',
  server: '主机', privacy: '模型、工具与文件操作由电脑执行。',
  done: '完成', brand: 'DSH',
  grouping: '会话查看方式', byTime: '时间', byWorkspace: '工作区', today: '今天', yesterday: '昨天', earlier: '更早', unassignedWorkspace: '未指定工作区', scan: '扫码连接电脑', conversation: '会话', options: '会话选项', connectionSettings: '连接设置',
  libraryEyebrow: '随身工作空间', libraryTitle: '继续你的想法。', librarySubtitle: '从一段对话，开始新的进展。', newSession: '新建会话', searchTitles: '搜索', searchResults: '搜索结果', recent: '最近会话', workspaces: '工作区', loadingSessions: '正在加载会话…', noMatches: '没有匹配的会话。', noSessions: '新的对话，会出现在这里。', navigationError: '暂时无法打开这段会话，请重试。', running: '进行中', completed: '已完成', libraryFooter: '让每一个想法，向前一步。',
  workspace: '打开工作区', hostPath: '电脑目录', hostPathHelp: '输入电脑上已有目录的完整路径。这里选择的是电脑工作区，不是手机文件夹。', openWorkspace: '打开', cancel: '取消',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { mobile: keyof typeof en }
}
