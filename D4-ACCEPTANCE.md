# D4 自主能力进化：首版业务交付

2026-10-21，本轮约定范围已实现；本机真实 Pi SDK / Provider / Web 完整闭环、签名 Electron 双端交互和自动化回归通过，等待用户验收。未提交 Git、未推送，未启动 D5。此前 D4 沙箱/VM 报告保持原样，不作为本轮准入或成功证据。

## 实现与职责

产品依据为 `docs/01-产品定义`，结合 RE-06、SA-06、TD-10、DP-04 和当前 DECISIONS。复用现有模块，无新的 Agent Loop、Coding Agent、Tool Registry 或版本系统。

| 职责 | 本轮实现 |
| --- | --- |
| Pi Agent SDK 1.3.0 | 只读讨论与授权后开发使用同一个原生 AgentSession。Agent 自主决定调查、开发、依赖管理、测试和是否产出代码；原生 write/edit/bash 执行，未规定分析步骤。 |
| Skill | 内置文本开发约定供按需读取；成果是原生 Skill/Package/Extension，可注册 deferred Tool 和 Hooks，复用普通 Skill 与 tool_search 发现。 |
| 产品层 | 目标/建议讨论入口、真实用户授权、候选准备、必要检查、取消/故障状态、持久化及 D2 发布协调。 |
| D2 发布 | 沿用 SkillVersion、完整快照/锁定依赖、加载、dispatch 屏障、原 Session reload、事务提交、失败恢复和回退。 |

授权由 Web/Desktop 的认证接口产生，冻结具体目标、允许改进的 Skill ID、允许创建的名称及已有版本修订。模型只有提交成果的 `evolution_complete`，没有授权或人工审查工具。并发重复授权、越范围成果、基础修订变化会被拒绝。D4 `evolution` 证明绑定授权活动、精确版本摘要及检查记录，重启/回退复核；不写入 D2 `review`。手工导入/编辑仍沿用 D2 人工审查。

讨论禁用写入、Shell、可执行 Extension 和 Memory 修改；授权后才激活原生开发工具。write/edit 检查候选路径及符号链接边界。Shell 的权限边界见下文，不将路径检查解释为系统隔离。

提交后检查成果归属、版本修订、完整依赖及摘要、Extension 加载/生命周期、Tool 名称冲突和每个实际 Tool 的代表调用。调用经过原生 `runToolCall` 与 Hooks，保存实际输出及通过/失败结果；检查不需要再次要求用户批准。候选失败不替换正式引用。允许 `packages: []` 的无代码结论。

活动保存讨论、目标、授权、结果、错误和版本入口。取消先撤销活动执行资格，再中止原生运行并等待发布收敛；中断活动启动时标为 interrupted，不重放。已提交版本保留，可显式回退。同一活动多个 Skill 逐个提交，不提供跨 Skill 的整体事务回退。首次发布失败而尚无正式版本的候选也可在新活动中被用户明确选中、授权修复；复制候选不加载或授予信任，修复后重新完成必要检查。

## 真实完整场景

[实际运行收据](docs/evidence/d4-business-2026-10-21/receipt.json)，模型 `openai-codex / gpt-6.1-sol`，真实 Pi SDK 1.3.0、React Web 和独立 Host。使用隔离临时产品数据，未修改用户正式能力库或原 Pi 凭据；结束后删除本轮临时数据。产出的[完整首版 Skill](docs/evidence/d4-business-2026-10-21/generated-v1/SKILL.md)、[Extension](docs/evidence/d4-business-2026-10-21/generated-v1/extension.ts)、实现及测试保留供检查。

| 场景 | 实际结果 |
| --- | --- |
| 用户目标 → 讨论 | 在 Web 输入文本差异能力目标并创建讨论；模型实际讨论输入/输出和边界，尚未授权。 |
| 讨论 → 授权 | Playwright 操作实际表单，用户动作提交具体目标和仅新建 `text-diff` 的范围；没有模型自授予权限。 |
| 自主开发 | Agent 使用原生 write/edit/bash，自主生成行级差异算法、Extension、Skill、测试；自主选择只复用 SDK/typebox，无新增运行时依赖。 |
| 实际验证 → 自动生效 | Agent 自主测试；Host 通过空文本、中文、重复行及替换的 4 次原生 Tool 调用。发布操作 `450f91c0-0516-4fc6-93ec-c17f42560bce` 为 applied，版本无人工 review。 |
| 普通会话发现/调用 | 新会话实际执行 `read → tool_search → text_diff`，返回中文文本新增/删除结果。调用记录及实际输出在收据 `normalUse`。 |
| 改进已有 Skill | 第二个授权活动自主改进已有 Skill 文档、测试原有接口并生成不同版本，自动生效。 |
| 用户回退 → 再调用 | 在既有版本历史点击恢复首版；正式版本从 `8c180384…` 恢复为 `a7b37075…`；新普通会话再次执行 `read → tool_search → text_diff` 成功。 |

主活动 `1caccaa7-6257-4a68-beac-62369387df44`；Skill `644821b9-a35d-44e9-ae9e-20be6d2c16eb`。收据的 `sourceSha256` 是写收据时的工作区文件摘要，不是进程启动时的代码证明；最终源文件摘要另见下述自动化收据。完整加密 Session 位于临时产品数据，不作为明文证据导出；收据只保留经过既有敏感保护的结果。

