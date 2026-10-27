# D6-A 第二阶段验收记录

真实 Host 适配与本地证据已保存，停在独立产品验收节点。没有批准视觉基线，没有替换原模拟 D6-A，没有关闭 UX-001。

## 运行与任务链

入口：`http://127.0.0.1:4189/`。在本目录执行 `npm run open`，通过已有 hash-token 流程打开已认证浏览器。原模拟环境仍为 `http://127.0.0.1:4176/?route=quiet`。

这是当前正式 Host 源码启动的专用实例，使用独立加密数据目录、真实 Provider 与已有签名 Native Reflection。人工测试项目及初始记忆用于触发实际操作；之后的执行、记忆修订、检查状态和来源均来自实际 Host。没有填充 Reflection 数据库、替换 executor 或模拟成功响应。它不构成正式用户数据迁移或生产密钥托管验收。

可操作链路：会话 → 会话反思摘要 → 检查详情 → 来源任务的 `memory_revise` → 修订 2 与修订 1 的差异 → 原始证据 → 定位原始会话。返回时保留未发送草稿；列表还保留焦点与滚动位置。

真实结果为“请求重试上限”从 7 次改为 3 次。**保存者是来源任务的原生 memory_revise；后台 Reflection.changes 为空。** 后台保存了摘要与证据，没有自行新增成果。最初没有变化的检查也保留在历史中。

[连续录像与三尺寸页面](evidence/index.html) · [接口与访问边界](ADAPTER.md) · [运行说明](README.md)

## 验证结果

| 检查 | 实际结果 | 记录 |
|---|---|---|
| 真实浏览器主链与边界 | 34 通过，0 失败，0 page error | [逐项预期与实际](evidence/browser-results.json) |
| 返回、滚动、焦点、移动导航 | 4 通过；滚动 754→754，刷新后维持顶部 | [导航](evidence/navigation-results.json) |
| 实际发送与停止 | 2 通过；回复保存，停止后 busy=false | [操作](evidence/composer-results.json) |
| 现有工作空间当前入口 | 15 通过，覆盖三尺寸会话、记忆、Skill、演进、原反思 | [回归](evidence/workspace-smoke.json) |
| 现有状态脚本 | 读取重试、离线禁止发送、重连草稿、空状态 4 项通过 | [状态](evidence/regression-a-product-states/states.json) |
| 文件与运行隔离 | 早期 4174 文件一致；最终复查出现 6 个目录外变化，不能声明整轮文件恒定。9 组原 A/B 开新入口前后画面一致 | [早期文件](evidence/isolation.json) / [最终差异](evidence/protected-files-final.json) / [画面](evidence/runtime-isolation.json) |
| 类型、契约、Biome、构建 | 8 条命令 exit 0；新契约 5 项、第一阶段契约 7 项通过 | [命令输出](evidence/checks.json) |
| 原生组件 | 已有 Bundle 严格签名检查 exit 0，nativeAvailable=true | [签名与哈希](evidence/native-runtime.json) |

主浏览器检查真实跨会话/项目筛选、同名任务身份、无记录、失败、中断、来源缺失、错误项目作用域拒绝、Origin 403 与恢复、Bearer 401 后受保护内容卸载，以及三尺寸无横向溢出。列表断言只读取摘要，没有逐条详情预取。

检查失败通过终止本实例桥接子进程产生；中断通过关闭本实例并正常重启产生，未写入状态 fixture。[失败](evidence/failed-real.json) / [中断前](evidence/interruption-before-restart.json) / [重启后](evidence/interrupted-after-restart.json)。Origin 负向测试将实际 Host 的 403 响应交给页面，没有创建替代响应体。项目拒绝使用现有 404 作用域行为，并非新增记录级 ACL。

现有与独立构建均有大于 500 kB 的 chunk 提示，构建通过不代表没有体积问题。

最终复查发现原 D6 的 Settings、契约脚本、round4 文档与三份本地 Skill 参考文件较初始快照不同，最后修改时间为 03:49，晚于先前 03:34 的零差异检查。本轮写入限定在 `host/`，未回滚或改写这六项；变化来源没有在本轮确认。最终构建和类型检查基于当前工作树通过，早期零差异记录不能替代最终差异记录。

## 保留的失败

- 旧综合脚本在已不存在的“全部修订”页签处超时，原断言未删减，正式界面未修改。[原始失败](evidence/regression-command.json)
- 更早交互脚本首次在外层折叠未展开时读取子按钮失败；展开后又在“新消息清空历史工具记录”的断言失败，当前会话保留历史。[首次](evidence/legacy-suite-initial.json) / [历史预期](evidence/legacy-suite-history-expectation.json)
- 新浏览器第一轮 28 通过、6 失败：Diff 重复文本触发 strict locator，Chrome 不接受直接覆盖 Origin。修正驱动后才获得 34/0，未弱化权限条件。失败截图、录像与 trace 保留于 `evidence/iterations/run-01/`。
- 最初真实任务未通过文本检索找到初始记忆，也没有产生变化。后续明确的用户记忆更新请求才产生真实修订。[初始记录](evidence/real-preparation-initial.json)

## 实际 UX 修正

- 摘要与完整详情分离，不把来源数当变更数，不补造列表统计。
- 通过原生操作反馈连接实际修订，区分后台检查与来源任务结果。
- 按指定历史修订显示成果、当前状态与正文差异；记忆 Diff 标注“记忆正文”。
- 保留 Memory 调用项目作用域，避免把项目哈希当路径导致来源跳转失败。
- 长来源顶部提供定位与返回；跨页保留原会话、草稿、焦点和滚动位置，刷新不会再次跳回旧位置。
- 401 卸载受保护内容，403/404 保留实际原因和恢复入口，不显示成空记录。

沿用 A 的字体、色彩与产品身份，没有继续第一阶段候选；整体视觉与使用体验仍待独立判断。

## 尚未证明或接入

- 尚无真实非空 Reflection.changes 的成果链，不能声称后台 Memory、Skill、Evolution 写入通过验收。
- Skill 知识与 Evolution 建议已实现只读引用适配，本轮没有对应真实生成成果链；编辑、发布、采纳与授权未接入。
- 真实记录未超过 20，实际翻页、Trace 超页、长来源分页、失败前已提交部分成果尚未实测。第一阶段类型化测试保留，但不替代真实验证。
- Host 列表没有变化、不确定性及对应筛选能力；没有新增记录级权限模型。
- 未验收正式用户数据迁移、生产密钥托管、长期运行、实体移动设备或屏幕阅读器。原模拟环境不能视为已接入真实 Host。

请求证据已移除令牌、重启密钥、主目录路径和本地 prompt 上下文；私有 `.runtime` 不属于交付证据。工程通过不等于设计通过；交付后停止，由 ChatGPT 独立验收。
