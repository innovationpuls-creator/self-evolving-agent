# 第四轮 · 第一阶段

启动：`npm run dev:round4 --prefix prototypes/d6`；访问 http://127.0.0.1:4177/ 。

这是独立视觉原型，不替换 A/B，不连接 Host。仅 Session、Memory、Evolution 和组合样板；刷新重置数据。演示控制可切换无衬线正文与灰色关系线。

## 设计依据与取舍

- [Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/style-strategies)：操作与阅读分角色。Plex Sans/Noto Sans SC 服务控件，Noto Serif SC 用于认识和长文，Plex Mono 服务代码。真实样张支持无衬线比较；采用衬线并不意味着用户已经认可。
- [Carbon motion](https://www.carbondesignsystem.com/building-blocks/foundations/motion/choreography)：选择与关系变化保持连续。节点活动环对应模拟运行，修订选中环对应选择；完成不放庆祝动画。减少动效时停掉循环。
- [Carbon content](https://www.carbondesignsystem.com/building-blocks/foundations/content)：保留技术概念，状态与动作描述事实。Tool 返回、答复完成和发布生效分别表达。
- [Primer Dialog](https://primer.style/product/components/dialog/accessibility/)：可见标题、关闭、焦点锁定和返回由 Radix 负责；授权目标与权限在批准前可读。

图形采用节点、来源关系和范围括线。它们服务实际记录：Session 的返回事件，Memory 的父修订与选中来源，Evolution 的授权范围。不是新增 Agent 生成图形能力。

三个场景使用不同结构：消息阅读与底部输入；修订脊线与当前认识；建议论证、讨论和聚焦授权。没有将三者套进统一卡片。

## 视觉批评与实际修正

初版发现 Session 横向行长偏长、Memory 24px 正文像宣言、Evolution 25px 主段落占比偏重。修正为900px总阅读工作区、Memory 21px、建议23px，窄屏进一步调整；缩短图形与正文之间的空距。初版 initial、修正 revised/final 均保留。

交互检查发现导航的编号进入可访问名称，已给按钮明确名称；正文仍使用同一安全 Markdown/GFM、Highlight.js、真实行Diff和JSON树，不开发新引擎。

## 组件与检查

| 场景 | 交互 / 状态 |
|---|---|
| Session | 文件/Skill引用及移除、模型选择、多行输入、输入法快捷键、发送、运行、停止、Tool成功/失败详情、代码复制与折行、长文样例 |
| Memory | 当前/历史选择、差异、来源Drawer、缺失/撤销/权限不足、草稿、理由、冲突比较、新修订保存 |
| Evolution | 建议、讨论前授权禁用、发送讨论、目标及范围、授权、开发、检查、失败旧版保留、取消、无代码成果、自动生效、恢复旧版 |
| 样板 | 字体/颜色对照、真实中文与代码、SVG选择与运行、reduced-motion |

运行 `node prototypes/d6/round4/review.mjs` 与 `extra.mjs`。四尺寸检查、动效录像、字体平台渲染记录及回归证据在 evidence。类型、构建和独立Biome检查也在那里。截图/检查不是用户审美验收。

## 资源与许可

实际依赖版本见 D6 package-lock；完整字体与 Motion许可见 licenses。Motion MIT；Noto与Plex OFL-1.1，保留Plex名称。Radix、Lucide、React及内容依赖复用D6，原许可在 ../licenses。Motion Primitives仅研究状态切换思想，没有复制其代码或引入Tailwind。没有品牌素材、外部字体CDN或真实凭据。

## 尚未覆盖

自由输入只演示续接，不生成真实业务结果。冲突入口模拟冲突反馈，而非多客户端并发。模型下拉仅改变展示选项，不做授权设置。未制作另四模块，也未执行原生Desktop、真实OAuth或屏幕阅读器实机验收。演示状态切换不是正式产品设置。

检查结果：第四轮四场景×四尺寸与主状态断言通过；补充失败、取消、无需修改通过；旧A/B完整回归通过。lint为0错误、6条既有写法警告（非空断言及reduced-motion的important）；构建有大包提示。Demo外基线摘要一致。第四轮源文件及样式未进入旧入口。
