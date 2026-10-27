# 浏览器验证与设计批评

## 可复现证据

运行 README 中 dev 命令后：

```sh
node prototypes/d6/scripts/browser.mjs
node prototypes/d6/scripts/failures.mjs
```

`evidence/browser.json` 记录两方向10组检查：结果与证据分页、Memory 修订、用户授权到自动生效及回退、停止不迟到完成、五种窗口尺寸。`evidence/failures.json` 记录8组负向/授权检查：检查失败、无代码、取消、空目标拒绝、模型登录取消/退出/环境授权。浏览器脚本使用真实 Chrome 和独立 Vite，不启动 Host。无 pageerror，无外部或 Host 请求。

类型检查、构建、格式检查通过；Biome lint 无 error，保留11 warnings及1 info（CSS specificity、important与单子 Fragment），完整输出在 evidence/。未运行正式根测试，因为未修改正式业务实现。

## 首版批评及修正

1. A 的阅读区以任务结果为主，B 初版只是增加导航栏，差异不充分。将 B 调整为结果优先、原始请求后置；授权面板加入并列的讨论背景与范围基础。A 保留会话阅读顺序与情境变化区。
2. 停止只改变运行提示，延迟回调仍会补上结果。加入运行代数，停止使待完成回调失效；浏览器等待超过原延迟后检查仍未完成。
3. 回退后 v2 从版本列表消失。将版本历史与当前引用分离，恢复 v1 后 v2 仍可查看与恢复。
4. 环境授权可用被误写成 Host 保存副本。分开凭据副本与模型可用状态；退出不声称提供方撤销。
5. 文件/Skill 引用最初跨会话共享。改为按方向与会话索引保存；两方向初始数据相同、进度隔离。
6. 长代码、JSON 以及窄窗口使用局部滚动和单列详情；两套结果、Memory、授权以及1240/850/768/390尺寸截图保存在 evidence/。实际目视检查了两套结果、授权与窄屏截图。

## 解释边界

所有执行、模型、开发及版本变化都是明确的模拟，不证明真实 Host、OAuth、XPC、原生 Desktop 或 Skill 发布可用。真实产品支持的完整导入/审查/编辑、队列、分支恢复等已在审计覆盖；本 Demo 深入三条代表旅程，其余说明性表面不等于正式功能复刻。

本轮未进行真实用户可用性访谈，不能据此声称用户已理解或认可设计。授权表面、模块显隐与视觉方向仍需用户最终选择。无正式前端替换。

## 工作区保护

baseline/ 是原始五文件快照。evidence/files-before.json 与 files-after.json 对 prototypes/d6 之外的已跟踪/未忽略文件逐项散列一致；缺失文件同样保留状态。workspace-before.txt/after.txt 记录原有未提交 Bugfix。未提交、推送或修改正式配置。
