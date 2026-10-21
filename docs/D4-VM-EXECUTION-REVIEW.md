# D4：独立 VM 执行边界验证

2026-10-21；基线 `b01acb8`。结论：**D4 不准入**。这是执行环境与固定自有 Skill fixture 的原型验证，不是完整 Evolution 工作流，也没有导入或发布真实生成候选。

## 技术选择与证据范围

| 路线 | 已取得事实 | 限制与决定 |
| --- | --- | --- |
| 既有 XPC / App Sandbox | D3 的签名、同 Team 身份及固定 Worker 业务通过；历史 D4 已证明同容器活动目录可相互访问、detached 后代遗留 | 保持 D3，不能用来授予未知生成代码正式权限 |
| Apple container 1.6.0 CLI | 本机没有安装 CLI；官方实现是每容器独立 VM；CLI 未提供本实验需要的完整 pids 控制接口 | 不声称做过 CLI 运行验收，不要求 Docker Desktop |
| Containerization 0.52.1 SDK | 独立签名 Swift helper 实际创建每 Activity 一台 VZ VM，使用 SDK Guest cgroup 与资源配置 | 当前优先验证的最小原型；没有通过完整安全准入，普通客户端不启用 |
| 直接 Virtualization.framework | SDK 本身已经使用 VZ；当前缺证集中在可信控制面、恢复及完整攻击矩阵 | 保留只读对照；没有为了换 API 再实现一套相同 Guest，不宣称原生 VZ 已验收 |

