# @khorsheed/dsh-library

[English](README.en.md) | 中文

让 agent 当你的读书教练：帮你排进度、记笔记、出题，还盯着你把错题订正对。

自学一本书，最烦的是没人管：进度自己排，笔记自己抄，题自己出，错题下次还没人提醒。装上图书馆，告诉教练你在读哪本书，它会先帮你排一版学习路线；读的时候拍一页书，划线和页边批注会自动整理成卡片；每学完一章做套小测，错题会一直留着，直到你订正对为止。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-today.png" width="640" alt="右栏「图书馆」的今日页：继续学习、今日复习、项目列表">

## 能做什么

- **告诉它读什么就能开始**：书名和版本说清楚就够，不用上传整本书；手边没书，也可以让它推荐一本。
- **路线它先排，你点头才算**：它会照目录起草一版学习路线，你看着合适点「采用」才生效。
- **拍一页就能记笔记**：读到哪页拍一下，划线和页边批注自动变成卡片，不用手抄。
- **学完一章就测**：题目从你划过的、问过的、做错的内容里出；选择填空当场出分，问答题教练来批。
- **错题不翻篇**：答错的题进「待订正」，订正对了才算掌握这个知识点。
- **每天照着清单复习**：今日页把要订正的题、该复习的卡片列好，打开就知道干什么。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-quiz.png" width="640" alt="章节小测：选择题和填空题当场判分，问答题交给教练批改">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-learning-suite
```

图书馆会跟着「学习套件」一起装好。装完开一个新会话，选「学习模式」，告诉教练你想读什么书。

图书馆只在学习模式的会话里出现，在其它模式里看不到它是正常的。

## 已知限制

- 不读取书的电子文件（EPUB、PDF），只登记书名和目录。
- 拍的照片会作为一条消息发进会话，由教练来识别。

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（服务与侧栏）、`src/tool.ts`（教练用的模型工具）；工具的用法写在各自的描述里。
- 也可以单独安装本包（`dsh plugin --profile web add @khorsheed/dsh-library`），但它的模型工具要由某个模式授予，单装时侧栏不会出现。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
