---
name: D6-A Skills Manager
description: An extension manager within the existing quiet olive workspace.
colors:
  primary: "#455c45"
  ink: "#242923"
  muted: "#646d63"
  border: "#e3e6df"
  surface: "#f7f8f5"
  library: "#f8f9f6"
  selected: "#e8ede2"
  selected-border: "#d6dece"
  layer: "#f0f2ec"
  editor: "#fcfdfb"
  gutter: "#f4f6ef"
  editor-focus: "#6a815d"
  pending-surface: "#faf7ef"
  pending-ink: "#7a591f"
  success-surface: "#edf4e7"
  success-ink: "#3c5a2f"
typography:
  headline:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontSize: "14px"
    lineHeight: 1.65
  markdown:
    fontSize: "13px"
    lineHeight: 1.9
  editor:
    fontFamily: '"IBM Plex Mono", "Noto Sans SC", monospace'
    fontSize: "12px"
    lineHeight: "25px"
rounded:
  manager: "10px"
  control: "6px"
  segment: "4px"
spacing:
  compact: "4px"
  control-gap: "10px"
  section: "24px"
components:
  selected-item:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "16px 10px"
  editor:
    backgroundColor: "{colors.editor}"
    typography: "{typography.editor}"
    padding: "18px 14px"
---

# Design System: D6-A Skills Manager

## Overview

**Creative North Star: "安静的个人参考室"**，沿用 [Workspace DESIGN.md](DESIGN.md) 的 quiet / olive 体系。技能与工具以持续可见的目录和对象管理区组织，便于查找、阅读、修改与发布；没有创建另一套视觉身份。

本文描述 `Skills.tsx`、`skills.css` 与共享控件的当前实现，只覆盖 D6-A 的技能与工具。所有生命周期与会话状态来自本地模拟数据；不代表真实 Host 回执或最终设计验收。B、其他工作空间模块、会话、轨迹、设置与正式 Host 均不在本文件范围内。

## Colors

### Primary

橄榄色延续工作空间主动作、活动页签与按钮焦点。局部状态以文字、图标和小圆点共同表达；选中项使用浅橄榄底和细边框，不靠高饱和大色块抢占阅读区。

### Neutral

`muted`、`border`、`surface` 分别对应实际 CSS 变量 `--asm-muted`、`--asm-border`、`--asm-surface`。目录底比白色详情略深；文件栏、层级切换条、编辑器与行号栏用相邻中性色区分。待处理和生效反馈使用各自语义前景与底色。共享 Status、Notice、Code、Diff 与 portal 浮层继续使用既有 token，不另设全局变量。

## Typography

延续 A 的系统正文与共享 Code 字体。页面标题使用 frontmatter 的 headline；对象标题同为 24px，但继承对象标题行高 1.5 与字距 -0.025em。列表名称为 14px / 600，标识与筛选为 12px，版本与辅助状态主要为 11px。Markdown 使用独立阅读规格；编辑器按固定行高与行号对齐。700px 及以下页面和对象标题降为 22px。

## Layout

本模块覆盖工作空间通用的 1180px 最大宽度，充分使用当前可用宽度；桌面内边距为 28px 32px 48px。管理器为 246px 目录加 `minmax(0, 1fr)` 详情，最小高度 738px；详情内边距 28px 30px 32px。目录内安排技能／工具页签、搜索、筛选、计数与对象行。详情顺序为对象标题、描述、状态、动作、管理页签与内容。

| 视口宽度 | 当前实现 |
| --- | --- |
| ≤1200px | 主体内边距收为 25px 24px 48px；目录 210px，详情内边距 24px 22px。 |
| ≤1000px | 目录 190px，详情内边距 22px 20px；启停开关换行，发布动作区纵向排列。 |
| ≤700px | 主体内边距 23px 16px 40px；管理器取消外框与最小高度，列表和详情互斥显示；详情提供返回列表入口。开关回到标题同行并隐藏重复文字，候选操作页签独占一行，保存栏与反馈可换行。 |

编辑区最大高度 600px，可滚动；textarea 可纵向调整，默认最小高度 365px，窄屏为 380px。行号栏宽 38px，窄屏为 28px。长文件标识允许换行，代码保留原始行结构。窄屏以进入详情的方式保留阅读宽度，不把目录挤成持续占位的窄栏。

