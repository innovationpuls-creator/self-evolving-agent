# Activity 权限边界与正式 Host 决策

当前 Activity 不具备产品要求的执行隔离。用户授权限制了哪些候选及版本可以通过业务流程提交、检查和发布，却没有将原生 Shell 或候选 Extension 限制到这些目录。取消也不是对已脱离子进程的权限回收。

## 实际执行路径

`Activity grant → AgentService 中的 Pi Session → developmentTools → Pi bash / write / edit → evolution_complete → 候选和授权检查 → applySkills 内加载 Extension 与实际 Tool probes → 版本切换 → 普通 Session 中调用已发布 Tool`。

| 边界 | 已有强制措施 | 仍可越过的范围 / 本轮证据 |
|---|---|---|
| 目标与授权 | `activities.ts:125–192` 校验 running、user grant、项目、baseRevision、精确目标；preparing 在 await 前预约，防重复授权 | goal 是业务约束，不能限制任意代码的 OS 能力。未授权讨论没有 bash；canary 和既有机制测试均验证 |
| 候选文件 | `development-tools.ts:20–60` 对 write/edit 做 contained、realpath 和运行状态检查；候选路径禁止符号链接 | 对这两个 Tool 的普通请求有效；不是同用户恶意进程的强制文件隔离。shell 可以直接调用 fs 越过这些 Tool |
| 发布 | `activities.ts`、SkillService、`agent.ts:640–700,1316–1450` 检查授权目标、版本/摘要、修订冲突、精确审查和实际 probes，既有切换屏障保留 | 这些检查保护发布身份和一致性，不证明代码运行安全，也不能撤销之前的外部副作用 |
| 文件系统 | bash 设置工作目录；没有 Activity OS sandbox executor | canary 证明可读取及覆盖授权候选外、当前用户可访问的合成文件；进程 uid 为 501（本机测试用户） |
| 环境与凭据 | `exposeSessionEnvironment:false` 去掉 Pi 会话元信息；产品凭据与完整 Session 加密保存 | Pi `getShellEnv()` 仍展开 `process.env`。合成环境值可被 shell 及孙进程读到。未读取任何真实私钥、凭据文件或 Keychain 内容；本轮不声称实际凭据已经泄露。静态加密不等于进程隔离 |
| 网络及依赖 | 真实 Pi bash 可启动子进程，安装依赖路径仍在同一用户权限下 | 实测可访问本轮 loopback HTTP 服务并执行 Node 子进程；没有出站网络 OS 策略。未做外网扫描或未知依赖安装；npm 生命周期脚本继承权限是执行路径分析结论 |
| 检查候选 | `applySkills` 用无模型凭据的 InMemoryCredentialStore 创建 validation runtime | `loader.reload()`、`createAgentSession()`、`bindExtensions()`、probes 在 Host 的 Node 进程内执行；空 credential store 不移除进程的文件、环境或网络权限。这是代码审查结论，未注入恶意 Extension |
| 发布后执行 | 原生 Pi Tool、Extension 生命周期与 Session 加载保持既有设计 | 发布后生成的 Extension 也在 Host 加载和调用；只隔离开发 shell 仍不闭合完整路径 |
| 取消/失败/超时 | 取消阻止后续开发与发布；活动执行中的 Shell 接受 AbortSignal；Pi 支持调用者指定 timeout，但没有默认 shell timeout；正式回归验证取消/Provider 失败不发布未完成版本 | 已返回 Shell 启动的 detached 子进程不再受该次调用跟踪。实测在 Activity cancelled 之后仍写入仅测试拥有的 marker；之后新 bash 调用确实被拒绝 |
| 重启 | 启动时将活跃 Activity 记为 interrupted，不自动重放开发或发布；已发布版本保留 | 这不是 OS 权限撤销。未验证 Host 崩溃后所有已脱离子进程都终止；不能以状态 interrupted 推断进程已死 |

## 受控实测

`tests/activity-boundary.test.ts` 调用正式 Host、真实 Pi Tool，仅用新建临时项目、合成环境值、合成候选外文件和 loopback 服务。测试本身未运行在 OS 沙箱中，这正是当前 Activity 真实执行路径；文件全部属于本轮临时目录。

- 授权前 bash 不可用；授权后 write 越目录被拒绝。
- 授权后 bash 成功读写候选外合成文件、读取合成环境、访问 loopback 并生成子进程。
- Shell 返回后取消 Activity；detached 子进程仍写入测试 marker；随后新的 bash 被拒绝。
- [首次独立实测](runs/2026-10-26T12-42-27.081Z-command-3a821571/evidence/prototypes/d6/acceptance/activity-boundary.json) 与 [最终跨模块实测](runs/2026-10-27T04-26-20.967Z-command-de062875/evidence/prototypes/d6/acceptance/activity-boundary.json) 均通过相同性质断言。通过表示准确揭示边界，不表示沙箱达标。

## Reflection 可复用的部分与限度

