# D3 自主反思系统交付与验收

## 结论

D3 产品实现已接入模块化 Host 和 Web/Desktop；**2026-10-20 本机 macOS 完整补验收通过，解除 D3 blocked**。D4 所需生成代码执行隔离尚未验证，仍不满足 D4 功能准入。

免费 Apple Development 身份在独立产品包中通过同团队 XPC 认证及真实 OS Sandbox 拒绝测试，实际 TeamIdentifier 为 `7UK53LNNF8`。未替换的正式受限 Worker 使用真实 Provider 完成历史取证、Memory 修正、反思记录与建议生成；双端详情/采纳、后台并发及成果提交后 Host SIGKILL 恢复均有实际收据。详见 [免费开发签名补验收](docs/D3-DEVELOPMENT-SIGNING-ACCEPTANCE.md)及[独立安全审查](docs/D3-DEVELOPMENT-SECURITY-REVIEW.md)。本机 development 验收不等同于 Developer ID 分发或任意生成代码的隔离验收。下文原验收数据保留为历史记录。

| 补验收项 | 最终证据 |
| --- | --- |
| 签名及实际 OS 拒绝 | [sandbox 收据](docs/evidence/d3-development-sandbox.json)，12 层签名；真实 XPC Worker/子孙进程的文件、网络拒绝及负向身份测试。 |
| 正式 Provider 完整业务 | [产品收据](docs/evidence/d3-signed-integration.json)，同一正式 Worker SHA256；实际历史/Diagnostic/Memory ToolCall、知识修正及建议。 |
| 并发与强杀恢复 | [共同时间点](docs/evidence/d3-concurrency-observation.json)，前台实际响应 3.545 秒；同一产品收据核对实际 Memory、建议、run 效果快照，35 秒后仍 interrupted 且不变。 |
| Desktop/Web | [客户端收据](docs/evidence/d3-signed-client.json)，历史修订跳转、建议详情及采纳讨论；未自动发出模型请求。 |
| 回归 | [自动化收据](docs/evidence/d3-development-automation.json)，157/157、0 skipped，typecheck/build/lint/format 及签名产品 Desktop 回归通过。 |

## 原始验收记录（历史）

基线：`cf51143a3ce89e1a3d2ba1a94bc98f4083831895`。历史实验保持原样。D4 自主代码开发、生成代码验证和自动发布未实现。

## 实现范围

- 普通 Pi `agent_settled` 在原生树写入最小 custom marker，随既有加密检查点提交。SQLite 按 Session/marker 去重，启动扫描补齐登记窗口，不追溯 D3 以前的任务。后台登记失败不污染普通历史保存链。
- 默认最后来源后 30 秒执行；同 Session 且祖先链连续才合并并重新计时。不同分支独立，running 来源冻结；后续任务形成 follow-up。显式离开或停止会话可提前安排。只读访问、断线和关闭窗口不会提前触发。
- SQLite 是任务状态权威；六种状态、run 身份和来源持久保存。重启将遗留 running 标为 interrupted，不重放可能已提交的成果。普通任务、排队消息和发布屏障优先；Provider dispatch 后开始超时计时。关闭等待沙箱检查与运行收敛后才关闭数据库。
- 独立 Pi AgentSession 和 Native Provider；关闭自动 Extensions、Skills、context files 及通用执行工具。固定 XPC Service 启动独立官方 Node/Pi Worker，通过受控 IPC 请求模型与数据，Host 保有真实凭据及正式状态。
- Host 绑定 job/run/project/model，核对模型实际返回的 ToolCall、参数和已加密检查点；限制历史原文到同项目，复用 Global/Project Memory、Diagnostic 和 Skill 服务。描述性知识与成果收据同事务提交，按 run/ToolCall 去重。项目决定保留实际来源与分支适用依据。
- Reflection 保存审查记录、证据及不确定性。允许无新成果；不规定分析顺序或产出数量。自身不会触发下一轮 Reflection。
- 建议接口同时供普通 Agent 与 Reflection 使用；支持查看、批量忽略/归档及 revision 冲突检测。采纳预留稳定讨论 Session，保存可见原生背景，不自动发出 prompt 或授权开发。
- 双端独立建议中心、反思历史、当前会话记录、知识修订入口及轻量状态；WS 只通知失效，首次打开及重连读取 HTTP 权威状态。仅作者明确标记且说明原因的待处理高价值建议产生入口提示。

## 七阶段执行状态

