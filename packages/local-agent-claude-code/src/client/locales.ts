/** `local-agent-claude-code` namespace dictionaries. */

/** Dictionary namespace owned by this plugin (matches the settings namespace). */
export const NS = 'local-agent-claude-code'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': 'Claude 委派',
  'card.description': 'Claude Code 委派：端点凭据与常驻模式（live）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'auth.title': '认证',
  'endpoint.info.aria': '端点凭据说明',
  'endpoint.info': '生效顺序：命名 scope 的 endpoint-auth.json > 此处 > profile 的 YAML 配置行；宿主 shell 的环境变量从不被读取。端点留空 = Anthropic 官方端点；API Key 与 Auth Token 至少填一个（分别对应 x-api-key 与 Bearer 头，看你的中转认哪种）。密钥只保存在本机设置里，绝不进入评测条件指纹。保存对下一轮委派生效，进行中的轮次不受影响。',
  'endpoint.baseUrl': '端点地址（baseUrl）',
  'endpoint.baseUrl.placeholder': '留空 = Anthropic 官方端点',
  'endpoint.apiKey': 'API Key',
  'endpoint.authToken': 'Auth Token',
  'endpoint.secret.configured': '已配置 · 输入新值更换，留空保存 = 清除',
  'endpoint.secret.placeholder': '未配置',
  'endpoint.save': '保存凭据',
  'endpoint.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'endpoint.error': '保存失败，请重试',
  'model.title': '默认模型',
  'model.info.aria': '默认模型说明',
  'model.info': '留空 = 跟随默认（输入框里显示的就是当前跟随的模型）。从列表选择或手动输入一个模型名后保存，之后的每轮委派都以它起 CLI（`claude -p --model <模型>`，常驻模式同一个旗标）。成员会话里还可用作曲器按会话切换，不影响这里的默认。改动在下一轮委派生效，进行中的轮次不受影响；评测 run 的条件在建立时冻结，中途换模型会被下一轮的模型回读判为 misattributed 而拦下。',
  'model.placeholder': '留空 = 不传模型，用 CLI 自己的默认',
  'model.menu': '选择模型',
  'model.menuDefault': '默认（跟随 CLI 内置默认）',
  'model.menuDefaultCliConfig': '默认（跟随 CLI 配置：{model}）',
  'model.menuDefaultCliBuiltin': '默认（跟随 CLI 默认：{model}）',
  'model.menuDefaultLastObserved': '默认（跟随 CLI 内置默认（最近：{model}））',
  'model.save': '保存',
  'model.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'model.error': '保存失败，请重试',
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
  'card.title': 'Claude Delegation',
  'card.description': 'Claude Code delegation: endpoint credential and resident (live) mode',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'auth.title': 'Authentication',
  'endpoint.info.aria': 'About the endpoint credential',
  'endpoint.info': "Precedence: a named scope's endpoint-auth.json > this card > the profile's YAML row; the host shell's environment is never read. A blank endpoint means Anthropic's own; fill at least one of API Key and Auth Token (x-api-key and Bearer respectively — whichever your relay accepts). Keys live only in this machine's settings and never enter an evaluation's condition fingerprint. Saving applies to the next delegation round; rounds in flight are unaffected.",
  'endpoint.baseUrl': 'Endpoint (baseUrl)',
  'endpoint.baseUrl.placeholder': "Blank = Anthropic's own endpoint",
  'endpoint.apiKey': 'API Key',
  'endpoint.authToken': 'Auth Token',
  'endpoint.secret.configured': 'Configured · type to replace, save blank to clear',
  'endpoint.secret.placeholder': 'Not configured',
  'endpoint.save': 'Save credential',
  'endpoint.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'endpoint.error': 'Save failed, please retry',
  'model.title': 'Default model',
  'model.info.aria': 'About the default model',
  'model.info': "Blank = follow the default (the input shows the model it currently follows). Pick from the list or type a model name by hand and save, and every later delegation round starts the CLI with it (`claude -p --model <model>`, the same flag in resident mode). Inside a member session the composer can also switch the model per session, without touching this default. A change applies to the next round and never disturbs a round in flight; an evaluation run freezes its condition at setup, so switching mid-run is caught by the model read-back on the next round and fails the run as misattributed.",
  'model.placeholder': "Blank = pass no model, keep the CLI's own default",
  'model.menu': 'Pick a model',
  'model.menuDefault': "Default (follow the CLI's built-in default)",
  'model.menuDefaultCliConfig': 'Default (follow the CLI config: {model})',
  'model.menuDefaultCliBuiltin': 'Default (follow the CLI default: {model})',
  'model.menuDefaultLastObserved': "Default (follow the CLI's built-in default (last: {model}))",
  'model.save': 'Save',
  'model.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'model.error': 'Save failed, please retry',
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-claude-code namespace)',
} satisfies Record<string, string>
