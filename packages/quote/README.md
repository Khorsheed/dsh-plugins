# @khorsheed/dsh-quote

[English](README.en.md) | 中文

看到哪句想追问，选中它，一键引用进输入框。

想拿助手回复里的一段话、文件预览里的一段内容来追问，以前得手动复制、切回输入框、粘贴，再写一句「你上面说的这段……」。装上引用，在 DSH 里选中任意一段文字，旁边就会浮出一个小菜单：点「引用到当前会话」，这段话带着出处进了输入框，你接着写问题就行；它不会替你发出去。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-1.png" width="560" alt="选中助手回复中的一段文本后，选区旁浮出的引用动作菜单">

## 能做什么

- **选中就能引用**：助手回复、文件预览、灵感空间的文章里，选中文字就出菜单；在输入框里选字不会打扰你。
- **自带出处**：从文件里引用会写上文件名，从文章里引用会写上文章标题，agent 一看就知道你在说哪段。
- **不会弄乱你写了一半的话**：输入框里已经有字，引用接在后面另起一段，不覆盖；引用后面另起一行，接着打字就是你的问题。
- **点一下核对引了什么**：引用在输入框里是个小标签，点开能看全文。
- **发出去也好认**：发出的消息里，引用显示成一张带出处的卡片。
- **顺手复制**：不想引用，点「复制」直接拿走原文。
- **别的插件也能加选项**：装了灵感画布，菜单里会多一个「存为画布卡片」；装了灵感空间，在文章里会多一个「记笔记」。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-2.png" width="560" alt="文件预览面板里选中一段内容后浮出的同一引用动作菜单">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-basic
```

引用会跟着「基础体验」一起装好。装完打开任意会话，选中一段文字试试。

## 已知限制

- 引用的是纯文字：表格、代码块会变成普通文本，也不能跳回原文的位置。
- 输入框里的引用标签是一整块，不能逐字改，按退格整块删掉。
- 页面滚动或缩放时菜单会先收起，重新选一下就好。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 选区菜单的工作方式、其他插件往菜单里加选项的接口（`ctx.quoteActions`）、各宿主版本上的降级，见[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/quote/docs/reference.md)。
- 也可以单独安装：在「添加插件」里输入 `@khorsheed/dsh-quote`，或 `dsh plugin --profile web add @khorsheed/dsh-quote`，重启后生效；本插件不存任何数据，卸载无残留。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