| 阶段 | 结果 |
| --- | --- |
| 1 设计审查 | 对齐 RE-05、TD-08/12/13、SA-06、DP-04 及既有 UX/安全约束；复用既有实验机制。 |
| 2 工程检查 | 核对干净基线、模块结构、Pi 1.3.0 API 与既有 D1/D2 服务。 |
| 3 工程约束 | 保留单一 Pi loop/Tool Calling、加密历史、模块化 Host；禁止高权限 fallback。 |
| 4 实现 | 调度、独立 Worker、受控接口、知识成果、建议中心及双端入口完成接入。 |
| 5 自动化与独立审查 | 125 通过、1 签名测试 skip；三个上下文审查问题修复后复审。typecheck/build 通过；Biome lint 53 warnings、21 infos，退出 0；格式检查通过。 |
| 6 真实系统集成 | macOS 包普通真实模型、双端建议管理、重连及 D1/D2 Desktop 回归通过；完整受限 Reflection 业务验收 blocked。 |
| 7 版本交付 | 本轮源码、测试、收据及文档本地提交，不推送；整体阶段状态保留 blocked。 |

## 工程证据

自动化命令、计数与摘要见 [d3-automation.json](docs/evidence/d3-automation.json)。真实打包运行收据见 [d3-packaged-integration.json](docs/evidence/d3-packaged-integration.json)。构建产物为 `release/Agent-darwin-arm64/Agent.app`，包内 `ReflectionBridge.app/Contents/Resources/reflection-runtime.json` 记录 Node 官方下载地址、校验值和运行时版本。

| 领域 | 证据及边界 |
| --- | --- |
| 调度与恢复 | 确定性时钟覆盖 30 秒边界、重新计时、重复来源、多 Session/分支、running follow-up、提前安排、前台让位、SQLite 关闭重开及 running→interrupted/迟到结果拒绝。 |
| 独立 Pi 业务 | 测试专用子进程执行真实 Pi Worker，以 Faux Provider 完成历史查询、Memory 写入、反思保存及建议创建；无新发现合法成功，不递归。此执行器只在测试注入，不能作为 OS 沙箱证据。 |
| 一致性与失败 | 覆盖成果/建议事务回滚、双端 CAS、采纳中断后稳定 ID、首条反思保存失败、后台注册 SQL 失败后普通聊天继续、模型超时取消、关闭等待检查、伪造 ToolCall/诊断/跨域证据拒绝。 |
| IPC | 真实字节协议覆盖无效 JSON/类型、不可序列化响应、同步异常、在途操作收敛、即时撤销、terminal 后请求拒绝。协议 fixture 绕过包检查仅用于协议测试，不证明沙箱隔离。 |
| D1/D2 回归 | 原有加密 Session、认证、Native Tool Calling、分支、Memory、Skill、Diagnostic、故障恢复等自动化继续执行。另修正基线电话脱敏误伤有效 UUID 的问题；已登记凭据仍优先保护。 |
| 原生打包 | 编译固定 ObjC Bridge/XPC、独立 Node、嵌套签名及 entitlements；缺失组件/ad-hoc 身份 fail closed。实际 Apple 身份下启动、内核沙箱允许/拒绝测试未通过验收。 |
| 真实业务 | 真实 Provider 普通任务、稳定来源与不可用状态和双端管理以运行收据的 checks 为准；完整 Reflection 业务链仍 blocked。 |

数据库恢复状态测试不能替代实际 Reflection 写知识后 SIGKILL 的产品验收；该场景、真实 Worker 与普通任务并行、沙箱中嵌套 Tool/子进程/网络/凭据越权拒绝仍需 Apple 签名环境补验收。D1/D2 既有 SIGKILL 回归仅证明其原有边界。

## 独立审查

三个独立上下文只读审查调度/数据一致性、原生隔离/IPC、建议/React 状态。

已修复并复审：初始保存失败导致 running 滞留、事务内活对象提前变更、关闭与 availability 竞争、背景登记失败污染普通聊天、讨论创建遗漏发布屏障、知识收据缺少修订、IPC 延迟撤销和 finished 后继续接收，以及切换请求失败后的面板/Session 状态。调度复审 focused 21/21、IPC 复审 9/9 通过。审查未将缺少签名和真实隔离的边界认定为已验证。

## 复验入口与未验收边界

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run package:desktop
npm run test:desktop
npx tsx scripts/d3-integration-smoke.ts
```

Apple 身份环境使用 `AGENT_CODESIGN_IDENTITY` 构建；独立 Web Host 使用 `AGENT_REFLECTION_APP_BUNDLE` 指向同版本有效应用包。原生测试会在可用身份下执行包内权限探测，缺少身份则明确 skip。现有打包集成脚本专门检查本机 ad-hoc 的不可用与恢复路径；补做可用沙箱的真实业务验收需追加收据，不能仅重用不可用路径成功代替。

Developer ID 正式分发、公证、Windows 实机隔离、长期/规模稳定性均未验收。未安装或伪造签名身份，没有修改用户 Keychain 授权。未推送代码。