保留[真实失败记录](docs/evidence/d4-business-2026-10-21/attempt-gpt-6-luna.json)：另一次实际模型运行已经生成/发布/调用首版，但后续改进提交了错误的 probe 预期，Host 拒绝并将活动记为 failed。这是必要检查起效的负向结果，不计入成功闭环，也不通过针对样例修改 Prompt 或放宽检查使之通过。

## 自动化与双端

[最终自动化收据及受测源文件摘要](docs/evidence/d4-business-2026-10-21/checks-final/receipt.json)。

| 检查 | 结果与证据 |
| --- | --- |
| TypeScript | Host、Web、脚本/测试 typecheck 通过。 |
| 全量回归 | [161/161 通过，0 skipped](docs/evidence/d4-business-2026-10-21/checks-final/tests.txt)。使用本机已有 Apple Development 身份，包含原有真实 XPC 拒绝测试，D3 路径未改动。 |
| D4 业务/失败覆盖 | `tests/activities.test.ts` 使用真实 Pi Session/原生工具与 Faux Provider：授权/新建/改进/发现/调用/回退/重启、未授权和越范围写入/提交、无代码、无效 Extension、首次发布失败候选的重新授权修复、Provider 失败、运行中 Shell 取消、冻结授权、重启不重放、禁用状态、多 Skill 包的兄弟能力保持、内容篡改。Faux 测试不冒充真实模型业务证据。 |
| 生成 Skill 独立复验 | [9/9、0 skipped](docs/evidence/d4-business-2026-10-21/checks/generated-tests.txt)，包括真实 Pi loader、Tool 参数/输出校验及实际执行；与上面的 Host 业务验收分开。 |
| Biome | lint 退出 0，无 error；仍有 93 warnings / 37 infos。受影响源码格式检查通过；未广泛格式化无关文件。 |
| Build/打包 | TypeScript/Vite build 通过；保留现有超过 500kB chunk 提示。最终本机 Development 签名包 deep/strict verification 通过。 |
| Desktop + Web | [最终实际应用收据](docs/evidence/d4-desktop-2026-10-21T10-43-46-047Z/receipt.json)：同一打包 Host，Desktop 创建讨论，Web 展开范围并选中未生效候选，Desktop 取消，Web 实时同步并刷新恢复；包含顶层抛错的未授权 Extension 未加载；建议采纳连接同一讨论/活动入口。 |

实际截图：[Web 授权表单](docs/evidence/d4-business-2026-10-21/web-grant.png)、[版本恢复请求](docs/evidence/d4-business-2026-10-21/web-rollback-request.png)、[Desktop 取消结果](docs/evidence/d4-desktop-2026-10-21T10-43-46-047Z/desktop-cancel.png)、[同 Host Web 范围表单](docs/evidence/d4-desktop-2026-10-21T10-43-46-047Z/web-discussion-same-host.png)。版本截图拍摄在 UI 刷新前，最终正式版本以收据的 Host 状态及回退后实际调用为准；复验脚本已补上等待 UI 正式版本刷新的断言。

最终打包应用：`release/d4-development-2026-10-21/Agent-darwin-arm64/Agent.app`，独立输出目录，未替换已有发布包。最初 ad-hoc 包实际遇到钥匙串等待；随后沿用项目既有 Development 签名配置成功启动和复验，未绕过安全存储。

## 使用与复验

普通会话“能力目标与开发活动”或建议中心进入讨论，讨论结束后在“确认开发范围”选择已有 Skill 或填写新名称并授权。检查通过后自动生效；活动内查看结果与版本，在能力管理恢复旧版。失败活动可保留候选进行检查，再从普通会话创建新的明确授权活动，选中原有能力或“未生效候选”继续修复。

```sh
npm run build
npm run test:d4:real
# 使用本机有效签名构建；AGENT_CODESIGN_IDENTITY 沿用现有配置
npm run package:desktop
npm run test:d4:desktop
```

`AGENT_APP_PATH` 可指定 Desktop 可执行文件，`AGENT_SMOKE_MODEL` 可指定真实模型。真实模型检查消费额度，要求已有有效 Pi 授权。脚本使用独立临时产品数据并清理；每次新建带时间的证据目录，不覆盖本轮或历史收据。

## 安全限制与未验收项

本轮范围没有已知阻断项。Windows 实机、长期运行、Developer ID 正式分发/公证未验收；不以本机 Development 验证代替。

开发 Shell 具有本机用户权限；候选检查和正式 Extension 在 Host 权限下执行。write/edit 范围、目标授权、独立无凭据检查 Session、摘要、锁定依赖和 probe 都不构成 OS 安全沙箱，不能阻止恶意 Shell/Extension 直接触碰宿主资源、绕过产品协议或阻塞进程。取消/回退不逆转已经发生的文件、进程或外部副作用；超时依赖原生协作取消。必要检查也不证明任意生成代码在所有输入上正确或安全。

D3 原有受限 Reflection 保持原路径；没有恢复 D4 VM、Native Broker 或隔离 adapter。用户 `AGENTS.md` 未提交修改、原有未跟踪评估文档和历史证据均保留。
