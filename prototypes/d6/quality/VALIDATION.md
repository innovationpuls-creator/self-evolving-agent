# 验证结果

状态：待 ChatGPT 独立设计验收；没有批准基线。

## 自动化与隔离

- 原 D6-A typecheck，以及新增资产 typecheck、Biome lint、format:check、独立 build 均通过。
- 7项类型化数据／契约测试通过，包含真实 Host catalog SQL 对照与最多一个 running 的调度约束。
- 浏览器实际断言：258项通过；11项失败均来自原版，保留为已知缺陷；0项意外失败，0项 pageerror。
- 4049个受保护文件内容未变；A会话、A反思、B反思在三个宽度下的9组运行截图内容摘要一致。
- 65张场景截图，3段1440×1000连续操作录像，12份可回放trace。另有18张运行隔离对照截图。

| 版本 | 通过 | 失败 |
| --- | --- | --- |
| original | 74 | 11 |
| journal | 92 | 0 |
| grouped | 92 | 0 |

## 原版失败项

- 重复完成标签：1440、850、390px各1项。
- 轻量列表依赖详情计数：三个宽度各1项。
- 独立详情读取失败／重读、环境未检查、环境不可用、访问拒绝、元数据缺失的项目回退：各1项。

这些失败没有通过修改原版或降低候选断言消除；它们不全部属于视觉缺陷，也记录了原版模拟机制与当前契约的差距。

## 可复核证据

- [同条件截图与录像](evidence/comparison.html)
- [逐项预期、实际结果与trace引用](evidence/browser-results.json)
- [代码检查命令与输出](evidence/checks.json)
- [最终 lint 输出](evidence/final-lint.log)
- [文件隔离](evidence/isolation.json) · [运行画面隔离](evidence/runtime-isolation.json)
- [媒体尺寸、时长与trace完整性](evidence/media-validation.json)
- [机械设计检测结果](evidence/design-detector.json)

实际查看了桌面日期日志、桌面分区、850px分区、390px列表／详情／来源，以及同数据原版截图。机械检测无命中不表示设计获得批准。

## 解释边界

截图统一固定种子、数据时间、zh-CN、America/Los_Angeles、1×缩放、1000px高度与 reduced motion。原版接收完整数据，候选列表只读取summary；两者来源同一factory，数据获取差异明确保留。

原版 updated 与候选 created 的时间组织、Host缺少详情计数／筛选、来源截断未继续分页、变更仅查看引用、未连接真实Host／模型／认证等限制见[交付说明](README.md#限制与尚未解决项)。

所有证据均为本地模拟和隔离测试结果，不能扩展为正式产品、真实设备或视觉验收结论。
