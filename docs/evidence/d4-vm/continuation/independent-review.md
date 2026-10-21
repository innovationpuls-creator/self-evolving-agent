# D4 最终独立只读安全复审

Reviewer: `/root/d4_evidence`。范围：当前差异（排除用户 AGENTS.md）、新增对抗探针、执行环境报告与索引证据。未启动 VM、构建或安装软件，不是 D2 人工代码审查记录。

结论：D4 不准入。最终修正复审通过只表示观察器和报告修正正确，不表示安全边界通过。

- P1：真实正式 Session 原生 read/bash 读取并导入隔离源码，Host canary 改变。可信 proxy 未关闭普通工具绕过。
- P1：live backing 实际可读出源码 marker，且可 pwrite 相同 54 字节。证明读写权限存在；没有声称任意修改后的 Guest 行为已验证。
- P1：Owner 接受调用方 kernel/initfs/rootfs、参数和 runtime；Host 摘要核对不能承担未来 broker 独立授权边界。此项是源码审查发现，非已执行攻击实验。
- P1：Host provisioning、解包、缓存、日志和 VZ 开销的聚合预算未建立；launched 未绑定身份的异常槽位仍缺自动恢复。
- P2：早期 Host probe 固定 marker 会误匹配历史成功，且 ready 后的调用早于 Guest 固定 sleep 后施压，不能证明超限时段可用。已改每次 UUID、精确成功 ToolResult、15 秒等待；补验 21 case 和 6 次不同 Host 调用，均 pressureOverlapProven=false。最终修正复审确认历史误匹配消除，报告已准确收窄，时段门槛仍未通过。
- P2：同权限新 VM 的真实模型开发/独立复测链、完整故障/显式共享矩阵仍未建立，不能拼接旧 XPC 和固定 Faux fixture 认定通过。

首次最终复审核对索引中 198 个归档的压缩/解压摘要及源码摘要匹配；正式收据为 23 检查、21 台 VM externalVMGone，native storage 仅构造 attachment，没有启动 VM。后续补验资源收据和修正代码另行复审，上述 P1 全部保留。
