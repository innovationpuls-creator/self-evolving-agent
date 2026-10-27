# 第二轮验证记录

本轮把视觉评审与行为检查分开。实际截图中的层级、比例、密度、内容和授权表面经过目视批评与修改，见 [VISUAL-REVIEW.md](VISUAL-REVIEW.md)；下面的浏览器结果只证明相应模拟操作和断言，不证明用户已经接受设计。

## 复现

先在仓库根目录运行 `npm run dev --prefix prototypes/d6`，保持4176运行，然后：

```sh
npm run test:browser --prefix prototypes/d6
```

使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，Playwright Core 驱动真实无头 Chrome。当前记录的浏览器版本为155.0.8059.85，不是 DOM 模拟器。五份脚本顺序执行，避免并发截屏干扰：

| 脚本 | 覆盖 | 结果文件 |
|---|---|---|
| `scripts/review.mjs` | 两方向全部主要模块、五尺寸；工具/证据、修订冲突、反思、能力候选检查/回退、模型授权、新会话/引用/IME/停止、四种开发结果 | `evidence/round2/browser-results.json`，24组 |
| `scripts/states.mjs` | 七模块×两方向×空/加载/读取失败/长内容；Tab 包含与 Escape 焦点返回；断线重连 | `states-results.json`，18组 |
| `scripts/details.mjs` | 窄屏 Memory/反思/能力详情、Diff/依赖/失败调用/JSON，390授权上下段与850×600授权 | `details-results.json`，2组 |
| `scripts/diff.mjs` | 未改上下文折叠/展开、修改前后完整原文与变化定位 | `diff-results.json`，2组 |
| `scripts/contracts.mjs` | 提供方授权隔离、未审候选不撤销正式信任、禁用 Skill 同步 Tool 状态、窄屏搜索直达指定对象 | `contracts-results.json`，8组 |

组数不是独立用户数或性能指标；单组可能包含多个步骤与断言。主要窗口为1440×1000、1240×850、850×600、768×900、390×844。截图清单见 `screenshots.json`，逐模块对照见 `evidence/round2/index.html`。`studies/` 保留本轮早期基准，当前比较页只使用最终命名截图。

## 实际检查内容

- 主要导航、搜索、会话与对象选择有对应内容；两方向采用相同初始案例与独立状态。
- Markdown/GFM、语法高亮、真实 Diff、JSON 嵌套与原文均有实际内容。没有以通知代替编辑、授权、检查、生效和版本切换。
- 未发送讨论时不能授权；空目标/空范围不能批准；阶段目录不能越过授权。
- 开发成功更新版本及内容；失败/取消/无需修改不替换旧版。手工候选经过独立内容审查；未审候选不撤销当前正式版信任。
- 停止后等待超过模拟完成时间，任务保持停止；授权和调用成功分别呈现；退出 Host 副本不声称撤销环境或提供方授权。
- Memory 新增修订保留旧内容；冲突阻止直接保存，核对后恢复；无新发现作为正常 Reflection 记录。
- 页面与工作区无横向溢出；表格和代码允许局部滚动。窄屏对象详情有返回目录，授权可以滚动到最后的决定。
- 对话框检查 Tab 不离开、Escape 返回触发位置；快速输入已获得新焦点时不强行抢回。IME guard 检查使用合成 composition 标记，不能替代所有中文输入法实机测试。
- 浏览器记录没有 pageerror；主检查没有发现外部服务或 Host 地址请求。源码不包含 Host API/凭据读取/真实发布接口；Vite 的本地开发资源与 HMR 正常使用。

## 工程检查

`typecheck.txt`、`lint.txt`、`format.txt`、`build.txt` 保存独立 Demo 检查结果。类型、Biome lint、格式和构建通过。Biome 配置覆盖 TS、TSX、CSS 与脚本；仅 CSS 的 noDescendingSpecificity 对模块及响应式覆盖关闭。没有借此修改根配置。

构建保留单包超过500kB提示：当前 JS 约638kB，gzip约199kB；这不是运行错误。Demo 未进行正式产品的分包或性能优化，也不作性能结论。正式根测试未运行，因为没有改动正式实现；模拟生命周期通过浏览器实际行为断言检查。

## 检查中发现并修正

- 截图导航脚本曾在 B 窄屏停留于打开的目录，修正关闭导航步骤，并重新截图；没有把目录遮挡误认为成品报告布局。
- 原始读取记录误复用差异数据、Tool 可用性未跟随禁用、候选/正式信任混用、回退仅切指针等，均在 Demo 状态与呈现中修正。
- 关闭弹窗的延迟焦点恢复与快速输入竞争，修正为不抢走新焦点；重跑输入与停止检查。
- 一次测试期间编辑源码触发热更新，出现 removeChild 异常；该轮不记为最终通过结果。最终检查在冻结源码后重新完整运行，结果以五份 JSON 为准。
- 目视发现的辅助字过淡、代码字号偏小、中窗口多列拥挤与选中对象定位不清，已实际修改并重新截图。详细对应关系见视觉记录。

## 本轮没有证明的事项

没有目标用户可用性访谈、完整屏幕阅读器审查、所有输入法/浏览器覆盖、真实 OAuth callback、真实 Shell/Skill 发布、XPC 或原生 Desktop 外链与窗口验收。浏览器响应式检查不冒充原生 Desktop 验收。A/B 的视觉与信息架构均等待用户选择。

## 工作区保护

`round1/` 保留上一轮原件，`baseline/` 保留更早五文件。`files-before.json` / `files-after.json` 对 d6 之外696个已跟踪/未忽略文件逐项摘要，缺失文件同样记录；`preservation.json` 差异为零。既有正式 Bugfix 保留。`workspace-before.txt` / `workspace-after.txt` 保留 Git 状态。没有提交、推送或进入正式前端改造。

## A 轨迹后续修订

本页 round2 证据保留原时点。后续 Agent Loop 内容与交互变更使用独立的 `npm run test:trace --prefix prototypes/d6` 验证；最新范围、视觉修正及证据见 [TRACE-LOOP.md](TRACE-LOOP.md)。未将旧版轨迹截图冒充最新界面。

## A 紧凑事件表后续修订

用户再次否定讲解式轨迹后，改按 Harness 网页版的 30px 事件表与局部检查器实现。专项 4 组检查通过，实际测量 10 行均为 30px；完整 Demo 的 54 组浏览器回归也通过。新证据独立放在 `evidence/trace-ledger/` 及其 `regression/`，没有覆盖先前截图。最终 typecheck/lint/format/build 通过；外部 696 文件摘要不变。设计修改、尺寸与截图见 [TRACE-LOOP.md](TRACE-LOOP.md)。
