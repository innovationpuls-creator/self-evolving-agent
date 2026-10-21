# 当前开发决策索引

新增隔离 Skill 的受限契约已获用户批准：仅公开应用生成的 Skill/Tool/Hook 使用说明，源码与执行保留 Guest；旧版本不迁移。当前实测 Host 原生 read/bash 能读取并导入原始版本源码，同 UID 可读写 live VM backing，故仍不满足该契约；不得仅隐藏路径、修改 Prompt 或回退 Host import。详见执行环境复审的源码边界反例和最小 native broker 方案。

- 2026-10-21 D4 独立 VM 验证与存储回收修复见 [执行环境复审](docs/D4-VM-EXECUTION-REVIEW.md)。Containerization 0.52.1 签名 helper 与受限 Skill 契约仅供实验；控制面预算、完整恢复与六项矩阵仍缺证，**D4 不准入**，正常客户端不启用，不将测试通过转为高权限加载资格。

- D1 范围与增量：[DP-03](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。D1 已归档；D2 整体集成验收通过，详见 [D2-INTEGRATION-ACCEPTANCE.md](D2-INTEGRATION-ACCEPTANCE.md)；D3 免费 Apple Development 签名、实际 XPC 隔离及完整真实业务补验收通过，解除 blocked，详见 [D3-ACCEPTANCE.md](D3-ACCEPTANCE.md)。D4 已实施代码执行隔离准入原型，同容器活动隔离、后代清理、活动资源限制与高权限自动发布仍有阻断，**不准入**，详见 [D4-SANDBOX-ACCEPTANCE.md](D4-SANDBOX-ACCEPTANCE.md)；D4 产品流程与 D5 尚未实施。
- 运行边界：[TD-04](docs/06-技术决策/TD-04-Web-Desktop一体化运行与交付.md)。React Web / Electron Desktop 共用独立进程 Agent Host，Electron Main 不运行 Pi。
- 执行基线：Pi SDK 1.3.0；Agent Loop、Tool Calling、Session、Compaction 使用原生实现。
- 存储：[TD-05](docs/06-技术决策/TD-05-Session安全持久化与恢复.md)、[TD-06](docs/06-技术决策/TD-06-数据持久化方案.md)。Pi 内存 Session 与完整加密快照保存历史，SQLite 仅保存产品业务状态。
- Reflection 合并边界：[TD-08](docs/06-技术决策/TD-08-后台任务调度与故障恢复.md)。仅同一 Session、同一有效分支内合并；不同来源独立调度，运行中活动不被覆盖。项目级合并仅为历史实验策略，D1 不实现 Reflection。
- 来源待核实：EQ-04～EQ-07 完整原文、原会话部分上传附件原字节（如 TD-13）。现有文档及本地报告保留，不补造历史依据。
- D1 SQLite 使用 TD-06 已允许的 `node:sqlite` 备选路径，避免独立 Node 与 Electron 内置 Node 的原生扩展 ABI 分歧；Session 仍为 Pi 完整加密快照。
- 模型通道检查放在 ModelRuntime 实际发送边界；普通 Extension 的异常会被 Pi 捕获，不能作为必要检查失败时的唯一拒绝边界。

- D2 Skill 入口：[DP-04](docs/08-交付规划/DP-04-D2至D5交付依赖与整体验收规划.md)、[RE-03](docs/03-需求工程/RE-03-Skill能力体系.md)、[Skill 管理与编辑](docs/02-用户体验设计/04-Skill管理与编辑.md)。普通 Skill 使用原生文本发现、解析与按需读取；特殊 Skill 使用原生 Package/Extension 与 tool_search，不新增 Tool Calling 或 Bridge。
- D2 执行信任采用本轮明确确认的**精确内容人工审查准入**：安装、保存、启用、开发授权不授予信任。审查记录绑定完整不可变快照、锁定依赖闭包和应用 SDK alias 身份；候选检查、正式加载、重启加载均复核。未经审查的 AI Tool/Hooks/Extension 只保存候选。普通文本发现与项目 Extension 执行信任分开，运行 Session 的 projectTrusted 明确为 false，并关闭自动 Extension 加载。
- D2 每个 Skill 独立引用不可变 Package 快照，明确绑定独占 Extension 路径；归属不明、重复或共享时拒绝。原生资源过滤移除禁用 Skill 的定义及 Hooks，间接原生调用不能凭旧激活名单恢复定义。审查必须同时检查跨资源引用；同进程可信代码可使用 Host 权限，人工审查和 Project Trust 都不是沙箱。
- D2 获取过程与加载过程分开：原生 PackageManager 使用独立准备目录、固定本机 npm/Git、强制 --ignore-scripts 和可信 Git 执行入口，避免包内 npm 配置改写执行命令。不执行包入口、自检或构建。缺少依赖或锁文件的候选不得批准和加载。
- D2 发布沿用 [TD-10](docs/06-技术决策/TD-10-Skill安全发布与版本切换.md)、[TD-11](docs/06-技术决策/TD-11-Skill更新与AgentSession连续性.md)：先独立无用户凭据 Session 检查，再建立全局协调屏障，等待已准入 dispatch/action/native idle，在原 AgentSession reload；全部成功后 SQLite 事务提交正式引用，失败恢复旧配置，恢复失败拒绝执行并提供重试。发布意图及结果持久保存，FIFO 消息仅在内存中等待；Host 重启不重放未完成请求。
- D2 知识轻量修改只适用于明确声明的独立 Markdown 文件，修订独立留史；SKILL.md 和未分离内容走正式版本。D4 对不可信生成代码的隔离和自动发布目标不变，本轮不实现 OS 隔离。

- D2 Memory 入口：[TD-07](docs/06-技术决策/TD-07-Memory实现与检索方案.md)、[DM-04](docs/04-领域建模/DM-04-Memory-Knowledge与Reflection的关系.md)、[Memory 管理与作用域](docs/02-用户体验设计/08-Memory管理与作用域.md)，交付证据见 [D2-MEMORY-ACCEPTANCE.md](D2-MEMORY-ACCEPTANCE.md)。复用产品 SQLite、FTS5 trigram 与五个 Pi 原生 Tool；短查询参数化字面匹配。Memory 不加载为执行规则、不自动全文注入、不复制 Session 历史，也不等待 D3 才能由普通 Agent 维护。
- Memory 的事实/经验/决定/怀疑与当前/撤销/删除分开；同一记录追加不可变修订及前驱引用。Global 跨项目，Project 取规范化路径的 SHA-256 标识；当前头与每个历史版本分别做作用域过滤。用户删除为可追溯逻辑删除，普通检索退出、显式历史保留；作用域扩大不披露原项目历史或来源引用。
- 项目决定的来源证据与适用依据分离。Agent 写入先保存含对应 Entry 的加密检查点；普通修正继承旧依据并补入修正来源，明确重新确认建立新依据。来源会话切换分支时先阻止相关当前读取及修改，再在快照成功后以短同步事务追加撤销；历史和通用经验保留，切回旧分支不自动复活。启动从有效检查点协调，无法确认的来源不视为有效；不跨 Pi 导航/Hook 持有异步 Memory 锁。
- Memory 修订、当前引用和索引同事务提交，baseRevision 冲突返回 409，WebSocket 只广播失效通知。敏感正文、标题和依据在写库/建索引前与模型/客户端读取时复用现有保护；Session 与凭据继续加密。恢复旧 Session 或回到旧分支后，通过 Pi 原生活动工具 API 补入 Memory，保留其他活动工具集合。

- D2 Diagnostic Log 入口：[RE-04](docs/03-需求工程/RE-04-Agent运行诊断与历史信息访问.md)、[DM-03](docs/04-领域建模/DM-03-Session-Trace-Log与Reflection的关系.md)、[SA-05](docs/05-系统架构/SA-05-Log-Memory与Reflection的数据协作.md)，证据见 [D2-DIAGNOSTIC-ACCEPTANCE.md](D2-DIAGNOSTIC-ACCEPTANCE.md)。Trace 是一次已准入 `session.prompt()` 的范围，包含原生重试/自动压缩；极简原生 custom Entry 首尾标识不进入模型上下文，不重新实现 Turn 或 Agent Loop。
- Pi 完整加密 Session 是原始历史权威；产品 SQLite 仅保存结构化观测、指标及引用，Host System Log 仅保存固定 code/级别/关联 ID，保留5000条/30天。诊断队列1000、单记录64KiB；SQLite 锁冲突不等待、不终止正常执行，缺失可识别。模型停止和运行结束不推断任务成功，重复调用不评价浪费；Pi 归一化零值及目录估价明确标未知来源边界。
- 三种 Pi 原生诊断 Tool 与 HTTP 共用服务；Agent 固定当前规范化项目，不因 Global Memory 来源而扩大原文权限。证据直接解密校验快照并在整体敏感投影后分页，不创建历史 AgentSession，不加载 Extension。旧 Memory 来源无需 Trace；分支回档不删除执行事实或复活已撤销决定。
- 启动对齐完整原生树与轻量索引：保留已观察终态，补齐原生确实保存的事实；未保存耗时、嵌套完整结果及无法从摘要恢复的直接父关系保持未知。上一检查点、缺失锚点及残余 running 均显式标记，不重放。D3 后续复用查询与证据接口，本轮不实现 Reflection 工作流。
- D2 整体验收：依据 [DP-04](docs/08-交付规划/DP-04-D2至D5交付依赖与整体验收规划.md)、[RE-08](docs/03-需求工程/RE-08-需求边界审查与整体验收.md)，81/81 自动化及打包 macOS/Chrome/真实 Pi 连续业务场景通过。来源撤销、独立新依据、原生诊断取证、强杀不重放和冷重启续接均有实际收据；修复 Skill UI 过期响应覆盖，未扩大特殊版本的人工审查权限。

- D3 交付：[D3-ACCEPTANCE.md](D3-ACCEPTANCE.md)。原生 settled marker 与加密检查点保证来源恢复；SQLite 管调度，独立 Pi Session 经固定 macOS XPC/Node Worker 和 Native Provider 受控转发执行。知识成果与收据同事务提交，running 中断不自动重放。建议采纳仅创建讨论入口。
- D3 产品对端认证使用系统 same-team 指定 Bridge 身份约束；ad-hoc 无法满足，明确 unavailable，不降级。2026-10-20 免费 Apple Development 身份已实际满足认证；正式 Provider 完整链路、并发、成果提交后强杀恢复及双端验收通过。本机 development 验收不等于 Developer ID 分发/公证验收，也不代替 D4 生成代码隔离验证。
