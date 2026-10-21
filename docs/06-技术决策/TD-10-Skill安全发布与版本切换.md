# TD-10：Skill 安全发布与版本切换

2026-10-21 [D4 受限执行契约实验](../D4-VM-EXECUTION-REVIEW.md)在既有 SkillVersion 中增加可选 execution 字段，绑定版本摘要、权限 profile 与 Guest runtimeDigest；候选、加载、reload、rollback、重启均按契约分流。适配器仅由可信应用注入，普通客户端未启用；旧版本保留人工审查语义，不新增 Tool 版本库，不把实验安全复审写成 D2 review，D4 仍不准入。

## 最终方案

采用 **不可变版本 + 独立验证 + 空闲切换 + 失败回退**。Pi Package 负责分发与资源加载，原生 Extension 执行 Tool/Hooks，宿主只补必要的发布控制。

| 内容 | 正式产品选择 |
|---|---|
| 代码、脚本和资源 | 独立版本目录，不直接覆盖运行中的文件 |
| 正式版本、Last Good、启用状态、发布结果 | 产品 SQLite |
| 候选检查 | 独立 AgentSession，与正式运行隔离 |
| 切换 | 等待旧执行排空，使用请求屏障 |
| 失败 | 保留或恢复 Last Good |
| 描述性知识 | 独立修订留历史，尽量轻量刷新 |

原型用 JSON 文件及 rename 保存状态，只证明最小机制；正式产品沿用 TD-06 的 SQLite，不新增一套版本状态文件，也不把代码内容塞进数据库。

## 发布生命周期

候选版本先在独立位置准备，完成必要的依赖、权限、加载及 Tool/Hook 检查。验证失败时旧版继续可用；旧 Tool 尚在执行时保持其绑定版本，不强制 reload 或覆盖脚本。

候选通过后，由 Host 在安全切换窗口改变正式版本引用并加载。初始化失败恢复 Last Good，包括 Tool 与 Hook 行为，保留失败原因。禁用状态在 reload、版本切换与 Host 重启后继续有效，不能因装入新版本自动恢复禁用能力。

同一用户会话的最终方案由 TD-11 补齐：保留原 AgentSession，空闲 reload 后继续处理消息，不另建跨 Runtime 会话迁移系统。

## 知识修订与执行版本

描述性知识能在不重载 Extension Runtime 时刷新，但不能因此丢掉修订历史。Knowledge 的轻量修订与正式能力版本区分：修改知识不要求逐次发布 Skill Version，也不重验全部可执行代码。

历史能力定义、当时关联知识与后续修正应可区分。回退执行版本不改写 Log，也不自动撤销独立 Memory。

## 授权与安全

D4 的目标授权与隔离后自动发布规划不变；本轮 D2 只采用人工审查过的可信精确版本，不以目标授权代替代码信任。安装、保存、启用和批准开发均不授予 Extension 执行信任。审查覆盖代码、完整锁定依赖闭包、权限和资源归属，记录绑定不可变快照摘要及应用 SDK alias 身份。内容或依赖身份变化后必须重新审查，候选、正式加载与重启均复核。

本项验证可信代码的版本管理可靠性，不证明生成代码安全。未经相应 OS 隔离和权限检查，不可信代码不能进入高权限 Runtime；候选放入另一个同权限 Session 本身不构成沙箱。D2 人工审查也不是隔离：已批准代码仍与高权限 Host 同进程运行，管理接口不作为模型可调用的批准工具。

## 可行性依据与剩余项

[TD-10 报告](../../experiments/pi-special-skills/TD10_REPORT.md)及[保存结果](../../experiments/pi-special-skills/results/td10-last-run.json)记录 18 项原型断言，覆盖候选失败不影响旧版、运行中旧调用完成、V1/V2 切换、回退、持久禁用和知识刷新。

TD-10 当时未完成的会话连续性，已有 TD-11 补充证据，不继续作为未解决的架构阻塞。

仍需验收多 Skill Package 的管理粒度：禁用某个 Skill 不应无故影响同包其他 Skill；当前夹具主要为单特殊 Skill/Package。正式 SQLite 发布一致性及真实生成代码的安全发布也未由本项原型证明。

## 来源与关联

来源：TD-10 方案、实验及最终验收；TD-11 对原 Session 更新的补充；前五阶段对 Knowledge 独立修订和回退边界的澄清。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [DM-05：Evolution Suggestion、开发活动与 Skill Version](../04-领域建模/DM-05-EvolutionSuggestion开发活动与SkillVersion.md)
- [TD-06：数据持久化方案](./TD-06-数据持久化方案.md)
- [TD-11：Skill 更新与 AgentSession 连续性](./TD-11-Skill更新与AgentSession连续性.md)
