/** `local-agent` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'local-agent'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'list.aria': '{harness} 会话记录',
  'list.title': '{harness} 会话记录',
  'empty': '作用域内还没有 {harness} 会话',
  'login.hint': '运行 /{command} login 授权后开始委派',
  'loading': '加载中…',
  'error': '无法读取 {harness} 会话记录',
  'unknown.command': '/{command} sessions 不可用（{harness} 插件未安装？）',
  'row.aria': '{harness} 会话 {sessionId}',
  'workdir': '工作目录',
  'settings.nav': '本地 Agent',
  'settings.intro': '管理本机安装的编码 agent CLI：查看授权状态，通过网页登录授权。',
  'settings.noSession': '先打开一个会话，再管理本地 agent',
  'settings.authenticated': '已登录',
  'settings.notAuthenticated': '未登录',
  'settings.login': '网页登录',
  'settings.reauthorize': '重新授权',
  'settings.logout': '退出登录',
  'settings.loggedOut': '已退出登录',
  'settings.openPage': '打开授权页面',
  'settings.homeDir': '作用域目录',
  'settings.pending': '等待授权…',
  'settings.unsupported': '待支持',
  'settings.rosterFailed': '无法读取本地 Agent 列表，请重试',
  'settings.retry': '重试',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<LocalAgentKey, string> = {
  'list.aria': '{harness} sessions',
  'list.title': '{harness} sessions',
  'empty': 'No {harness} sessions in the scoped home yet',
  'login.hint': 'Run /{command} login to authorize, then delegate',
  'loading': 'Loading…',
  'error': 'Could not read {harness} sessions',
  'unknown.command': '/{command} sessions unavailable (is the {harness} bundle installed?)',
  'row.aria': '{harness} session {sessionId}',
  'workdir': 'workDir',
  'settings.nav': 'Local Agents',
  'settings.intro': 'Manage locally-installed coding-agent CLIs: check auth status and authorize through the web login.',
  'settings.noSession': 'Open a session first, then manage local agents',
  'settings.authenticated': 'Authenticated',
  'settings.notAuthenticated': 'Not authenticated',
  'settings.login': 'Web login',
  'settings.reauthorize': 'Re-authorize',
  'settings.logout': 'Sign out',
  'settings.loggedOut': 'Signed out',
  'settings.openPage': 'Open authorization page',
  'settings.homeDir': 'Home',
  'settings.pending': 'Waiting for authorization…',
  'settings.unsupported': 'Coming soon',
  'settings.rosterFailed': 'Could not read the local-agent roster; retry',
  'settings.retry': 'Retry',
}

/** Key domain of the `local-agent` namespace (zh is the source of truth). */
export type LocalAgentKey = keyof typeof zh
