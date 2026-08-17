/** `local-agent-dsh` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'local-agent-dsh'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.on': '已开启：模型可使用 subagent_dsh 委派给本机 dsh',
  'settings.off': '已关闭：委派只走官方内置子代理工具',
  'settings.switch': 'DeepSeek 委派开关',
  'settings.unavailable': '设置不可用（本地 Agent 插件未安装？）',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<LocalAgentDshKey, string> = {
  'settings.on': 'ON: the model can delegate to the local dsh via subagent_dsh',
  'settings.off': 'OFF: delegation goes through the official in-process subagent tool only',
  'settings.switch': 'DeepSeek delegation switch',
  'settings.unavailable': 'Settings unavailable (is the local-agent plugin installed?)',
}

/** All keys, derived from the Chinese source of truth. */
export type LocalAgentDshKey = keyof typeof zh