`native-executor.ts` 验签 Bundle、Bridge、XPC Service、Worker；验证 Team、版本/架构和 App Sandbox/inherit entitlement，拒绝网络 client/server entitlement。原生 Bridge 使用受控环境、CLOEXEC、按次临时工作区和模型/Tool IPC，Worker 不加载用户 Extension。源码位于 `apps/desktop/native/reflection/`，是复用协议、签名检查和模型留在 Host 的参考。

本轮完成签名原生 Worker 的真实运行（含真实 Provider），另保存只读签名与 entitlement 结果于 `runs/native-review-yGrSfo/native-bundle.json`。没有为当前 Worker 重做全套 OS 拒绝 canary，不能把签名或一次成功运行当成整个沙箱证明，更不能外推到 Activity。

既有 `docs/evidence/d4-sandbox.json` 明确 `admission:false`，记录共享容器 sibling workspace 可访问及 detached 后代存活。那是历史证据，本轮未改写、未恢复 D4。Apple 的 [App Sandbox 说明](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox) 与 [XPC 说明](https://developer.apple.com/documentation/xpc) 支持在独立进程施加不同权限；它们不自动提供每 Activity 的文件授权、子进程销毁和依赖执行安全。

## 建议实施方案，尚未授权

保留 Host、Pi SDK、Session、Memory、Reflection、SkillVersion 和既有发布屏障。新增的隔离只承担执行，不创建第二套产品 Agent loop。

1. **完整链路移出 Host。** `developmentTools` 保留 Pi Tool 契约，但将 shell、文件与依赖执行转交 `ActivityExecutor`；候选 Extension 的加载、生命周期、probes 也进入隔离环境。Host 只接收有界结构化结果和不可变候选快照，不 import 未信任代码。
2. **每 Activity 可销毁的执行环境。** 使用成熟、可验证的隔离运行时；若支持任意 shell/npm，就需要能终止整个环境及所有后代的强边界。推荐评估一次性 guest/VM 执行层：私有文件系统和临时 HOME，无 Host 私钥/凭据/env/继承 FD，无 Host 用户目录挂载；候选输入快照、输出导出及资源/时间上限明确。不会直接恢复 D4 自建 VM 或把当前 Reflection 固定 Worker 改成任意 shell 执行器。
3. **模型和网络。** 复用 Reflection 中模型留在 Host、IPC 按 grant 校验的思想。默认无 guest 外网；依赖获取通过明确网络策略/受控下载步骤，锁定依赖及生命周期脚本也在隔离侧执行。不将“允许安装依赖”等同于“允许访问所有网络”。
4. **候选、发布与继续调用。** 导出时重新验证目标、路径、链接、文件限额和 digest，再进入现有 SkillVersion/Operation 屏障。发布的生成 Tool 通过代理继续在受限执行环境调用；Extension hooks 不能在发布后回到 Host 执行。已有用户明确信任的原生 Extension 路线是否保留，属于需明确决定的兼容/信任模式。
5. **终止与恢复。** grant、run 和环境身份绑定；失败、取消、超时、Host 重启均销毁环境、撤销通道并核对终止；保留已提交版本和候选、禁止重放。环境无法证明销毁时不得继续自动执行或发布。

| 必须修改的正式部分 | 目的 | 粗估投入 |
|---|---|---|
| `evolution/activities.ts`、`development-tools.ts`、`runtime/agent.ts` 开发分支 | grant 与 executor 绑定；替换高权原生执行；保留现有目标/版本语义 | 3–5 人日 |
| 新 Activity executor、原生/成熟运行时适配、签名与打包脚本 | 私有文件、模型通道、网络策略、资源上限、完整环境销毁 | 10–20 人日，需先验证平台可行性 |
| `runtime/agent.ts:applySkills`、`skills/skill-loader.ts`、执行 Tool 注册/代理 | 检查和发布后不在 Host import 生成代码；保持 Pi 契约和版本屏障 | 8–15 人日 |
| 生命周期、诊断、跨模块回归及平台否定测试 | 取消/失败/超时/重启、后代进程、外网/FD/env/跨活动、部分发布 | 5–10 人日 |

以上约 6–10 人周是初步工程量，不是交付承诺。首先用 3–5 人日验证成熟运行时、安装/签名和部署约束；当前没有已批准的跨平台强隔离方案，不能在不支持的平台退回高权原生执行并继续称为安全模式。

剩余风险包括隔离运行时漏洞、显式允许的网络外传、依赖供应链、资源耗尽、授权导出内容及用户信任的高权原生能力。隔离不能替代目标/版本校验；版本回退也不能撤销已经发生的外部操作。

## 技术审批节点

需决定是否批准完整链路的隔离执行层与兼容模式设计，或明确接受并标示高权限原生模式。后者仍不满足本轮所要求的受限自主执行安全性质。另需单独授权 Reflection 诊断修改。

本轮只修正 D6-A 的权限说明，没有修改正式 Host、扩大 grant、弱化检查或模拟 sandbox 成功。正式产品发布仍被以上安全缺口阻挡。
