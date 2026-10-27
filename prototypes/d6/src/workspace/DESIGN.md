---
name: D6-A Workspace
description: Quiet reading and maintenance surfaces for memory, skills, reflection and improvement proposals.
colors:
  primary: "#455c45"
  primary-hover: "#354c35"
  ink: "#242923"
  secondary-text: "#687066"
  surface: "#ffffff"
  divider: "#e5e8e1"
  soft: "#f5f6f2"
  row-hover: "#f7f8f5"
  icon-surface: "#eef1e8"
  icon-ink: "#56694e"
  caution-surface: "#faf6ed"
  caution-ink: "#7d613b"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  note:
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 2
  label:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  field: "4px"
  control: "6px"
  panel: "8px"
  tile: "10px"
spacing:
  compact: "8px"
  control-gap: "12px"
  item-gap: "18px"
  block: "24px"
  section: "32px"
  reading-rail-gap: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  skill-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "24px"
  search:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.field}"
    padding: "0 9px"
---

# Design System: D6-A Workspace

## Overview

**Creative North Star: "安静的个人参考室"**

白底阅读面、石墨文字、克制的橄榄色操作与中性导航服务个人长期使用。记忆先读认识，技能先看用途，反思按时间回看，建议只在有必要时要求判断；四种集合保留各自的组织方式。

本文件从 `workspace.css`、四个模块和共享控件的实际实现提取，只适用于 A（`quiet`）的记忆、技能与工具、反思记录、改进建议。其阅读与维护页面由 `src/main.tsx` 路由到 `src/workspace/`，B、会话、轨迹、设置不继承本次重设计。当前是模拟数据原型；最终设计验收由 ChatGPT 决定。

**Key Characteristics:**
- 白底、细分隔与少量语义底色。
- 集合进入完整详情，阅读正文与属性依据分层。
- 四类集合有不同节奏，操作在相关对象中出现。
- Lucide SVG 提供辨识；没有图片资产，截图只作为评审证据。

## Colors

单一橄榄色操作强调配合中性阅读层级；保留已有状态语义，不把执行结束自动解释为成功。

### Primary

- **Quiet Olive**（`primary`、`primary-hover`）：工作空间按钮、文字链接、活动页签和键盘按钮焦点。
- **Olive Icon**（`icon-surface`、`icon-ink`）：技能用途图标的轻底与前景。

### Neutral

- **White Reading Surface**（`surface`）：集合、详情和主体阅读背景。
- **Graphite**（`ink`）：标题、正文和当前页签。
- **Quiet Context**（`secondary-text`）：用途说明、时间、属性和来源。
- **Fine Boundary**（`divider`）：行与章节分隔。
- **Soft Context**（`soft`）：辅助内容与工具选中背景；`row-hover` 用于记忆、建议等行的悬停。
- **Caution**（`caution-surface`、`caution-ink`）：待核实记忆的说明，不表示已发生失败。

**The Restrained Accent Rule.** 橄榄色帮助定位动作和选择；阅读层级主要由位置、间距与字重建立。

共享错误、检查、Diff 与 portal 浮层仍沿用项目既有语义颜色和控件 token；它们不是本文件新增的品牌色。工作空间局部 `--aw-*` 声明在容器内，不能假定会继承到 Radix portal。

## Typography

**Body Font:** 系统字体栈，具体见 `headline.fontFamily`；没有外部字体请求，也没有展示字体。

### Hierarchy

- **Headline**：模块及对象标题；窄于等于 700px 时调整为 25px。
- **Title**：通用章节；技能 tile 和日志标题使用 18px，日志在窄屏使用 17px。
- **Body**：说明和一般内容；阅读正文按内容单独放大。
- **Note**：记忆正文，保留换行；窄屏为 16px / 1.95。技能 Markdown 为 15px / 1.95，反思导语为 16px / 1.95。
- **Label**：按钮与页签；辅助说明主要 12–13px，11px 仅用于技能标识等局部元信息。

**The Reading First Rule.** 对象标题先建立内容主题，范围、状态与日期放在标题下方或属性区；不把元信息提升为展示性眉题。

## Layout

主体最大宽度 1180px，居中；宽屏内边距为 42px 48px 64px。标题与集合工具有独立间距，详情替换集合，而不是预先显示一个未选择对象的阅读面。

宽屏详情为 `minmax(0, 1fr) 230px`，正文与依据栏间距 48px；讨论页同样保留 230px 上下文栏，间距 40px。视口小于等于 1250px 时上下文移到正文后，间距 32px，属性区用顶部分隔替代左侧分隔。技能集合从三列变为两列。

小于等于 1000px 时主体内边距为 32px 30px 55px；小于等于 700px 时为 27px 22px 48px，技能单列，工具栏换行、搜索占满宽度、页签允许横向滚动、日志日期移到条目上方。详情始终有明确返回入口。

## Elevation & Depth

工作空间集合与阅读面以分隔线和色面建立层级，不给 tile 添加阴影。共享次要按钮保留极轻的 `0 1px 1px #00000004`；Dialog、Menu 和 Toast 继续使用共享浮层阴影。浮层高于阅读面的层级服务焦点与反馈，不引入玻璃或装饰渐变。

技能 tile 只在背景和边框上使用 130ms ease；共享按钮背景和文字使用 100ms。Radix 浮层使用共享 fade；reduced-motion 时关闭工作空间过渡，共享层另有项目响应规则。

