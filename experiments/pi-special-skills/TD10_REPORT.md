# TD-10：Skill 安全发布与版本切换验证

## 结论

Pi SDK `@earendil-works/pi-coding-agent@1.3.0` 提供了 Package 资源加载、独立 `AgentSession`、Extension Tool / Hook、Tool 调用、Package 重载及 Skill 元数据刷新接口。它没有提供跨 runtime 的原子发布、流量切换、调用排空、持久禁用策略或自动回滚。最小补充是宿主维护一个版本/禁用状态文件、独立暂存候选、通过检查后切换入口，并保留已知可用版本。

**TD-10 实验通过。**没有修改 Pi Core，也没有直接加载未经信任的生成代码。实验用的 V1/V2 和故障包是本地已审查的确定性测试夹具；它们仍在 Pi 进程权限内运行。没有实现或验证 OS 级沙箱。

## 环境与复现

- SDK：`@earendil-works/pi-coding-agent@1.3.0`、`@earendil-works/pi-ai@1.3.0`。
- macOS `darwin arm64`，Node `v26.10.0`。
- 最新运行：2026-10-17 11:55:14 UTC，`PASS`（18 项断言）；逐项结果见 [results/td10-last-run.json](./results/td10-last-run.json)。
- 复现命令：`node td10-run.mjs`。它调用 Pi Faux Provider 和原生 AgentLoop，不连接模型服务。
- 实验入口：[td10-run.mjs](./td10-run.mjs)；进程重启探针：[td10-restart-probe.mjs](./td10-restart-probe.mjs)。测试只改写临时目录中的 V1 Skill 文件，退出时删除临时目录。

## 实测结果

| 验收点 | 结果 | 证据与边界 |
|---|---|---|
| 新版独立暂存、加载并执行检查 | 通过 | V2 在独立 `DefaultResourceLoader` / `AgentSession` 中加载；执行 Alpha Tool 并检查 `agent_start` 与 `tool_call` Hook，再允许切换。 |
| 新版初始化失败不影响旧版 | 通过 | V1 Tool 正在 await 时，独立加载故障夹具；候选初始化错误、Tool 未注册，宿主仍指向 V1，旧调用继续运行；磁盘状态中的 active / last-good 也保持 V1。夹具是已审查的本地代码，未使用生成代码。 |
| 旧 Tool 不被更新中断 | 通过 | V1 Tool 等待 gate 时完成 V2 暂存；宿主没有 reload V1 session，放行后旧调用以 V1 结果完成。 |
| 空闲后切换及后续调用路由 | 通过 | Host 设置切换屏障并排空当前调用。排队请求等待切换完成，随后返回 V2 结果；切换后磁盘状态持久化 V2 为 active / last-good。 |
| 失败回退恢复 Tool / Hooks | 通过 | 为验证恢复路径，故意把空闲的活动 V2 session reload 到故障包；Pi 此时不再注册 Alpha。宿主按 last-good V2 重载后，Alpha / Gateway 恢复，`agent_start` 和 `tool_call` 再次触发。此故障注入不是推荐发布步骤。 |
| 禁用跨 reload、版本选择、Host 重启 | 通过 | 宿主原子写入 `disabledSkills`，禁用时不给 Pi 配置该 Skill 所属 Package。session reload、切到 V1/V2 后 Skill、Package Tool、Package Hook 均未加载；独立 Node 子进程读取同一状态后也未加载 Skill 或 Extension。 |
| 知识正文更新 | 通过 | 修改 `SKILL.md` 正文后，Pi 的 `/skill:td09-special` 命令展开读取磁盘最新正文，无需重载 Extension runtime。 |
| Skill 描述/frontmatter 更新 | 通过 | `ResourceLoader.extendResources({ skillPaths })` 刷新 Skill 元数据；`AgentSession.setActiveToolsByName()` 重建提示词。Extension factory 加载数没有增加，没有调用 session reload。 |

禁用策略按 **Package** 排除；本 fixture 每个 Package 只有一个特殊 Skill。若一个 Package 中有多个 Skill，需要明确选择整个 Package 禁用，或由宿主维护 Skill 级过滤映射并验证相关 Extension 是否也应停用。

## Pi 原生能力与宿主补充

### 直接复用的 Pi 接口

