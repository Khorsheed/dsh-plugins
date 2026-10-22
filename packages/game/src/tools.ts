/**
 * The game mode's model tools, registered by the `./agent` entry:
 * `game_open` (list, switch to, create or adopt a project — the light gate
 * lives here) and `game_read` (the bound project's state). There is no write
 * tool and no test tool: the agent writes project files with the ordinary fs
 * tools, and the checks run by themselves at the end of every turn.
 *
 * Origin-tagged with the community `Symbol.for('dsh.tool.origin')` key (the
 * catalog's documented no-import path).
 * @module @khorsheed/dsh-game/agent
 */
import { isAbsolute, join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { artStyleLabel, lookText } from './project.ts'
import type { GameService } from './store.ts'
import { ART_STYLES, ART_STYLES_3D, CHAPTERS, type ProjectView } from './types.ts'

/** The community tool-origin tag. */
function tagOrigin<T extends object>(definition: T): T {
  ;(definition as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')] = { channel: 'plugin', owner: '@khorsheed/dsh-game' }
  return definition
}

const STATUS_LABEL = { todo: '未写', draft: '草稿', done: '定稿' } as const

/** The model-facing overview of a project. */
export function renderProject(view: ProjectView): string {
  const lines = [`项目《${view.title}》（${view.id}）`, `目录：${view.root}`]
  if (view.manifest === null) lines.push(`清单有问题：${view.manifestError ?? '读不到 game.json'}`)
  else {
    lines.push(
      `pitch：${view.manifest.pitch}`,
      `运行时：${view.manifest.runtime?.kit === '3d-three' ? '3D（3d-three 套件，用 dsh3d）' : '2D 画布'}　元素类型：${view.manifest.elementTypes.join('、')}　美术风格：${artStyleLabel(view.manifest.artStyle)}　自动确认：${view.manifest.autoConfirm ? '开' : '关'}`,
    )
    if (view.manifest.pillars.length > 0) lines.push(`支柱：${view.manifest.pillars.join('；')}`)
    if (view.manifest.params.length > 0) {
      lines.push(`参数（game.json，游戏每帧从 window.dshParams 读）：${view.manifest.params.map(p => {
        const live = view.paramOverrides[p.key]
        return `${p.label}(${p.key})=${p.value}${live === undefined ? '' : `，用户试玩值 ${live}`}`
      }).join('；')}`)
    }
    if (view.restyleTo !== undefined) lines.push(`用户要求换成「${artStyleLabel(view.restyleTo)}」风格：重画所有外观、更新 game.json 的 artStyle 与 palette，下个通过的版本会作为候选等用户确认。`)
  }
  lines.push(`策划：${view.chapters.map(c => `${c.title}${c.generated ? '' : `(${STATUS_LABEL[c.status]})`}`).join('、')}`)
  const byType = new Map<string, number>()
  for (const e of view.elements) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
  lines.push(`元素：${view.elements.length === 0 ? '还没有' : [...byType].map(([t, n]) => `${t} ${n}`).join('、')}${view.elements.length === 0 ? '' : `（${view.elements.map(e => `${e.name}=${e.id}${e.look === null && e.look3d === null ? '' : '·有外观'}`).join('、')}）`}`)
  if (view.pending.length > 0) {
    lines.push(`用户在面板里改了、还没发给你的（已经生效，别改回去）：${view.pending.map(p => p.text).join('；')}`)
  }
  const open = view.proposals.filter(p => p.picked === undefined)
  if (open.length > 0) lines.push(`等用户挑选的外观方案：${open.map(p => `${p.elementId}（${p.variants.length} 个）`).join('、')}`)
  for (const f of view.elementErrors.slice(0, 5)) lines.push(`  ✗ ${f.where}：${f.message}`)
  lines.push(view.hasEntry ? '入口：index.html 已有' : '入口：还没有 index.html（写好它和 window.dshGame 后才会检查和进试玩区）')
  lines.push(`试玩区：${view.current === null ? '还没有版本' : `v${view.current.version}`}${view.candidate === null ? '' : `；待确认 v${view.candidate.version}`}`)
  const check = view.lastCheck
  if (check !== null) {
    lines.push(check.ok
      ? `最近检查：通过（${check.passed} 个用例${check.skipped === undefined ? '' : `；${check.skipped}`}）`
      : `最近检查：未通过${check.gaveUp === true ? '，已停止自动修复' : ''}`)
    if (!check.ok) for (const f of check.failures.slice(0, 6)) lines.push(`  ✗ ${f.where}：${f.message}`)
  }
  return lines.join('\n')
}

/**
 * The tool definitions.
 * @param store - the service core.
 * @returns the two definitions, tagged.
 */
export function gameToolDefinitions(store: GameService): ToolDefinition[] {
  const listText = async (sessionId: string | undefined): Promise<string> => {
    const projects = await store.listProjects()
    const bound = sessionId === undefined ? undefined : await store.boundProject(sessionId)
    const lines = projects.length === 0
      ? ['还没有游戏项目。']
      : ['游戏项目：', ...projects.map(p => `- ${p.id}《${p.title}》${p.id === bound?.id ? '（本会话）' : ''} ${p.root}`)]
    lines.push('', `2D 美术风格示例（让用户挑）：${ART_STYLES.map(s => `${s.id}=${s.label}（${s.look}）`).join('；')}；或 custom:描述。`)
    lines.push(`3D 美术风格示例（runtime=3d 时）：${ART_STYLES_3D.map(s => `${s.id}=${s.label}（${s.look}）`).join('；')}；或 custom:描述。`)
    return lines.join('\n')
  }

  const open = defineTool({
    name: 'game_open',
    description:
      'Choose this session\'s game project. No arguments: list projects and the art-style examples. project: switch to '
      + 'one (title or id). create: make a new project in the session workspace — requires title, pitch, elementTypes and '
      + 'artStyle the user agreed to (the answer lists what is missing); runtime: 3d makes a three.js project (default 2d). '
      + 'path: adopt an existing folder with a game.json. '
      + 'The right-sidebar game tab follows. Load the gamedev skill before writing game code.',
    parameters: {
      project: { type: 'string', description: 'Project title or id to switch to.' },
      create: { type: 'string', description: 'Title of a new project.' },
      pitch: { type: 'string', description: 'create: one sentence — what the player does and why it is fun.' },
      elementTypes: { type: 'string', description: 'create: element categories, separated by 、 (e.g. 角色、敌人、道具).' },
      artStyle: { type: 'string', description: 'create: an art-style id from the list (2D or 3D list to match runtime), or custom:<description>.' },
      runtime: { type: 'string', description: 'create: 2d (default) or 3d — 3d pins the three.js kit (dsh3d runtime).' },
      pillars: { type: 'string', description: 'create: optional design pillars, separated by ；.' },
      path: { type: 'string', description: 'Adopt this existing project folder (absolute, or relative to the workspace).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (
      args: { project?: string; create?: string; pitch?: string; elementTypes?: string; artStyle?: string; runtime?: string; pillars?: string; path?: string },
      exec: { agent?: Agent },
    ): Promise<string> => {
      const session = exec.agent?.session
      const create = args.create?.trim() ?? ''
      const wanted = args.project?.trim() ?? ''
      const path = args.path?.trim() ?? ''
      if (create === '' && wanted === '' && path === '') return listText(session?.id)
      if (session === undefined) return '失败：这次调用没有会话。'

      if (create !== '') {
        const created = await store.create({
          title: create, pitch: args.pitch, elementTypes: args.elementTypes, artStyle: args.artStyle, runtime: args.runtime, pillars: args.pillars?.split(/[；;\n]/),
        }, session)
        if (!created.ok) {
          return 'missing' in created
            ? `还不能建项目，缺：\n${created.missing.map(m => `- ${m}`).join('\n')}\n先和用户把这些定下来（给选项让用户挑），再调用 create。`
            : `失败：${created.error}`
        }
        return `完成：已建项目《${created.project.title}》（${created.project.id}），目录 ${created.project.root}，本会话已绑定。`
          + '\n已写 game.json 与 design/pillars.md。接下来：load gamedev 技能，写 index.html + src/ 与 window.dshGame，并一起写 tests/。'
      }

      if (path !== '') {
        const cwd = session.header?.cwd ?? ''
        const root = isAbsolute(path) ? path : join(cwd, path)
        const adopted = await store.adopt(root)
        if (!adopted.ok) return adopted.error === 'not-found' ? `失败：${root} 下没有 game.json。` : `失败：${root} 的 game.json 读不了。`
        await store.bind(session.id, adopted.project.id)
        return `完成：已登记并切到《${adopted.project.title}》（${adopted.project.id}）。`
      }

      const projects = await store.listProjects()
      const exact = projects.filter(p => p.id === wanted || p.title === wanted)
      const pool = exact.length > 0 ? exact : projects.filter(p => p.title.includes(wanted))
      if (pool.length === 0) return `失败：没有叫「${wanted}」的项目。\n${await listText(session.id)}`
      if (pool.length > 1) return `「${wanted}」对应多个项目，请问用户是哪一个：${pool.map(p => `${p.id}《${p.title}》`).join('、')}`
      const target = pool[0]!
      const bound = await store.bind(session.id, target.id)
      if (!bound.ok) return `失败：${bound.error}`
      const view = await store.view(target.id)
      return view === undefined ? `完成：已切到《${target.title}》。` : `完成：已切到这个项目。\n${renderProject(view)}`
    },
  })

  const read = defineTool({
    name: 'game_read',
    description:
      'Read this session\'s game project: no arguments gives the overview (manifest, design chapters and their status, '
      + 'elements, the last end-of-turn check, the deployed version). chapter: one design chapter in full (id: '
      + `${CHAPTERS.map(c => c.id).join(', ')}).`,
    parameters: {
      chapter: { type: 'string', description: 'A design chapter id to read in full.' },
      element: { type: 'string', description: 'An element id: its fields and its look as pixel rows.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { chapter?: string; element?: string }, exec: { agent?: Agent }): Promise<string> => {
      const session = exec.agent?.session
      if (session === undefined) return '失败：这次调用没有会话。'
      const row = await store.boundProject(session.id)
      if (row === undefined) return `本会话还没有游戏项目。用 game_open 选一个或新建。\n${await listText(session.id)}`
      const view = await store.view(row.id)
      if (view === undefined) return '失败：项目登记丢了，用 game_open 重新选。'
      const elementId = args.element?.trim() ?? ''
      if (elementId !== '') {
        const element = view.elements.find(e => e.id === elementId || e.name === elementId)
        if (element === undefined) return `没有元素「${elementId}」。有：${view.elements.map(e => `${e.id}（${e.name}）`).join('、') || '（无）'}`
        const lines = [`元素「${element.name}」id=${element.id} type=${element.type} 文件 ${element.file}`,
          `字段：${Object.entries(element.stats).map(([k, v]) => `${k}=${String(v)}`).join('、') || '（无）'}`]
        lines.push(element.look3d !== null ? `外观（3D look）：${JSON.stringify(element.look3d)}`
          : element.look === null ? '外观：还没有 look（画面里是代码画的或色块）。' : `外观（look）：\n${lookText(element.look)}`)
        const proposal = view.proposals.find(p => p.elementId === element.id)
        if (proposal !== undefined) lines.push(proposal.picked === undefined ? `有 ${proposal.variants.length} 个外观方案等用户挑。` : `用户上次挑了方案「${proposal.variants[proposal.picked]?.label ?? ''}」。`)
        return lines.join('\n')
      }
      const wanted = args.chapter?.trim() ?? ''
      if (wanted === '') return renderProject(view)
      const chapter = view.chapters.find(c => c.id === wanted || c.title === wanted)
      if (chapter === undefined) return `没有章节「${wanted}」。可选：${view.chapters.map(c => `${c.id}（${c.title}）`).join('、')}`
      if (chapter.text === '') return `「${chapter.title}」还是空的${chapter.generated ? '（自动生成的章节）' : `，写在 ${join(view.root, chapter.file)}`}。`
      return `${chapter.generated ? '（自动生成）' : `文件：${join(view.root, chapter.file)}　状态：${STATUS_LABEL[chapter.status]}`}\n\n${chapter.text}`
    },
  })

  const propose = defineTool({
    name: 'game_propose',
    description:
      'Offer the user up to 3 appearance variants for one element; they appear side by side in the game tab and the user '
      + 'picks one (picking applies it — never write the look yourself while variants are open). variants: a JSON array of '
      + '{label, note, look} where look = {palette: ["#rrggbb", …], states: {idle: ["..00..", …], move: […]}}; each row is a '
      + 'string, "." is transparent, 0-9a-z index the palette; all rows of a state are the same width (16×16 is typical).',
    parameters: {
      element: { type: 'string', required: true, description: 'The element id.' },
      request: { type: 'string', description: 'What the user asked for, in their words.' },
      variants: { type: 'string', required: true, description: 'JSON array of up to 3 {label, note, look}.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { element?: string; request?: string; variants?: unknown }, exec: { agent?: Agent }): Promise<string> => {
      const session = exec.agent?.session
      if (session === undefined) return '失败：这次调用没有会话。'
      let variants: unknown = args.variants
      if (typeof variants === 'string') {
        try {
          variants = JSON.parse(variants)
        } catch (error) {
          return `失败：variants 不是合法 JSON（${(error as Error).message}）。`
        }
      }
      if (!Array.isArray(variants) || variants.length === 0) return '失败：variants 要是 1–3 个方案的数组。'
      const result = await store.proposeLooks(session.id, (args.element ?? '').trim(), args.request ?? '',
        variants.map(v => (v !== null && typeof v === 'object' ? v as { label?: string; note?: string; look: unknown } : { look: null })))
      if (!result.ok) return `失败：${result.error}`
      return `完成：「${result.name}」的 ${result.count} 个外观方案已放到右栏「元素」里等用户挑；挑中的会直接替换进游戏，下一轮你会收到用户的选择。`
    },
  })

  return [tagOrigin(open), tagOrigin(read), tagOrigin(propose)]
}
