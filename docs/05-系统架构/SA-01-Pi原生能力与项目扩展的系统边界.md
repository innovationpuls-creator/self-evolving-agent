# SA-01：Pi 原生能力与项目扩展的系统边界

## 设计目标

以 Pi Agent SDK 为运行核心，优先通过原生 Extensions、Skills 和 Packages 扩展，避免重写已有机制。原对话中的 API 与能力判断作为后续验证输入，不等同于已完成技术验证。

## 逻辑分层

| 层次 | 职责 | 复用原则 |
|---|---|---|
| Pi Runtime | Agent Loop、模型、Tool Calling、Session 与上下文管理 | 原生复用 |
| Pi Extensions | Tool 接入、生命周期事件及执行连接 | 原生接口优先 |
| 自进化能力 | Diagnostic Log、Memory、Reflection、Evolution | 仅补充项目差异 |
| 产品运行管理 | 多会话、后台活动、连接与管理操作 | 补充 SDK 未直接承担的产品职责 |
| Web / Desktop | 交互、状态反馈与管理入口 | 共用核心能力 |

这些是职责层次，不代表必须分别部署为服务。

## 复用与自定义

Agent Loop、Tool Calling、模型接入、Session/分支/Compaction、基础文件和命令工具、普通 Skill 发现与扩展安装优先复用 Pi。

项目新增范围收敛为：

1. 特殊 Skill 的能力声明、知识组织与原生执行连接。
2. 高价值诊断及原始历史定位，不重复保存完整历史。
3. 独立长期记忆，优先复用成熟扩展，补足作用域、修正和证据关联。
4. 以特殊 Skill 提供认识与反思指导，程序提供触发、权限等基础。
5. Skill 编辑、建议、独立开发活动、版本与客户端运行管理。

不另外建设 Tool Registry、Tool Calling 协议、反思工作流引擎或独立 Coding Agent。

## 交付与安全边界

原生 Pi 的独立交付目标修订为单独的 Diagnostic Extension：通过 Pi 官方 Tool/Session 扩展接口向 Agent 提供按需的高价值日志与证据查询，复用现有指标语义，不重建 Session 或整个自进化 Host。Memory、Reflection、Evolution 及完整产品交互继续留在现有产品；原生 Extension 不提供操作系统级隔离，敏感信息保护与范围约束仍须实际验证。

原对话指出 SDK 与 CLI 默认加载能力可能不同，Extension 不具备天然隔离，原生 Session 脱敏也未获得完整保证。这些均列入 SA-08。

不修改 Core 是优先方向；若与强制脱敏、真实隔离或可靠性冲突，以证据重新评估最小可行扩展，而非降低产品要求。

## 来源与关联

来源：SA-01；SA-08 对独立安装、Skill 职责及技术可行性的收口修订。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [06-首版范围与使用边界](../01-产品定义/06-首版范围与使用边界.md)
- [RE-07-Skill扩展与Pi原生兼容](../03-需求工程/RE-07-Skill扩展与Pi原生兼容.md)
- [SA-02-核心能力解耦与协作](../05-系统架构/SA-02-核心能力解耦与协作.md)
- [SA-08-系统架构审查与收口](../05-系统架构/SA-08-系统架构审查与收口.md)