## Shapes

集合行是平直的分隔结构；控件使用小圆角，技能 tile 使用较大的圆角。辅助工具面板与待确认内容用轻底色容器，避免把每段正文变成独立卡片。图标来自现有 Lucide SVG，不使用文字字符充当图标。

## Components

### Buttons and fields

主按钮使用橄榄色实心与白字；次要描边和 ghost 沿用共享 Button，局部最小高度 36px。焦点可见，禁用保留名称和位置。主按钮 hover 既应用本地深色背景，也保留共享 `brightness(0.92)`。搜索为白底细框；共享搜索焦点沿用 A 的 `--accent`，普通工作空间按钮焦点使用 `--aw-accent`，两者不是同一个变量。

输入、textarea、select、确认提示和错误沿用现有 Field / Notice / StateGate。讨论输入容器用 `focus-within` 整体标识焦点。复用 Radix Dialog / Tabs / Menu 的焦点和键盘基础设施；不以截图替代其运行行为验证。

### Memory: grouped reading rows

记忆独立于会话。浏览范围可以随工作空间参考会话、固定已有项目或只看全局；项目与全局分组阅读，完整路径辅助辨识同名项目。全局正文共享不扩大项目历史或来源引用的访问范围。

可使用、暂不可用、已撤销、全部修订与类别分开筛选。详情将最新头、状态、检索可用性分别呈现。创建和编辑保留四类认识、内容与依据；修订追加、历史只读。撤销退出当前检索，重新确认必须提交当前认识和新依据；移除保留历史但不可直接启用。冲突保留草稿，来源尚未恢复时不能修订或调整范围。

### Skills and tools: purpose tiles

技能以用途名称、Lucide 图标、用途说明与启用／候选状态形成 tile；工具作为独立目录页签，通过行进入归属与可用性说明。技能详情区分使用说明、文件、候选与版本；Markdown、Code、JsonView、Diff 复用现有内容组件。

编辑或导入形成候选。Extension 的精确候选内容需先审查信任，再运行必要检查；内容改变时信任不应继续作为旧内容的批准。检查失败保留正式版本，版本页提供已有版本的回退。这里展示的是本地模拟生命周期，不是真实 Host 检查或本机执行证明。

### Reflection: chronological journal

全会话时间线可按来源会话筛选，项目标识帮助辨识任务；日期列与日志行构成时间序列；保留有发现、没有新发现、未能检查三种记录。详情以结论、观察、未确认内容和知识／能力影响分节，依据与关联内容置于上下文。反思不是内部思考轨迹，也不会自行授权修改能力。关联记忆、未采纳建议与来源应定位到相应对象。

### Improvement proposals: attention inbox

待处理页允许合理为空，最近处理记录与历史仍可读；待决定建议支持讨论、暂不采纳和归档；没有保存处理原因时不归纳原因，也不为填充列表制造能力缺陷。用户可主动发起讨论，发送文本与授权开发是分开的动作。

讨论后通过聚焦 Dialog 明确目标、允许修改的已有技能、新建范围、本机用户权限、必要检查通过后自动生效以及取消／回退无法撤销外部副作用。目标为空、没有允许范围、重名或连接不可用时不能开始。活动、检查失败、取消、生效与无需修改分开呈现；历史详情导航不改变当前开发活动。

### Reuse and reference boundary

复用项目已有 Radix Dialog / Tabs、Button / Field / StateGate、Diff、Lucide 和状态模型。Linear、Obsidian、Raycast、shadcn 的外部参考用于结构模式与源代码研究，没有复制整包组件、品牌图像或增加依赖。无 raster 素材义务；评审截图不作为界面素材使用。

## Do's and Don'ts

### Do:
- **Do** 保留四类集合各自的组织方式，并以完整详情承载阅读。
- **Do** 将来源、修订、信任和授权后果放到相关决策点。
- **Do** 用标题、正文、属性分层与响应式重排保持阅读顺序。

### Don't:
- **Don't** 为填满待处理列表而捏造缺陷或建议。
- **Don't** 将本次 A 工作空间规则应用到 B、会话、轨迹或设置。
- **Don't** 将原型呈现、内部评审或截图称作最终设计验收或真实 Host 验证。


## 2026-10-24 · Hierarchy refinement

本轮保留 quiet / olive 视觉与四模块组织方式。记忆首页以三种可用状态浏览，跨修订搜索改为次级“历史查询”；项目目录和共享会话数量按需展开。阅读详情只保留一次范围与类别，正文优先，编辑／修订历史在对象标题旁；属性折叠。反思按更新时间倒序，结论之后依次是已保存变更、待核实与发现；来源标识集中在证据抽屉。

建议以问题、拟议改变、不确定性和决定组织，来源折叠于文末；讨论区只保留一处授权入口。授权对话框不重复展示被选技能，必须明确选择技能后才能授权已有能力。权限与自动生效后果保持可见。

技能保留目录、编辑器与版本操作。1000px 及以下使用列表／详情切换，详情返回列表后仍可导入或切换目录；桌面保留双栏。Tool 以参考会话和一个可调用结论为主，加载与模型声明另行展开；窄屏参数按参数行阅读。候选页删除重复的候选标题和已在当前页的“审阅候选”入口。未改变候选、信任、检查、发布与回退语义。