## Elevation & Depth

目录与详情以轻底色和细线分界，管理器与列表项没有新增阴影。Dialog 使用现有 Radix portal 的遮罩、层级与焦点机制；局部容器变量不能假定继承到 portal。正在检查以共享旋转图标及文字反馈，结果在对象动作区下方呈现。

## Shapes

管理器与技能大图标采用 manager 圆角，行项、文件阅读容器、发布栏采用 control 圆角，筛选与分段选择使用 segment 圆角。文件栏上圆角与正文下圆角组成一个连续文件容器。窄屏目录单独使用 8px 圆角；详情以平直阅读面承载内容。

## Components

### Directory and object management

技能可按名称、标识与描述搜索，按全部／已启用／有候选筛选；工具按名称、标识与来源搜索。列表保留启停、正式版本、候选与未保存编辑提示，选中对象由当前项语义和底色共同定位。详情以内容／工具／版本切换；正式版本和候选为独立内容层，文件选择另占一层。

### Formal, candidate and release

正式内容只读，支持 Markdown 或 Code 查看。编辑使用原生 textarea 加独立行号栏；Cmd/Ctrl+S 与按钮同样调用保存候选。草稿按技能与文件保留；撤销未保存编辑回到已保存候选或正式内容。空白、未改变内容、检查期间及另一个文件已有候选时不能保存；一个技能同时只处理一份已保存候选。

候选按编辑／改动／审查与发布组织。Diff 比较当前正式内容与候选或未保存编辑，明确标出比较对象；保存不会替换正式内容。Extension 候选需通过 Dialog 查看完整指引、执行代码与锁定依赖，并勾选审查确认。审查绑定精确内容及正式基线，再次保存内容需重新审查。

已保存内容、Extension 信任及连接条件满足后可检查并生效。模拟检查期间保留正式版本；连接或内容基线变化、检查失败时保留候选并说明原因。通过后新增版本快照并启用正式版本，反馈提供版本入口。导入使用演示包、校验空名与重名，只创建未生效候选；不会实际加载执行代码。

### Versions and tools

版本页按新到旧列出历史，可查看保存的完整快照。缺失快照不提供恢复；恢复前用 Dialog 说明目标版本与后果，连接可用且不在检查中才可确认。恢复保留历史及现有候选；Extension 候选的审查状态随正式基线切换清除，需重新审查。不撤销记忆、执行历史或外部操作。

工具详情分别列出来源可提供、会话已加载、已向模型声明与当前活动调用。归属不明保持未确认；所属技能停用则来源不可用；Shell 加载不等于获得活动授权。工具与所属技能互相导航，工具没有独立启停开关。参数先用表格阅读，原始声明按需展开。

### Reuse and references

复用现有 `Button`、`SearchBox`、`Field`、`Notice`、`Status`、`StateGate`、`EmptySearch`，`TabBar` / `Modal` 分别封装 Radix Tabs / Dialog；`Markdown`、`Code`、`Diff` 与 Lucide 图标继续使用已有实现。文件和版本选择是普通带 `aria-pressed` 的按钮。编辑器为原生 textarea，当前 package.json 未安装 CodeMirror，不将其描述为集成编辑器。

本轮主代理实际查看的官方视觉参考：[VS Code Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace) 中功能贡献截图的标题／版本、动作、Details／Contributions／Changelog 与侧栏层级，以及 [Raycast Extensions](https://manual.raycast.com/extensions) 的 Store 截图中搜索、紧凑行、选中项与 Show Details／Actions 底栏。参考用于管理结构和信息层次，没有复制外部源码、品牌素材或安装新组件包；官方截图未作为本地界面资产保存。

## Do's and Don'ts

- **Do** 将正式内容、已保存候选和未保存草稿分清；在操作处说明何时生效。
- **Do** 保留可追溯版本、准确的信任边界与未知工具状态。
- **Do** 在此模块以实际管理器布局为准；父级 DESIGN.md 的技能 tile 与三／两／单列描述属于此前实现。
- **Don't** 把检查、导入或工具可用性展示称为真实 Host 执行证明。
- **Don't** 将技能页的布局覆盖扩散到 B 或其他模块，或通过新品牌色、展示字体重建视觉身份。
