# D1 工程验收报告

## 结论

D1 已完成约定的 macOS 端到端验收，可以进入 D2。工程回归证据沿用原报告；真实模型补充结果由用户在本轮明确提供：`openai-codex/gpt-6-luna`，`npm run test:ui` 退出码为 0。本次归档不重新执行已有充分证据的验证。

仓库未单独保存该次成功运行的 stdout、退出码 receipt 或打包产物摘要；这里明确记录结果来源，不声称本次归档重新运行过验收。

## 环境与正式基线

- 验收日期：2026-10-18；macOS / arm64。
- Node.js 26.10.0、npm 11.19.1、TypeScript 7.0.2、Pi SDK 1.3.0、Electron 44.9.0。
- 修复前本地提交：`532010f`（`chore: establish D1 development baseline`）。
- 修复后本地提交：`0047231c50fe4ba4566ccd26654e2081d19215f3`（`fix: close D1 authentication and recovery gaps`）。
- 未创建额外分支、未推送。源码、设计与历史实验经明确清单审查后入库；本轮没有修改 `docs/` 或 `experiments/`。
- `.gitignore` 排除环境文件、凭证和密钥、加密运行数据、SQLite、锁、临时文件、依赖及构建与发布产物。打包根目录采用允许清单，仅包含 `dist`、生产依赖、`package.json` 与 `README.md`。

## 实际修复

| 问题 | 修复及边界 |
|---|---|
| Cookie 认证可在本机其他端口泄露并复用 | 移除 Cookie 认证；HTTP Bearer；浏览器令牌保存在 Host origin 的 sessionStorage；WebSocket 首帧认证，认证前不发送业务事件，检查 Host/Origin，限制等待时间和消息大小。认证失效清除客户端状态，返回连接界面。 |
| 流式思考、工具参数和嵌套字段泄露已知凭据前缀 | 保护累计消息中的有效载荷；统一常见敏感字段，处理嵌套值及带空格、换行的引号密码。模型请求、客户端事件、历史和导出使用保护副本，原始 Tool 参数及加密 Pi 历史不被改写。必要检查失败拒绝传播，不回退原文。 |
| 最新检查点损坏会阻断全部会话 | 保留当前与上一有效加密检查点；验证并回退，提示进度损失和未知副作用。坏会话单独不可用，健康会话继续使用；原损坏证据保留。全部检查点不可用或凭据库不能解密时拒绝启动，不建立空库冒充恢复。 |
| message_end 时原生条目尚未追加，检查点可能缺少 Tool 结果 | 在 Pi 原生同步追加结束后排队取得匹配的 entries/leafId；关闭等待运行、检查点及写入队列，不手工追加消息、不修改 Pi Core。busy 在最终保存完成后才结束。 |
| 分支或模型操作保存失败仍可继续修改，关闭可漏清理 | 保存失败标记会话故障，拒绝后续修改；逐个释放会话，最终释放数据库、连接和服务器；退出保存失败返回非零状态。 |
| 快速切换会话时旧响应覆盖新选择 | 以当前选择和请求序次校验响应；重连刷新遵守当前选择；流式事件与错误只更新所属会话。 |
| 超大 WebSocket 消息可能产生未处理错误 | 处理连接错误并关闭违规连接，Host 继续提供服务。 |

未增加自动续跑或副作用重放，不开发 D2～D5，不重构原生 Agent Loop、Tool Calling、Session 或 Compaction。

## 本轮已通过

