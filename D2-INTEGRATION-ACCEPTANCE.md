# D2 整体系统集成与最终验收

日期：2026-10-19。基线：`e7c301d5ce675c92c904faea3e1104e76a6cf37b`。本报告及最小修复的版本身份以包含它们的 Git commit 为准。

## 结论

**D2 整体验收通过，满足 DP-04 的 D3 准入条件：数据及能力访问可用。** 最终单次运行于北京时间 10:42:03～10:43:22 完成，退出码 0，机器收据为 `passed`。Reflection、Evolution 及其工作流仍未实施。

结论来自同一个实际文件项目、两个原生 Pi Session、macOS 打包应用和 Chrome 的连续业务活动，以及 Tool 结果、实际文件、SQLite 和加密原始 Entry 的交叉核验。此前三份纵向验收报告继续保留各自范围；本报告补齐它们之间的业务协作验收。

- [真实运行收据](docs/evidence/d2-integration-real-ui.json)
- [自动化、审查及工程检查收据](docs/evidence/d2-integration-checks.json)
- [真实模型驱动脚本](scripts/d2-integration-ui-smoke.ts)、[确定性集成回归](tests/integration.test.ts)、[异步状态浏览器回归](scripts/skills-response-browser-smoke.ts)

## 七阶段执行记录

| 阶段 | 本轮执行 |
| --- | --- |
| 1 设计审查 | 复用 DECISIONS、三份 D2 验收及既定设计；核对 DP-04、RE-08、EQ-01、EQ-07 与 Session/Memory/Diagnostic 所有权 |
| 2 工程检查 | 核查 Git、安装态 Pi 1.3.0、既有 80 项测试及打包入口；保留并行配置和后续 lint/format 修改 |
| 3 工程约束 | 沿用 Pi 原生执行、Session、分支和加密历史；特殊版本审批不继承；诊断不复制完整原文 |
| 4 最小修复 | 修复 Skill 面板过期异步响应覆盖权威状态；未修改 Host、Memory、Diagnostic 服务行为 |
| 5 自动化与独立审查 | 增加一项贯穿生命周期的集成回归；81/81 通过；独立发现、复现、修复并复审 UI 问题 |
| 6 系统集成 | 同一部署资料项目完成下表连续场景，真实模型与最终 macOS 包运行通过 |
| 7 版本交付 | 本报告、机器收据、README、决策及 DP-04 状态更新；按白名单提交，保留并行工作 |

## 连续业务场景与结果

环境：macOS arm64；自动化 Node 26.10.0；Pi 1.3.0；Electron 44.9.0；Chrome 155.0.8059.84；模型 `openai-codex/gpt-6-luna`。使用独立数据目录和临时文件项目，Session A/B 的 cwd 完全一致。Desktop 与 Chrome 使用同一 Host origin。

| 连续环节 | 实际执行及独立断言 | 结果 |
| --- | --- | --- |
| Skill → Agent 任务 | 正式发布普通 `d2-deploy-helper`；A 根据任务发现并读取它，原生 read/write 产出部署回执；诊断记录实际读取的 Skill ID、版本及摘要 | 通过 |
| 任务 → Memory | A 原生 `memory_save` 保存项目决定、通用经验、Global 事实；来源定位到 A 的真实 Entry，诊断保存 Memory 修订引用 | 通过 |
| 跨会话使用 | B 初始消息为空，自主检索并实际写出 A 保存的随机目标值；断言 B 未调用 read/bash 读取项目规格或 A 的完整历史 | 通过 |
| 认识修正与双端冲突 | Chrome 修改为 revision 2；Desktop 用旧基线提交收到 409；两端 UI 显示当前值，B 本轮重新检索并实际改写文件 | 通过 |
| 原生诊断与取证 | B 调用 `diagnostic_search/get/evidence` 定位 A 的真实写文件参数并写出取证文件；Desktop 从 Memory 来源跳转原始 Entry，Chrome 显示共享状态 | 通过 |
| A 回档 → B 适用性 | A 回到知识形成前，决定自动成为 withdrawn revision 3；B 的新搜索排除旧目标并写出无当前要求的结果；通用经验仍可检索 | 通过 |
| 历史事实保留 | 回档前后 Trace/调用事实及原始回执证据保持一致；历史 Entry 明确不在当前选定分支 | 通过 |
| 有效知识更新 | B 读取新的项目资料，以原生 `memory_revise(confirm=true)` 确认同一 Memory；revision 4 的当前 basis 属于 B，A 的原始来源及 1～3 修订保留 | 通过 |
| Host 强杀及双端重连 | 原生 bash 已产生 started 副作用时 SIGKILL Host；两端恢复连接并重读权威状态，任务为 interrupted；等待后 started 仍只有一次 | 通过 |
| 整应用重启与续接 | 关闭 Desktop/Chrome 后重启同一数据目录；正式 Skill、Memory 当前值及四次修订、历史诊断及证据一致；原 B 的 leaf/message count 保留，续接后重新检索当前知识并真实写文件 | 通过 |
| SQLite 数据归属 | 核对 memories 的 revision 4 与四个 memory_revisions 指纹；诊断表无随机业务原文或合成凭据，Host System Log 无合成凭据 | 通过 |

