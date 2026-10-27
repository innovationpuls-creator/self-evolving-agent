# D6-A · 真实 Host 体验验证

状态：实现与证据已保存，等待 ChatGPT 独立验收。第一阶段两个候选未获批准，未用于替换现有 D6-A。本入口沿用 A 的视觉和控件，独立连接真实 Host；原模拟工作空间仍在 `http://127.0.0.1:4176/?route=quiet`。

## 运行

```sh
cd /Users/torch/Documents/ChatGPT/agent/prototypes/d6/host
npm run build
npm run start
# 另一终端中打开已认证的系统浏览器
npm run open
```

真实入口：`http://127.0.0.1:4189/`。页面由现有 `startHost` 直接提供，与 `/api`、`/events` 同源；没有代理改写 Origin、额外 CORS、后端替身或免鉴权通道。`open` 复用正式 Web 的 hash-token 引导，随后令牌从 URL 清除。也可在页面输入该实例的连接令牌。

`.runtime/` 是仅供本轮受控验证的私有目录，被 Git 忽略。Host 数据使用原有加密存储；测试启动器为复现重启，将数据密钥和连接令牌放在本目录的 0600 文件中。**该测试启动方式不是生产密钥托管方案**，不得用于迁移或接管用户正式数据。它没有读取 Desktop 的 Keychain 数据。模型凭据通过既有 `/credentials` 的 `importExisting` 导入并由 Host 加密保存；不输出凭据。

当前实例使用本工作树的正式 Host 代码和已有签名 Reflection App Bundle。没有修改或重建 Host、Web、Desktop 或原生组件。只新增本目录。

## 实际任务链

1. 选择 `retry-policy` 项目的会话，打开其反思记录。
2. 打开最近的检查，选择「任务来源」。
3. 打开 `memory_revise` 的真实执行结果，点击「查看本次修订」。
4. 阅读记忆修订 2、相对修订 1 的差异、修订依据和来源。
5. 打开「记忆来源 1」，在来源会话中定位，或「返回原会话」。

本轮真实结果：用户要求的记忆更新将重试上限从 7 次改为 3 次。更新发生在来源会话的原生 `memory_revise` 中。Reflection 保存了摘要和证据，但其 `changes` 为空。页面分别呈现两类事实，没有伪造 Reflection 的成果。最初的检查未命中文本检索、未产生变化；这些结果也保留在历史与证据中。

[入口与证据说明](ADAPTER.md) · [验收记录](VALIDATION.md) · [截图与录像](evidence/index.html)

## 验证命令

```sh
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
npm run test:browser       # 读取当前真实测试数据，含真实 Host 拒绝请求的负向检查
npm run test:navigation
npm run test:isolation
npm run test:regression    # 原断言保留；会报告遗留脚本与当前界面的不匹配
npm run evidence:redact
```

`prepare:real` 默认重新读取已有场景并核对真实记录，不重新调用模型。首次运行或显式 `-- --new` 会创建专用测试项目、人工初始记忆和会话，调用已配置的 `gpt-6-luna`，执行真实任务与后台检查。

`test:composer:real` 会额外创建一条真实测试会话，实际点击发送和停止，消耗模型额度。`states-real.ts failed|interrupted` 是仅用于本实例的故障注入脚本：前者终止本 Host 的桥接子进程，后者关闭隔离 Host，需正常重启；不会终止其他 Host。

证据不属于批准视觉基线。交付后停止，不自动推进正式前端替换。
