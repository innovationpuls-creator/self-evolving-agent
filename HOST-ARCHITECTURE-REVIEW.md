# D3 前 Host 架构治理报告

日期：2026-10-19。范围：Host 内部解耦与行为等价验证，不开发 D3 Reflection。

## 基线

D2 基线为 `4e7c2b5`。实施前重新检查，其他任务已将 Biome 与格式整理提交为 `08bad4b9344b794b134b584a1cd523ad9f5083bc`，master 工作区和暂存区均为空。本轮基于该提交实施，未覆盖、重置、stash 或代为提交其他任务改动。最终提交包含本报告，提交号见交付消息和 `git log -1`；不推送。

审查依据：SA-02、SA-08、DECISIONS.md、D1/DP-03 与 TD-04/05/06/10/11、当前代码及安装的 Pi SDK 1.3.0。以调用关系、状态所有权、职责边界和修改影响范围判断，不以行数验收。

## 实际问题与重构

| 问题证据 | 调整及收益 |
| --- | --- |
| AgentService 承担历史授权、分支筛选、Entry 投影和脱敏分页；原测试需要覆写 private loadSaved | 提取 DiagnosticHistory，仅注入已验证检查点读取、只读索引和 SensitiveData。HTTP/Pi Tools 共用 DiagnosticReader，保留 AgentService 委托方法。历史访问无需初始化活动 Agent，可独立测试 |
| AgentService 从 Skill views 目录名推断知识修订，跨模块依赖存储布局 | SkillService 返回结构化资源来源，Loader 在成功加载后提交来源快照，纯函数对照 Pi 实际加载结果生成诊断关联，移除目录名解码 |
| import/edit/review/verify 四处重复摘要描述 | 集中为 versionDigest，保留字段顺序、输入字节、依赖验证及 SDK 身份，保持原信任摘要有效 |
| Server 混合安全入口和各领域业务路由 | 提取 Session、Skill、Memory、Diagnostic 处理器及原 HTTP 编解码函数。Promise<boolean> 表示路由匹配；认证后才进入处理器，Server 继续统一安全边界 |

Loader.selected 收为 private，通过 setLoadout 显式切换候选。保留原候选验证、原 Session reload、SQL 提交与失败回退顺序。未新增框架、依赖、数据库迁移、DI 容器或事件总线；HTTP、Tool 和持久化契约保持。

## 保留的大文件与复杂度

- AgentService 保留活动 Session、加载去重、请求屏障、FIFO、退出状态和跨服务提交/回退。这些是 Host 应用协调职责。Memory 来源检查点与分支撤销顺序也留在这里。
- diagnostics.ts 保留 Recorder、索引与启动恢复。Recorder 已有独立状态边界；实时采集和恢复快照的信息完整度不同，不强行统一算法。
- skills.ts 保留 Package 获取、发现、依赖与信任验证、版本和知识管理；Loader 继续适配 Pi 原生加载。仅消除具体重复与来源耦合，不按体积拆分。
- Vault/CredentialStore 已封闭凭据读写，继续保留。单纯搬文件没有实质收益。
- Server 保留 Host/Origin 检查、HTTP/WebSocket 认证、请求限制、安全响应头、错误映射、静态资源和连接关闭，安全入口未下放给业务路由。

## 验证

| 检查 | 结果 |
| --- | --- |
| 增量相关测试 | Diagnostic 34/34；Skill/Diagnostic 29/29 |
| 全量自动化 | npm test：84/84，通过；基线为 81 项 |
| typecheck、build、lint、format、diff --check | 全部通过；lint 0 errors、44 warnings、17 infos，基线为 45 warnings、17 infos |
| 摘要对比 | 两个相同输入样本的新旧摘要完全一致，见下方 |
| 浏览器 | browser-smoke、skills-browser-smoke、memory-browser-smoke、skills-response-browser-smoke 全部通过：认证隔离、双端冲突、草稿保护、Memory 和异步响应顺序 |
| 桌面 | macOS arm64 / Electron 44.9.0 独立打包通过；独立 Host、随包运行时、关闭窗口保持 Host、Host 重连、空 Session 重开和包内容检查通过 |
| 真实 D2 连续场景 | openai-codex/gpt-6-luna，通过：跨 Session 知识检索与修订、Diagnostic 原始取证、分支撤销及确认、Host 崩溃无重放、完全重启续接、SQLite 数据所有权 |

摘要样本：`fc1e41909a3f1ff4e748d5d44e09cb03c07d8d385d095815ee089cdf7f6b9a65`、`3253ec4afbdf779a708bafae05be7aa0ea91ced8211e51f09350309b7957a920`。

新增测试覆盖独立历史读取、旧检查点、项目隔离、完整脱敏后分页与源对象不变；知识刷新实际进入 Pi、来源快照稳定及失败加载回退；未认证和非法 Origin 请求不进入业务处理器。既有测试继续覆盖原 Session、Compaction、模型/Thinking、FIFO、首次保存屏障、信任发布回退和 Memory 来源撤销。

真实验收收据：[host-decoupling-real-ui.json](docs/evidence/host-decoupling-real-ui.json)。原 D2 收据未修改。本轮截图保留于 `release/host-decoupling/integration/` 和 `release/host-decoupling/skills/`，已检查桌面取证界面。测试包使用隔离目录，验收后删除临时包，保留原验收包。验收脚本增加可选证据输出路径，默认行为保持。

一次早期聚焦运行中，既有 SQL commit/partial reload 测试在故障注入前取不到 live Session；单独复跑、随后 29 项及最终全量 84 项均通过。根因未确定，保留该稳定性观察，不将其归因于本轮重构。

## 独立审查

两个独立上下文分别审查运行时/历史/路由，以及 Skill/Loader/摘要，对照 08bad4b 和架构文档，均未发现 P1/P2 问题。独立审查为静态代码与调用链复核，运行证据来自上述实际执行。

| 维度 | 重构后评价 |
| --- | --- |
| 职责与依赖方向 | 历史读取从 Agent 生命周期解耦；来源采用结构化契约；业务路由与安全入口分离 |
| 状态所有权与安全 | Session/提交顺序仍归 AgentService，成功加载快照归 Loader；项目隔离、保护后分页与统一认证保留 |
| 重复与维护成本 | 四处摘要描述合一，移除目录名推断和 private 测试替换；新增模块承担具体逻辑或领域处理 |
| 行为等价 | 错误码、返回结构、缺失证据语义、信任摘要、失败回退及 HTTP/WebSocket 边界保持；自动化与真实场景通过 |
| D3 扩展便利性 | 后续后台分析可复用独立历史读接口与资源来源，无需激活历史 Agent；未预建 Reflection 或后台运行抽象 |

## 剩余债务

Diagnostic 共享 Trace 缺口标记、恢复算法与 SQLite 索引/队列的耦合仍保留，应结合真实后续变更评估。既有 lint warnings/infos 未作无关清理，上述一次未复现测试波动继续观察。本轮桌面实测仅覆盖 macOS arm64。

本轮只完成工程治理，D3 Reflection 在独立开发任务中另行实施。
