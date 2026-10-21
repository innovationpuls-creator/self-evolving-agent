# D4：独立 VM 执行边界验证

2026-10-21；工程基线 `b01acb8`，后续磁盘/打包修复提交 `e0fb1fb`。**D4 继续不准入**。本轮只验证执行环境和固定自有 Skill fixture；没有导入或发布真实生成候选，没有开发完整 Evolution 工作流。

## 当前结论

Apple Containerization 0.52.1 能实际提供每 Activity 独立 VM、Guest 聚合 cgroup 限额及 VM 销毁边界。签名 Electron 可启动包内签名 helper，正常 Pi Session 的 Tool/Hook 与版本切换可经过 Guest。但这不能独立保证正式源码只能在 Guest 执行：正常 Host 的原生 `read/bash` 已成功读取并导入隔离版本的原始源码；同一用户还能够直接读取、写入正在运行的 VM backing file。**正式执行权限阻断已被真实反例确认，不能用路径隐藏或测试通过消除。**

新证据见 [continuation/index.json](evidence/d4-vm/continuation/index.json)；其文件摘要和解压后摘要同时保留。先前阶段的 [prior-index.json](evidence/d4-vm/prior-index.json)、[repair-verification.json](evidence/d4-vm/repair-verification.json) 与失败收据保持原状。各轮结果不相互覆盖，也不把旧 XPC 真实模型结果算成新 VM 的模型开发证明。

## 技术路线比较

| 路线 | 实际结果 | 选择限制 |
| --- | --- | --- |
| XPC / App Sandbox | D3 继续通过；旧 D4 同容器活动可互访、detached 后代遗留的失败证据保留 | 保持 D3；不承载未知生成代码正式执行 |
| Apple container 1.6.0 CLI | 用户完成官方签名包安装后，实际版本 `ca4884f`、system running；本轮 CLI 容器和镜像均为 0。核查真实 run/create 帮助 | CLI 不能完整表达所需 tasks/TID、控制面权限及生命周期证明，因此不靠每进程 rlimit 补齐，不把 CLI 安装当容器验收 |
| Containerization 0.52.1 SDK | 签名独立 helper 实际创建每 Activity 独立 VZ VM，配置 Guest cgroup；完成下述运行矩阵 | 优先路线；尚未满足正式源码、Host 控制面和完整恢复门槛，默认产品不启用 |
| 直接 Virtualization.framework | 实际附件探针：普通文件 FD 作为 block-device attachment 被拒；已 unlink 文件的 `/dev/fd/<fd>` 作为 image attachment 可构造 | 探针没有启动 VM，也没有证明创建窗口、FD 可访问性及 protected storage；不宣布原生 VZ 方案通过，不为替换 API 重写完整 Guest |

