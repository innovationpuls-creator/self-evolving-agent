# D2 Skill 管理纵向功能验收

## 交付结论

完成 D2 首个 Skill 管理纵向功能：正式 Web/Desktop 共用管理入口，普通 Skill 原生发现和按需读取，特殊 Skill 原生 Package/Extension 与 `tool_search`，编辑、启停、版本、审查、发布、回退及失败恢复。本报告不将该增量等同于完整 D2：Memory、Diagnostic Log、Reflection、Evolution 与 OS 隔离未实施。

## 可追溯版本

- D1 源码基线：`0047231c50fe4ba4566ccd26654e2081d19215f3`。
- D1 验收归档：`9f4a3d1d31620e2e9079c8adb20cabebaa34b063`（`docs: archive completed D1 macOS acceptance`）。D1 真实模型成功结果来自用户提供，本轮未重跑旧 D1 验收。
- D2 实现：`7b02b213efe4e45212e1462dd87adf8191fdd255`。
- 本报告随后独立提交。不推送，不改历史实验。工作区并行出现的 Biome 配置、AGENTS.md、package-lock.json 和对应 package.json 配置变更予以保留，不混入本轮提交。

## 七阶段执行记录

| 阶段 | 本轮结果 |
|---|---|
| 设计审查与技术验证 | 核对 DP-04、RE-03、TD-09～TD-11、Skill 管理设计及只读历史实验；以安装的 Pi SDK 1.3.0 源码核对原生资源、Extension、Session reload、Tool exposure。补齐精确版本人工审查边界。 |
| 工程初始化 | 复用已有独立 Host、SQLite、认证、加密凭据与 Session、共享 React 客户端，无重复初始化。 |
| 工程约束 | 普通文本发现与执行信任分离；正式 Session 明确不信任项目，关闭未知 Extension 自动加载；禁止未经审查代码入 Runtime，不新增 Bridge。 |
| 纵向功能开发 | 依次实现普通 Skill、可信特殊 Skill、版本与会话连续性，纳入同一管理入口及现有认证 API/WebSocket。 |
| 自动化验证与独立审查 | 34 项测试通过；独立 Host/权限审查和需求/客户端审查提出的问题修复后定向回归，再完整回归。详见下文。 |
| 系统集成验收 | macOS arm64 实际打包 Desktop 与 Chrome，真实模型 `openai-codex/gpt-6-luna`，普通文本读取及获准特殊 Tool 调用通过。 |
| 版本交付 | 更新 DECISIONS.md、README 与 TD-10，提交实现与验收记录，保存机器可读证据和本地应用。 |

## 实现与使用

入口为侧栏“能力管理”。支持导入本地目录、原生 npm/Git Package、接管已发现的普通 Skill；以来源和作用域区分同名资源，保留原生命名冲突诊断。默认显示用途、说明及启用状态，文件、Tool/Hook、依赖快照、审查及历史按需展开。

编辑携带读取时的基础修订号，双端冲突返回 409；直接编辑和对话辅助编辑作用于候选资源，支持草稿删除及过期草稿重建。重要操作持久保存，耗时导入与发布返回操作标识，经 WebSocket 通知，重连重新读取权威状态。描述性知识只允许明确声明的独立 Markdown 文件轻量修订并留史；`SKILL.md` 及未分离内容修改走正式版本。能力版本回退不覆盖独立知识历史。

每个 Skill 独立引用完整不可变快照，显式绑定其独占 Extension 路径；归属不明、重复归属、共享 Extension、越界链接拒绝加载。同包其他 Skill 的正式引用保持独立。关闭能力会移除 Skill 发现和 `/skill:name` 入口、所属 Tool 定义及 Hooks，不只修改 activeTools。

发布前在独立无用户凭据 Session 验证候选；正式切换使用协调屏障，等待已准入 dispatch/action 和原生 idle，保留原 AgentSession、历史、模型、thinking、有效 Tool 状态及订阅。所有受影响会话成功后事务提交正式引用；候选、初始化、部分 reload 或 SQLite 提交失败恢复旧版。恢复失败时拒绝执行，客户端提供重试恢复。屏障期间消息按 FIFO 在内存排队；Host 重启仅使用已提交版本，不重放未完成请求。

## 执行准入与实际人工审查

获取与执行分离：原生 PackageManager 在独立目录准备，固定可信 npm/Git 入口、强制 `--ignore-scripts`，不自动执行包入口、自检、构建或安装脚本。依赖必须完整包含并匹配锁定闭包；审查摘要包括快照内容、资源绑定和应用 SDK alias 身份。候选检查、正式加载及重启加载前重新校验，内容失配拒绝。安装、保存、启用或开发授权都不产生信任；管理 API 不是模型批准工具。

用户本轮明确提供实际独立审查结果，审查文件为：

- `tests/fixtures/reviewed-skill/package.json`
- `tests/fixtures/reviewed-skill/skills/receipt/SKILL.md`
- `tests/fixtures/reviewed-skill/extensions/receipt.js`

唯一获准摘要：`8dd88097d08051818bc644d9febcad2f730f698e86c2cd862825a370a4d35192`。

审查结论：仅注册 deferred Tool `d2_receipt`，返回 `D2_RECEIPT:${value}`；使用应用自带 Pi 1.3.0 / TypeBox 1.3.27，无其他依赖、网络、文件操作、子进程或 Hooks。授权限于此精确版本的本轮 macOS 验收。实测脚本将实际审查记录与摘要一同提交，并在加载前验证完整性；未批准候选先被拒绝。未扩大到其他 Package，内容或依赖身份变化不能继承批准。

