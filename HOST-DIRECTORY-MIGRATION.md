# 按业务能力组织目录：迁移与验收

日期：2026-10-19。基线：`5d0f77e`；开始时工作区与暂存区均为空。本轮只迁移目录、更新必要引用与资源定位、分离 Web 挂载入口，并补充迁移验收。Pi 原生机制、Host 进程边界、HTTP/WebSocket、持久化格式与业务规则保持，不开发 D3。

依据：DECISIONS、HOST-ARCHITECTURE-REVIEW、SA-02、SA-08、DP-02/03、TD-04。既有实验、架构治理报告及 D2 验收收据未修改。

## 结构与文件归属

迁移前，Host 的 20 个 TypeScript 文件全部平铺；Web 的 App、React 挂载与三个领域面板位于同一层。迁移后，19 个 Host 文件和 4 个 Web 文件通过 `git mv` 移动，新增 Web `main.tsx` 只负责挂载原 App。

```text
迁移前                                  迁移后
apps/host/                              apps/host/
  main.ts                                 main.ts / package.json
  agent.ts / session-routes.ts              runtime/
  server.ts / http.ts                       transport/
  skills.ts / skill-*.ts                    skills/
  memory*.ts                               memory/
  diagnostic*.ts                           diagnostics/
  storage.ts                               storage/
apps/web/src/                           apps/web/src/
  main.tsx（App + 挂载）                    main.tsx + app/App.tsx
  skills.tsx                               features/skills/SkillsPanel.tsx
  memory.tsx                               features/memory/MemoryPanel.tsx
  diagnostics.tsx                          features/diagnostics/DiagnosticsPanel.tsx
  style.css                                style.css
```

| Host 目标目录 | 从原根目录迁入的文件 | 保留的职责 |
|---|---|---|
| `runtime/` | `agent.ts`、`session-routes.ts` | Agent/Session、屏障、FIFO、检查点及跨领域提交/回退协调 |
| `transport/` | `server.ts`、`http.ts` | 认证、Origin、安全响应、HTTP/WebSocket 生命周期、静态资源和编解码 |
| `skills/` | `skills.ts`、`skill-acquire.ts`、`skill-dependencies.ts`、`skill-discovery.ts`、`skill-loader.ts`、`skill-routes.ts` | Skill 管理/API、获取、发现、依赖/信任与 Pi 原生资源加载 |
| `memory/` | `memory.ts`、`memory-routes.ts`、`memory-tools.ts` | 修订、作用域、检索、来源分支适用性、领域 API/Tools |
| `diagnostics/` | `diagnostics.ts`、`diagnostic-history.ts`、`diagnostic-resources.ts`、`diagnostic-routes.ts`、`diagnostic-tools.ts` | 采集、索引、历史证据、资源关联、领域 API/Tools |
| `storage/` | `storage.ts` | 加密、Pi Session 快照和 SensitiveData 整体迁入 |