固定依赖与官方来源：[container 1.6.0](https://github.com/apple/container/releases/tag/1.6.0)、[每容器独立 VM 架构](https://github.com/apple/container/blob/1.6.0/docs/technical-overview.md)、[SDK LinuxContainer](https://github.com/apple/containerization/blob/0.52.1/Sources/Containerization/LinuxContainer.swift)。Swift Package.resolved 固定 0.52.1；Linux Node 24.22.0、Pi 1.3.0；下载输入及 runtime 均有摘要。没有安装 Docker Desktop，没有映射 Home 或 SSH Agent。

## 执行边界与参数

每 Activity 一台 VM、一块独占 2 GiB ext4；默认无 Host 文件系统挂载、无虚拟网卡、无共享可写缓存。源码与离线 runtime 经可信 helper 的受控 SDK copy/stdio 通道进入 Guest。Workload UID/GID 1000，capabilities 为空，no_new_privileges；固定 launcher 限制 AF_VSOCK、namespace/control、ptrace、bpf 等 syscall。未知 workload 不能直接访问 supervisor 通道或修改 workload cgroup 限额。

VM 为 2 vCPU、1152 MiB；workload cgroup 为内存 1 GiB、swap 0、CPU quota 100000/100000 µs、128 tasks/TID。stdout/stderr 累计 4 MiB，Host 输入累计 32 MiB，绝对 deadline 最长 300 秒。VM 内核与控制面内存单独观测，不计作 workload 剩余内存；vCPU、quota 与累计 CPU 时间分别记录。

取消先撤销 Host 能力，再等待 helper 与实际 VZ 进程停止。签名外部 observer 记录 PID、启动秒/微秒、startAbsolute，排除 PID 重用。候选冻结使用可信端 WeakMap 中铸造的 VMClosure，绑定 activity、runtime、限额和外部关闭身份；Guest finished、序列化闭包或两个布尔值均不授予冻结资格。

## 六项验收结果

| 项目 | 本轮真实证据 | 未通过或未建立部分 |
| --- | --- | --- |
| 双向活动隔离 | A/B 同时运行，Node/Python/Shell 正向业务；workspace/cache/build/tmp、已知路径、穿越、symlink、openat、Host canary 双向拒绝。Host FD 正向读取后经 fd3 传给 helper，Guest 扫描 FD 无 canary | 未取得 helper fd3 的独立 lsof 正对照；显式文件共享权限矩阵未完成；阻止 Host 反向读取 Guest 源码的要求失败，见下一节 |
| 生命周期 | 多层/detached 后代覆盖 stdin EOF、helper SIGKILL、deadline；21 个资源 case 均绑定实际 VZ 并确认消失。正式 fixture 21 台 VM 均外部确认退出；实际产品 Host SIGKILL 后 VZ 消失，同一临时数据库重启可调用 | launched 未绑定身份窗口仍保留槽位，不能自动恢复；容器服务/VZ 强杀及全部启动故障矩阵未完成 |
| 聚合资源与并发 | 21 个 case；多进程内存 exit 137 且可信 oom/oomKill 计数增加；CPU 多 worker throttle；进程及线程达到 tasks=128；累计输出超限；双进程写盘 ENOSPC。B Activity 正向业务完成；补验中 Host 唯一 marker 新调用成功，显式记录 pressureOverlapProven=false。早期固定 marker 收据仅作历史记录，不证明超限时段可用 | Host 超限时段持续可用、镜像准备/解包/缓存/日志及整个控制面的聚合 CPU/内存/存储预算仍未证明，不能声称整个活动资源门槛已通过 |
| 正式能力同边界 | 固定 fixture 真正经过 SkillService.publish、barrier、正常 Session、原生发现/tool_search、direct/nested/codemode、reload/rollback/restart；23 项检查 | 正常 Session 原生 read/bash 可读取并执行原始隔离源码，sourceBoundaryPassed=false；这是阻断反例 |
| 正向业务与反向权限 | Guest 拒绝 Host canary、ModelRegistry/system prompt、控制通道与未支持 API。离线 npm lifecycle/rebuild、pip wheel/sdist/PEP517 hook 实际成功；损坏摘要、损坏 npm tgz/wheel 均实际拒绝。Host TCP4/TCP6/UDP/DNS/Unix socket 正对照，Guest 无网卡且非授权路径失败 | Guest ::1 不是 Host ::1，不把该失败算成同一 Host IPv6 endpoint 的隔离证明；显式共享和完整网络矩阵仍缺证 |
| 独立审查与开销 | 独立只读审查指出源码绕过、控制面预算、生命周期及证据缺口，已复现实质源码反例并修复损坏包/清理测试缺陷；开销量化如下 | 另一次最终只读复审完成，明确维持不准入；指出固定 Host marker 与施压时段证据缺陷。已收窄报告并补验唯一 marker，时段持续可用仍未证明；不是 D2 人工代码审查记录 |

真实模型开发、先失败后修复、原始字节独立复测与候选篡改的旧 XPC 收据保留。新 VM 的完整真实模型开发链尚未建立，不作通过声明。

Host 可用性观察器已改用每次唯一 UUID marker、精确成功 ToolResult 和有界等待，避免复用历史成功；收据显式记录 pressureOverlapProven=false。此补验只证明新调用在 Activity 运行期完成，不声称与实际超限时段重叠。独立审查结论及剩余门槛见新证据索引。

## 正式源码与 boot chain 的阻断反例

1. 固定自有版本经过真实发布路径后，正常 Host Session 的原生 read 读取版本快照 `extension.mjs`；原生 bash 启动 Node import，fixture 顶层代码修改 Host canary。测试随后恢复 canary。正式运行 fixture 的执行检查已完成，但安全测试以退出 1、sourceBoundaryPassed=false 保存。没有导入真实生成候选。
2. backing 专项先让 Guest fsync 固定源码，并报告 `/tmp` 是 ext4；Host 以同一 UID 打开正在运行的 backing，定位 54 字节自有源码 marker，并成功 pwrite 相同字节。没有修改其他文件或元数据。其 backingBoundaryPassed=false；VZ 文件锁不是普通 read/pwrite 的访问拒绝。首次未 fsync 时未找到 marker，属于页缓存可见性，不能解释为权限保护。
3. 当前 helper 虽有 Apple Development hardened runtime 签名，但其配置接受调用方选择 kernel/initfs/rootfs、参数、Node 与 runtime archive；摘要核对发生在 TypeScript Host。若将它直接升级成持有源码密钥的 broker，Host bash 可另起 helper/替换 boot chain，现有核对不足以成为 native 授权证明。该项是源代码审查发现，未伪称已经完成攻击实验。

因此，“loader 只加载可信代理”只覆盖受控 loader，不能推出“未知源码实际只在 Guest”。单独生成使用说明、隐藏路径、加密 SQLite、签名 helper、将 Guest `/tmp` 改为 tmpfs 或 unlink 磁盘，都不足以独立关闭这三条路径。

## 已批准契约与最小替代方案

用户已批准仅针对新增隔离版本的受限契约：Agent 通过应用生成的 Skill/Tool/Hook 使用说明自主发现及原生 Tool Calling，源码、脚本、依赖和执行留在 Guest；旧正式版本保持兼容，不强制迁移。这个裁决已经记录，不需要再次批准同一目标。

沿用 SkillVersion 的可选 execution 字段，`d4-vm-v1` 绑定版本摘要、`d4-data-only-v1` 和 runtimeDigest；候选检查、初次加载、reload、rollback、重启均分流到可信 proxy，缺适配器直接拒绝。异步 Tool、agent_start、所属 Tool 的 tool_call/tool_result 实测；Hook 精确一次、V1 在途/V2 切换、初始化/提交失败恢复、挂起 Hook/Tool 取消、禁用和重启均覆盖。Provider、TUI、同步 Host 回调及其他 Host API 明确拒绝。旧版本仍走既有 D2 人工审查语义，不新增 Tool 版本库。

最小可靠后续方案仍优先复用官方 SDK 和现有 Guest/Pi runner：将新增隔离版本的私有存储与执行授权收敛到可信 native broker，Host 只保留版本身份、使用契约与数据投影；broker 自身固定验证 boot chain，拒绝调用方提供任意可执行输入；源码不能再经过普通 Host 可读快照、草稿、知识视图或可读 backing。必须实测 protected storage 的创建窗口、替换竞争、重启/回退及完整原生 read/bash 对抗后才能集成。

可先评估 hardened broker + 受保护的密钥与匿名/加密 backing，不预断同 UID 必然需要管理员服务。若该路线不能形成 OS 强制边界，再评估独立 OS 身份服务；安装/权限配置届时交由用户执行。直接 VZ 只在官方 SDK 无法提供必要接口时继续，复用同一 Guest 和验收，不改变桌面框架。当前没有把上述替代方案当作已实现修复，也没有擅自限制旧版本或正常 Host 工具兼容性。

## 磁盘回收与打包修复

旧实现复制 2 GiB rootfs 后没有在关闭路径删除，重复实验填满存储。历史清理记录保留第二轮 91 块盘、182 GiB 实际分配，以及前轮清理；仅处理本任务产物，没有清理用户其他数据或系统 swap。

现在所有实验共用固定私有缓存的两个持久化槽位，每块最多 2 GiB；分配前保留 16 GiB，再预留两槽最坏 4 GiB。跨进程锁改为 SQLite BEGIN IMMEDIATE，真实子进程 SIGKILL 后 OS 释放锁的测试通过，避免永久遗留 mkdir 锁。准备阶段也串行，未完成准备重试复用同一镜像身份，不再每次新建 2 GiB。已验证摘要的解压内核可复用，清除大下载归档后不会再次下载；实际缺归档重试成功，损坏内核则明确拒绝。

正常关闭须外部确认实际 VZ 消失才回收；Host 崩溃恢复只回收 owner 已死且未启动或精确绑定 VM 已消失的槽位。已 launch 未绑定身份仍保留并阻止继续分配。一次此类遗留槽位在记录系统进程及打开文件证据后手动清理，单独保存收据；不计作自动恢复通过。修复后真实 21 case 和正式路径未再积累运行盘。

正常包与 XPC/VM 实验 profile 互斥、拒绝输出别名覆盖；只裁剪依赖 sourcemap 与声明文件，保留运行资源。未压缩包上限 768 MiB，并有打包前空间检查。先前阶段正常包约 588 MiB 的收据保留；本轮不把旧包大小冒充新结果。本轮复用现有 Electron 44.9.0 shell，替换当前 dist、重建 native、裁剪依赖并重新签名，VM 实验客户端 **650356 KiB，约 635 MiB**，deep/strict 签名通过。没有把未重跑的 packager 命令记为成功，也没有移除独立签名 Node 或改桌面框架。

## 实测开销与回归

预备镜像和离线 runtime 已存在，Host 文件缓存未清空：首 VM 到 runtime 就绪 3543.2 ms，第二台 3423.8 ms。20 次采样中单 VM physical footprint 中位约 836.4 MiB、峰值 836.5 MiB；双 VM 合计中位约 1689.6 MiB、峰值约 1689.6 MiB。采样峰值不是全过程峰值；helper 与 Host 分角色另列原始数据。低层资源探针 ready 约 0.5～0.7 秒不含完整 Pi runtime，不能与此混用。

开销收据的准备目录实占 1650024 KiB，native bin 53728 KiB；离线 runtime 143116800 字节、内核下载归档 696573576 字节，单个临时可写盘逻辑 2 GiB。完整下载/解包耗时、系统全过程峰值及 Host 控制面预算未建立。证据归档后已清理本任务内核下载归档、安装包、runtime 暂存副本、实验客户端和 Swift 构建缓存，共计 du 引用占用约 3.18 GiB；APFS 共享块不能据此直接推算释放空间。清理后 df 已用约 221 GiB（237 GB），可用约 186 GiB；无 VM 进程或遗留活动盘槽。保留约 773 MiB 固定 VM 重跑输入、签名 helper，以及所有失败候选、数据库和历史证据；清理收据另列。

最新全量回归 170/170、0 skip；typecheck、build、format:check 通过，lint 无错误但有既有警告。真实 Apple Development XPC 身份测试包含在全量回归；签名 VM 实验 Electron 客户端、Desktop/Web 与包内 helper→实际 VM→外部退出观测通过。它们都不替代正式源码安全门槛。机器日志和代码摘要见新索引。

## 重跑与准入规则

```sh
npm run build:d4:vm
npm run prepare:d4:vm
npm run prepare:d4:runtime
npm run test:d4:vm
npm run test:d4:formal
npx tsx scripts/d4-vm-backing-boundary.ts
swift scripts/d4-native-storage-probe.swift
npm run test:d4:execution
```

构建使用现有 AGENT_CODESIGN_IDENTITY。准备需要已核对的生产依赖目录，默认取现有客户端；可由 AGENT_D4_VM_NODE_MODULES 指定。运行工具缺失不自动安装系统软件。formal/backing 专项当前预期返回非零，代表上述实测安全失败；总入口遇失败停止，不继续启动可能未清理的 VM，始终不自动授予发布资格。其他独立探针本轮分别执行并留证，不能把总入口未运行到的探针写成总入口通过。

六项安全验收、新安全边界实现后的独立复审、同权限真实模型链及签名客户端集成全部满足之前，保持 D4 不准入。当前交付真实失败证据、边界限制与最小替代方案，保留现有正式能力。
