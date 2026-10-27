# D6-A 重跑与输出边界

从仓库根目录运行。不要在原验收目录直接执行会写入 evidence、`.runtime` 或 build 的脚本。顶层 runner 创建当前源码的独立副本，子命令在副本内执行；不是 Git checkout，也不改变用户的未提交工作。

```sh
# 当前真实 Host 业务链路，受控 Provider 指令
node prototypes/d6/acceptance/scripts/run.mjs -- node prototypes/d6/acceptance/scripts/campaign.mjs

# Reflection 分页、成果、环境生命周期及错误反馈
D6_CAMPAIGN_FAMILY=reflection node prototypes/d6/acceptance/scripts/run.mjs -- node prototypes/d6/acceptance/scripts/campaign.mjs

# A/B 只读参考截图比对、当前 A 交互、B 行为回归
node prototypes/d6/acceptance/scripts/run.mjs -- node prototypes/d6/acceptance/scripts/mock-campaign.mjs

# Reflection 针对性串行/并行采样
node prototypes/d6/acceptance/scripts/run.mjs -- node prototypes/d6/acceptance/scripts/reflection-trials.mjs

# 输出隔离：重复、并行、正常终止与强制中断
node prototypes/d6/acceptance/scripts/validate-isolation.mjs

# 本轮 canary 与诊断注入
node prototypes/d6/acceptance/scripts/run.mjs -- node --import tsx --test prototypes/d6/acceptance/tests/*.test.ts
```

完整连续任务 `D6_CAMPAIGN_SCRIPTS=whole-journey` 与真实模型 `D6_CAMPAIGN_SCRIPTS=real-use` 使用同一 campaign，需设置 `AGENT_REFLECTION_APP_BUNDLE` 指向已经签名的同版本 Agent.app。本轮使用仓库既有 `release/post-d5-bugfix-2026-10-22/package/Agent-darwin-arm64/Agent.app`，只读。`D6_REFLECTION_DELAY=86400000` 将受控任务保留到明确 expedite，避免同一个 Faux 队列被后台测试任务提前消费；生产延迟未改变。真实模型脚本通过既有 `/credentials importExisting` 使用已配置 Provider，无 mock fallback。

一个需要共享 Host 状态的批次必须放在**同一个外层 runner** 内。各 npm 命令单独运行会得到不同副本，不能自动读取另一轮的连接文件。campaign 已负责 build、启动专属 Host、等待就绪、执行浏览器脚本与关闭本轮 Host。旧 open/report/browser 单命令需要同一副本中的有效状态，缺失时失败，不借用历史 `.runtime`。不支持向 runner 通过 stdin 传脚本；使用保存的脚本文件或命令参数。

| 命令/资源 | 副作用 | 本轮处理 |
|---|---|---|
| D6-A npm test、check、browser、journey、report、redact、start/open、build | Session/Memory/Skill 数据库、密钥/连接文件、证据、trace/video、dist、端口/子进程、部分报告会修改证据 | npm 包装 + 原目录入口 guard；私有 workspace；按脚本子目录保存批量输出 |
| Vite build | dist 覆盖与配置临时文件 | 在副本执行；`--configLoader native` |
| Pi/npm/Chrome 临时文件 | TMPDIR、npm cache、Node compile cache、浏览器 profile | 指向 run/tmp；完成后移除 |
| Reflection 原生 Worker | OS 管理的 sandbox container 内按 UUID 创建临时目录、原生进程及系统日志 | 既有 Bridge 生命周期清理；不写正式 Host 用户数据；未把该 OS 临时目录误算成 run/workspace 内文件 |
| node_modules | 两处依赖目录 symlink 只供复用 | 不复制或修改依赖；inventory 不遍历共享依赖树，不能声称全机器无副作用或 OS 隔离 |
| 原 mock 参考 PNG | 比对基线只读访问原 `capability-integration/evidence/before/` 六张图 | 新截图另存；不重新批准基线 |
| 真实 Provider | 正常模型请求、token 使用；凭据导入写入测试加密 Vault | 只在专用测试 Host，经产品 API；Vault 不导出，随临时工作区清理 |
| 既有服务与产品数据 | 不能借用、清理或停止 | 本轮服务动态端口；仅关闭自己启动的进程 |

每轮目录下：

- `source-before.json` / `source-after.json`：源码、ignored evidence/runtime/build 的文件哈希；包含范围见 `isolation.mjs`。包源码从当前版本起也在覆盖范围内。
- `run.json` / `receipt.json` / `command.log`：运行状态、命令、退出码/信号、原目录变化及输出；receipt 不等于每个内部测试都执行，需读具体命令与结果。
- `evidence/<模块相对路径>/<批次子目录>/`：本轮证据，和原目录验收证据分开。
- `output-inventory.json`：临时产品数据、运行证据和源码/构建分类。原始数据库及连接文件不导出。
- `redaction.json`：文本和 zip 中连接值脱敏及 zip 完整性检查；视频/PNG 不显示连接字段，不能把这一检查说成对任意未知秘密的扫描证明。
- `workspace/`、`tmp/`：正常完成后移除；`D6_KEEP_WORKSPACE=1` 可明确保留私有调试数据，不应作为交付公开。

归档只合并目录，文件以 COPYFILE_EXCL 写入；已存在同名证据会报错，不覆盖。批量浏览器脚本通过 `D6_EVIDENCE_SUBDIR` 分开结果、截图和录像。SIGKILL 无法执行清理，私有不完整目录可以保留；确认子进程退出后再导出、脱敏和清理**该轮自己创建的临时工作区**，不得删除历史验收证据。

本轮的范围检查覆盖指定源码/证据/运行目录及可识别的副作用类别，不是全盘文件监控，也不是对任意 shell 命令的 OS 沙箱。`dev` 等交互式开发服务不作为验收入口；使用上述 campaign 验证当前构建。
