/** `requestInspector` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.title': '请求明细',
  'guide.description': '按 turn 查看每次模型请求的完整组成：system 分段、工具定义、历史与新增上下文，以及耗时分布',

  'view.token': 'Token 分布',
  'view.time': '耗时分布',
  'view.structured': '结构化',
  'view.raw': '原始 JSON',
  'view.wireHint': '需要宿主 ≥0.1.2（deepseekLlmApiExtensions）',
  'foot.note': '分段=字符数（精确）· 总计=真实 usage',

  'turn.label': 'turn {seq}',
  'turn.switch': '切换 turn',
  'query.prefix': 'query：',

  'scope.main': '主对话 · {count} 请求',
  'scope.tagMain': '本轮 query · {count} 次请求',
  'scope.tagSub': '子 agent · {label}',

  'state.loading': '加载中…',
  'state.noTurns': '本会话还没有捕获到请求',
  'state.emptyScope': '这个范围还没有模型请求',
  'state.turnMissing': '该 turn 的捕获已不在缓冲区（旧 turn 会被淘汰）',
  'state.hostMissing': '宿主未安装请求明细的宿主半边',
  'state.error': '加载失败：{message}',

  'run.failed': '运行失败',
  'run.failedMeta': '耗时 {duration} · {count} 次模型调用',
  'run.failedHint': '子会话 {id} 已创建，但未完成任何请求——失败发生在首次模型调用之前。',

  'req.input': '输入',
  'req.output': '输出',
  'req.cacheHit': '缓存命中 {tokens} tok（{pct}%）',
  'req.streaming': '流式中',
  'req.failed': '失败',
  'resp.directAnswer': '直接回答',

  'detail.anchor': '本次响应',
  'detail.config': 'config',
  'detail.maxTokens': 'maxTokens',

  'cat.title': '请求 #{seq} · 组成分类（点类别筛选明细）',
  'cat.rows': '{count} 段',
  'chain.title': '组成明细 · 四段式（{count} 条消息严格按序，历史折叠）',
  'chain.filtered': '已筛选「{category}」',
  'chain.chars': '{count} 字符',

  'seg.system': '系统提示词',
  'seg.tools': '工具定义',
  'seg.history': '历史上下文',
  'seg.added': '新增上下文',
  'seg.systemFrom': 'systemPrompt 组装 · {count} 段',
  'seg.toolsFrom': '{count} 个',
  'seg.historyFrom': '继承自之前请求 · {count} 条',
  'seg.addedFrom': '相对上一请求新收到 · {count} 条',
  'seg.empty': '（空）',
  'seg.toolsEmpty': '（该请求没有携带工具定义）',
  'seg.systemEmpty': '（one-shot 调用没有 system 内容）',

  'cat.system': '系统提示词',
  'cat.tool-definition': '工具定义',
  'cat.user': '用户消息',
  'cat.assistant': '助手消息',
  'cat.tool-result': '工具结果',
  'cat.skill-injection': '技能注入',
  'cat.reminder-injection': '提醒注入',
  'cat.plugin-injection': '插件注入',
  'cat.runtime-snapshot': '运行时快照',
  'cat.tool-change': '工具变更',

  'time.total': '本轮总耗时',
  'time.totalScope': '本次运行总耗时',
  'time.calls': '模型调用',
  'time.outputTok': '输出 tok',
  'time.genTime': '模型生成时间',
  'time.catTitle': '耗时分类（{scope}口径 · stream block 级实测）',
  'time.scopeTurn': '整轮',
  'time.scopeRun': '本次运行',
  'time.byTool': '按工具拆分（调用次数 · 各类耗时合计）',
  'time.times': '{count} 次',
  'time.callMeta': '输出 {tokens} tok · 共 {duration}',
  'time.bucket.wait': '模型等待',
  'time.bucket.reasoning': '模型思考',
  'time.bucket.tool-args': '工具参数',
  'time.bucket.text': '模型输出',
  'time.bucket.tool-exec': '工具执行',
  'time.bucket.other': '其他开销',

  'raw.hint': '请求 #{seq} 的完整捕获（CapturedRequest 序列化 · {chars} 字符）',

  'action.inspect': '请求明细',
}

/** English dictionary (same key set). */
export const en: Record<keyof typeof zh, string> = {
  'tab.title': 'Request inspector',
  'guide.description': 'Per-turn breakdown of every model request: system sections, tool definitions, history vs added context, plus timing',

  'view.token': 'Tokens',
  'view.time': 'Timing',
  'view.structured': 'Structured',
  'view.raw': 'Raw JSON',
  'view.wireHint': 'Requires host ≥0.1.2 (deepseekLlmApiExtensions)',
  'foot.note': 'segments = exact char counts · totals = real usage',

  'turn.label': 'turn {seq}',
  'turn.switch': 'Switch turn',
  'query.prefix': 'query: ',

  'scope.main': 'Main · {count} requests',
  'scope.tagMain': 'this turn · {count} model calls',
  'scope.tagSub': 'subagent · {label}',

  'state.loading': 'Loading…',
  'state.noTurns': 'No requests captured for this session yet',
  'state.emptyScope': 'No model requests in this scope yet',
  'state.turnMissing': 'This turn’s capture has left the buffer (old turns are evicted)',
  'state.hostMissing': 'The host half of request-inspector is not installed',
  'state.error': 'Load failed: {message}',

  'run.failed': 'Run failed',
  'run.failedMeta': '{duration} · {count} model calls',
  'run.failedHint': 'Child session {id} was created but never completed a request — the failure happened before the first model call.',

  'req.input': 'in',
  'req.output': 'out',
  'req.cacheHit': 'cache hit {tokens} tok ({pct}%)',
  'req.streaming': 'streaming',
  'req.failed': 'failed',
  'resp.directAnswer': 'Direct answer',

  'detail.anchor': 'Response',
  'detail.config': 'config',
  'detail.maxTokens': 'maxTokens',

  'cat.title': 'Request #{seq} · composition (click a category to filter)',
  'cat.rows': '{count} rows',
  'chain.title': 'Breakdown · four segments ({count} messages in wire order, history collapsed)',
  'chain.filtered': 'filtered: {category}',
  'chain.chars': '{count} chars',

  'seg.system': 'System prompt',
  'seg.tools': 'Tool definitions',
  'seg.history': 'History',
  'seg.added': 'Added context',
  'seg.systemFrom': 'systemPrompt assembly · {count} sections',
  'seg.toolsFrom': '{count}',
  'seg.historyFrom': 'inherited from previous requests · {count}',
  'seg.addedFrom': 'new since the previous request · {count}',
  'seg.empty': '(empty)',
  'seg.toolsEmpty': '(this request carried no tool definitions)',
  'seg.systemEmpty': '(one-shot call with no system content)',

  'cat.system': 'System prompt',
  'cat.tool-definition': 'Tool definitions',
  'cat.user': 'User message',
  'cat.assistant': 'Assistant message',
  'cat.tool-result': 'Tool result',
  'cat.skill-injection': 'Skill injection',
  'cat.reminder-injection': 'Reminder injection',
  'cat.plugin-injection': 'Plugin injection',
  'cat.runtime-snapshot': 'Runtime snapshot',
  'cat.tool-change': 'Tool change',

  'time.total': 'Turn wall time',
  'time.totalScope': 'Run wall time',
  'time.calls': 'Model calls',
  'time.outputTok': 'Output tok',
  'time.genTime': 'Model generation',
  'time.catTitle': 'Timing split ({scope} · stream block measurements)',
  'time.scopeTurn': 'whole turn',
  'time.scopeRun': 'this run',
  'time.byTool': 'By tool (calls · summed durations)',
  'time.times': '{count}×',
  'time.callMeta': 'out {tokens} tok · {duration}',
  'time.bucket.wait': 'Model wait',
  'time.bucket.reasoning': 'Reasoning',
  'time.bucket.tool-args': 'Tool arguments',
  'time.bucket.text': 'Model output',
  'time.bucket.tool-exec': 'Tool execution',
  'time.bucket.other': 'Other overhead',

  'raw.hint': 'Full capture of request #{seq} (CapturedRequest serialized · {chars} chars)',

  'action.inspect': 'Request inspector',
}

/** The dictionary namespace this package binds. */
export const NS = 'requestInspector'

/** The requestInspector namespace key union (`zh` is the key-set source of truth). */
export type RequestInspectorKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The request-inspector tab and entry copy. */
    'requestInspector': RequestInspectorKey
  }
}
