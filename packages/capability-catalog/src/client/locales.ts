/**
 * Dictionaries for the capability-catalog browser half.
 * @module @khorsheed/dsh-capability-catalog/client
 */

export const NS = 'capability-catalog'

/** The capability-catalog namespace key union. */
export type CapabilityCatalogKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The capability-catalog settings card copy. */
    'capability-catalog': CapabilityCatalogKey
  }
}

export const zh = {
  title: '能力目录',
  'section.nav': '工具与技能',
  intro: '当前实例中已注册的技能与工具及其来源。技能以预览卡展示，点击查看详情、源码与凭据配置。',
  skillTab: '技能',
  toolTab: '工具',
  addSkill: '新增 skill',
  empty: '没有已注册的技能。',
  loading: '加载中…',
  loadFailed: '加载失败',
  source: '来源',
  provider: '提供者',
  modelInvocable: '模型可调用',
  whenToUse: '适用场景',
  yes: '是',
  no: '否',
  userOnly: '仅用户',
  credentials: '凭据配置',
  credentialsHint: '该 skill 的 metadata 声明了以下凭据，配置后模型可读取。',
  configured: '已配置',
  notConfigured: '未配置',
  credPlaceholder: '输入值',
  save: '保存',
  saveFailed: '保存失败',
  viewSource: '查看源码',
  bundleFiles: '包文件',
  metadata: 'metadata',
  detailClose: '关闭',
  addSkillHint: '上传 skill 包（zip）或粘贴 SKILL.md，将安装到选定的 skill 根目录。',
  addTabUpload: '上传压缩包',
  addTabPaste: '粘贴 SKILL.md',
  addPastePlaceholder: '把 SKILL.md 内容粘贴到这里…',
  addModelInvocable: '进模型 catalog',
  addModelInvocableHint: '关闭后仅用户 /name 可调用，不被模型自动感知',
  addRoot: '安装到',
  rootUser: '用户 ($DSH_HOME/skills)',
  rootProject: '项目 (.agents/skills)',
  addSubmit: '导入',
  cancel: '取消',
  addSuccess: '已添加 skill：',
  addError: '添加失败',
  readFailed: '文件读取失败',
}

export const en = {
  title: 'Capability Catalog',
  'section.nav': 'Tools & Skills',
  intro: 'Skills and tools registered in this instance and their sources. Skills appear as preview cards — click for detail, source, and credential config.',
  skillTab: 'Skills',
  toolTab: 'Tools',
  addSkill: 'Add skill',
  empty: 'No skills registered.',
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  source: 'Source',
  provider: 'Provider',
  modelInvocable: 'Model-invocable',
  whenToUse: 'When to use',
  yes: 'Yes',
  no: 'No',
  userOnly: 'User only',
  credentials: 'Credential config',
  credentialsHint: 'The skill metadata declares these credentials; configure them so the model can read them.',
  configured: 'Configured',
  notConfigured: 'Not configured',
  credPlaceholder: 'Enter value',
  save: 'Save',
  saveFailed: 'Save failed',
  viewSource: 'View source',
  bundleFiles: 'Package files',
  metadata: 'metadata',
  detailClose: 'Close',
  addSkillHint: 'Upload a skill archive (zip) or paste a SKILL.md to install it into the selected skill root.',
  addTabUpload: 'Upload archive',
  addTabPaste: 'Paste SKILL.md',
  addPastePlaceholder: 'Paste the SKILL.md content here…',
  addModelInvocable: 'In model catalog',
  addModelInvocableHint: 'Off = only user /name can invoke, not model-visible',
  addRoot: 'Install to',
  rootUser: 'User ($DSH_HOME/skills)',
  rootProject: 'Project (.agents/skills)',
  addSubmit: 'Import',
  cancel: 'Cancel',
  addSuccess: 'Added skill: ',
  addError: 'Failed to add',
  readFailed: 'Failed to read file',
}
