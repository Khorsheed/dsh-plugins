# Agent Note: ui-file-preview 内容面迁入官方 document 预览面(方案 B)

Status: implemented

> **同日已回退(2026-09-24):** 仓主实测后否决了这次迁移——两条宿主线重新发
> 自绘产物页。本 note 保留作历史记录;其中对官方面的能力调查依然准确。当前真
> 相见[方案 B 回退](2026-09-24-file-preview-plan-b-reverted.md)。

## Problem

宿主 0.1.7-rc.1 把官方 document tab 长成了真正的扩展点:
`ctx.documentPreviews.register` 允许外部渲染器实现注册(extension 档压过
官方内置,工具栏下拉保留所有匹配),属主供给分页/字节/渲染器自持三种加载,
ui-open-in-app 也已经把在文件夹/IDE 打开这类原首手势贡献进了 document
工具栏。ui-file-preview 自建的 FilePreviewTab——一个以同档认领
`dsh-resource://file/**` 的 page-type 右栏 tab——如今与官方拥有的框架
重复;而它的改动记录维度(回合产物卡、逐次 write/edit diff 历史)官方仍无
对应物(workspace-changes 内存态、git-only、宿主重启即失)。用户拍板方案
B(2026-09-24):rc.1 上内容预览面切到注册进官方面,0.1.5 保留自建 pane
(npm 最新发布线),改动记录维度维持我方,并跟踪上游等同等能力。

## Decision

一个插件、两面内容脸,由 `installFilePreviewSurfaces`
(`packages/ui-file-preview/src/client/index.ts`)里的能力探测二选一:

1. **探测永不读版本。** 点探测 `ctx.get('documentPreviews')` 在官方面已
   就位时直接跳过自建注册;一个 pend 在 `inject: ['documentPreviews']`
   上的嵌套插件(`.../document-pane`)在官方面晚到时注册 rc.1 的两个渲染
   器并调用 `retireLegacySurfaces()`。cordis 4.0.4 的服务访问闸门禁止把
   未声明的 `ctx.documentPreviews` 当属性读,而静态 inject 又会在 0.1.5
   上把整包挂起——即
   [settings 双线](2026-09-24-settings-config-forms-dual-line.zh.md)的
   延迟 inject 模式。两面内容脸永不共存;把 documentpreview 组合在外的
   rc.1 实例退化为恰好的 0.1.5 面。
2. **rc.1:两个渲染器进官方 document tab。** 内容渲染器
   (`content-definition.ts` + `FileContentBody.tsx`)以默认 `extension`
   档注册——文件点击落进官方 tab,共享内容面板是默认渲染体,官方渲染器
   一下拉之遥。`loading: 'renderer'` 让读取留在本插件自己的 Remote 上,
   工作区外产物照常渲染(属主的工作区分页读服务不到);渲染体按属主的
   revision 经 `loaded(version)`/`failed()` 结算,version 取自标准
   `useResource<'file'>` 元数据,属主的变更检测与自动刷新因此继续工作。
   改动记录渲染器不变(`builtin` 档,只进下拉)。
3. **0.1.5:不变。** FilePreviewTab 类型与本体照旧注册;minHost 保持
   `0.1.5-rc.1`。
4. **rc.1 手势清单**(每个差异化点要么并入要么让位):复制路径/内容搜索/
   结构化渲染(JSON 树、CSV 表、Markdown)/HTML 沙箱分级随面板并入注册定
   义;在文件夹打开、在 IDE 打开让位 ui-open-in-app 的
   `sidebar.right.tab.document.actions` 贡献;图片预览让位官方缩放查看
   器,唯 avif 保留(官方未认领,并声明进 `binaryExtensions`,纯文本兜底
   不再自荐);超大文件从我们的截断提示改为官方文本渲染器的滚动分页(一下
   拉之遥)。原样保留:TurnFileRow、FileHistoryBody、宿主 Remote、
   mentions 包装。
5. **字典清理。** 已退役抽屉的文案(drawer.* 8 键、row.* 5 键、
   turn.summary/summaryOne/expand/collapse)在双线都已死,删除;
   `content.title`(「预览」/“Preview”)是内容渲染器的下拉标签。

## Alternatives considered

- **rc.1 上也保留自建 tab(方案 B 之前的现状)。** 两个框架认领同批地
  址;官方面在 rc.1 的大扩(缩放、FortuneSheet、office 经随包
  libreoffice、actions 槽)让重复肉眼可见,且用户判定内容维度官方覆盖已
  够。
- **以 `builtin` 档注册,让官方渲染器保持默认。** 把插件的存在理由(增
  强面板)降级成下拉项,改变每次文件点击的所见;extension 档是注册表给
  外部实现的成文座位,且保住了今天「默认是我们」的行为,只是搬进官方框
  架。
- **`loading: 'text-pages'`(属主备内容)。** 官方分页、版本、自动刷新
  全送——但属主的读限定工作区,工作区外渲染就此死掉,而这是用户明确保
  留的头牌能力;渲染器自持加载把读留在我们的 Remote 上。
- **连图片一起认领。** 面板的裸 `<img>` 臂严格不如官方缩放查看器;只有
  avif 留下(官方 image 渲染器不认领它)。
- **插件行上静态 `inject: ['documentPreviews']`。** 在 0.1.5 上把整包永
  久挂起;点探测 get + 延迟嵌套插件才是成文的双臂探测。

## Consequences

- rc.1 上文件点击、mentions、官方产物卡、回合卡收敛到一文件一 tab(官
  方 document tab);查看器下拉给出 预览(我方,默认)/ 改动记录(我
  方)/ 官方渲染器——严格比 0.1.5 的分裂可达,那时改动记录渲染器只服
  务我们认领不了的文件。
- 已记录的损失:向导页「会话产物」列表入口在 rc.1 消失(每回合产物由
  TurnFileRow 存续);没有 ui-open-in-app 的组合里我们的文件夹/IDE 按钮
  消失;面板的内容⇄改动切换与全屏仍在,但面板自带标题栏会渲染在官方工
  具栏之下(视觉重复,v1 接受——消除它需要内核包的无头渲染体模式,超出
  本次范围)。
- 工作区外渲染在切换后存活(渲染器自持加载);此类文件的 tab 在 `file`
  资源无元数据时没有官方变更检测(手动重载)。
- 测试在同一 bench 上钉住双臂:rc.1(渲染器在、自建缺席)、0.1.5(自建
  在、渲染器缺席)、晚到(provide 后自建退役),外加 FileContentBody 组
  件 spec 钉渲染器自持加载生命周期(`loaded`/`failed`/revision 重取)。
- 顺带修复 rc.1 类型面在 FilePreviewTab 的预存错误
  (`navigation.params.path` 撞上只带 `line` 的
  `WorkspaceFileParams`),用官方 TextPreview 同款的 `'path' in` 收窄。
