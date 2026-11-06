# 进度

当前任务的状态，跨会话保留。由 `/verified-loop` 维护；新任务开始时，把上一任务移入“已完成任务”只留一行结论。

## 当前任务

### 去除多余次级标签与说明（2026-11-06）

- 目标：按 AGENTS.md“Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.”清理 Web/Desktop 界面中的重复入口、重复信息、说明句和无信息量标签。
- 依据：2026-11-06 在带数据的隔离 Host 上逐页评审得出的 24 条问题（会话、执行过程、历史弹窗、记忆、模型设置、技能、改进建议、自动复盘、新会话弹窗）；源码统计 23 处 `<small>`、19 处 muted/hint 说明、4 个 Modal description。用户确认“全部修”。
- 范围：仅 `apps/web/src` 展示层与 smoke 选择器；不改 Host API、载荷、业务语义；安全/副作用警告保留原意。
- 完成标准：评审清单每条已处理或在实际结果中说明原因；`npm run test:d6:ui`、`npm run verify` 通过；1440/850/390px 无横向溢出。

| # | 步骤 | 验证方式 | 状态 | 尝试 | 证据 |
|---|---|---|---|---|---|
| 1 | 外壳与新会话：去“⋯”单项菜单改为标题悬停；模块页去空页头带；新会话弹窗去副标题 | Shell/App 无“查看完整任务标题”、模块页无仅含返回箭头的独立页头带、深链仍可返回；typecheck + build | pass | 1 | verifier PASS：⋯菜单/标题弹窗/“回到对话”已删；模块页角落控件不遮挡（1440/390 实测）；无文件夹浏览 API 故未加选择器；typecheck/lint/format/build |
| 2 | 对话页：去回复上方“Agent”、步骤仅标失败、结果折叠合并、去重复 read 块与“查看执行过程”、空会话不显示改进/复盘入口；历史弹窗去冗余标签 | `features/chat` 对应元素消失且失败状态仍可见；相关测试 + typecheck + build | pass | 2 | 第 2 轮 PASS：改进面板按 Host session.activity 显示（讨论会话/授权运行可见），历史保留空文本分支点；聚焦测试 18/18、typecheck/lint/format/build。首轮 FAIL：“完成一轮”判断要求用户消息，讨论会话/授权开发运行中改进面板消失；历史弹窗隐藏空文本条目，但它们是合法分支点。已退回 |
| 3 | 执行过程页：去“回到对话”、零值事件组和格式化元数据标签（执行·已结束、Tool·…·调用完成、模型调用、message） | `features/diagnostics` 对应文本不再渲染；trajectory 测试 + typecheck + build | pass | 2 | 第 2 轮 PASS：模型名按分组内首轮显示，内容空行显示可见标签，切换按钮名唯一；trajectory 7/7、typecheck/lint/format/build。首轮 FAIL：模型名“仅变化时显示”按全部分组计算，未考虑窗口/搜索/折叠，可见分组首轮可能缺失不同的模型名。已退回 |
| 4 | 记忆：去重复新建按钮与说明句、元信息/修订重复、空来源节、多余退出入口；范围筛选合一；项目显示文件夹名；正文标签与读屏名一致 | `features/memory` 对应元素消失；typecheck + build | pass | 2 | 第 2 轮 PASS：确认按钮按 Host revise() 实际效果显示；范围选择覆盖所有路由状态；typecheck/lint/format/build、web-state 7/7。首轮 FAIL：用户编辑过的项目决定隐藏“确认仍然有效”，但 Host confirm 会重置 basis；合并范围选择无法表达 project+global 且标签失真。已退回 |
| 5 | 模型与连接：去卡片套卡片与重复连接状态、按提供方类型只显示适用的登录方式、脚注收敛 | `features/models` 对应元素消失；typecheck + build | pass | 1 | verifier PASS：API/载荷不变，按行退出登录（含未选中提供方，实测 POST logout groq）；退出提示保留脚注含义；三宽度无溢出 |
| 6 | 技能、改进建议、自动复盘：去指路空状态、空列表时隐藏搜索/筛选、项目显示文件夹名、提出建议表单精简、去冗余提示与“需要处理的检查”、隐藏内部错误原文 | 三个 feature 对应元素消失；typecheck + build | pass | 3 | 第 3 轮 PASS：等待状态统一“需要重新检查”且无不实说明，重新检查始终可达，技能刷新恢复（图标）；typecheck/lint/format/build。第 2 轮 FAIL：等待详情文案“点‘重新检查’后继续”在环境仍不可用时不成立且指向可见按钮；其余通过。verifier FAIL：waiting_user 文案称“可用后会继续”（实际需用户重新检查），行内“已暂停”丢失需处理信号；技能页移除刷新，但磁盘技能文件变化无 Host 事件。已退回 |
| 7 | 回归：smoke 选择器同步、`test:d6:ui`、三宽度溢出检查、`npm run verify` | 命令全部通过 | pass | 1 | verifier PASS：d6-client-smoke 仅改 3 处标签选择器（标题/正文，加 exact），无断言删除或放宽；`test:d6:ui` 全部 true（responsive 1440/850/390）；6 页三宽度无横向溢出（空数据态）；`npm run verify` exit 0，测试 218：217 pass/1 skip |

- 实际结果：7 步全部 pass，无 blocked。`npm run verify` exit 0（typecheck、lint 0 error、format、test 217 pass/1 skip、build），`npm run test:d6:ui` 通过。改动：外壳去⋯菜单与标题弹窗，模块页改角落返回/导航；对话页去“Agent”标签、步骤只标失败、结果合并、去“查看执行过程”；执行过程页只显示异常状态、模型名按分组显示；记忆单一范围选择、字段标签精简、确认按钮按 Host 语义显示；模型页扁平化、按行退出登录、按提供方显示登录方式；技能/改进建议/自动复盘去指路空状态、显示文件夹名、等待状态统一“需要重新检查”、错误原文收进详细信息。提升规则 2 条（visibility、copy）。之后已重新打包 Desktop，`npm run test:ui`（打包版 Desktop + Chrome + 真实模型 openai-codex）通过，全部检查项 true。未验证/已知缺口：skills-ui-smoke（早已落后于 UI）未跑；溢出脚本只测了空数据态；记忆依据只含其他项目来源时确认按钮是否可见未确认；“尚未检查”提示可能过时；390px 下完整标题在触屏上不可达（标题不是首条消息前缀时）；product.css 等残留死 CSS；Host 侧错误文案未改。未提交。

## 失败记录

同一签名出现第二次时，提升为 CLAUDE.md 的 Learned rules，并标记“已提升”。

| 签名 | 次数 | 首次步骤 | 状态 |
|---|---|---|---|
| copy: simplified status text asserts a cause not true for all states it covers | 3 | 5 | 已提升 |
| visibility: control hidden on assumed semantics without checking host behavior for all reachable states | 2 | R2-4 | 已提升 |
| derived-label: deduplicated label computed over data the user cannot see (filtered/collapsed/windowed) | 1 | R2-3 | 观察中 |
| refresh: manual reload removed where host emits no change event for that data | 1 | R2-6 | 观察中 |

## 已完成任务

- 2026-11-06 Desktop/Web 前端易懂性优化：首次使用引导、导航分组、全站去内部术语、返回入口去重；8 步全部 pass，`npm run verify` 与 `test:d6:ui` 通过（未提交）。

- 2026-11-05 仓库整理：D6 提交、prototypes 停止跟踪、DECISIONS.md 重建、历史脚本归档（`aecabfe`）。