强杀后的受控本地副作用：started=1、completed=1；完成可能来自仍存活的原有子进程，不据此推断应用已知其结果。恢复期间及显式续接后均未重复执行该操作。

### 本次真实运行的关联证据

| 对象 | 标识 |
| --- | --- |
| Session A | `b7c9b0e6-0fda-46c1-b0d6-ee185c8b0849` |
| Session B | `cfc2db37-1186-487b-bc41-265bcc67abf0` |
| A Trace | `0cc30ae8-4279-47cf-af4f-8f96c4a45089` |
| Skill 正式版本 | `987eb7e3-951d-4dcb-a1b2-bd2ccbcac01d` |
| Skill 精确摘要 | `5705f24d705ac6eaaa3c678a38f898c1a9b9723bc44dd18f826df6078b080f78` |
| Memory | `2d0df1a6-5531-46f8-9dc0-48e75edaeb66` |
| 回执原始 Assistant Entry | `3715c3d9`，包含原生 write 参数 |
| 原始证据 SHA-256 | `b0eae74b82b2a253e6b282c57fcf5336e4d707d8decdd80a180feddb208328f9` |
| 强杀 Trace | `2e3d3900-e396-4802-a96e-b9fac38704f5` |

收据还保存实际 ToolCall/Assistant Entry/Result Entry、Memory sources/basis、各文件及 SQLite 修订指纹。重启后原始证据逐字相同；已有调用只允许追加正常的 `recovered:false` 协调注记，其余字段严格相等。最终运行没有异常页面导航，记录的唯一 Host 退出为注入的 SIGKILL。

截图已实际查看：[Desktop 原始证据](release/d2-integration-evidence/desktop-evidence.png)、[Chrome 状态](release/d2-integration-evidence/web-client.png)。它们属于本地忽略产物，不随报告提交。脚本结束后清理自己的临时项目、凭据副本与数据目录；提交的收据只保留关联和指纹，不归档完整对话或凭据。

## 工程检查与自动化回归

| 检查 | 结果及范围 |
| --- | --- |
| `npm test` | 81/81，0 失败，约 12.6 秒；含新增完整集成回归及既有恢复、安全、权限和分支测试 |
| `npm run typecheck` | 通过 |
| `npm run build` | 最终 UI 修复后通过 |
| `npx tsx scripts/skills-response-browser-smoke.ts` | 10 项异步顺序、重连、项目切换及草稿保护场景通过 |
| `npm run test:skills:browser` | 双端冲突、旧缓冲区、未保存退出、精确审查重置、异步导入和权威恢复通过 |
| 四个新增/修改 TS/TSX 文件的 Biome lint/format | 无错误；Skill 面板保留原有两条 warning；格式通过 |
| 全仓 Biome | 初始 lint 16 errors/45 warnings/17 infos、format 14 errors；并行修正后当前 lint 0 errors/45 warnings/17 infos、format 0 errors。并行修正未混入本轮提交 |
| `git diff --check` | 通过 |

标准打包重试遇到 Electron 下载 ETIMEDOUT；使用官方 `@electron/packager` 的 `electronZipDir` 指向已缓存的同版本 ZIP，以原有其余参数完成打包，没有修改产品打包配置。最终实跑使用该包。包内 `index-DqRoawm7.js` 与构建文件一致，SHA-256 为 `a70f01956910475a14b03153c0e316d362270ab84e657b9b1b09a45658a295ef`。

