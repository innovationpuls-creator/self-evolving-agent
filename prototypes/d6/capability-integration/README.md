# D6-A · Skill / Tool 与 Evolution / Activity

本轮已把真实管理能力接入现有 D6-A。入口仍使用原来的 A Shell、悬浮会话输入、项目导航、Memory 与 Reflection。新增模块没有成为第二套产品。视觉与产品体验等待 ChatGPT 独立验收；没有创建批准基线。

## 运行与复查

- 当前真实模型 Host：<http://127.0.0.1:4189/>。使用现有 `npm --prefix prototypes/d6 run open:host` 私下传入该环境自己的认证令牌。Skill / Evolution 页面同样使用本轮实现；本轮没有在此环境执行测试性 Skill 写入。
- 本轮隔离正式 Host：<http://127.0.0.1:4193/>。`npm --prefix prototypes/d6/capability-integration run open` 会打开同一 D6-A 并私下传入独立令牌。这里可以实际管理测试 Skill、建议和 Activity。
- [录像、三尺寸页面、请求与断言索引](evidence/index.html)。[工程检查](evidence/engineering.json)，[范围隔离](evidence/isolation.json)。

```sh
# 在项目根目录；仅首次需要构建，当前环境已运行。
npm --prefix prototypes/d6 run build:host
npm --prefix prototypes/d6/capability-integration start
npm --prefix prototypes/d6/capability-integration run open

# 新资产类型与机制测试；使用临时隔离数据库。
npm --prefix prototypes/d6/capability-integration run typecheck
npm --prefix prototypes/d6/capability-integration test
node prototypes/d6/capability-integration/scripts/check.mjs
```

`start` 使用正式 `AgentService`、HTTP/WebSocket 传输和新建的加密数据目录；不复制生产凭据、用户数据或用户 Skill。再次启动会保留已有测试历史，不会重置数据库。4193 的模型是受控 Pi Faux Provider，**不是自主模型开发**。私有 control 文件仅向真实 Pi 执行循环排入 Tool Call，不提供模拟 HTTP 成功响应；重启忽略旧 control，必须显式提交新指令。业务写入均针对 `.runtime/` 中的新项目、新 Session、新 Skill 或临时数据库；旧测试命令的证据文件副作用另见文末范围偏差。不要将这个测试环境作为个人正式数据目录。

## 接口与状态对应

| 能力 | 真实接口及处理 |
| --- | --- |
| Skill / Tool 目录 | `GET /skills?project=…`、`GET /tools?project=…`；复用正式返回类型。目录、工具、启用、已加载、向模型声明、可调用分别展示。仅用 Host 返回的精确 Session ID 数组判定 Session 状态。加载仍由正式运行时机制处理，没有虚构前端加载接口。 |
| 文件与版本 | `/skills/:id`、`/files`；当前版本、候选、历史快照分开。快照读取包含真实 `packageRoot`。编辑为 `/edit` 的不可变新候选，`baseRevision` 冲突保留原始草稿，比较后显式继续。保留行号、Tab 缩进、快捷保存、阅读、Diff、多文件草稿和本地候选目录操作。 |
| Review | `/review` 精确绑定 version + digest，三个实际审查声明及备注。候选改变清除旧快照选择与弹窗；旧版审查仅属于旧版，不给新候选授信。 |
| Publish / Rollback / Enabled | 返回 202 Operation；持续读取 `/skills/operations/:id`，终态后重新读取 Skill。只有 `applied` 且权威 current/enabled 匹配才报告生效；失败保留旧正式版本。确认弹窗绑定打开时的修订。 |
| Skill Knowledge | `/knowledge`，只修订当前声明的独立 Markdown，保留历史正文与 Diff、来源。不会将此修订当作执行代码发布。 |
| 建议 | `/suggestions` 的真实 limit/offset/status/project/sessionId；忽略、归档使用各项实际 revision。用户创建只提交正式字段，不伪造 Agent、project 或 source。Agent 来源读取正式 checkpoint。 |
| 采纳与讨论 | `/suggestions/:id/adopt` 使用 `baseRevision`，打开 Host 创建的独立讨论 Session；不隐式授权。返回原建议恢复阅读位置，讨论保留在真实会话中。 |
| Activity | `/activities`、`/:id`、`/:id/authorize`、`/:id/cancel`。授权提交完整 `baseRevision, goal, existingSkills, newSkills`；已有 Skill 不预选，范围绑定实际 Activity 修订。正式 authorize 自身启动运行，不新增前端执行入口。 |
| Activity 结果 | 覆盖八种正式状态。`releases` 包含发布尝试，不能全部视为成功。逐项核对 Operation `applied`、operation.evolution.activityId、精确 version.evolution 的 activity/digest，再区分当前正式版本和历史已发布版本。`completed`、候选检查与发布不是同一件事。 |
| 传输与恢复 | 沿用正式 `useHost` 的 Bearer、同源访问、WebSocket 事件同步、重连和项目边界。401/403/409、断线与提交后丢失响应均不返回假成功、不自动重放写入。 |

