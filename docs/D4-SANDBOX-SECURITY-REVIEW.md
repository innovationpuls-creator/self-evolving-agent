# D4 执行隔离原型独立安全复审

审查日期：2026-10-21。独立审查 agent 在独立上下文只读检查最终代码、签名产物、quarantine 与机器收据，并独立执行 codesign 严格检查及文件摘要核对；没有替代实施者重跑全部实验，也没有创建证书或改变系统信任。这是工程安全复审，**不是 D2 正式 Skill 的人工代码审查记录**，没有写入 Skill review。

## 结论

**D4 不准入。** 最终受控原型具备真实 OS 拒绝、实际 Provider 开发、独立字节复测与未审查发布拒绝的局部证据；未发现新增 quarantine 进入正式能力路径的绕过。四项必要边界仍失败或未建立，不能宣布 D4 满足安全准入。

## 最终独立核对

- [签名执行收据](evidence/d4-sandbox.json)时间为 `2026-10-21T00:20:27.545Z`，`executionCompleted:true`、`admission:false`。产品 Apple Development Team 为 `7UK53LNNF8`，当前外层产品 `codesign --verify --deep --strict` 成功。
- 正式产品 Worker、收据与当前 dist 的 SHA-256 一致：`525917ec` 前缀，完整值见机器收据；对抗 fixture 的身份独立记录，未将 fixture 当正式 Worker。
- quarantine 五文件逐一重算摘要全部匹配；开发与独立复测 digest 均为 `e23e5a77aade58749309b73b3ada35d711d8aef9082b06c66e5376e84e87eefd`。授权目标、runId、permission profile、路径、源码身份绑定，不意味着已授予发布权限。
- 实际模型 Tool 事件包含 `test.mjs` 的 AssertionError、写入 normalize 源码、随后相同测试 PASS。独立运行实际调用 normalize_labels 得到精确 `["a","b"]`，Hook 触发。普通 Agent 最后 assistant 为 `D4_STILL_AVAILABLE`，stopReason 为 stop。
- 生成候选 `frozen:false`、`imported:false`，保持 quarantine。D2 单独 fixture review 为 null、current 为 null，实际发布拒绝，不是生成候选成功交付声明。
- Node/Shell/TS、dynamic import、真正 Pi Extension/Hook、目录 openat、npm lifecycle 与网络探针支持验收报告限定的局部 OS 拒绝结论。Python 启动失败独立标为不支持，没有推广其他解释器证据。

## 复审发现与修正

| 发现 | 修正及复审结果 |
| --- | --- |
| 将未证明的后代清理用布尔值当成功，随后导入生成候选 | 生产实验只 inspect 字节，禁止冻结与生成候选导入；D2 门禁使用单独固定 fixture。已确认。 |
| Python 只看进程退出码，可能把启动失败当隔离成功 | 正常 stdlib/子进程正对照及每个文件 errno 1/13 才可支持；当前两个解释器均不支持。已确认。 |
| develop 只匹配任意 bash 失败/成功 | 绑定 Tool args 的 test.mjs、AssertionError 和后续 PASS；最终收据含真实顺序。已确认。 |
| 普通 Agent 回复检查可能匹配 user prompt | 只检查最后 assistant，拒绝 error/aborted；最终收据有真实回复。已确认。 |
| detached 进程可能在 pip 测试期间自然退出 | 移到耗时步骤后，延长 60 秒；最终 terminal 后 alive:true，未把自然退出当清理通过。已确认。 |
| 继承 FD 证据范围过宽 | 报告明确仅枚举 FD 3～31，未注入 Host 打开的 canary FD，ENOENT 不当权限拒绝。已确认。 |

## 必须保留的技术阻断

1. 同固定 App Sandbox 容器内相邻工作区可以访问，随机 cwd 无法形成活动级文件授权。
2. detached 后代终态后仍存活，进程组清理不能保证所有后代终止，失败时不能安全冻结候选。
3. 没有已证明的活动级总内存、进程数边界。按用户的 RLIMIT_NPROC 不能替代。
4. 现有正式 D2 Extension 在高权限 Host 内加载，隔离验证不能自动赋予该权限；EVO-07 一次目标授权后的自动生效目标仍有技术阻断，不得自动伪造人工审查。

[自动化与日志身份](evidence/d4-automation.json)记录 161 tests、无 skip、typecheck、lint、format、build、最终重签名与同包 Desktop 回归；lint 存在警告。先前 Provider error 尝试不计通过。完整证据范围、未验证项与最小下一步见 [D4-SANDBOX-ACCEPTANCE.md](../D4-SANDBOX-ACCEPTANCE.md)。