**人工审查、Project Trust 和独立候选 Session 均不是代码沙箱。** 获准 Extension 仍在高权限 Host 同进程运行；本轮提供可信代码准入和原生注册资源撤销，不声称能隔离恶意获准代码。未经隔离的不可信 Agent 生成代码不加载。

## 自动化与运行证据

机器可读记录：[自动化结果](docs/evidence/d2-skills-automation-2026-10-18.json)、[macOS 真实模型结果](docs/evidence/d2-skills-macos-real-2026-10-18.json)。前者是本轮命令结果摘要，后者是实际运行脚本生成的 receipt；不是历史 D1 日志。

| 检查 | 结果与含义 |
|---|---|
| `npm run typecheck` | 退出码 0，覆盖 Host/Web/Desktop/脚本/测试。 |
| `npm test` | 最终 34/34 通过：19 项原有 Host 回归与 15 项 Skill 测试。 |
| `npm run package:desktop` | 最终退出码 0，包含 `npm run build`；生成 `release/Agent-darwin-arm64/Agent.app`。 |
| `npm run test:skills:browser` | Chrome 双客户端编辑冲突、读取后过期编辑缓冲、未保存离开确认、跨版本审查表单重置、异步导入事件、重连权威状态、普通发布/禁用均通过。使用 Faux Provider。 |
| `npm run test:skills:ui` | 使用用户批准摘要与实际审查记录；真实打包 macOS Desktop + Chrome / `openai-codex/gpt-6-luna` 通过，详见 receipt。 |
| 新增十个实现/测试脚本的 Biome lint | 退出码 0，0 errors，21 warnings / 9 infos；已按新增项目配置格式化。获准 executable fixture 保持原字节。 |
| 全仓 `npm run lint` / `npm run format:check` | 均退出码 1：16 errors / 45 warnings / 18 infos；14 个文件有格式差异。剩余 error 位于已有语句，包括既有按钮类型、赋值表达式、测试 callback 与隐式 any；未为新加入的全仓规则重写稳定源码。不能声称全仓 lint/format 通过。 |

15 项 Skill 自动化覆盖普通发现、原生使用、项目/祖先 `.agents` 和显式文本路径，直接与间接调用禁用（`tool_search`、嵌套 `ctx.executeTool()`、codemode、Hook）、同包独立性、重启和升级后禁用、篡改/越界链接/归属冲突/未知项目 Extension 拒绝、锁定依赖与相对链接、原生 npm 获取不执行安装脚本、草稿与知识修订，以及候选初始化失败、事务失败、部分 reload 失败、恢复失败后的阻断与显式恢复。

会话回归包含旧调用完成、首次加密保存前 dispatch 竞争、FIFO 与并发 thinking 操作、原生 Compaction、非末尾历史分支、模型/thinking/订阅保持，以及关闭等待恢复完成。故障注入和变更特殊可执行版本的测试使用受控 Faux Provider 及测试 fixture；不冒充所有情况都经过真实模型验证。

真实模型实测包括：普通 Skill 被发现后按需读取 `SKILL.md` 与随机内容文件；双端启停同步；未审查特殊候选拒绝；已审查 `d2_receipt` 由真实模型搜索并调用；普通 Skill V2 发布及回退；特殊 Tool 禁用后搜索不可用，重新启用后 Chrome 成功调用；原会话、模型/thinking 保持及客户端重连。未使用本次批准去加载另一个特殊代码版本。

本地截图位于 `release/d2-evidence/skills-browser.png` 和 `release/d2-evidence/skills-macos.png`；运行数据及凭据不入库。

## 独立代码审查

使用独立上下文 `pi_integration` 检查 Host/权限/会话一致性，`d2_constraints` 检查需求、管理 API 与客户端。修复的问题包括：包来源外的普通 Skill 混入、首次保存前 dispatch 竞争、恢复/关闭协调、原生相对链接复制、元信息过期、重复归属、候选 Session 意外使用全局凭据、审查勾选跨版本继承、编辑基础修订号过期、草稿删除与重建、未保存退出、原生祖先文本发现遗漏、npm 配置替换 Git 执行入口、完整锁定依赖快照不可查看、损坏正式版本无法禁用。

修复后审查结论：在“精确版本人工审查的可信代码”边界内通过，没有剩余阻断问题。最后补充的项目 Skill 配置路径读取亦独立确认：仅提取 `skills` 并清空 `packages`，正式 Runtime 继续禁用项目执行信任与未知扩展加载。随后仅进行了 Biome 格式化、按钮显式类型与等价缓存赋值整理，并重新执行完整自动化回归。

## 未验证边界

Windows 实机、签名与公证、OAuth 长期轮换、长期压力与完整安全矩阵未验证。远端 npm/Git 的所有 registry、代理、认证组合未穷举；本轮原生 npm 安装脚本阻断测试使用本地测试包。未实现 OS 隔离、不可信代码自动审查批准、完整 Memory/Diagnostic Log、D3 Reflection、D4 Evolution。内存 FIFO 不提供崩溃后的请求重放或 exactly-once 副作用承诺。

本地应用使用 `release/Agent-darwin-arm64/Agent.app`；复验新增真实模型流程使用 `npm run test:skills:ui`，必须携带经过实际审查的精确摘要和审查结论，不能以开发授权代替批准。
