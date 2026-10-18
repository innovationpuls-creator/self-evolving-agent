# TD-09：特殊 Skill 接入与生命周期验证

## 结论

Pi SDK `@earendil-works/pi-coding-agent@1.3.0` 已提供普通 `SKILL.md`、Pi Package、Extension Tool、事件 Hook、deferred Tool 搜索和运行时 Tool visibility 所需的原生机制。对可信代码，最小方案是 **Pi Package + 原生 Extension**，无需另写 Tool Calling 或通用 Bridge。

原生机制不提供 Extension 沙箱、跨版本事务回退或活动中的安全热替换。若 Hook 代码不可信，不能把它作为 Extension 导入高权限 Pi 进程；需要一个可信 Extension 作为窄入口，并把不可信执行放进受操作系统约束的独立环境。单独拆出进程但沿用同一用户权限，不构成安全边界。

## 版本与实验边界

- Pi SDK：`@earendil-works/pi-coding-agent@1.3.0`、`@earendil-works/pi-ai@1.3.0`；依赖精确固定在 [package.json](./package.json) 和 [package-lock.json](./package-lock.json)。
- 环境：macOS `darwin arm64`，Node `v26.10.0`，npm `11.19.1`。
- 最新运行：2026-10-17 11:31:45 UTC，结果 `PASS`，明细见 [results/last-run.json](./results/last-run.json)。
- 用官方 Faux Provider 驱动 Pi AgentLoop，按脚本提交测试 Tool Calls；没有自制 Tool Calling，也没有访问模型服务或消耗模型额度。
- 实验代码：[run.mjs](./run.mjs)、[package-v1 fixture](./fixtures/package-v1/)、[package-v2 fixture](./fixtures/package-v2/) 和故意抛错的 [package-bad fixture](./fixtures/package-bad/)。这是 SDK 集成实验，不是生产 Bridge，也没有实现或测量 OS 沙箱。

## Pi 原生已满足

| 能力 | 结果 | 实测边界 |
|---|---|---|
| 普通 `SKILL.md` | 通过 | Package 声明 `pi.skills` 后，Pi 发现 Skill 并把名称和描述放入提示词；相对引用文件也随 Skill 包提供。Faux Provider 没有模拟模型自行读取正文的语义行为。 |
| 一个特殊 Skill 多个 Tool / Hooks | 通过 | Extension 注册两个 deferred Tool、一个 Gateway Tool、一个管理 Tool，以及 `agent_start`、`tool_call` 两个 Hook。 |
| 按需发现和调用 | 通过 | 使用 SDK 的 `createToolSearchExtension()` 搜索 deferred Tool，再由 Pi AgentLoop 调用；没有重写 Tool Calling。需由宿主启用 `tool_search`，它不是此实验默认 Tool 集的自动成员。 |
| Tool 停用与绕过 | 有条件通过 | 从 `activeTools` 移除只是不再向模型声明；Tool 仍可被 `tool_search` 重新激活，也可由已注册 Gateway 经 `ctx.executeTool()` 或 codemode 调用。将 Tool 重注册为 `exposure: "hidden"` 后，Pi 的发现、嵌套调用和 codemode 路径均无法再调用。 |
| Hook 停用 | 运行时通过 | `pi.on()` 返回的 unsubscribe 可停止之后的事件派发；当前已经开始的 dispatch 不受影响。 |
| Hook 重载 | 通过 | `session.reload()` 替换 Extension runtime，重新加载的 Extension 会重新注册 Hook。运行时的 unsubscribe 不跨 reload 持久化。 |
| 版本切换及旧版恢复 | 通过 | 更新宿主的 Package 选择后 reload，可从 V1 切到 V2，也可恢复 V1。Pi 不替宿主保存业务版本策略。 |
| 失败回退 | 需宿主介入 | 同一会话切到故意初始化失败的 Package 后，Pi 报 Extension load error，旧 Tool 不再注册，也没有自动回退；宿主重新选择 V1 并 reload 后恢复。 |
| 不可信项目包 | 启动加载被信任门控 | 拒绝项目信任时，Package Skill 和 Extension 都未加载，Extension 初始化计数为零。授信后，Extension 与 Pi 同进程运行，并能读取宿主权限可访问的 canary 文件。 |

### 禁用状态与间接调用

`setActiveTools()` 控制模型看到的 Tool 集，不代表授权撤销。`deferred` 与 `codemode` Tool 在不活动时仍可供 `ctx.executeTool()` 使用；`tool_search` 也可将 deferred Tool 再次激活。因此，只从模型 Tool 列表移除不满足禁用要求。

`exposure: "hidden"` 是 Pi 现有 Tool 注册机制中最合适的撤回动作：它使已注册 Tool 不可被 Pi 的 Tool Search、codemode 和嵌套 Tool 路径调用。实验覆盖了这些路径。它不是对任意 Extension 自有代码的沙箱，也不取消已经开始执行的 Tool。重新加载后，Extension 会重新注册 Tool；本 fixture 默认重新注册为 deferred，所以宿主若要求禁用状态跨 reload / 版本切换保持，必须持久化禁用策略并在每次 runtime 初始化时应用。