Web 保留 App 连接/会话协调及原 API/回调注入，领域面板只改位置和引用。不拆 JSX、Hooks、样式，不增加空目录、barrel、兼容转发、DI 容器或共享契约层。当前结构说明已同步至 [DP-02](docs/08-交付规划/DP-02-正式项目结构与开发任务管理.md#当前实现目录) 和 README。

## 依赖与路径检查

[依赖收据](docs/evidence/directory-migration-dependencies.json)记录完整 Host 文件映射、48 条应用静态相对导入边和动态路径检查。运行时文件循环 0，包含类型引用的文件循环 0，缺失相对模块 0。全部 20 个 Host 源文件与基线比较，除模块导入和 Server Web 定位外内容完全一致；独立上下文亦逐文件复核。

运行协调依赖领域服务；领域服务不依赖活动 Agent。路由沿用现有 `Pick<AgentService, ...>` 类型约束；Diagnostic 历史读取仍注入只读检查点能力。Diagnostic 资源关联保留结构化 Skill 来源类型。`transport/server → 领域路由 → transport/http` 是入口适配器与底层编解码的不同文件依赖；目录聚合有双向边，不将目录图宣称为严格 DAG。

| 定位项 | 处理及证据 |
|---|---|
| NodeNext | Host 相对导入保留 `.js`；源码、测试、fixtures、脚本和 Web 类型引用同步更新 |
| Web 根 | Server 下移后改为 `../../web/`，编译后仍访问 `dist/web`；实际 Desktop 页面加载通过 |
| 获取子进程 | Service 与 `skill-acquire.ts` 同迁，保留相邻 `.js` 与源码 `.ts` fallback；包内获取实跑通过 |
| SDK 身份 | `import.meta.resolve` 继续解析安装/随包依赖，未改变身份计算 |
| Electron | `dist/host/main.js`、`dist/desktop/main.js` 与 Main 的 `../host/main.js` 保持，生命周期代码未改 |
| fixtures | 未移动，原 `new URL(..., import.meta.url)` 子进程定位保持 |
| 旧编译输出 | 构建前定向清理生成的 `dist/host`；新包断言根目录仅 `main.js` 和六个职责目录，无旧平铺 `.js` |

`tsc` 不自动删除被迁移源码的旧输出。本轮已实际清理并验证最终包，不为一次迁移改造构建框架。

## 工程及客户端验证

以下均为迁移后重新执行结果，[工程检查收据](docs/evidence/directory-migration-checks.json)保存命令日志摘要、客户端结果与包内 JS 哈希，原始日志位于 `release/directory-migration/checks/`。

| 检查 | 结果 |
|---|---|
| `npm test` | 84/84，通过；包含发布屏障/回退、Session、Memory 分支与 Diagnostic 历史证据 |
| `npm run typecheck` | 通过，包含 Host/Desktop、Web、scripts/tests |
| `npm run lint` | 0 errors；既有 44 warnings、17 infos 与基线一致 |
| `npm run format:check` | 通过；仅格式化引用变长或本轮实际修改的选定文件 |
| `npm run build` | TypeScript 与 Vite 通过 |
| `git diff --check` | 通过 |
| `npm run test:browser` | 认证隔离、刷新、Session 选择竞争、失效认证通过 |
| `npm run test:skills:browser` | 双端冲突、草稿保护、审查重置、异步导入、重连及发布/禁用通过 |
| `npx tsx scripts/memory-browser-smoke.ts` | 创建、写入期间交互、作用域/访问变化及草稿恢复通过 |
| `npx tsx scripts/skills-response-browser-smoke.ts` | 10 项响应顺序、重连、项目切换及旧响应场景通过 |
| macOS 打包与 `npm run test:desktop` | 独立 Host、随包运行时、关闭窗口后台运行、强杀后重连、退出及冷启动恢复通过 |
| 编译获取子进程 | 包内经 `POST /api/skills` 导入本地 npm tarball 成功；锁文件可读取，postinstall marker 不存在 |
| 普通 Skill 真实模型 | Desktop + Chrome 的原生发现/读取、双端启停、原 Session、重连及未审查特殊候选拒绝通过 |

打包使用 `AGENT_PACKAGE_OUT=release/directory-migration/package`，默认仍输出 `release`，原有应用包保留。实际新包为 `release/directory-migration/package/Agent-darwin-arm64/Agent.app`；测试通过 `AGENT_APP_PATH` 指向该包。普通 Skill 脚本新增可选 `AGENT_SKILL_EVIDENCE_DIR`，本轮收据与截图位于 `release/directory-migration/skills/`，默认目录保持。

包内 Web 与本轮构建一致：`index-C-dX_bFk.js` 的 SHA-256 为 `ba910728b0a1d0bc7e88ffa6fdd2178feb30eb97fb448a12216a13b2f6a42ac9`，CSS 为 `90a750ddda03ee6b42be366b810cd0079975b35c756ed8181b98a87d9bbea9b2`。

特殊 Skill 未进行本轮真实模型执行，未复用历史人工批准。其摘要、原生 Extension/Tool 加载、间接调用禁用、发布/回退及重启状态由本轮 84 项确定性测试覆盖；普通 Skill 收据中的特殊版本相关 `false` 字段原样保留。

## 连续集成场景的失败与取证

首次真实 D2 连续运行在跨 Session 阶段失败，断言为 `Search must actually return the saved deployment target`。首个 Session 的 Skill、知识保存和诊断关联已通过，但首次收据未保存失败阶段的完整 Tool 请求/结果，不能据此判定根因或归因于目录迁移。失败收据保存在 [attempt1](docs/evidence/directory-migration-real-ui-attempt1.json)。

为定位该失败，验收脚本增加一项收据字段，在断言前保存受保护的 Session B 消息。测试 Prompt、断言和产品实现未改，未以放宽条件替代通过。

第二次完整运行于北京时间 **16:23:48～16:26:37** 通过，退出码 0，[真实连续场景收据](docs/evidence/directory-migration-real-ui.json)为 `passed`。环境为 macOS arm64、Node 26.10.0、Electron 44.9.0、Pi 1.3.0、Chrome 155.0.8059.84，模型 `openai-codex/gpt-6-luna`，Desktop 与 Chrome 共用新包启动的 Host。

本次 Session B 先使用长语句查询，随后改用 `deployment target` 查询成功取回目标，再查询三角形事实；收据保留原生消息及 Tool 返回。本次全部 9 个连续步骤通过：Skill 与来源 Memory、跨 Session 使用、修订与双端冲突、Diagnostic 自主取证、分支回档撤销、新依据确认、强杀重连、完全重启续接，以及 SQLite 数据所有权检查。Tool 错误为 0；预期的 Host `killed / exitCode 9` 与恢复结果均记录。首次失败缺少同等取证，根因仍未确定，不将通过复验描述为修复了某个业务缺陷。

| 关联对象 | 本次实际标识 |
|---|---|
| Session A | `607ba839-adf7-4d6f-b5c7-1a3458e2b076` |
| Session B | `eb2a23c4-35fc-4888-a782-04e16c9097ea` |
| 初始 Trace | `8cd78739-1536-4724-a5ab-bae4416ee61d` |
| 被修订 Memory | `c9c7e890-06b3-4a03-8c53-ee318b94c671` |

截图位于 `release/directory-migration/integration/`，已查看普通 Skill 与 Diagnostic 原始证据界面。脚本结束后清理临时项目、数据目录和测试实例；新包和本轮证据作为交付保留。

复现本轮包与运行检查时，先清理旧 Host 编译输出，再执行：

```sh
AGENT_PACKAGE_OUT=release/directory-migration/package npm run package:desktop
export AGENT_APP_PATH="$PWD/release/directory-migration/package/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent"
npm run test:desktop
AGENT_SKILL_EVIDENCE_DIR=release/directory-migration/skills npm run test:skills:ui
AGENT_ACCEPTANCE_EVIDENCE=docs/evidence/directory-migration-real-ui.json \
AGENT_ACCEPTANCE_SCREENSHOTS=release/directory-migration/integration \
npx tsx scripts/d2-integration-ui-smoke.ts
```

真实模型检查需要有效本机 Pi 授权。本轮未传特殊 Skill 人工批准相关环境变量，历史批准不作为本轮批准。

## 独立审查与交付

独立上下文对照 `5d0f77e` 复核全部迁移文件、依赖、动态路径、前端入口、验收脚本、报告与收据，未发现 P1/P2 或其他必须修复项。审查还逐项核对了工程日志 SHA-256、包内全部 JS 哈希、真实收据的 9 个通过步骤及报告链接；静态审查结论与本轮实际运行证据分别记录，没有以审查代替实测。

本轮提交仅包含目录迁移、必要的验收脚本调整、目录说明与本轮证据；不推送。新增 Web App 与缩小后的同名入口可用 `git diff -B -M` 辅助查看整段代码移动。无兼容旧内部路径的转发文件，无数据库、SDK、Electron Main 或历史实验修改。