确定性集成用原生 Faux Provider 驱动真实 Pi/Host/SQLite，覆盖未审查特殊版本拒绝、来源修订、全历史与本轮结果区分、独立 B basis 不受 A 再次导航撤销、冷恢复及原 Session 续接。它没有用历史人工批准加载可执行 Package，也没有把 Faux Provider 写成真实模型证据。

复跑命令（需要本机 Pi 授权、打包应用和模型额度）：

```sh
npx tsx scripts/d2-integration-ui-smoke.ts
```

## 独立审查、修复及失败闭合

两个独立上下文分别检查数据/引用/信任边界，以及 UI 权威恢复和崩溃连续性；修复后再次复审，**无剩余 P1/P2 阻断项**。

| 审查方向 | 结论 |
| --- | --- |
| 数据归属和引用 | Pi 加密 Session 保留完整事实；SQLite Memory 保留当前知识及修订；Diagnostic 仅存指标与可追溯引用 |
| Skill 信任 | 正式版本与精确内容、依赖摘要绑定；普通文本发现不授予 Extension 权限；既有审批不扩展到本轮 |
| Memory 跨会话/分支 | 决定依赖来源分支；通用经验保留；重新确认建立新的当前 basis，同时保留原始 provenance |
| Diagnostic 完整性与保护 | 历史事实不随知识撤回删除；Agent 限当前项目；证据直接校验解密快照，不激活历史 Agent；敏感投影先于分页 |
| 恢复和原生连续性 | 既有终态不被恢复覆盖；未知工作标 interrupted 且不重放；原生 Session 的模型、thinking、分支及历史保持连续 |

**真实产品修复：** Skill 面板缺少响应顺序与项目所有权检查，慢响应可在重连后覆盖新目录/详情，旧项目的启用或保存回调也可覆盖当前项目。新增请求/选择代数、项目代数、草稿及响应落地检查；没有重构稳定服务。原实现已动态复现失败，10 项浏览器回归修复后全绿，最后两项旧操作回流另经独立复审。

**验收脚本修正：**

- 用户提供的 Step 7 失败源于遍历 B 的全部 `memory_search` 历史，把回档前合法读取的旧目标当成回档后的新检索；现按 Prompt 前的消息边界断言。当前目录、withdrawn 状态、新搜索及真实输出分别核验，未手动 retire 掩盖联动。
- 修正重复切换已打开 Memory 面板的导航；检索以成功返回当前值并实际使用为准，不要求每次重复调用已无必要的 get。失败 ToolResult 不满足成功断言。
- 独立 Chrome 探针证明，深度 60～150 的对象传输会误报 context destroyed，200～250 报引用链过长；同样数据的 JSON 文本在 20～250 深度全部成功。改为 HTTP 文本传输后在 Node 解析，未修改产品树或恢复机制。
- 冷重启断言只规范化新增的 `recovered:false`；`true`、状态、时间、关联、版本及原文变化仍会失败。
- 此前配额阻断及中途脚本失败均不作为最终通过证据；本次最终收据来自修改后的单次完整运行。

**特殊 Skill 边界：** 用户此前提供的含 `d2-receipt` 的 Step 1～6 输出只作为用户运行记录，不作为本轮独立复核与批准。最终整轮命令不传旧 digest，收据 `specialSkillLoaded=false`。如另行执行可选特殊 Package 路径，必须先独立检查实际文件/依赖/摘要并取得本轮批准，提供匹配摘要和真实审查说明；历史 digest 或脚本内建说明均不能代替人工批准。

## 遗留范围与 D3 准入

D2 当前没有已知阻断问题。D3 可复用正式 Skill、当前知识与修订、诊断查询及受保护原始证据接口；进入 D3 开发仍按原有权限和隔离约束执行。

Windows 实机/AppContainer、签名公证、长期运行与 OAuth 长轮换、大规模历史性能仍未在本轮验证，按 D5 交付边界记录。生成代码隔离、Reflection/Evolution 产品工作流、Provider 缺省与真实零 Usage 的区分及实际账单也未由本轮证明。已进入模型上下文的旧信息不会远程擦除，回档后判断需重新查询当前知识；这次已用 B 的新检索及实际输出验证。

本轮更新 D2 里程碑为完成、D3 准入为满足；没有实施 D3～D5。