项目筛选不被当作额外鉴权层。已认证的本地用户能读取什么由 Host 决定；Agent Tool 与 Activity 的项目/目标限制按正式调用身份验证，不把当前 UI 选中的项目推断成用户权限。

正式来源核对：`apps/host/skills/skill-routes.ts`、`skills.ts`、`tool-catalog.ts`；`apps/host/evolution/evolution-routes.ts`、`evolution.ts`、`activities.ts`、`development-tools.ts`；`apps/host/runtime/agent.ts`；正式 Web 的 `SkillsPanel`、`ToolCatalog`、Suggestions 实现。直接复用正式 Web `useHost` 和已有 D6-A 的 UI、Diff、来源阅读器与导航机制，没有复制后端业务逻辑。

## 实际验证及边界

[逐项机制结果](evidence/mechanism-results.json)与[脱敏请求](evidence/mechanism-requests.json)来自正式 Host、实际加密临时数据库、原生 Pi Tool 执行。覆盖精确审查、候选失效、并发、202→applied、失败旧版保留、合法回退、知识修订、工具 Session 边界、35 条建议真实分页、采纳、无授权/范围外拒绝、完成但零发布、部分成功、取消、关闭后重启中断、不重放、401/403。16 个 Node 测试通过（含外层用例与三个前端状态契约），正式既有 Activity/Evolution/Skill 29 个测试通过。重启测试是正常关闭再打开，不是断电或 SIGKILL。

浏览器在 1440、850、390 × 1000、相同语言/时区/字体/缩放下执行真实点击。新链路 36 项浏览器断言，以及一次实际隔离 Host 进程重启验证全部通过：编辑、精确 Diff、审查、发布、知识历史、建议跨页/采纳/讨论、授权与实际发布、部分失败、取消、401/403/409、响应丢失、草稿连续、长内容、全局导入及本地目录编辑。具体步骤和实际 ID 在各 `*-results.json` / `*-requests.json` 中。

回归包括：真实官方模型 `openai-codex/gpt-6-luna` 的流式输出与停止（三尺寸）、既有真实模型 Reflection 零新增结论及来源返回、受控正式 Host 的 Reflection 125 条目录跨页与 Memory 精确修订链、Memory 管理和网络/冲突恢复。原模拟 A/B 六张截图逐字节一致，既有工作空间另有 15 个交互断言。各套结果独立保存，不把受控 Tool 结果计作真实模型自主发现或开发。

前后页面保留，但前后间存在真实测试操作导致的数据/版本/状态变化；对照用于查看信息层级与交互能力，不是相同内容的视觉差分基线。早期失败保存在 `evidence/attempt1/`：850px 详情被原 CSS 隐藏的问题已用 A 专属作用域修复；其余包括测试驱动等待、已消耗的建议、旧文案选择器，以及将 import Operation 的 `skillId: catalog` 错当具体 Skill ID。最终断言没有以假响应或弱化权限要求通过。

## 本轮产品修正

