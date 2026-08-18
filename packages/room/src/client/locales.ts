/** `room` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.newRoom': '新建 Room',
  'view.members': '成员',
  'members.empty': '暂无成员',
  'composer.placeholder': '发消息到黑板；@ 成员以派发',
  'composer.send': '发送',
  'composer.noted': '已记录到黑板，@ 成员以派发',
  'composer.error.unknownTargets': '未知成员：{names}',
  'composer.error.generic': '发送失败，请重试',
  'member.kind.main': '主 agent',
  'action.copy': '复制',
  'action.copied': '已复制',
  'speech.jump': '查看成员会话',
  'run.working': '{member} 正在工作…',
  'run.failed': '{member} 运行失败',
  'run.stop': '停止',
  'event.joined': '{member}（{provider}）加入了 room',
  'event.joinedByAgent': ' · 由主 agent 邀请',
  'event.left': '{member} 离开了 room',
  'event.dispatch': '你 @{targets}：{text}',
  'event.note': '你记录到黑板：{text}',
} satisfies Record<string, string>

/** The room namespace key union. */
export type RoomKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The room controls' copy. */
    room: RoomKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.newRoom': 'New room',
  'view.members': 'Members',
  'members.empty': 'No members yet',
  'composer.placeholder': 'Post to the blackboard; @ a member to dispatch',
  'composer.send': 'Send',
  'composer.noted': 'Recorded to the blackboard; @ a member to dispatch',
  'composer.error.unknownTargets': 'Unknown members: {names}',
  'composer.error.generic': 'Could not send; please retry',
  'member.kind.main': 'main agent',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'speech.jump': 'Open the member session',
  'run.working': '{member} is working…',
  'run.failed': "{member}'s run failed",
  'run.stop': 'Stop',
  'event.joined': '{member} ({provider}) joined the room',
  'event.joinedByAgent': ' · invited by the main agent',
  'event.left': '{member} left the room',
  'event.dispatch': 'You @{targets}: {text}',
  'event.note': 'You noted to the blackboard: {text}',
} satisfies Record<RoomKey, string>
