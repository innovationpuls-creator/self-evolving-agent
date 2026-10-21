# D4 沙箱复用评估

2026-10-21；工程 HEAD `6e16d0a`，Pi SDK `1.3.0`。本轮仅检查实际源码和官方文档，没有安装运行时、拉取镜像、启动沙箱、运行压力实验或修改执行代码。**D4 保持不准入；停止继续开发 Native Broker、底层 VM 和完整 Evolution 工作流。** 后续建议均未实施，既有实现、失败候选与历史证据保留。

## 结论

优先候选是 **现成 Docker Sandboxes（独立 `sbx` microVM）承担执行环境，现有 Pi Worker/ExtensionRunner 承担 Agent 与 Skill 语义，Host 保留可信工具代理和既有 D2 版本协调**。不再维护自有 VM owner、内核、Guest supervisor 或新 Broker。`pi-sbx` 可复用 operations 和连接传输代码，但不能原样作为 D4 边界：其工作区挂载、Host Skill 读取例外和显式 Host 执行模式与新增隔离版本契约不同。

这是优先评估的复用组合，**不是通过结论或已批准采用**。四个项目都没有直接完成本项目的正式 Skill 同权限发布要求，不能把剩余权限阻断叫作“小适配”。OpenHands 的命令、文件和环境管理可作远程执行备选；不引入其 Conversation/Agent Loop。

## 实际源码基线

远端默认分支固定到以下 commit；仅下载小型源码文件，没有 clone 仓库或安装依赖。

| 项目 | 基线 | 检查入口 |
| --- | --- | --- |
| Pi 官方 | `v1.3.0` / `71023aec1546d6d677a65669c5665c0927ce0dd0`，同时读取本机安装包 | `docs/containerization.md`；`examples/extensions/sandbox/index.ts`、`package.json` |
| rnorth/sandboxed-pi | `48643301ff043c45ee95d528fca7dbabd2603de5`，package `0.1.0` | `pi-extension/src/{index,docker,ops,egress}.ts`；`Dockerfile.template`；`proxy/setup_iptables.py`；package |
| ChristianMoesl/pi-sbx | `3abac782e6bc616b952b396f83f7f28969ae2ab1`，package `0.7.1` | `extensions/pi-sbx/{index,connection,transport,skill-access,cli}.ts`；`worker.cjs`；README、readiness、package |
| OpenHands 当前 SDK | `0996c33916c2a977ea9fe38deee660ff0e1389f2` | `openhands-workspace/openhands/workspace/docker/workspace.py`；`openhands-sdk/openhands/sdk/workspace/remote/{base,remote_workspace_mixin}.py`；LICENSE |
| OpenHands 旧 Runtime | `137bede1f5e867a7eb17ae36e78a05ffef6ec09a` | `openhands/runtime/impl/docker/docker_runtime.py`；`openhands/core/config/sandbox_config.py`。取自删除 V0 Runtime 的 `e86067c15b54242fd611877aa9038a2f7a219658` 的父提交，不冒充当前实现 |

Pi、pi-sbx、所检查 OpenHands SDK 为 MIT。rnorth 的 package 声明 MIT，但该源码树未见 LICENSE 文件，复制分发前须确认许可文本。rnorth 依赖旧包名 `@mariozechner/pi-coding-agent ^0.72.1`；pi-sbx peer 为新包名 `*`、开发基线 `^0.82.1`，都不等于已验证兼容本工程 `1.3.0`。

