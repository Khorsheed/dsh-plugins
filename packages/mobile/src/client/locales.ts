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
  workspace: '打开工作区', hostPath: '电脑目录', hostPathHelp: '输入电脑上已有目录的完整路径。这里选择的是电脑工作区，不是手机文件夹。', openWorkspace: '打开', cancel: '取消',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { mobile: keyof typeof en }
}
