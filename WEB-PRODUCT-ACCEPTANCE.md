# Web 产品完善与验收记录

日期：2026-10-20；基线：`f07e432`。本轮实现 Web 优先产品完善，不推送。Web 继续作为独立 Host 的客户端，Pi 负责 Agent Loop、工具与原生 Session。

**实现和 Web 验证完成；整体双端验收尚未完成。** 打包成功，但本轮 Desktop 启动停在系统钥匙串访问，未能进入窗口，不能据此声称关窗后台运行或 Desktop/Web 业务操作通过。D3 真实受限 XPC 隔离验收继续 **blocked**。

## 差距与实际修改

| 模块 | 原有差距 | 本轮结果 |
| --- | --- | --- |
| 连接入口 | 网络失败被当作认证失效；状态与下一步不清楚 | 显示 Host 地址、令牌说明；区分连接、同步、断线、401、403。网络故障保留令牌，权威同步后开放写操作；旧请求不能清除新令牌。 |
| 对话和 Session | 管理页面遮住导航目标；共享草稿；失败覆盖其他会话输入；重连缺少流式消息 | 单一主视图；会话内存草稿及版本绑定；防重复提交；结果不确定时读取状态并提示，不自动重发。Tool 参数与结果折叠，恢复当前轮未完成 Tool 阶段；历史阅读位置和新内容入口。 |
| Skill | 文件编辑器承担阅读；重要信息混杂；窄屏难用 | 默认 Markdown 说明，明确进入编辑；用途、正式/候选、启用状态优先，版本、知识历史、审查、依赖和 Hooks 分层展开；沿用精确摘要人工批准。 |
| Memory | 来源修订号丢失；历史实际显示当前正文 | 精确定位指定修订；历史只读；不存在的修订明确提示；当前编辑操作与历史阅读分开。恢复作用域、选择、修订及分页。 |
| Diagnostic | 密集元数据和原始证据同时铺开 | 执行摘要优先；Tool/状态筛选保留，时间与关联 ID 折叠，过程、指标、来源证据逐层展开；保留采集缺失和检查点语义。 |
| Reflection | 环境、任务、结果易混淆；来源跳转不完整 | 环境可用性、任务及历史分开；保留阻塞原因；Memory/Skill 修订与 Reflection 原对象可定位；重新检查不生成虚假成功。 |
| 进化建议 | 缺少已有项目/会话筛选接入；来源不能准确定位 | 状态与项目/会话筛选、逐项讨论及批量忽略/归档保留；三类知识来源定位；详情切换清除旧对象。 |
| 模型设置 | 依附对话，管理页操作不可见 | 独立主视图；保存、导入、等待、失败反馈留在本页；重复打开不丢失返回位置。 |

所有模块沿用业务目录。浅色中性背景和绿色强调，系统中文字体；技术标识与原始证据使用等宽。桌面侧栏加列表/详情，窄屏折叠导航并在列表/详情间切换。统一 Markdown 使用 `react-markdown@10.1.0`、`remark-gfm@4.0.1`，禁用原始 HTML，保留默认 URL 安全处理，外部图片仅显示引用文字。

## 状态契约与边界

Session 响应新增 `stateVersion`、`streamingMessage`，更新事件携带递增版本。Host 对完整消息与受保护流式消息形成同一瞬时客户端投影，避免 Pi 内部状态先变化、Extension 公开事件尚未通知时产生不一致快照。空会话持久化并激活后广播现有 state 事件。

客户端先取得快照基线，再应用更新缓冲；连接代数、选择代数和版本阻止旧 HTTP、旧连接及旧缓冲覆盖当前状态。重启重新建立进程内版本基线，不新增持久化历史。列表合并保护期间收到的新会话和新状态。

当前 origin 的 sessionStorage 仅保存导航、对象/修订 ID、枚举筛选和分页等位置元数据；正文、自由文本检索和草稿不写入持久存储。所有页面入口共用未保存修改保护。不同会话的提交结果和失败反馈绑定原目标，不能覆盖另一会话草稿。

未修改 SQLite schema、认证权限、凭据加密、Reflection 执行路径或 XPC 隔离边界；未增加浏览器 Agent Loop、远程部署平台或 D4 能力。

## 自动化和真实 Host 证据

基线 125 passed / 1 skipped；本轮全量 **132 passed / 1 skipped（133 total）**。

