# DM-02：其他对象与 Skill 的关系

## 领域关系总览

| 对象 | 独立职责 | 与其他对象的主要关联 |
|---|---|---|
| Session | 管理会话、上下文与历史分支 | 一次会话关联多次 Trace |
| Trace | 标识完整任务执行经历 | 关联分支与诊断记录 |
| Diagnostic Log | 提供结构化运行信息和证据索引 | 定位 Pi 原始历史 |
| Reflection | 一次自主认识审查及其结果 | 可分析多个会话与 Trace |
| Memory | 保存长期知识、经验与怀疑 | 可关联多个 Skill 和证据 |
| Skill | 管理知识、指导、Tool、Hooks 与版本 | 可被不同会话反复使用 |
| Evolution Suggestion | 保存改进构想与相关依据 | 可涉及多个 Skill |
| Evolution Activity | 管理讨论、授权后的验证与开发 | 可关联建议、会话及多个 Skill |
| Skill Version | 表示可使用或恢复的能力版本 | 关联产生它的活动及实际使用记录 |

## 归属与关联的区别

Tool、Hooks 与相关指导属于 Skill 的能力内容。Log、Memory、Reflection 和 Evolution Suggestion 不作为 Skill 的附属对象，它们有独立用途与生命周期。

- 一条 Memory 可以支持多个 Skill，不必复制到每个 Skill。
- 一次 Reflection 可以跨多个会话取证，不归属于某个 Skill。
- 一条建议可以涉及多个 Skill，也可以最终不产生修改。
- 一次开发活动可以由用户主动发起，不要求先有建议。
- 运行状态、诊断与证据不因能力统一管理而全部塞入 Skill。

## 领域建模收口

整体关系可表达为：

```text
Pi Session / Branch
        └── Trace ──关联── Diagnostic Log ──定位── 原始证据

Reflection ──按需读取── Trace / Log / Memory / Skill / 过去反思
           ├── 形成或修正描述性知识
           └── 可能产生 Evolution Suggestion

建议 ──采纳与讨论── Evolution Activity ──可能产生── Skill Version
用户 ──主动发起─────┘
```

这是对象关联，不是固定推理流程。只为新增业务行为补充必要状态，Session、Agent Loop、Tool Calling 与上下文管理复用 Pi。

界面按用户任务组织入口，不为每个领域对象新增独立的大型页面；重要状态采用全局轻量反馈。当前模型不要求新增大型领域对象、数据库结构或另一套 Session 分支系统。

## 来源与关联

来源：DM-02；DM-05 后的领域模型汇总与第四阶段收口；SA-08 最终逻辑边界。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [DM-01-Skill与Tool的领域关系](../04-领域建模/DM-01-Skill与Tool的领域关系.md)
- [DM-03-Session-Trace-Log与Reflection的关系](../04-领域建模/DM-03-Session-Trace-Log与Reflection的关系.md)
- [DM-04-Memory-Knowledge与Reflection的关系](../04-领域建模/DM-04-Memory-Knowledge与Reflection的关系.md)
- [DM-05-EvolutionSuggestion开发活动与SkillVersion](../04-领域建模/DM-05-EvolutionSuggestion开发活动与SkillVersion.md)
- [01-日常使用与轻量状态反馈](../02-用户体验设计/01-日常使用与轻量状态反馈.md)

