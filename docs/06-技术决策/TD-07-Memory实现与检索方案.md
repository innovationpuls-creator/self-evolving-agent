# TD-07：Memory 实现与检索方案

## 最终方案

采用 **产品自有 SQLite Memory + FTS5 按需检索 + Pi 原生 Tool + 独立 Reflection**。借鉴成熟代码的局部设计，不直接安装两套扩展，不引入另一套自动学习和会话采集。

| 职责 | 选择 |
|---|---|
| 存储 | 产品 SQLite，复用产品数据访问、事务与迁移边界 |
| 检索 | FTS5 和作用域查询，Pi Tool 按需访问 |
| 修正 | 新认识替代旧结论，保留历史与依据 |
| 作用域 | Global / Project，用户可调整 |
| 来源 | Pi Session ID、Entry ID 与必要的适用背景 |
| 当前适用性 | 与历史来源分开维护，跨 Session 共享同一项目决定的当前适用状态与修订依据 |
| 积累 | Agent / Reflection 自主决定，不要求每次产出 |
| 注入 | 不启用每轮或会话开始时的全文自动注入 |

描述性知识可自主维护，不设普通知识保存审批。实际改变长期行为规则仍遵守授权边界，Knowledge 修订也不要求逐次发布 Skill Version。

## 开源复用取舍

原对话评估 `@samfp/pi-memory@1.6.1`、`@kvidzibo/pi-mem@0.17.0`，并核对 Pi SDK 1.3.0：

| 候选 | 可参考部分 | 不直接采用的原因 |
|---|---|---|
| pi-memory | SQLite/FTS5 与知识操作 | 自行采集整理；关闭 per-turn 后仍在 session-start 注入；修正历史与来源不足 |
| pi-mem | 来源、不可变修正与 supersede | 自有 schema、自动召回和候选流程不符产品边界；缺少 Pi entry/branch 适用性 |

接口检查还发现 pi-memory 在 custom-trigger 的 `before_agent_start` 中读取 `event.prompt` 的类型兼容问题。可以局部修复，但不是无需改造的直接复用。

两包均未通过临时分支回档用例，是不原样采用的关键依据。轻量产品访问层可参考 [pi-memory 固定提交](https://github.com/samfoy/pi-memory/tree/6eaf0cb68f055af4619c635d76effa108a35bb30)与 [pi-mem 固定提交](https://github.com/kvidzibo/pi-mem/tree/4efb36dabeebce814536c4e2018f9f61d59954a1)，不移植完整生命周期。

## 回档与知识适用性

Memory 不因会话回档自动删除。历史来源说明知识从何而来，当前适用性说明它是否仍可作为现行要求；不能只按时间、Session ID 或“存在于 Memory”判断有效。

**跨 Session 共享的项目知识必须维护可追溯的当前适用状态，并保留来源 Session、Entry 和修订依据。** 分支依赖的项目决定结合来源会话的分支背景、明确撤销或替代的依据及适用范围判断；读取方不能仅凭自己的 `getBranch()` 判断另一会话产生的决定仍有效。

例如 Session A 决定改用 PostgreSQL，随后回档撤销该决定；Session B 读取同一 Project Memory 时，不得继续将其作为当前要求。撤销或替代的依据仍保留，旧决定可作为历史证据检索；仍有效的通用经验单独判断，不能一律删除其他分支知识。该规则在既有 SQLite Memory 内落实，不另建知识图谱或 Pi 分支系统。

该过滤只控制再次提供的有效知识，不能抹去已发送给模型的上下文，也不重写 Pi 会话树。

## 可行性与限制

依据为原对话提交的源码评估、接口检查和临时 SQLite 分支用例。Pi 当前分支已排除旧 Entry，但两包仍召回旧 Project decision；pi-mem 的同 Session provisional candidate 也未随切分支失效。

评估和用例未留下本地实验文件，不能写成仓库已有完整 Memory 模块或回归测试。当时产品访问层尚未实现，成本仅作相对比较；语义检索、业务迁移及完整产品集成不由该用例证明。

## 来源与关联

来源：TD-07 方案、用户提交的源码评估及分支用例、最终验收；DM-04 对来源、知识修订与分支适用性的约束；EQ-07 及本轮对跨会话当前适用状态、来源和修订依据的澄清。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [DM-04：Memory、Knowledge 与 Reflection 的关系](../04-领域建模/DM-04-Memory-Knowledge与Reflection的关系.md)
- [TD-06：数据持久化方案](./TD-06-数据持久化方案.md)
- [TD-08：后台任务调度与故障恢复](./TD-08-后台任务调度与故障恢复.md)
- [EQ-03：数据可靠性与故障恢复验收](../07-工程质量设计/EQ-03-数据可靠性与故障恢复验收.md#memory-的来源与当前适用性)
