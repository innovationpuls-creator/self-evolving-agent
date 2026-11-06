# 进度

当前任务的状态，跨会话保留。由 `/verified-loop` 维护；新任务开始时，把上一任务移入“已完成任务”只留一行结论。

## 当前任务

### 界面遗留问题收尾（2026-11-06）

- 目标：处理上一任务实际结果中列出的已知缺口。
- 依据：“去除多余次级标签与说明”实际结果的未验证/已知缺口清单；用户“继续”。
- 范围：`apps/web/src` 展示层与 `scripts/*smoke*.ts`；不改 Host API 与业务语义（Host 侧文案另需授权）。
- 完成标准：每条缺口已修复或在实际结果中说明原因；`npm run verify`、`npm run test:d6:ui` 通过；带数据时 1440/850/390px 无横向溢出。

| # | 步骤 | 验证方式 | 状态 | 尝试 | 证据 |
|---|---|---|---|---|---|
| 1 | 记忆“确认仍然有效”：按 Host revise/confirm 与 basis 规则核对依据只含其他项目来源时的可见性，按实际效果修正 | 引用 Host 代码说明各状态；对应状态下按钮可见性与 Host 行为一致；typecheck + 相关测试 | pass | 1 | verifier PASS（无代码改动）：Host 所有写入路径（用户/Agent 工具/复盘）的来源项目均等于记忆项目，跨项目依据不可达；按钮条件与 confirm 实际效果一致（用户编辑且无依据/非项目决定时 confirm 只生成相同修订）；memory/web-state 19/19、typecheck |
| 2 | 自动复盘“尚未检查/暂不可用”提示：环境状态变化后提示随 Host 数据更新，不残留过时文案 | 说明数据来源与刷新事件；状态变化后提示更新；typecheck + 相关测试 | pass | 1 | verifier PASS（含一次小修）：Host 环境变化不发事件，网页层在未检查时每 5s 轮询（仅已连接且页面可见）、focus/visibilitychange 刷新、重新检查失败也刷新；同范围刷新保留错误直至成功，消除闪烁；两句提示各自只覆盖对应状态；新增 tests/reflection-notice.test.ts，相关测试 29/29、typecheck、build。限制：其他客户端重新检查且无等待任务时，本窗口要到聚焦/切回才更新 |
| 3 | 会话完整标题在窄屏/触屏可达（标题非首条消息前缀时） | 390px 下可通过触控或可聚焦元素看到完整标题；typecheck + build | pass | 1 | verifier PASS：标题改为可点/可聚焦按钮，390px 触控点开换行显示全文、再点收起，两种视图无横向溢出；无新增可见文字，标题仍是 heading 名；1440/850/390 收起态页头高度与 HEAD 一致；顺带修复执行过程视图 850/390 下切换按钮被挤压；换会话自动收起；typecheck、build、biome |
| 4 | 删除 product.css、a-product.css、workspace.css 等文件中无引用的死 CSS | 删除的选择器在 `apps/web/src` 无引用；build 产物样式无回归（test:d6:ui） | pass | 1 | verifier PASS：独立解析 1,233 个删除选择器，类/ID 在源码中全部无引用；keyframes 与变量无残留使用；8 个空文件已删且无引用；带数据 46 个页面状态（1440/390）逐元素计算样式与位置 diffs=0；构建 CSS 199→88 kB；typecheck/lint/format/build/test:d6:ui 通过 |
| 5 | skills-ui-smoke 按当前界面更新并运行 | `npm run test:skills:ui` 通过，断言未削弱 | pass | 1 | verifier PASS：skills-ui-smoke（打包 Desktop + 真实模型一轮）与 skills-browser-smoke 均通过；逐条核对删除/改动断言均为等价或更强替换（过期编辑器改为只读、新增双窗口未保存草稿、离开确认改为草稿保留 + beforeunload、审查重置改为跨窗口）；导入范围显式选全局与旧默认一致。未跑：需人工审查摘要的特殊技能分支 |
| 6 | 回归：带数据的三宽度溢出检查、`test:d6:ui`、`npm run verify` | 命令全部通过 | pass | 1 | verifier PASS：顺带修复自动复盘行内项目名与状态粘连（仅 CSS，flex + 12px 间距）；带数据 15 个页面状态 1440/850/390 无横向溢出；`test:d6:ui` 全部 true；`npm run verify` exit 0（219：218 pass/1 skip） |

- 实际结果：6 步全部 pass，无 blocked。`npm run verify` exit 0（219：218 pass/1 skip），`npm run test:d6:ui` 通过；skills-ui-smoke（打包 Desktop + 真实模型）与 skills-browser-smoke 通过。改动：自动复盘环境提示随 Host 状态更新（未检查时轮询，聚焦/切回刷新，失败也刷新，不闪烁）；会话标题可点开看全文；删除约 1,600 条无引用 CSS 与 8 个空文件（CSS 199→88 kB，46 个页面状态计算样式无差异）；技能 smoke 同步新界面；复盘行项目名与状态间距。记忆确认按钮经核对无需改动。未提升新规则。未验证：需人工审查摘要的特殊技能分支；真机 iOS/Android；部分对话框与运行中/失败状态未做逐像素对比；Desktop 未用本轮代码重新打包；Host 侧错误文案与环境变化事件未改（需授权）。未提交。

## 失败记录

同一签名出现第二次时，提升为 CLAUDE.md 的 Learned rules，并标记“已提升”。

| 签名 | 次数 | 首次步骤 | 状态 |
|---|---|---|---|
| copy: simplified status text asserts a cause not true for all states it covers | 3 | 5 | 已提升 |
| visibility: control hidden on assumed semantics without checking host behavior for all reachable states | 2 | R2-4 | 已提升 |
| derived-label: deduplicated label computed over data the user cannot see (filtered/collapsed/windowed) | 1 | R2-3 | 观察中 |
| refresh: manual reload removed where host emits no change event for that data | 1 | R2-6 | 观察中 |

## 已完成任务

- 2026-11-06 去除多余次级标签与说明：7 步全部 pass，`npm run verify`、`test:d6:ui`、`test:ui`（打包 Desktop + 真实模型）通过；提升 visibility、copy 两条规则（`6e6b1fa`）。

- 2026-11-06 Desktop/Web 前端易懂性优化：首次使用引导、导航分组、全站去内部术语、返回入口去重；8 步全部 pass，`npm run verify` 与 `test:d6:ui` 通过（未提交）。

- 2026-11-05 仓库整理：D6 提交、prototypes 停止跟踪、DECISIONS.md 重建、历史脚本归档（`aecabfe`）。
