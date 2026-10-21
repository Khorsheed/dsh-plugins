/** `local-agent-claude-code` namespace dictionaries. */

/** Dictionary namespace owned by this plugin (matches the settings namespace). */
export const NS = 'local-agent-claude-code'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': '本机 Claude Code 委派',
  'card.description': '使用本机安装的 Claude Code CLI 委派：端点凭据与常驻模式（live）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'auth.title': '认证',
  'endpoint.info.aria': '端点凭据说明',
  'endpoint.info': '这里保存的就是默认 scope 的 endpoint-auth.json（0600，只存本机），它优先于 profile 的 YAML 配置行；宿主 shell 的环境变量从不被读取。端点留空 = Anthropic 官方端点；API Key 与 Auth Token 至少填一个（分别对应 x-api-key 与 Bearer 头，看你的中转认哪种）。密钥绝不写进 profile 文件，也不进入评测条件指纹。保存对下一轮委派生效，进行中的轮次不受影响。',
  'endpoint.baseUrl': '端点地址（baseUrl）',
  'endpoint.baseUrl.placeholder': '留空 = Anthropic 官方端点',
  'endpoint.apiKey': 'API Key',
  'endpoint.authToken': 'Auth Token',
  'endpoint.secret.configured': '已配置 · 输入新值更换，留空保存 = 清除',
  'endpoint.secret.placeholder': '未配置',
  'endpoint.configured': '已配置',
  'endpoint.save': '保存凭据',
  'endpoint.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'endpoint.error': '保存失败，请重试',
  'endpoint.check': '验证端点并获取模型',
  'endpoint.checking': '验证中…',
  'endpoint.checkDirtyHint': '有未保存的修改，先保存凭据再验证',
  'endpoint.checkUnavailable': '当前核心不支持端点验证（请升级 local-agent 核心包）',
  'endpoint.unavailable': '当前核心不支持凭据配置（请升级 local-agent 核心包）',
  'endpoint.checkFailed': '验证失败，请重试',
  'live.title': '常驻模式（live）',
  'live.info.aria': '常驻模式说明',
  'live.info': '常驻模式 = 成员进程常驻：输出实时流入成员会话、取消不杀进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。设置为全局偏好，对所有后续委派生效。',
  'live.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'live.error': '保存失败，请重试',
  'live.unavailable': '设置服务不可用（宿主未注册 local-agent-claude-code 命名空间）',
} satisfies Record<string, string>

/** The local-agent-claude-code namespace key union. */
export type LocalAgentClaudeCodeKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The claude-code harness settings card copy. */
    'local-agent-claude-code': LocalAgentClaudeCodeKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Local Claude Code Delegation',
  'card.description': "Delegate through this machine's Claude Code CLI: endpoint credential and resident (live) mode",
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'auth.title': 'Authentication',
  'endpoint.info.aria': 'About the endpoint credential',
  'endpoint.info': "What you save here is the default scope's endpoint-auth.json (mode 0600, local only), which outranks the profile's YAML row; the host shell's environment is never read. A blank endpoint means Anthropic's own; fill at least one of API Key and Auth Token (x-api-key and Bearer respectively — whichever your relay accepts). Keys never enter the profile document or an evaluation's condition fingerprint. Saving applies to the next delegation round; rounds in flight are unaffected.",
  'endpoint.baseUrl': 'Endpoint (baseUrl)',
  'endpoint.baseUrl.placeholder': "Blank = Anthropic's own endpoint",
  'endpoint.apiKey': 'API Key',
  'endpoint.authToken': 'Auth Token',
  'endpoint.secret.configured': 'Configured · type to replace, save blank to clear',
  'endpoint.secret.placeholder': 'Not configured',
  'endpoint.configured': 'Configured',
  'endpoint.save': 'Save credential',
  'endpoint.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'endpoint.error': 'Save failed, please retry',
  'endpoint.check': 'Verify endpoint & fetch models',
  'endpoint.checking': 'Checking…',
  'endpoint.checkDirtyHint': 'Unsaved changes — save the credential first',
  'endpoint.checkUnavailable': 'Endpoint verification is not supported by this core (upgrade the local-agent core)',
  'endpoint.unavailable': 'Credential configuration is not supported by this core (upgrade the local-agent core)',
  'endpoint.checkFailed': 'Check failed, please retry',
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-claude-code namespace)',
} satisfies Record<string, string>
