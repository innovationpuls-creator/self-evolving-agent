# Reflection 偶发失败调查

结论：上一阶段 `succeeded`、`stages=[]` 的原始故障仍无法确定根因。本轮没有修改正式 Host，没有把复跑成功认定为修复。确认了测试目录唯一性风险，以及正式 Host 在首次成果前失败时缺少可定位诊断的缺口。

## 原始证据与等待语义

原始记录仍在 `../capability-integration/evidence/attempt1/engineering-reflection-failure.json`。其中 `succeeded` 用例约 194 ms 后以 `AssertionError: []` 失败；同次另外两种结局通过。该文件没有 executor 阶段、Job/Record 状态或原始异常，不能反推是哪一层出错。

`persistence.test.ts` 的 `host.prompt()` 只确认任务已接收，不代表 Session、Reflection 或成果已完成。本轮时间线实测在 `prompt.returned` 时 Session 仍 busy；随后才有 `executor.available → executor.start → model.request/response → checkpoint.saved → 成果提交`。测试等待的是 `committed || job.status === failed`，因此一次首提交前的终态失败会使等待提前返回，但不是无条件立刻断言。`stages=[]` 只说明没有观察到成功成果，不能证明数据库丢失。

正式调度在 `reflection-service.ts:337–380` 通过 `canRun`、availability、`pendingClaim` 和 pumping 标记控制。没有本轮证据证明这里存在重复调度、Faux 响应被其他 Session 消费或正式持久化事务错误。不能据此排除尚未复现的竞争。

## 本轮复现记录

所有路径均相对本目录；每个进程的 stdout/stderr、每种结局的 Job/Record、单调时间线及异常均保存在对应运行目录。

| 运行 | 实际结果 | 解释 |
|---|---|---|
| `runs/2026-10-26T12-38-39.652Z-command-8f1f5573` | 仪表初跑 2 通过、1 失败 | 测试辅助目录未创建导致写证据失败；辅助代码问题，未据此判断 Host |
| `runs/2026-10-26T12-39-30.039Z-command-86da12b4` | 20 个串行进程通过；24 个四路并行进程中 5 个失败 | 毫秒时间戳目录没有进程身份，132 个预期 fixture 只有 127 个目录；失败发生在初始化附近，finally 的 `host.reflection.jobs` 又遮蔽了原异常。因此可确认目录复用与测试不稳定，不能逐一补造这 5 次的原异常 |
| `runs/2026-10-26T12-40-42.387Z-command-5d650752` | 20 串行 + 24 四路并行，44 进程均通过，132 份生命周期诊断 | 给采样进程独立身份后，三种结局各 44 次；已提交成果、重复 Tool Call、重启恢复断言保持原样。没有重现原始首次成果前故障 |
| `runs/2026-10-26T12-46-49.308Z-command-7ba4c6c4` | 原 Reflection 7 项通过 | 仅是本轮结果，未覆盖历史验收证据 |
| `runs/2026-10-27T04-26-20.967Z-command-de062875` | D6-A、各适配和本轮测试共 49 项通过 | 含并发模块运行、SIGKILL 后保留成果、作用域、事务回放、失败/中断、故障注入 |

本轮将原生命周期测试及 capability 中复用测试的 fixture 改为 `mkdtemp`；断言附带 `stages/jobs/records`。新仪表记录 executor、model、checkpoint、等待返回和异常。没有提高等待时间来掩盖终态失败，没有减少持久化断言或改变 Faux 响应去迎合样例。

## 已确认的诊断缺口

`acceptance/tests/reflection-errors.test.ts` 注入两个独立故障：executor 开始即抛错；启动后、首个成果前抛错。两者均落为 `failed`、`changes=[]`；Job 与 Record 只保存“反思未完成，请检查模型、沙箱或受控接口状态”。实际注入值与持久结果分开记录：

- `runs/2026-10-26T13-00-20.494Z-command-59f9cf79/evidence/prototypes/d6/acceptance/reflection-error-executor-start.json`
- 同目录 `reflection-error-before-first-effect.json`
- 最终同类注入也在 49 项测试运行中通过。

`apps/host/reflection/reflection-service.ts:989` 的 catch 丢失错误类别与阶段；调度层 catch 也只保留固定通用码。`native-executor.ts:147` 丢弃 stderr 是已有防敏感日志设计，不应直接改成保留原始 stderr。现在的证据不足以事后区分模型、IPC、初始化、协议校验或保存前异常。

没有观测到本轮 OOM、进程被外部杀死或系统资源耗尽；这不是对历史执行环境的排除证明。没有复现原始失败，故不能把它判为已修复的测试问题，也不能判为正式数据一致性缺陷。

## 待授权的最小正式 Host 修改方案

1. 在 `reflection-service.ts` 内维护固定枚举阶段，覆盖 claim、初始化、Worker start、model、checkpoint、tool、summary/complete；异常出口写入阶段对应固定诊断码，沿用原有 session/trace/call 关联和有界保留策略。记录正常阶段转换时间，区别从未启动与启动后失败。
2. 在 `native-executor.ts` 将 spawn/签名/对端断连/协议/退出/取消区分为固定错误类别，禁止复制 Provider 文本、请求头、路径内容或原始 stderr。必要时同步 `apps/desktop/native/reflection/` 的 Bridge 协议并复核签名打包兼容性。
3. 优先复用 `DiagnosticService.system(code, level, sessionId, traceId, callId)` 及现有系统日志表；不需要先修改数据库架构。若将新诊断字段暴露为公共 DTO，另行明确兼容与脱敏契约。
4. 增加正式层故障注入，验证每个首次成果前出口保留准确阶段及关联，而已提交成果和当前权限语义不变。然后再复现原用例，不能先修猜测中的持久化代码。

粗估 2–4 人日，取决于是否需要原生协议变更；这是工程估算。此方案未实施，正式 Host 修改需用户授权。