源码：[Pi 文档](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/coding-agent/docs/containerization.md)、[Pi sandbox](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/coding-agent/examples/extensions/sandbox/index.ts)、[rnorth Docker](https://github.com/rnorth/sandboxed-pi/blob/48643301ff043c45ee95d528fca7dbabd2603de5/pi-extension/src/docker.ts)、[rnorth operations](https://github.com/rnorth/sandboxed-pi/blob/48643301ff043c45ee95d528fca7dbabd2603de5/pi-extension/src/ops.ts)、[pi-sbx 主扩展](https://github.com/ChristianMoesl/pi-sbx/blob/3abac782e6bc616b952b396f83f7f28969ae2ab1/extensions/pi-sbx/index.ts)、[pi-sbx transport](https://github.com/ChristianMoesl/pi-sbx/blob/3abac782e6bc616b952b396f83f7f28969ae2ab1/extensions/pi-sbx/transport.ts)、[当前 DockerWorkspace](https://github.com/OpenHands/software-agent-sdk/blob/0996c33916c2a977ea9fe38deee660ff0e1389f2/openhands-workspace/openhands/workspace/docker/workspace.py)、[旧 DockerRuntime](https://github.com/OpenHands/OpenHands/blob/137bede1f5e867a7eb17ae36e78a05ffef6ec09a/openhands/runtime/impl/docker/docker_runtime.py)。

## 直接支持、适配与缺口

“直接支持”表示源码已有实现，不表示已在本工程实测通过。

| 路线 | 直接支持 | 可复用的适配部分 | 仍不支持或不能据此证明 |
| --- | --- | --- | --- |
| Pi containerization 文档 | 区分整个 Pi 进程隔离与 Host 工具路由，明确 Extension 执行位置 | 复用完整 Pi 在成熟沙箱中运行的部署方式，保留原生 Tool Calling | 文档不是运行时；示例 Docker 参数不含完整活动限额、崩溃回收或正式版本权限契约 |
| Pi sandbox 示例 | `SandboxManager` 包装 bash 与 user_bash，文件/网络规则；macOS Seatbelt/Linux bubblewrap | 可信普通 bash 的轻量限制示例 | read/write/edit 和未知 Extension/Hook 仍在 Host；初始化失败使用 localBash；取消依赖进程组；无活动聚合资源限制 |
| rnorth/sandboxed-pi | 七个内置工具经 Pi operations→docker exec；Session 创建/正常关闭移除；非 root 镜像；可选代理侧车和 iptables/DNS 出口控制 | operations factory、容器命令封装、Node/Python/Shell 镜像配置 | 普通容器而非每 Activity 独立 VM；默认 cwd 双向可写挂载；自定义 Extension/Hook 仍在 Host；启动无 memory/CPU/pids/总磁盘限额，输出 Buffer 无总量边界 |
| ChristianMoesl/pi-sbx | 七工具和用户 shell 经 sbx exec；持久 Node worker、流式传输、取消、就绪屏障、同名重连；未就绪不静默回退 Host | 最贴近本工程的 Pi operations、连接状态与传输适配 | 不创建/销毁沙箱、不设资源政策；要求直接挂载 cwd 或父目录；Host Skill 读取例外；自定义 Extension 默认 Host；显式 Host 模式不适用于新增隔离版本 |
| OpenHands 当前 DockerWorkspace/RemoteWorkspace | 启动、健康检查、stop、环境/显式 volumes；命令 start/output/stop、上传下载、runtime release；远程 API | TypeScript/REST 接 Pi operations；复用已部署执行服务，不采用其 Agent Loop | 本地 DockerWorkspace 不暴露聚合 memory/CPU/pids/总存储配置；nofile 是单进程 FD 限制；普通容器不等于独立 VM；没有本项目 Pi Tool/Hook 与 D2 版本语义 |
| OpenHands 旧 DockerRuntime | Docker SDK 创建/移除和 Action 执行；docker_runtime_kwargs 透传参数 | 参考其运行参数和环境管理 | 已从当前主线移除，不建议搬入旧全栈；参数透传不是已配置/实测的限额 |

关键实现位置：

- Pi sandbox 的 `createSandboxedBashOps` 取消使用 `process.kill(-pid)`；初始化异常设置 `sandboxEnabled=false`，Tool execute 随后使用 `localBash`。不能直接作为 fail-closed D4 执行器。
- rnorth `createSandboxContainer` 启动 `sleep infinity`，正常 session_shutdown 执行 docker rm -f；单命令 abort/timeout 只杀 Host Docker CLI，不能证明 Guest 命令及 detached 后代终止。Host SIGKILL 不执行正常关闭 Hook。
- pi-sbx 的 `resolveHostSkillReadPath` 允许读取已发现 SKILL.md 所在目录中的支持文件；`connection.close()` 只 dispose transport，worker shutdown 杀已记录子进程组，没有 sbx rm 或实际 VM 停止确认。
- 当前 OpenHands DockerWorkspace 默认 `linux/amd64`，arm64 镜像须另核对；只显式传入 nofile=65536:65536，端口绑定 127.0.0.1，并转发配置中的 Session API key。Context7 较旧摘录仍显示全接口绑定和清空 key，本文以固定 commit 源码为准。context manager/析构 cleanup 不能证明调用方 SIGKILL 后回收。

## 对本项目需求的适配判断

| 需求 | 可直接保留/复用 | 剩余工作 |
| --- | --- | --- |
| Evolution 独立执行 | 现有 worker.ts 已有 Pi createAgentSession 和模型转发；供应后端提供进程环境 | 每 Activity 显式独占实例，开发与独立验证使用新实例和相同权限 profile；不能按 cwd 自动选某个现存沙箱 |
| 原生 Tool Calling | Pi operations 保留工具 schema/执行链；本工程已有 tool_search、codemode 和可信 proxy | 核对 SDK 1.3.0 差异；只接独立 Evolution 会话和新增隔离版本，不能全局改变旧正式能力 |
| 依赖管理 | 镜像内 npm/pip/系统工具与包缓存，无需重写包管理器 | 固定镜像、锁文件、摘要；安装和 lifecycle/build hook 在同一边界；出口和缓存有上限。能安装包不等于安全依赖服务 |
| 聚合资源 | Docker 已有 cgroup 能力；SBX 文档有 VM memory/cpus 配置 | 扩展没有完整配置；vCPU 不等于 CPU quota；tasks/TID、输出/IPC、所有可写盘与 Host 缓冲/拉取/解包/日志仍须供应后端实际支持并验证 |
| 生命周期 | 后端有容器/VM remove；扩展有传输取消和正常关闭 | 撤销能力→销毁环境→确认停止；缺 Host 崩溃、deadline、服务异常的独立回收保证。dispose 不等于 VM 销毁 |
| 正式隔离 Skill | 保留 SkillVersion、publish/barrier/reload/rollback；现有 skill-worker.mjs 已使用真正 Pi 机制 | 未知代码 Guest import/init/execute；Host 只注册可信 proxy；供应项目没有本工程的版本/Hook 契约，源码与控制接口绕过仍是权限阻断 |

## Docker Sandboxes 的真实适配边界

官方当前文档明确：独立 sbx 不要求 Docker Desktop/Engine，支持 macOS Apple silicon；每个本地 sandbox 是独立 microVM，与 rnorth 普通 Docker 容器不同。[安装](https://docs.docker.com/ai/sandboxes/install/)、[隔离层](https://docs.docker.com/ai/sandboxes/security/isolation/)。

sbx create 支持无 Host 工作区挂载，而 sbx run 默认使用 cwd；状态保留到显式 remove，各沙箱镜像、包和状态都会占盘。优先无挂载模式并关闭共享 Skill store，不能直接照搬 pi-sbx 的挂载发现流程。[架构](https://docs.docker.com/ai/sandboxes/architecture/)。

文档提供 memory、cpus、skills off；Docker 数据盘与 workspace 大小是不同项，单项大小不是总存储限额。本次未找到直接满足 tasks/TID、严格 CPU quota 与全部存储聚合约束的统一配置。Guest 默认用户有 sudo，Guest 可修改的限制不能当不可提高的边界。[环境配置](https://docs.docker.com/ai/sandboxes/configuration/environment-files/)、[磁盘配置](https://docs.docker.com/ai/sandboxes/configuration/settings/)、[Guest 权限](https://docs.docker.com/ai/sandboxes/security/isolation/)。

SBX 底层只核查官方公开文档，没有取得其实现源码；不把产品文档当底层审计。pi-sbx 扩展实际源码已检查，其 README 要求 SBX 0.48.x；官方文档滚动更新，今后获准适配时须固定安装版本再核对。本轮不安装。

## 正式权限阻断

1. **loader 边界**：工具路由不会拦截未知 Extension 顶层 node:fs、child_process 或 Hook 代码。整个未知模块的导入、初始化与调用必须留在沙箱；官方文档明确区分这两种部署方式。
2. **源码/依赖存储**：本工程 SkillService 的 versions/views、read/草稿/知识视图，以及 VMIsolatedSkillAdapter.open 仍保留并读取 Host 明文原始包。仅替换 exec 后端无效；新增隔离版本 Host 只能取得使用说明和摘要，原包留执行服务。隐藏路径不是修复。
3. **执行服务控制权**：无挂载 VM 解决 Guest→Host 文件访问，不自动阻止 Host→Guest 源码导出。若普通高权限 Host bash 仍能调用同 UID 的 sbx exec、Docker socket 或读取远程 Runtime 凭据/API，就能绕过代理。远程 OpenHands 也须确认调用身份与部署/文件导出/管理身份的真实权限区分；没有该能力就记录阻断，不再自研 Broker 补齐。
4. **兼容性**：不能全局沙箱化旧正式 Extension，不能靠逐次批准 Host 执行补洞。新增版本沿用受限异步 Tool、agent_start 与本能力 tool_call/tool_result；Provider、TUI、同步 Host 回调继续明确拒绝。D2 版本、禁用与回退机制不变。

没有一个所检查 Pi 扩展可原样完成“隔离开发后，正式未知 Skill 自动取得同边界执行”。可复用执行环境和工具适配，不能据此跳过发布权限要求。

## 新任务获准后预计涉及的现有模块

| 模块 | 最小变化 | 判断 |
| --- | --- | --- |
| apps/host/evolution/sandbox/worker.ts、worker-channel.ts | 保留 Pi AgentSession、模型转发与消息语义，运行于供应后端 | 小，不重写 Agent Loop |
| apps/host/evolution/sandbox/native-executor.ts 及执行器注入处 | 供应后端 create/exec/remove/inspect 映射 execute(start, handle, signal)，绑定 Activity | 中；deadline、异常回收取决于后端能力，不继续继承 D3 XPC 实现 |
| apps/host/evolution/sandbox/isolated-skill-adapter.ts | 复用可信 proxy；供应后端运行 Guest Pi worker，替换 VMChannel 和 Host 明文 collect 假设 | 传输小到中；存储/调用授权不是小改动 |
| apps/desktop/native/evolution/vm/skill-worker.mjs | 复用已有受限 Pi runner，部署到成熟镜像 | 小；运行不再依赖自建 VM |
| apps/host/skills/isolated-execution.ts、skills.ts、skill-loader.ts | 沿用一个 SkillVersion；供应后端契约、数据权限和使用说明投影；核查 import/read/views/draft/knowledge/候选/重启 | 中到大，有真实权限阻断，不能只改 loader |
| apps/host/evolution/sandbox/candidate.ts、既有 D4 验收入口 | 消费供应后端真实身份/资源/停止结果，复用篡改、反向权限和版本测试 | 中；Guest finished 不作安全关闭证明 |
| 现有 VM build/prepare、vm-assets.ts、vm-channel.ts、vm-disk.ts | 保留为历史实验，新后端不调用自建链；磁盘删除与镜像管理交供应后端 | 本轮不删、不迁移、不扩建 |

小/中/大按模块与契约影响判断，不是工期承诺。优先复用 pi-sbx operations/transport，避开 TUI、逐次交互审批、Host 例外和 cwd 自动发现；不同时引入三套沙箱生命周期。后端若缺必要权限或不可提高的资源约束，报告不满足，不继续自研基础设施。

## 本轮交付边界

仅新增本评估报告，没有新增 Broker/VM/执行接口，没有大型实验、导入/发布生成候选、改变正式能力或提交 Git。用户 AGENTS.md 修改保留。历史 native broker 建议属于上一阶段，本轮由“停止自研，先评估复用”指令替代；D4 状态不变。