| 检查 | 实际结果 |
|---|---|
| `npm run typecheck` | 通过，覆盖 Host、Desktop、Web、测试和验收脚本。 |
| `npm test` | 19/19，通过；原有 8 项及新增 11 项回归。 |
| `npm run build` / `npm run package:desktop` | 通过，生成当前 macOS arm64 应用。 |
| `npm run test:browser` | 实际 Chrome 通过：刷新认证、不同本机端口无认证泄露、逆序会话响应隔离、无效认证回连接页。使用 Faux Provider，不作为真实模型证据。 |
| `npm run test:desktop` | 实际打包 Agent.app 通过：隔离 renderer、独立 Utility Host、关窗继续运行、杀死 Host 后重启和客户端重连、退出应用后重新打开空会话、打包内容允许清单。未调用 LLM。 |
| `npm run test:ui` | 用户补充验收：macOS 打包应用、真实模型 `openai-codex/gpt-6-luna`，退出码 0；覆盖内容见下节。 |
| Git 和范围检查 | 差异空白检查通过；设计和历史实验未改动；提交候选不含运行数据、实际凭证或构建产物。 |

自动化覆盖：

- HTTP/WebSocket 正常认证与拒绝，Host/Origin 检查、首帧前事件阻断、认证超时及超大帧处理。
- 每帧思考与 Tool 参数中的已知凭据前缀、嵌套敏感值、常见格式、异常文本；模型请求、客户端、历史和导出保护；检查失败拒绝；原始执行参数保持不变。
- 加密快照篡改、截断、错误密钥、上一有效检查点恢复、坏会话隔离、无有效检查点拒绝及损坏证据保留。
- 原生 Tool 完成而下一次模型请求未完成时的检查点；实际子进程 SIGKILL 后恢复已提交 Tool 结果，不发起模型请求或重放副作用。该测试使用 Faux Provider。
- 分支与非末尾 leaf、原生 Compaction、停止、模型错误重试、多会话并行、保存失败后的拒绝及完整关闭。

## 真实模型补充验收

此前首轮曾因 `401 / refresh_token_reused` 失败；该历史阻塞已由用户补充的成功验收解除，不再作为 D2 准入阻塞。

`test:ui` 启动已有打包 Agent.app，通过 UI 导入本机 Pi 授权，使用 `openai-codex/gpt-6-luna`。按 `scripts/ui-smoke.ts` 的成功断言，覆盖：

1. Renderer 不暴露 Node.js；真实模型使用原生 write/read，关窗后 Host 继续工作。
2. Chrome 与桌面共用同一 Session，多轮继续；指定敏感样例在界面和导出中受保护，导出明确不可恢复。
3. 原生 bash 执行中 SIGKILL Host，Host 重建，双端重连并显示中断，不自动重放未知副作用。
4. 退出应用后重新打开同一 Session；用户明确发起下一步 read 后继续，先前文件不因恢复被重放修改。

脚本清理临时用户数据和工作目录。不提交凭据或模型原始日志；本轮未另行执行 `npm run test:real`。

## 未验证与 D2 准入

| 项目 | 状态及影响 |
|---|---|
| OAuth 长期轮换 | 本次覆盖有效授权导入及实际调用，未验证跨 access-token 到期的长期 refresh-token 轮换、反复刷新、撤销及重新授权。 |
| Windows 实机 / AppContainer | 未验证；macOS 结果不能外推。生成代码隔离也未在 D1 实现。 |
| 正式签名与公证 | 未验证；当前本地打包回归不代表正式发行验收。 |
| 任意敏感格式、多解释器、完整数据传播、迁移恢复、压力及长期运行 | 未完成完整验收；本轮只覆盖报告列出的本地回归，保留既定后续阶段边界。 |

D1 的约定 macOS 验收已完成，D2 可以启动。该结论不代表 Windows、正式发行及完整安全与长期运行验收完成。

## 启动与复验

从源码：`npm ci` → `npm run build` → `npm run desktop`。独立 Web 的密钥、令牌和启动方式见 [README](README.md)。

macOS 应用：`release/Agent-darwin-arm64/Agent.app`；重新打包使用 `npm run package:desktop`。`test:ui` 使用该产物，源码修改后应先重新打包；可通过 `AGENT_APP_PATH` 指定其他已有应用。

需要复验相关行为时执行 `npm run test:ui`；需要进一步定位独立 Host 真实模型通道时使用 `npm run test:real`。两者均可能产生真实模型使用量，仅在临时工作目录操作。