- 真实管理沿用原 Skill 库与编辑器；长文件名可分辨，完整路径可查看，库自身滚动，编辑焦点沿用原 A 的收束模式。平板/手机明确切换列表与详情。
- Review 与确认始终指向精确内容；历史版本入口不会悄悄改读最新候选。原本空字符串文件也能进行冲突比较。
- 文件与 Knowledge 草稿分别保留文件、版本、基础修订；跨 Memory/会话导航后可继续。建议返回和讨论导航恢复原上下文。
- 授权先呈现目标与范围，已有 Skill 按需展开选择；没有几十项默认选择挤走重要风险确认。部分发布失败仍提供实际已保存版本入口。
- 技术标识和完整证据按需展开；重要执行权限、失败和不确定结果保留明确表达。

## 限制与未验证能力

- Reflection 旧回归曾有一次 `succeeded` 用例在首个成果写入前失败（stages 为空）；隔离副本保持相同断言复跑 7/7 通过。失败日志保存在 `attempt1/engineering-reflection-failure.json`，根因未定位，不将复跑当作对偶发失败的修复。

- **未验证真实模型自主开发完整链。** 本轮非空 Skill 成果由受控 Provider 驱动正式 Pi Tool 和检查机制；真实模型证据仅覆盖会话流式输出/停止和既有 Reflection。没有降低权限、跳过 Review/授权校验、注入成功响应或编造自动成果。
- Host 的授权 Shell 使用当前本机用户权限，**不是操作系统沙箱**。候选目录 `write/edit` 和成果提交目标受正式授权检查；不能宣称全部 Shell 操作已被目标目录隔离。授权弹窗明确说明这一点。若产品需要更强隔离，需要另行授权后端设计。
- Skill 目录与 Activity 列表目前没有 Host 分页接口；没有前端伪分页。建议使用真实目录分页。Skill detail 只枚举最新候选文件；可按已知路径读取历史精确快照，但无法列出已经从最新版本移除的全部历史文件。未补造接口。
- 草稿是当前页面进程内保存，支持模块导航与错误恢复；不是浏览器崩溃后的持久草稿。页面关闭有未保存提示。
- 写入响应丢失后，不自动重试；读取权威状态并保留旧草稿供比较。Host 没有写入幂等请求键；没有回执时，前端不能可靠推断某个未知 Operation 就是刚才的请求。
- npm/git 远程获取、外部依赖下载与复杂原生构建未在浏览器端到端验证。本地目录导入、外部候选目录编辑、纯文本 Extension 与实际 Tool probe 已验证。
- 辅助技术只验证语义标签、键盘 Tabs 和焦点/导航断言，未做真实读屏器评估；三尺寸为 Chrome 浏览器窗口，不是实体设备。
- 部分 UI 状态（preparing/checking/interrupted）持续时间短或来自重启；正式机制覆盖并实现呈现，不宣称每种瞬时状态均完成独立浏览器录像。
- 构建保留既有主 chunk 超过 500kB 的提示；本轮未作性能优化或性能结论。

## 改动范围

新增 `src/real/Skills.tsx`、`skill-management.ts`、`Evolution.tsx`、两个专属 CSS 与本目录测试/证据；已有源码仅改 A 的 `real/App.tsx`、`Session.tsx`、`navigation.ts`。621 个起始文件逐一哈希核对，仅这三个允许文件变化，无起始文件丢失；此前六项来源未确认文件均相同。正式 Host、Web/Desktop、D6-B 和旧源码未改。没有提交、推送或批准视觉基线。

**范围偏差未恢复：** 直接运行既有 Reflection 回归命令时，它重写了上一阶段 `evidence/crash.json`、`persistence.json`、`worker-scope.json`，并创建了新的临时回归目录。起始哈希清单不包含这些忽略文件，不能用源码哈希通过掩盖这个问题。没有原始字节备份，因此没有臆造恢复。已停止直接调用该命令，将原测试及其辅助脚本复制到本轮目录，保持断言并仅改变输出归属。详见 [范围偏差](evidence/scope-deviation.json)。
