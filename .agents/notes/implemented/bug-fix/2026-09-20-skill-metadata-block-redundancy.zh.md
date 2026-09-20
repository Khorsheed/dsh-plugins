# Agent Note: the skill detail modal's metadata block

Status: implemented

## Problem

skill 详情弹窗会在 frontmatter metadata 里有任何「弹窗别处没渲染过」的键时，把整份 metadata 原样 pretty-print。豁免集合只有一个键：

```ts
return Object.keys(parsed).some(key => key !== 'presetScope')
```

它自己的注释就写着原则——已经渲染过的重复展示是噪音——但 `credentials` 不在里面。而声明 `metadata.credentials` 恰恰是让「凭据配置」表单出现的唯一方式，于是同一个声明又多出一份原始 JSON。对一份 metadata 只为这个目的而存在的 skill 来说，这块就是纯粹的重复。

它还带来两个小毛病：

- 区块渲染在最后，紧贴源码浏览器下面，一段等宽 JSON dump 看起来像源码窗格的一部分，而不像对这个 skill 的描述；
- 值原样打印。今天里面没有秘密（凭据值存在凭据服务里，从不进文件），所以这不是泄露——但面板在别处的规则是「用户配置过的值不再回显」，而一个格式整齐的 dump 正是变化发生时最不容易被注意到的位置。

## Decision

`hasUnrenderedMetadata` 现在豁免一个具名的「已有专用界面」键集合——`presetScope`（范围编辑器）与 `credentials`（凭据表单）——通过 `RENDERED_METADATA_KEYS` 表达，规则只有一处可读，而不是散在行内的比较。

区块标题改为 **frontmatter metadata**，并移到凭据表单之前：它描述的是这个 skill，理应和 skill 的其它属性放在一起，而不是贴着代码窗格。两个函数都导出并补了单测（`tests/skill-detail-metadata.client.spec.ts`）——旧判据没有任何直接覆盖，这正是 `credentials` 被漏掉的原因。

`formatMetadata` 现在把**键名**命中 `key|token|secret|password`（忽略大小写、递归、含数组）的值遮挡为 `···`。按 key 匹配是刻意的：按 value 形状启发式会误伤普通文案，以及路由描述里每一段长字符串。键名与值的形状仍然打印，所以这块仍然告诉读者 frontmatter 声明了什么。

## Alternatives considered

**在每个键都被豁免时干脆不显示（现有行为），其余不动。** 那就把「重复」之外的两个毛病留下了：位置和原样打印。位置恰恰是读者最先注意到的。

**彻底删掉这块，只渲染有专用表单的键。** 这块是「UI 不认识的 metadata」（插件自己的约定）的出口，而面板的定位就是列出注册了什么。保留，但收窄。

**按 value 形状遮挡（`sk-…`、长高熵字符串）。** 否决：对普通文本误伤，而且会悄悄毁掉读者正是来看的那些文案。

**把 metadata 渲染成 key/value 表格而不是 JSON。** 更好看，但它要为对象/数组型值发明一种形状，而这块存在的意义正是"别处都不理解的键，按存储的样子显示"。

## Consequences

- 只声明 `credentials`（或只声明 `presetScope`）的 skill 不再多出 metadata 区块；有其它键的仍然显示。
- 敏感值遮挡是展示层护栏，不是策略：磁盘上的值不受影响，凭据流程不变。
- `hasUnrenderedMetadata`、`redactMetadataSecrets`、`formatMetadata` 现已导出并有覆盖；将来某个 metadata 键有了自己的界面，就是 `RENDERED_METADATA_KEYS` 里加一项。

## Related

- [the capability catalog's mode view](../feature/2026-09-20-capability-catalog-mode-view.md)——这个弹窗所属的面板。
