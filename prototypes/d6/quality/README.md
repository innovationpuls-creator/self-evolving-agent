# D6-A 反思记录质量验证

第一阶段，仅反思记录；所有候选和证据待独立设计验收。现有 D6-A 没有被替换。

## 使用

在仓库根目录执行，无需安装依赖：

```sh
npm --prefix prototypes/d6/quality run dev
```

- 评审入口：<http://127.0.0.1:4187/>
- 原版：<http://127.0.0.1:4187/?variant=original&scenario=mixed&seed=25>
- 日期日志：<http://127.0.0.1:4187/?variant=journal&scenario=mixed&seed=25>
- 完成情况分区：<http://127.0.0.1:4187/?variant=grouped&scenario=mixed&seed=25>
- [对照截图与三段操作录像](evidence/comparison.html)（启动后可在浏览器打开 `/evidence/comparison.html`）
- [页面信息契约](contracts/reflection.md) · [UX-001](defects/UX-001.md)

评审控制位于独立入口，不放入产品预览。通过入口选择 scenario，或修改 URL 参数；seed 可换为1–99999的整数，不依赖目前演示记录的名称或ID。

## 运行验证

```sh
npm --prefix prototypes/d6 run typecheck
npm --prefix prototypes/d6/quality run typecheck
npm --prefix prototypes/d6/quality test
npm --prefix prototypes/d6/quality run lint
npm --prefix prototypes/d6/quality run format:check
npm --prefix prototypes/d6/quality run build
# 保持独立 Vite 服务运行后：
npm --prefix prototypes/d6/quality run test:browser
npm --prefix prototypes/d6/quality run test:isolation
```

输出仅写入本目录。构建为 `dist/`，不清理或覆盖原 D6 的构建。浏览器脚本复用 playwright-core / Google Chrome，失败保留截图、trace与逐项错误。浏览器报告中的 failed / knownDefect 是原版实际未满足的检查，仍属于失败；意外失败或 pageerror 会使命令退出非零。结果不作为视觉基线，不运行截图批准命令。

`evidence/preservation-before.json` 是本轮开始时4049个受保护文件的内容摘要，`isolation.json` 比对其后状态。它保留了当时工作区已有修改，不是 Git HEAD 回滚清单。重跑时不覆盖 before 文件。

## 数据与场景

`src/fixtures.ts` 复用正式 Host 类型；`tests/fixtures.test.ts` 在内存 SQLite 调用真实 catalog，校验排序、分页、会话筛选、status view及Unicode截断。默认12条记录覆盖全部六种状态，pagination为47条。变更、证据、session元数据与轻量投影均来自同一 factory。

场景：mixed、empty、loading、list-error、detail-error、environment-unchecked、environment-unavailable、source-missing、source-truncated、source-old-branch、source-previous、source-denied、metadata-missing、pagination。读取失败场景第一次失败，用户重读成功；不启动任务。source-denied持续拒绝，不能通过重试绕过。

候选列表只消费 catalog 与 session 元数据；按需读取详情和来源。两候选共用详情，保留已保存变更、未核实内容、发现与原始引用。日期日志按 created 分日期；分区方案按 status 区分未完成／已完成，桌面并列、窄窗口堆叠。

## 限制与尚未解决项

- Host summary 不含变更、不确定性、发现、项目字段；项目依赖 session 元数据。没有 status / uncertainty 查询过滤接口，也没有分区总量。候选不会为此逐条预取详情。
- 原版是直接复用的完整本地数据页面；独立详情读取失败、顶层环境状态和传输层访问拒绝不能完整注入，报告保留其失败。其原始元数据回退也不同于候选。不改原版来让测试变绿。
- 来源阅读器显示当前返回片段与截断标记，保留 nextOffset，尚未提供继续分页读取或跳转正式会话。变更引用可查看原始对象，未建设记忆／技能／建议模块。
- source-denied依据现有Host传输层403模拟请求来源信任失败；不宣称Host已有单条证据ACL。浏览器模拟不构成真实认证验证。
- 独立预览复用导航外观，但仅挂载反思记录；其他模块与正式交互应在原D6入口查看。
- 未连接正式Host、模型、签名服务或真实用户数据。未验证物理移动设备、屏幕阅读器、正式部署或长期运行。
- 截图与录像是待评审证据。正常状态不重复声明，也不意味着可以隐藏失败、权限或不确定性；完整性与视觉选择仍由ChatGPT独立验收。