## 必须补充的最小能力

**所有 Hook / Tool 都来自可信包时：**由宿主保存持久化的 Tool、Hook 启停状态；每次加载时应用状态，Tool 禁用用 `hidden` 撤回；Package 版本先固定，失败时由宿主显式恢复已知可用版本。更新时不要 reload 正在执行旧 Extension Tool 的会话；至少等会话空闲，或把新版本放到独立 runtime 验证并让旧调用排空后再回收旧 runtime。实验的独立 runtime 证明旧调用可在旧 runtime 保持存在时完成，但没有验证跨 runtime 的同一会话连续性或宿主请求路由。

**需要运行不可信 Hook 时：**Pi 进程内只放一个可信、职责窄的 Bridge Extension，用 Pi 原生事件 API 接入 Hook、用原生 Tool 注册与调用；它仅向受限 worker 转发经筛选的序列化事件，并验证返回结构和允许的 Hook 结果。worker 需要 OS sandbox / 专用低权限身份、文件和网络限制及资源上限。UI、任意进程执行、Pi 内部对象等能力不能通过隐式共享交给 Hook；需要时逐项建成显式 RPC 权限。若没有 OS 边界，这个 Bridge 只能做模块隔离，不能解决高权限进程执行风险。

## 需要限制或不能保证的行为

- **不可信 Hook 直接加载：不可接受。**Project trust 是是否加载项目资源的门控，不是运行后沙箱；被授权的 Extension 具有 Pi 进程用户的 OS 权限。实验用宿主 PID 和非秘密 canary 验证了这一点。
- **即时撤销 Hook：不保证。**unsubscribe 对正在进行的事件派发无效。要求“取消此刻正在跑的 Hook”必须由隔离执行器提供协作取消、超时和进程终止语义；原生 Hook unsubscribe 不具备该语义。
- **调用中热更新：不保证成功。**实验在 Tool await 期间 reload 同一会话，旧 `ctx` 随 runtime 替换而失效，调用以 stale-context error 结束。版本更新要等待空闲或采用并行 staging / drain，不能原地覆写旧代码并声称运行中调用不受影响。
- **声明集移除等同禁用：不可用。**它只影响模型下一轮看到什么；已注册的 deferred/codemode Tool 仍有间接入口。
- **Project trust 等同安全审查：不成立。**信任决策只控制项目资源是否加载；一旦用户授信，Extension 仍在高权限 Pi 进程中运行。

## 方案比较与推荐

| 方案 | 复杂度 | 适用范围 | 主要代价 / 限制 |
|---|---|---|---|
| Pi Package + 原生 Extension | 低 | 包和 Hook 都经过审查并信任；需要标准 Skill、多个 Tool、事件 Hook 和按需 Tool 暴露 | 无进程内沙箱；Tool/Hook 启停持久化、版本事务和更新排空由宿主负责。 |
| Pi Package + 最小可信 Bridge | 中到高 | 必须执行不可信 Hook，且可提供真正 OS 隔离时 | 增加 worker 生命周期、IPC 协议、事件/结果 schema、超时取消、权限策略、版本排空和沙箱部署。Bridge 若直接在 Pi 进程 `import` 不可信模块，或 worker 仍有同等宿主权限，就没有建立边界。 |

**推荐：先用原生 Package + Extension。**只把来源不可信且必须执行的 Hook 移入隔离 worker；不要为了 Tool Calling 另造 Bridge。若无法提供 OS 沙箱，应限制为人工审查后加载的可信 Hook，或把特殊 Skill 保持为数据和说明文本。

## 源码依据（Pi 1.3.0）

安装包内源码与文档随精确锁定的依赖一起复核；相应上游版本文档：

- [Skills v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md)：`SKILL.md` 目录、渐进式加载、Agent Skills 路径；本地 `node_modules/@earendil-works/pi-coding-agent/docs/skills.md:11-45,57-65`。
- [Packages v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/packages.md)：Package 聚合 Extension 与 Skill，项目包在 Project trust 后加载；本地 `docs/packages.md:3-5,19-21`。
- [Extensions v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/extensions.md)：Extension 同 Pi OS 权限、`pi.on()` unsubscribe 和 dispatch 行为、Tool exposure / hidden / nested calls、session reload 生命周期；本地 `docs/extensions.md:3-5,44-50,96-100,149-165,212-220`。
- [Security v1.3.0](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/security.md)：Project trust 不是沙箱，Extension 和子进程沿用 Pi 进程权限；本地 `docs/security.md:1-7,25-55`。
- 工具可调用/活动集语义：本地 `dist/core/agent-session.js:1068-1164`。Tool Search 查找并激活 deferred/codemode：`dist/extensions/tool-search/tool.js:135-153`。
- Reload 替换 Extension runtime：本地 `dist/core/agent-session.js:2969-2990`；旧 runner 在重建前失效。实验观察到悬挂 Tool 随后访问旧 `ctx.cwd` 时失败。

## 复现

```bash
cd experiments/pi-special-skills
npm ci
npm run verify
```

`verify` 每次更新 `results/last-run.json`，所有 fixture 均为本实验自有代码。
