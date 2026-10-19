# D2 Diagnostic Log 验收报告

日期：2026-10-19。基线：`cb01295f575e5afb3b79fcbea32f2cde93bcf0e2`。范围：D2-3 Diagnostic Log 及必要的轻量 Host System Log。提交身份以包含本报告的 Git commit 为准。

## 实现结果

复用 Pi 1.3.0、独立 Host、现有 SQLite、认证、敏感投影、加密 Session 与 React 双端。已接通原生事件 → 有界采集 → SQLite 指标 → 跨 Session 查询 → 原始 Entry 取证 → Agent Tool / Web / Desktop。没有新增 Agent Loop、Trace 执行引擎、日志服务器或依赖，也没有实现自动 Reflection。

- Trace 在 dispatch 准入后开始，覆盖整次 `session.prompt()`，包含原生 retry 与自动 compaction。首尾极简 custom Entry 不进入模型上下文；Turn 使用原生边界及观察序号，分支使用原生 parent/leaf。
- 索引保存状态、顺序、时间、Usage、调用关系、输出规模与来源引用；不保存第二份 Prompt、Thinking、Tool 参数、Tool 结果或流式 Token。完整证据仍只有加密 Pi Session。
- `ended` 表示运行结束，不宣称任务成功；同名调用次数不评价浪费。嵌套耗时不与父耗时相加。无法证明的耗时、直接父关系和 provider reporting 保持未知。
- 三种 Pi 原生 Tool 与 HTTP 共用服务。Agent 固定当前规范化项目，可跨本项目 Session 查询；用户沿用全局 Bearer 权限。Global Memory 来源不扩大原文权限。查询不会激活历史 Session 或加载 Extension。
- 证据来自身份匹配的有效加密快照，整体敏感投影完成后再分页；返回 checkpoint/previous_checkpoint、是否处于选定分支、可用性、截断及下一页。旧 Memory 来源不要求已有 Trace。
- Web/Desktop 共用“历史日志”和“运行诊断”，支持筛选、分页、按需展开和 Memory 来源跳转。WebSocket 只发失效通知；重连重读权威数据，过期响应被丢弃。

## 七阶段记录

| 阶段 | 实际执行 |
| --- | --- |
| 1 设计审查 | 核对 README、RE-04、DM-03、SA-05、EQ-04、历史日志 UX、DP-04、Memory 验收及决策；安装态 Pi 源码与纯内存真实事件验证覆盖优先于旧版 Skill 文档 |
| 2 工程检查 | 基线 typecheck、46项测试和差异检查通过；记录用户并行配置及存量 Biome 问题 |
| 3 工程约束 | 明确 Session/Diagnostic/System Log 所有权、Agent 项目作用域、保护失败拒绝、采集故障隔离及有界队列 |
| 4 纵向实现 | 完成索引/采集/恢复、Tool/API、共享 UI 与 Memory 证据入口；复用原生执行、分支和压缩 |
| 5 自动化与独立审查 | 21项诊断测试、13项审查/安全回归，加既有46项，共80项；独立上下文审查并修复权限、恢复、版本、锁等待及嵌套语义问题 |
| 6 系统集成 | 真实模型、重新打包 macOS arm64 Electron 与 Chrome；实际调用及文件断言；D1、Skill、Memory 浏览器回归 |
| 7 版本交付 | 本报告、机器收据、README 查询说明、决策和文档索引；仅提交本轮文件，保留并行改动 |

## 十二项验收

| 场景 | 实际证据 |
| --- | --- |
| 1 多 Turn / Tool | 真实模型主任务产生5 Turn、4次调用；原生 SDK 自动化另覆盖5 Turn/7次调用及两级嵌套 |
| 2 重复、错误、耗时、Usage | 真实任务重复 read、预期缺文件错误，errorCount=1，Usage 正数；目录估价与 provider reporting 的未知语义有独立测试 |
| 3 嵌套与覆盖边界 | 真实 Pi SDK + Faux Provider 观察两级 parentToolCallId；恢复只从父结果摘要取得身份，无法恢复直接父时明确 null；unfinished 摘要不得覆盖已观察终态 |
| 4 大结果不复制 | 真实 read 结果 outputBytes=51226，SQLite 不含随机原文标记或合成凭据；证据按段访问。自动化另覆盖更大输出及参数哨兵 |
| 5 Compaction 后取证 | 真实手动压缩后原成功 read Entry 内容一致；实际模型另一个 Session 用证据写出正确随机值。原生 threshold 自动压缩、失败后 retry/context_edit 均有实际 SDK 测试 |
| 6 跨 Session / 分支 | 原生三 Tool 同项目跨 Session 查询；历史分支筛选、原始证据保留、回档及重启不复活 Memory 决定均有 Host 测试 |
| 7 Skill / Memory 关联 | 采集加载版、知识 overlay 修订、实际读取与 Tool 归属；Memory 只抽取实际返回的 ID/revision/sources；真实关联补验见收据 |
| 8 双端查询 | 真实打包 Desktop 当前会话、Chrome 全局筛选、详情和证据分页；另有 Chrome 模拟响应测试覆盖旧响应与页切换 |
| 9 Agent 自主查证 | 真实模型分别调用 diagnostic_search/get/evidence，自己选择参数，并用 write 写出与原始证据完全一致的随机 UUID；断言基于 ToolResult 和文件，不基于模型自述 |
| 10 重启 / 故障 | 实际 SIGKILL Host 后重新获取权威状态、无模型重放；完整 App 重启保留。自动化覆盖运行中 SIGKILL、部分批次、队列溢出、写锁、坏检查点及上一份回退 |
| 11 敏感保护 | 索引、HTTP/原生 Tool、客户端、导出继续复用既有边界；保护失败不返回未经检查内容，跨项目猜测 get/evidence 被拒；额外修复已知凭据重叠时的流式前缀泄露 |
| 12 已有功能 | 既有46项自动化全部通过；D1 browser、Skill 双客户端、Memory 管理浏览器回归通过；特殊 Skill 精确人工审查机制保持原有实现 |

