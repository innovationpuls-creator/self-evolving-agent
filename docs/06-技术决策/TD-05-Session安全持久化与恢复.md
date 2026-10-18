# TD-05：Session 安全持久化与恢复

## 最终方案

保留 Pi 原生 Session 结构，使用 **内存 Session + 宿主完整加密快照 + 独立安全导出**。不修改 Pi Core，不用脱敏副本恢复执行，不另建会话历史系统。

| 部分 | 技术选择 |
|---|---|
| 活跃会话 | `SessionManager.inMemory()` |
| 恢复快照 | `header`、完整 `entries` 与对应 `leafId` |
| 加密 | 宿主 AES-256-GCM |
| 数据密钥保护 | Electron `safeStorage`，选型优先异步 API |
| 恢复分支 | 加载原生条目后执行 `branch(savedLeafId)` |
| 导出 | 对独立副本检查、脱敏，不作为恢复入口 |

## 完整快照与传播控制

TD-01 的消息过滤改变 Tool 的真实参数，且不能覆盖全部写入。恢复数据不能先被不可逆替换为掩码。

原始数据可保留在加密快照中；解密后进入 Memory、Diagnostic Log、客户端、模型请求或导出时，仍受敏感信息保护。加密不替代传播控制，文件权限也不隔离同用户权限下的恶意代码。

数据密钥不放入会话快照。选型中的 `safeStorage` 对接 macOS Keychain / Windows DPAPI；Windows DPAPI 不构成同一用户下其他应用的隔离边界。真实系统密钥库集成不属于本次持久化原型已完成的部分。

## 保存与恢复

1. 从 `getHeader()`、`getEntries()`、`getLeafId()` 取得匹配副本；`getEntries()` 不含 header。
2. 整体加密，以受限文件权限和原子替换保存；快照与 leaf 不能来自不同时间点。
3. 恢复时验证加密认证，将 header 与完整条目提供给 `SessionManager.inMemory()`，再恢复保存的 leaf。
4. 沿用 Pi 原生 AgentSession、Extensions、分支及 Compaction，不只恢复 `agent.state.messages`。
5. 导出处理独立深拷贝，绝不写回活跃 Session 或完整恢复快照。

Pi 1.3.0 重建条目索引时按追加顺序确定 leaf；仅导入条目，不能恢复“切换历史分支但尚未追加”的用户选择，因此必须额外保存 `leafId`。

## 可行性依据

[持久化报告](../../experiments/pi-session-persistence/REPORT.md)及[保存结果](../../experiments/pi-session-persistence/artifacts/last-run.json)记录 macOS arm64、Node 26.10.0、Pi SDK 1.3.0 的 Faux Provider 实验。

原型保留分支、Compaction、Custom Entry 及嵌套数据；检查点保存后实际终止进程，新进程恢复并继续 Tool Calling。首次及恢复后的参数保持原值；密文篡改和错误密钥被认证拒绝。脱敏导出不含模拟凭证明文，并明确不可恢复。

## 剩余风险

测试密钥来自父进程，不代表 Keychain/DPAPI 已集成。SIGKILL 发生在 Tool 完成及检查点保存后，未覆盖写入中断、断电、磁盘损坏或执行中的 Tool。

正式签名应用的密钥访问、Windows 恢复、真实模型及全部导出路径仍待验收。未知秘密不能靠通用模式保证识别，必要检查失败的处理沿用 SA-07。

**恢复历史不等于安全恢复外部操作。** 已产生但未确认的副作用不能因会话可恢复就自动重放，见 TD-08。

## 来源与关联

来源：TD-03 的执行/存储分离；TD-05 原型、验收与本地报告。完整加密快照覆盖早期将脱敏数据作为恢复数据的设想。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [TD-06：数据持久化方案](./TD-06-数据持久化方案.md)
- [TD-08：后台任务调度与故障恢复](./TD-08-后台任务调度与故障恢复.md)
- [SA-07：权限、安全与能力变更边界](../05-系统架构/SA-07-权限安全与能力变更边界.md)
