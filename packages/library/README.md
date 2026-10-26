# @khorsheed/dsh-library

[English](README.en.md) | 中文

让 agent 当你的读书教练：帮你排进度、记笔记、出题，还盯着你把错题订正对。

自学一本书，最烦的是没人管：进度自己排，笔记自己抄，题自己出，错题下次还没人提醒。装上图书馆，告诉教练你在读哪本书，它会先帮你排一版学习路线；读的时候拍一页书，划线和页边批注会自动整理成卡片；每学完一章做套小测，错题会一直留着，直到你订正对为止。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-1.png" width="560" alt="学习模式的会话：左边是教练给出的判分结果表，右栏图书馆的今日页列出各个学习项目、今日复习里待订正的题和最近的变化">

## 能做什么

- **告诉它读什么就能开始**：书名和版本说清楚就够，不用上传整本书；只说想学的领域也行（「从零学微积分，教材你帮我挑」），它照你的底子挑知识点和教材。
- **路线它先排，你点头才算**：它会照目录起草一版学习路线，你看着合适点「采用」才生效；之后可以跟着路线一站站过关，也可以挑感兴趣的站先学。
- **拍一页就能记笔记**：读到哪页拍一下，划线和页边批注自动变成卡片，不用手抄。
- **学完一章就测**：题目从你划过的、问过的、做错的内容里出；选择填空当场出分，问答题教练来批。
- **错题不翻篇**：答错的题进「待订正」，订正对了才算掌握这个知识点。
- **每天照着清单复习**：今日页把要订正的题、该复习的卡片列好，打开就知道干什么。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-2.png" width="560" alt="一本教材的路线页：14 站的学习路线，顶部是站过关和考点掌握进度，当前一站有「去订正 7 题」和「接着学这一站」">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-3.png" width="560" alt="订正页：错题逐题列出，每题下面是作答框和「提交」「讲讲思路」「题有问题」">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-learning-suite
```

图书馆会跟着「学习套件」一起装好。装完开一个新会话，选「学习模式」，告诉教练你想读什么书。

图书馆只在学习模式的会话里出现。它的工具只对学习模式有用，所以只交给学习模式的会话，其它模式不会多出用不上的工具和按钮；这也是要连同套件一起装、不要只装本包的原因——单独装时它不会出现。

## 已知限制

- 不读取书的电子文件（EPUB、PDF），只登记书名和目录。
- 拍的照片会作为一条消息发进会话，由教练来识别。

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（服务与侧栏）、`src/tool.ts`（教练用的模型工具）；工具的用法写在各自的描述里。
- 也可以单独安装本包（`dsh plugin --profile web add @khorsheed/dsh-library`），但它的模型工具要由某个模式授予，单装时侧栏不会出现。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