真实脚本：[diagnostic-ui-smoke.ts](scripts/diagnostic-ui-smoke.ts)。真实收据：[d2-diagnostic-real-ui.json](docs/evidence/d2-diagnostic-real-ui.json)。检查汇总：[d2-diagnostic-checks.json](docs/evidence/d2-diagnostic-checks.json)。截图位于 `release/d2-diagnostic-evidence/`，打包应用位于 `release/Agent-darwin-arm64/Agent.app`；可再生成产物不纳入 Git。

## 恢复、安全与资源审查

独立审查最初发现并复现：诊断 flush 继承5秒 busy_timeout 阻塞 Host；无 Tool Assistant Entry 查询遗漏；知识 overlay 修订未进入引用；证据故障屏蔽已有指标。均已修复并加回归。SQLite 诊断写入在同步区间不等待写锁，finally 恢复原连接配置；1000条锁冲突样本在毫秒级结束，不逐批等待。

部分索引恢复按原生 Entry/call ID 对齐：保留既有身份、parent、顺序、时间和终态，补齐确实保存的事实，不重复计数。原生 nested 摘要没有完整输出和直接父关系，不从 ID 格式推断。没有 start marker 的已索引运行标 interrupted、结束时间未知、证据不可确认；旧历史不伪造 Trace。分支回档保留历史事实，并继续依赖原 Memory 有效性规则。

新增队列最多1000条、单条元数据最多64KiB，单次 Memory 引用合计最多100个来源；超限或保护失败丢弃该条并记录可识别 gap。完成后释放采集缓存。查询上限100/200、证据上限32768字符；SQL 先限定项目作用域再分页。Host System Log 只允许固定 code/级别/短关联 ID、每条最多2KiB，最多5000条/30天，不递归记录原异常。诊断历史仍随业务数据保留，不新增自动清除规则。

真实关联验收另发现 macOS `/var` / `/private/var` 同文件别名导致 Skill 实际读取漏记；已将已加载资源与 read 请求按实际路径匹配，补入真实 Host、正式普通 Skill 发布、原生 read canonical/alias 双路径回归。最新打包应用真实模型补验确认 Skill 版本/摘要、Memory 保存和读取的来源引用，以及 Desktop Memory → 原始证据跳转全部通过。

完整回归曾暴露既有流式前缀测试间歇失败。抓取失败帧后，使用已知模拟凭据稳定复现：较短匹配先替换会破坏较长前缀检查。现以原文完整匹配和最长 partial suffix 的合并区间统一投影，覆盖注册顺序、完整/部分重叠和 message_start 累积内容；原始历史保持原样。该修复是敏感信息边界的必要收口。

## 运行检查与未验证边界

运行及查询说明见 [README](README.md#运行诊断与历史证据)。本轮执行 typecheck、全部测试、build、Desktop 打包、三类浏览器回归和真实双端验收。新增 TS/TSX 文件通过定向 Biome；全仓仍为既有16 lint errors、45 warnings、17 infos，以及14个格式错误文件，未为格式清理重写稳定旧文件。

真实主流程最初两次手动压缩因样本实际保留量不足返回原生“无需压缩”；调整实际 read 范围后通过，未改变产品压缩策略。嵌套、自动压缩、自动重试及故障注入用受控 Faux Provider 和真实 Pi SDK 验证；未声称这些故障在真实商业 Provider 上被强制造出。provider 原始 Usage 报告缺省/真实零及实际账单不能由 SDK 归一化数据区分；子调用完整结果未被原生保存时无法取回。真实主链路与最新包关联场景分别运行通过；高熵样本调整后的默认完整脚本未整轮重跑，未将分次证据写成单次运行。

本次平台为 macOS arm64；Windows 实机、签名/公证、长时间稳定性与大规模历史性能不在本次已验证范围。既有 Skill/macOS Memory 用户验收属于此前交付依据，本轮重新运行了自动化/浏览器回归，不冒称重新进行了特殊 Skill 精确版本的人工作业。

## D2 状态

Skill、Memory、Diagnostic Log 三项纵向功能均已交付，D3 可复用诊断查询/证据接口。当前没有已知阻断本轮功能的 P1/P2。进入 D2 整体集成验收时，应按 DP-04 做同一实际项目中的统一业务场景签收，尤其将特殊 Skill 已人工审查的精确版本、Memory 修正/撤销和 Diagnostic 历史证据串联留收据；本轮证据不替代该整体验收签收。存量 Biome 问题应单独处理，不是本轮新增；跨平台、发行与长期稳定性仍按 D5 边界推进。
