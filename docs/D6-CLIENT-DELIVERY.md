# D6 正式客户端交付

2026-10-29。依据用户对 D6-A「会话书桌」的最终确认和正式实施授权。

## 运行

macOS arm64 应用：`release/d6-client-final/Agent-darwin-arm64/Agent.app`。正式 Web 构建：`dist/web`。

```sh
open release/d6-client-final/Agent-darwin-arm64/Agent.app
```

源码启动仍为 `npm run build && npm run desktop`。独立 Web 的密钥、令牌和启动方式见 [README](../README.md#独立-web)。桌面菜单“在浏览器打开”连接同一个 Host。

当前已打开的应用使用 `release/d6-client-review/runtime/` 独立验收数据；没有迁移或覆盖原有用户数据。直接正常启动应用仍沿用既有数据目录规则。

## 实施范围

正式 React 项目按应用协调、共享内容组件和业务功能组织，复用 D6-A 的真实 Host 适配、组件、样式与交互。正式入口不依赖实验目录或模拟业务数据。

| 操作 | 正式整合内容 |
|---|---|
| 会话 | 导航、项目上下文、流式回复、悬浮输入、停止、文件/Skill 引用、模型/推理设置 |
| 回溯 | Tool 结果、轨迹、精确来源、原生只读历史、分支、压缩、受保护的导出 |
| Memory | 项目/全局检索、新建/修订、适用性操作、指定旧修订和来源 |
| Reflection | 后台工作状态、反思结果、关联变化、任务和证据阅读 |
| Skill/Tool | 候选与协助编辑、精确审查、发布、启停、版本及知识修订 |
| Evolution/Activity | 建议、独立讨论、明确授权、开发状态与结果 |
| 设置 | 复用 Provider、OAuth、API Key、Pi 授权副本导入和连接恢复 |

Desktop 加载相同 Web 构建，保留原生菜单、系统密钥保护、后台运行和恢复。`apps/host`、`apps/desktop` 源码无修改；没有新增执行系统、业务数据库或 D4 沙箱/VM 门槛。

## 发现并修复

| 问题 | 结果 |
|---|---|
| 文件目录与搜索关键词混用 | 目录位置独立显示；当前目录内搜索，导航时清空关键词 |
| 文本文件引用漏传 | 与选中文件合并去重，经既有 Host 读取权限处理，保留 8 文件上限 |
| Skill 命令追加末尾后 Pi 不展开 | 放在草稿开头，保留正文，重新选择时替换原前缀 |
| 切会话丢失提交状态或错误 | 按会话保留待提交状态、错误与草稿；未知结果提示先核对记录 |
| Host 队列/恢复错误不显示 | 恢复全局反馈与会话能力恢复入口 |
| 新建响应迟到抢占导航 | 原位置和创建对话框仍有效时才自动进入 |
| 候选协助编辑入口遗漏 | 准备既有候选目录后进入会话草稿，不自动发送 |
| Memory 搜索词写入 URL/存储 | 仅页面内存保留；返回可恢复，刷新清空，对象和修订位置仍恢复 |
| 会话样式隐式依赖实验入口 | 正式入口显式加载视口样式，保留悬浮输入和阅读滚动 |

## 验证

日志和视觉证据位于 `release/d6-client-review/`，原有材料保留。

- **真实模型与正式签名应用**：`openai-codex/gpt-6-luna` 原生文件写入/读取、关闭窗口后台执行、Web/Desktop 同会话多轮、敏感内容保护及导出、执行中 Host 崩溃重连、应用重开且不重放工具副作用。沿用并适配 `scripts/ui-smoke.ts`。见 `real-ui-result.json`；原始 `real-ui-smoke.log` 保留了旧进程错误和并行输出，提取 JSON 来自实际完成最终断言的运行。
- **实际桌面操作**：最终包创建并读取 `welcome.md`，保存项目记忆，菜单打开浏览器后读取同一会话。会话 `a06ba2ef-6870-4abf-829e-1c21fcf8067f`，记忆 `910ae728-103f-4279-ae8a-b6c05ae18ab3`。同轮此前完成的记忆第 2 版修订截图 `desktop-memory.png` 保留。
- **原生 Reflection**：任务后实际完成后台反思，正式 UI 读取结果并沿证据打开对应 `read` 返回。记录 `d5209fa3-ee4a-471d-af9d-59664b7e4e50`，来源 Entry `9fe47cd5`，见 `reflection-source-final.png`。本次没有强求额外知识或建议产出。
- **隔离 Host 的 UI 回归**：文字文件引用进入受控 Provider、草稿切换、目录/搜索、原生只读历史/轨迹、Memory 创建/修订/指定旧版、查询持久化边界、延迟提交失败、Skill 候选发布/知识修订/命令前缀、建议讨论和用户授权 Activity。见 `scripts/d6-client-smoke.ts`、`client-smoke.log`。受控 Activity 不作为真实模型自主开发新能力成功的证明。
- **响应式与键盘**：1440px 正常工作路径；850px、390px 实际操作会话悬浮输入和文件选择，390px 经移动导航进入会话，无横向溢出，关闭对话框恢复触发器焦点。Memory 阅读与设置路径均检查。
- **认证与桌面生命周期**：刷新认证、跨端口凭据隔离、失效认证返回、会话切换竞态；实际应用关闭窗口保留 Host、Host 重启重连、应用重开、随包运行时与候选依赖获取。见 `browser-smoke.log`、`desktop-signed-smoke.log`。
- **业务回归**：轨迹、输入资源、Memory、Reflection、Evolution 的 40 项相关测试通过，见 `business-tests.log`。
- **工程**：类型、lint、格式及正式构建通过；lint 仍有仓库警告。Apple Development 签名和 `codesign --verify --deep --strict` 通过。应用内 Web 构建与 `dist/web` 一致。对应日志保留。

视觉证据：[会话](../release/d6-client-review/desktop-session-final.png)、[记忆](../release/d6-client-review/desktop-memory-final.png)、[反思来源](../release/d6-client-review/reflection-source-final.png)。最终视觉与长期使用体验由用户判断。

## 限制

- Reflection 原始偶发失败仍未定位；本次真实成功不代表历史问题已修复，未启动架构改造。
- 本轮未重做真实模型自主开发新 Tool 并自动发布的完整 D4 验收；验证了正式 UI 的讨论、授权和 Activity，并复用业务回归。
- 实机范围为 macOS arm64。原生备份/恢复菜单保留，本轮未重新执行恢复操作；没有新增 Windows、公证或自动更新要求。
- Vite 报告约 782 kB 的单一压缩 JS chunk 体积提示，未据此扩展性能重构。
- 工作区缺少 `DECISIONS.md`；实施前读取 `3350478:DECISIONS.md` 和现有有效规划，未恢复已删除文件。2026-11-05 已按该版本重建精简索引。

改动留在工作区，未提交、未推送。
