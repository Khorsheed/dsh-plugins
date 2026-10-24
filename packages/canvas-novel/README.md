# @khorsheed/dsh-canvas-novel

[English](README.en.md) | 中文

和 agent 一起写长篇连载：写到第一百章，它还记得人物设定、知道上次写到哪、没忘了埋下的伏笔。

和模型写长篇，最怕写着写着它就忘了：人物性格前后不一，伏笔埋了没人收，每开一次新对话都得把背景重新贴一遍。长篇小说是灵感画布的一种体裁：一部作品就是一块画布，人物、世界、原则、伏笔都是画布上的卡片。你和 agent 先定大纲，再一章一章地定计划、写正文；每写完一章，agent 回头对一次账，把这一章发生的事记回卡片上。下次换个会话接着写，它从卡片里读到的就是这部书现在的样子。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-board.png" width="640" alt="长篇小说画布：顶部细条显示当前章和待审数，下面是人物、世界、原则、伏笔几类卡片">

## 能做什么

- **一部作品一块画布**：新建画布时体裁选「长篇小说」，人物、世界、原则、伏笔、关系几类卡片就备好了，每类都有现成的栏目可填。
- **先定大纲再动笔**：和 agent 聊清楚主线、主角、结局方向和篇幅，它在「规划」页起草一页纸大纲和分卷，你点「采用」才算数，之后随时能改。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-planning.png" width="640" alt="规划页：顶部全书进度，一页纸大纲，虚线框里是 agent 的大纲提议，带「采用 / 不采用」，下面是按卷排列的章节路线">

- **聊到的设定直接成卡**：聊天里定下的人物和世界设定，agent 会直接记成卡片；不对就改，同名的人物只会有一张。
- **每章先看计划再开写**：agent 先列出这一章的目标字数、情节、冲突、伏笔和出场人物，对话里出一张计划卡，你点「查看并确认计划」看完、确认了它才动笔。
- **正文就在你的工作区里**：每一章是工作区里的一个 Markdown 文件，任何编辑器都能打开。
- **写完对一次账**：在对话里说「对账第 3 章」，agent 读完正文，把人物经历、关系变化、伏笔进展记回卡片；拿不准的会留在「待审」里等你拍板。
- **一眼看清整本书**：「故事」页按章节摊开伏笔的埋下和揭晓、人物关系的起伏和每个人的经历，太久没动的伏笔会被标出来；「章节」页是目录加阅读器，点「继续写」接着往下写。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-story-log.png" width="640" alt="故事日志：横轴是章节，伏笔、关系、人物、世界四组，右侧打开一条伏笔，看它的现状和逐章变化">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-writing-suite
```

长篇小说会跟着「写作套件」一起装好，灵感画布也在里面。装完开一个新会话，选「写作模式」，对 agent 说「我想写一部长篇，新建一块长篇小说画布」。

它只在写作模式的会话里出现，在其它模式里看不到是正常的。

## 已知限制

- 章节正文要存进画布挂着的工作区；存不进去，这一章就不会登记。
- 不是从当前会话打开的画布只能看，不能处理待审。
- 旧插件 story-bible 的数据不会迁移过来。

## Compatibility

需要 DSH 0.2.0-rc.2 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 入口：`src/index.ts`（体裁与写作引擎）、`src/agent.ts`（agent 用的小说工具）、`src/client/index.ts`（画布里的各页）。
- 可以单独安装（`dsh plugin --profile web add @khorsheed/dsh-canvas @khorsheed/dsh-canvas-novel`），但必须和灵感画布一起装；没有画布时它什么也不做，也不会报错。
- 关系卡怎么打分见[关系评估标准](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/canvas-novel/docs/relation-criteria.md)；隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，变更见 [CHANGELOG.md](CHANGELOG.md)。