| 检查 | 结果与范围 |
| --- | --- |
| `npm test` | 通过；新增版本回放、流式恢复、Markdown 安全、Tool 阶段、并行调用与历史中断调用、空会话广播及 Extension 延迟窗口断言。 |
| `npm run typecheck` | 通过。 |
| `npm run lint` | 退出 0；52 warnings、27 infos；仓库原有提示仍存在，非零提示数量不等于检查失败。 |
| `npm run format:check` | 通过。 |
| `npm run build` | 通过；Web 主 JS 约 530 kB / gzip 157 kB，仍有超过 500 kB 的构建提示。 |
| `npm run package:desktop` | 通过，输出本机 arm64 应用；打包成功不代表 Desktop 运行验收通过。 |
| `npm run test:browser` | 通过：刷新认证、跨端口凭据隔离、选择竞态、无效令牌。 |
| `npm run test:skills:browser` | 通过：双端冲突、未保存保护、精确审查、异步导入、重连、发布/禁用。 |
| `scripts/memory-browser-smoke.ts` | Web 创建、异步作用域和草稿恢复回归，详见检查收据。 |
| `scripts/skills-response-browser-smoke.ts` | 10 项响应顺序、重连、项目切换和卸载回归，详见检查收据。 |
| `scripts/web-product-browser-smoke.ts` | 真实 Host + 确定性 Faux，仅用于机制回归：10 组检查及 89 张截图；不作为 Reflection 正式验收。 |
| `npm run test:real` | 真实 Provider 原生 write/read 及加密重启恢复通过。 |
| `scripts/web-product-real-smoke.ts` | 真实 Chrome + Host + openai-codex/gpt-6-luna：文件任务、原生 ToolResult、Diagnostic 检查点原始证据、重启恢复、Reflection waiting_user 持久化通过。 |

[浏览器收据](docs/evidence/web-product-browser.json)、[真实 Provider 收据](docs/evidence/web-product-real.json)、[Desktop 未通过收据](docs/evidence/web-product-desktop.json)、[检查汇总](docs/evidence/web-product-checks.json)、[命令输出](docs/evidence/web-product-validation.txt)。真实任务的 `traceId`、`resultEntryId`、Reflection source marker 均保存在独立收据中；临时项目测试结束后清理，不把测试数据写入用户项目。

## 视觉检查

实际渲染 1440、1024、768、390 宽度：七个主模块正常/长内容、连接入口，以及五个管理模块的加载、失败和空状态，共 89 张。完整原图由脚本输出到 `release/web-product-browser/`；提交保留四组模块总览、三组状态总览及关键原图。[截图 SHA-256 清单](docs/evidence/web-product-ui-manifest.json)对应本轮实际原图。

- [1440 总览](docs/evidence/web-product-ui/modules-1440.jpg)、[1024](docs/evidence/web-product-ui/modules-1024.jpg)、[768](docs/evidence/web-product-ui/modules-768.jpg)、[390](docs/evidence/web-product-ui/modules-390.jpg)
- [加载](docs/evidence/web-product-ui/loading.jpg)、[失败](docs/evidence/web-product-ui/error.jpg)、[空状态](docs/evidence/web-product-ui/empty.jpg)
- [独立连接](docs/evidence/web-product-ui/connect-1440.png)、[Skill 阅读](docs/evidence/web-product-ui/skills-1440.png)、[Memory 历史修订窄屏](docs/evidence/web-product-ui/memory-390.png)

渲染审查修正了说明阅读中暴露保存操作、Skill frontmatter 干扰阅读、窄屏分支控件及来源详情不可见等问题。截图来自真实 UI，机制测试中的示例内容不代表模型正式评估结果。

## 独立审查

独立审查覆盖交互、状态一致性、隔离边界和维护性。发现并关闭：非活动 Session 缺少版本、迟到请求拉回旧视图、旧 401 清除新令牌、恢复对象 404 丢失提示、设置返回循环、旧 A 404 清空新 B、生成中 Tool 阶段丢失、历史未配对 Tool 污染新一轮状态。Pi 原生事件顺序与瞬时投影已对照实际 1.3.0 源码检查；未发现新增 Reflection 绕行路径。

## 尚未通过的验收

**Desktop：blocked。** `test:desktop` 和本轮双端脚本在 firstWindow 阶段超时，尚未形成窗口。进程采样定位到 `SecItemCopyMatching` / `Security::KeychainCore::ItemImpl::getContent`；macOS 钥匙串访问等待系统交互。系统工具禁止自动化操作 SecurityAgent，因此未尝试输入密码或改动钥匙串访问控制。该问题发生在 Web 业务之前，不能算作 Desktop 回归通过；关窗后台运行及 Desktop/Web 完整业务链仍待在可启动环境复验。

ad-hoc 开发包的 designated requirement 绑定代码摘要，重新打包后可能再次要求授权；正常使用不应被设计为每次输入密码。现有 `AGENT_CODESIGN_IDENTITY` 支持稳定签名身份，本机 `security find-identity -v -p codesigning` 返回 0。未为减少提示而降低凭据保护，也未要求本轮购买付费开发者计划。

**D3：blocked。** 真实普通任务产生来源后，Reflection 环境检查返回“需要 Apple Development 或 Developer ID 签名以验证 XPC 对端；当前应用为 ad-hoc 签名”，任务为 `waiting_user`，重启仍保留。Faux 仅用于自动化机制测试；未替代真实受限 XPC Worker 验收。历史 D3 收据未改写。
