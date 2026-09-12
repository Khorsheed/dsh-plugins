/** `local-agent-dsh` namespace dictionaries. */

/** Dictionary namespace owned by this plugin (matches the settings namespace). */
export const NS = 'local-agent-dsh'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': 'Local Agent · dsh',
  'card.description': 'dsh 自委派：开关、认证状态与常驻模式（live）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'auth.title': '认证',
  'model.title': '默认模型',
  'model.info.aria': '默认模型说明',
  'model.info': '填了就每轮委派以它起子 dsh（`--model <provider/model>`；只写模型名则沿用宿主实例的 provider）；留空则本插件不传 `--model`，仍由宿主实例的默认模型选择决定。单次委派自带的模型优先级更高。改动在下一轮委派生效，进行中的轮次不受影响；评测 run 的条件在建立时冻结，中途换模型会被下一轮的模型回读判为 misattributed 而拦下。',
  'model.placeholder': '留空 = 不传，用宿主实例的默认模型',
  'model.placeholder.cli-config': '留空 = 跟随宿主默认模型：{model}',
  'model.placeholder.cli-builtin': '留空 = 跟随宿主默认：{model}',
  'model.placeholder.last-observed': '留空 = 跟随宿主实例默认（最近：{model}）',
  'model.menu': '选择模型',
  'model.save': '保存',
  'model.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'model.error': '保存失败，请重试',
  'model.effective.set': '当前生效：{model}',
  'model.effective.cli-config': '跟随宿主默认模型：{model}',
  'model.effective.cli-builtin': '跟随宿主实例默认',
  'model.effective.cli-builtin.named': '跟随宿主默认：{model}',
  'model.effective.last-observed': '跟随宿主实例默认（最近：{model}）',
  'auth.host': 'dsh 凭据走宿主实例的凭证设置，无需单独登录。',
  'enable.title': 'DeepSeek 委派',
  'enable.switch': '启用',
  'enable.switch.aria': 'DeepSeek 委派开关',
  'enable.on': '已开启：模型可使用 subagent_dsh 委派给本机 dsh',
  'enable.off': '已关闭：委派只走官方内置子代理工具',
  'live.title': '常驻模式（live）',
  'live.info.aria': '常驻模式说明',
  'live.info': '常驻模式 = 成员进程常驻：输出实时流入成员会话、取消不杀进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。设置为全局偏好，对所有后续委派生效。',
  'live.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'live.error': '保存失败，请重试',
  'live.unavailable': '设置服务不可用（宿主未注册 local-agent-dsh 命名空间）',
} satisfies Record<string, string>

/** The local-agent-dsh namespace key union. */
export type LocalAgentDshKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh harness settings card copy. */
    'local-agent-dsh': LocalAgentDshKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Local Agent · dsh',
  'card.description': 'dsh self-delegation: toggle, credential status, and resident (live) mode',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'auth.title': 'Authentication',
  'model.title': 'Default model',
  'model.info.aria': 'About the default model',
  'model.info': "Set, every delegation round starts the sub-dsh with it (`--model <provider/model>`; a bare id keeps the host instance provider). Blank passes no `--model` at all: the host instance default model selection decides. A model named by one delegation outranks this key. A change applies to the next round and never disturbs a round in flight; an evaluation run freezes its condition at setup, so switching mid-run is caught by the model read-back on the next round and fails the run as misattributed.",
  'model.placeholder': "Blank = pass none, use the host instance default",
  'model.placeholder.cli-config': 'Blank = follow the host default model: {model}',
  'model.placeholder.cli-builtin': 'Blank = follow the host default: {model}',
  'model.placeholder.last-observed': 'Blank = follow the host instance default (last: {model})',
  'model.menu': 'Pick a model',
  'model.save': 'Save',
  'model.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'model.error': 'Save failed, please retry',
  'model.effective.set': 'In effect: {model}',
  'model.effective.cli-config': 'Following the host default model: {model}',
  'model.effective.cli-builtin': 'Following the host instance default',
  'model.effective.cli-builtin.named': 'Following the host default: {model}',
  'model.effective.last-observed': 'Following the host instance default (last: {model})',
  'auth.host': 'dsh authenticates through the host instance’s credential settings — no separate sign-in.',
  'enable.title': 'DeepSeek delegation',
  'enable.switch': 'Enabled',
  'enable.switch.aria': 'DeepSeek delegation switch',
  'enable.on': 'ON: the model can delegate to the local dsh via subagent_dsh',
  'enable.off': 'OFF: delegation goes through the official in-process subagent tool only',
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-dsh namespace)',
} satisfies Record<string, string>