依据：[container 1.6.0 架构](https://github.com/apple/container/blob/1.6.0/docs/technical-overview.md)、[SDK 0.52.1 LinuxContainer](https://github.com/apple/containerization/blob/0.52.1/Sources/Containerization/LinuxContainer.swift)。Swift Package.resolved 固定依赖闭包。原型 Linux Node 为 24.22.0，Pi 为 1.3.0；内核、镜像和 Node 下载固定摘要，保留准备清单。

## 实现的边界

每 Activity 私有 VM 与 2 GiB 可写盘；不共享 Host 文件系统，不配置网卡，不映射 Home、SSH Agent 或共享可写缓存。可信 helper 使用 SDK 受控 copy/stdio 通道投送固定 runtime 与授权源码。Workload 为 UID/GID 1000，清空 capabilities，设置 no_new_privileges；固定 launcher 限制 AF_VSOCK、namespace/control、ptrace、bpf 等系统调用，避免触达 vminitd 管理通道。受控依赖获取和完整依赖安装矩阵尚未完成。

VM 配置为 2 vCPU、1152 MiB VM 内存，额外内核/控制面不冒充 workload 限额；workload cgroup 为 1 GiB、swap 0、CPU quota 100000/100000 µs、128 tasks/TID。stdout/stderr 合计 4 MiB，Host 输入合计 32 MiB，绝对 deadline 最长 300 秒。vCPU 数、CPU quota 和累计 CPU 时间不是同一种限制。

取消先撤销可信端调用权限，再等待 helper 与实际 VZ 进程退出。外部 observer 采集 PID 和 startAbsolute 排除 PID 重用；观察错误不能当进程消失。固定 VM 输入、签名 Team 与摘要每次启动重查。候选冻结不再接受两个布尔值，只消费可信端内存中铸造的 VMClosure；Guest finished、序列化闭包和测试自报均不授予冻结资格。

## 正式 Skill 可行性

沿用 SkillVersion、不可变版本摘要、SkillService.publish、发布屏障、原 AgentSession reload 与回退。显式 `d4-vm-v1` 执行契约绑定版本摘要、`d4-data-only-v1` 和 runtimeDigest。未知 JavaScript 的导入、初始化和执行都留在 Guest；Host 仅加载应用自带代理。旧版本继续遵守 D2 精确内容人工审查语义，不迁移现有正式能力，不增加 Tool 版本库。

适配器仅由可信应用内部注入，默认客户端未开启。契约不匹配或缺少适配器时拒绝，不能退回 Host import。候选检查、初次加载、reload、rollback 和重启均按同一契约分流。

| Pi 能力 | 原型验证/支持范围 |
| --- | --- |
| 原生发现、tool_search、direct/nested/codemode Tool Calling | 固定 fixture 经真实 SkillService 和正常 Session 调用；复用原生 ExtensionRunner |
| 异步 Tool、取消 | Guest 执行；Host 取消关闭所属 VM，不把已返回的 detached 代码留作正式后台能力 |
| agent_start、所属 Tool 的 tool_call/tool_result | Guest 原生 Hook，按 turn 去重；重建 Guest 时先恢复本 turn 的 agent_start |
| 数据权限 | 仅包内受限源码与本次参数/结果投影；不传完整 Session、ModelRegistry、凭证或任意 Host bash/read |
| Provider、TUI、同步 Host 回调及其余 Host API | 明确拒绝；没有宣称任意 Extension 可透明迁移 |
| 版本切换 | 固定临时产品数据库覆盖 V1 在途、V2、生效失败恢复、rollback、禁用和重启 |

支持矩阵仅用于可行性，不改变既有正式 Extension 兼容性。若后续必要业务依赖未支持 API，需要拿具体业务和实测结果裁决，不能把扩大 Host 权限作为补丁。

## 原始实验收据

[先前收据索引](evidence/d4-vm/prior-index.json)固定文件 SHA-256 与解压后 SHA-256，区分已完成的早期 fixture 运行和最后失败的总验收，不继续覆盖这些证据。

- 双向隔离与资源：15 个 case，两个同时运行的 Activity；workspace/cache/build/tmp、已知绝对路径、穿越、symlink、openat 与 Host canary 访问失败，Node/Python/Shell 正对照成功。没有宿主挂载；跨 VM 同路径 ENOENT 只支持各自命名空间不可见，不伪称同目录权限 errno。还缺 Host 继承 FD 注入和显式文件共享反向测试。
- 聚合资源：4 个 CPU worker 出现 quota throttle，127 个子进程加父进程达到 tasks=128，5×260 MiB 内存压力使 workload exit 137；合计输出触发 4 MiB，双写进程对同一 2 GiB 文件系统出现 ENOSPC。可信 supervisor 的 cgroup 统计与 workload 报告分别保留；缺最终 OOM 计数器证明、线程专项和 Host 控制面聚合限额。
- 并发可用性：各项超限期间，B Activity 完成正常操作，普通 Host 的实际 Pi bash Tool 业务也完成。不能据此推广所有解包、日志、缓存和控制面攻击均受限。
- 生命周期：多层/detached 后代分别覆盖 stdin EOF、helper SIGKILL 与 deadline；外部 VZ 进程身份消失。另有真实产品 Host SIGKILL 后、相同临时数据库重启并调用成功的收据。容器服务/VZ 强杀、全部启动失败与观察故障后的恢复仍不完整。
- 正式路径：早期固定 fixture 19 项检查完成，含真正发布/屏障/正常 Session/版本切换/Hook/拒绝 Host API；这不是生成候选发布。最后总验收中的正式路径失败，完整失败收据保留，不用早期通过覆盖最终失败。
- 签名客户端：早期真实 Apple Development Electron 包能启动包内签名 helper 并在 Guest 输出固定结果；不是完整产品 VM 后端验收。Team 为 `7UK53LNNF8`。

真实模型开发、失败后修复、独立原字节复测和候选篡改的旧 XPC 证据继续保留；没有把它们迁移算作新 VM 路线的完整真实模型开发链。

## 存储事故、修复及打包边界

旧 VMChannel 与资源验收入口复制 2 GiB rootfs 后没有在关闭路径删除；重复运行累积，导致存储耗尽。清理回执记录第二轮 91 块盘、182 GiB 实际分配空间；早先清理记录另存。只删除本任务临时盘、构建中间物和新实验包，保留源码、失败候选、固定数据库与历史收据，没有清理用户其他应用或系统 swap。

修复后实验磁盘统一分配到固定用户级私有缓存中的两个持久化槽位，跨 cwd/Host 共用预算；分配、回收与恢复使用跨进程锁。每块不超过 2 GiB，分配时保留 16 GiB 可用空间，并额外预留两个槽位的最坏分配。正常关闭在确认实际 VZ 退出后回收磁盘和配置；失败或未绑定身份的 VM 保留槽位并阻止后续累积。Host 崩溃后，仅在原 Host 已死、未启动或绑定 VM 已确认消失时恢复。PID 重用宁可阻止回收，不猜测安全退出。

持锁 Host 被杀、或已经标记 launch 但还未绑定 VM 的崩溃，会保留锁/槽位并拒绝新实验，**还不是完整异常恢复实现**。这把存储增长限制为两个实验盘，但没有据此宣称 D4 生命周期门槛通过。

正常客户端不含 D4 实验组件；XPC 与 VM 实验 profile 互斥、默认输出到独立目录，并拒绝通过 symlink 别名覆盖正常输出。包内依赖只移除 sourcemap 与类型声明，不移除运行所需源码、文档资源或 Native 模块。XPC 复用外部依赖的 symlink 尝试被实际 codesign strict 拒绝后撤回，没有扩大 App Sandbox 权限。

新正常客户端实占 602468 KiB（约 588 MiB）：Electron/Frameworks 294788 KiB、D3 Helpers 215504 KiB、Resources 89860 KiB，签名等计入总量。原约 1.08 GiB 是叠加两套 XPC 与 VM helper 的实验包，不能把差值全当依赖优化收益。正常包仍保留独立签名 Node，未重设计桌面框架。新增未压缩包 768 MiB 上限、打包前空间检查及机器体积回执。

## 开销与剩余准入条件

修复后尝试重建固定 VM 输入：签名 helper 构建成功，但固定 Kata 内核归档下载在 600 秒后超时（约 262 MiB 的临时部分文件）；未启动新的 VM。因此本轮磁盘修复有真实文件/跨进程回归与源码审查，**缺少修复后的真实 VM 回收复测**。失败日志和清理记录保留，不能把旧 VM 收据改称当前版本通过。

修复后的验证收据见 [repair-verification.json](evidence/d4-vm/repair-verification.json)：全量 169/169、无跳过；新增磁盘/打包测试含跨 cwd 真实子进程共预算、20 次回收、并发恢复、低空间拒绝和输出别名拒绝，以及下载失败仅清理本次创建的 partial；真实签名 XPC、正常客户端 Desktop/Web、typecheck、build、format 均通过。lint 无错误但仍有警告。独立只读复审确认本轮五项新增发现关闭；不是六项安全准入通过，也没有写入 D2 人工审查记录。

准备好镜像和离线 Pi runtime 后，首次 VM ready 4205.9 ms，第二活动 4597.6 ms；Host 文件缓存没有清空。单 VM physical footprint 中位约 809 MiB，两 VM 合计约 1608 MiB，helper 另计。每活动可写盘为 2 GiB，旧实验实际全分配；先前 work 总目录的大量累计磁盘不能当单活动开销。首次下载/解包全过程耗时、系统峰值与所有 Host 缓冲预算尚未统一测量。

必须补齐：可信准备/解包/控制面的聚合预算；所有生命周期故障与无绑定启动恢复；完整 FD/共享文件/线程/网络 TCP/UDP/DNS/Unix socket 及离线依赖 npm lifecycle、pip wheel/sdist/build hook 矩阵；VM 内真实模型开发到独立原字节复测链；最终冻结版本的独立复审。任一缺失均保持不准入。

最小替代不是把候选重新加载进 Host，而是继续固定 SDK helper + 私有 VM + 有限数据契约，先补控制面预算与恢复，再扩展已验证的 Pi API。现有 D2/D3 正式能力继续使用原语义；本轮无正式自动发布。

## 重跑入口

先用既有 Apple Development 身份生成正常客户端与固定 helper，再准备镜像和离线 runtime；不安装系统软件，不自动安装 container CLI：

```sh
npm run package:desktop
npm run build:d4:vm
npm run prepare:d4:vm
npm run prepare:d4:runtime
npm run test:d4:execution
```

签名身份沿用 AGENT_CODESIGN_IDENTITY；自定义客户端输出时，用 AGENT_D4_VM_NODE_MODULES 指向其包内生产依赖。总入口先跑资源、正式 fixture、失败、Host 崩溃和开销探针；设置 AGENT_APP_PATH 才增加签名 VM 客户端探针（需要独立 VM 实验包）。即使已实现的探针全部完成，总入口仍返回不准入，直到本文剩余六项门槛真正补齐；不是自动发布入口。