- `DefaultResourceLoader.extendResources()` 是公开的 `ResourceLoader` 接口，可重新读取指定 Skill 路径；本次验证它更新 frontmatter 元数据时没有重建 Extension runtime。
- `AgentSession.setActiveToolsByName()` 会重建 system prompt；Skill 列表只有在 `read` 或 `bash` 可用时才进入提示词。本实验启用了原生 `read` Tool。
- `/skill:name` 展开时从 `Skill.filePath` 直接读取当前文件正文，所以正文编辑可在下次调用时生效。
- `AgentSession.isIdle` 可供宿主检查当前 session；session reload 会先使旧 Extension runner 失效，因此切换不应靠在活动 session 上直接热 reload。
- Pi 原生 Package 与 Extension 已提供资源和 Tool / Hook 执行。无需重写 Tool Calling。

### 必须由宿主补充的最小发布层

实验版 `ReleaseHost` 只包含以下状态和步骤：

1. 保存当前版本、last-good 版本、禁用 Skill 列表；用临时文件加 rename 更新状态。
2. 在独立 loader / session 暂存候选；要求 Extension 无加载错误，候选 Tool 可执行，必要 Hook 能触发。
3. 候选通过后阻止新请求进入旧 runtime，等待旧调用结束，再持久化版本并切换路由；随后回收旧 runtime。
4. 出错时使用 last-good Package 重建 Pi runtime，让 Tool 和 Hooks 重新注册。
5. 禁用时在 Pi 加载 Package 前排除它；Host reload / 新版本选择 / 新进程启动时重复应用同一策略。

这个状态文件和路由屏障是实验用宿主代码，不是 Pi 内置发布事务。状态更新测试覆盖同机新进程读取，但没有模拟断电、磁盘损坏或多 Host 写入竞争。

## 源码证据（安装包为 Pi 1.3.0）

- [Pi Skills v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md)：普通 `SKILL.md` 的目录格式及 `/reload` 使用说明；本地 `docs/skills.md:41-50,87-91`。
- `ResourceLoader.extendResources()` / `reload()` 公开签名：本地 `dist/core/resource-loader.d.ts:32-61`。指定路径重读 Skill 且不调用 Extension loader：`dist/core/resource-loader.js:323-339,624-644`。
- Skill frontmatter 在资源刷新时解析：`dist/core/skills.js:208-265`。Skill 正文由 `/skill:name` 展开时按当前 `filePath` 读取：`dist/core/agent-session.js:1698-1711`。
- `AgentSession.setActiveToolsByName()` 会重建提示词：`dist/core/agent-session.d.ts:417-431`，实现见 `dist/core/agent-session.js:1104-1117`。System prompt 仅在声明 `read` / `bash` 时包含 Skill 清单：`dist/core/system-prompt.js:101-109`。
- AgentSession 提供 idle 状态：`dist/core/agent-session.d.ts:405-408`。Session reload 先 shutdown / invalidate 旧 runner，再 reload resource loader 并构建新 runtime：`dist/core/agent-session.js:2969-2990`。
- [Pi Packages v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/packages.md) 与 [Pi Extensions v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/extensions.md)：Package 可包含 Skills / Extensions，Extension Tool 与事件处理使用 Pi 原生机制。
- [Pi Security v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/security.md)：Project trust 控制项目资源加载，但不构成 Extension 沙箱；同进程代码具有 Pi 进程 OS 权限。

## 未解决的限制

- **没有 OS 沙箱。**未经信任的 Hook / 生成代码仍不得载入 Pi Extension runtime；单独 worker 进程如果保留相同 OS 权限，也不构成隔离。本实验没有尝试执行这类代码。
- **跨版本会话连续性未验证。**测试通过新 `AgentSession` 暂存 V2，并在旧调用完成后切换路由；没有迁移 transcript、未完成队列或同一对话状态。生产宿主需要决定如何承接 session state。
- **宿主状态不是生产级数据库。**实验使用单写者本地 JSON + rename，并通过新 OS 进程验证读取；没有 fsync、损坏恢复、并发写入锁或远端一致性设计。
- **候选检查有限。**覆盖 Extension 初始化、目标 Tool 调用和两个 Hook；不代表真实模型下自然语言路由正确，也不覆盖所有 Hook 类型或外部副作用。
- **禁用粒度有限。**实验以 Package 为单位排除单 Skill；多 Skill Package 的细粒度禁用语义尚未设计或测试。

## 建议

继续采用 Pi Package + 原生 Extension。宿主只增加不可变版本引用、独立 stage/健康检查、idle drain 与请求路由、last-good 恢复，以及持久禁用清单。描述正文改动直接由 `/skill:name` 读取；frontmatter 变化用 `extendResources()` 更新并重建 prompt，避免不必要的 Extension runtime reload。只有在明确实现 OS 级隔离后，才考虑让 Bridge 转发不可信 Hook 执行。
