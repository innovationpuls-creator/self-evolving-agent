# 开源资源与许可证

本轮使用无样式基础设施构建自己的视觉系统，没有采用成套 UI 主题。新增依赖仅在 `prototypes/d6/package.json` 与本目录锁文件；根配置未修改。

| 资源 | 实际安装版本 | 许可证 | 本地通知 |
|---|---|---|---|
| `@radix-ui/react-dialog` | 1.3.1 | MIT | [LICENSE](licenses/@radix-ui--react-dialog--LICENSE) |
| `@radix-ui/react-dropdown-menu` | 2.2.1 | MIT | [LICENSE](licenses/@radix-ui--react-dropdown-menu--LICENSE) |
| `@radix-ui/react-tabs` | 1.2.1 | MIT | [LICENSE](licenses/@radix-ui--react-tabs--LICENSE) |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | [LICENSE](licenses/@radix-ui--react-tooltip--LICENSE) |
| `lucide-react` | 1.61.0 | ISC | [LICENSE](licenses/lucide-react--LICENSE) |
| `highlight.js` | 11.12.0 | BSD-3-Clause | [LICENSE](licenses/highlight.js--LICENSE) |
| `diff` | 8.0.2 | BSD-3-Clause | [LICENSE](licenses/diff--LICENSE) |
| `react` | 19.3.1 | MIT | [LICENSE](licenses/react--LICENSE) |
| `react-dom` | 19.3.1 | MIT | [LICENSE](licenses/react-dom--LICENSE) |
| `react-markdown` | 10.1.0 | MIT | [license](licenses/react-markdown--license) |
| `remark-gfm` | 4.0.1 | MIT | [license](licenses/remark-gfm--license) |
| `vite` | 8.3.4 | MIT | [LICENSE.md](licenses/vite--LICENSE.md) |
| `typescript` | 7.0.2 | Apache-2.0 | [LICENSE](licenses/typescript--LICENSE), [NOTICE.txt](licenses/typescript--NOTICE.txt) |
| `playwright-core` | 1.58.2 | Apache-2.0 | [LICENSE](licenses/playwright-core--LICENSE), [NOTICE](licenses/playwright-core--NOTICE) |

Radix 处理 Dialog/Menu/Tabs/Tooltip 的基本交互；Lucide 提供图标；Highlight.js 使用有限语言注册；diff 计算真实行差异。React/Markdown/GFM/Vite/TypeScript/Playwright 复用项目已存在基础设施。所有 npm 依赖均为开源软件，不需要将用户数据发送给这些项目。

Lucide 的 ISC 许可证正文同时保留部分 Feather 来源的 MIT 通知，见本地 LICENSE。其余传递依赖的许可证随安装包保留；`package-lock.json` 是本轮精确依赖图。本地通知用于评审分发，不能替代未来正式产品分发时的依赖清单。

没有使用第三方位图、商业字体、产品 logo、远程图标/字体 CDN。字体是 macOS/浏览器系统字体回退；品牌字标“Agent”为普通文本与 Lucide Command 图标，不复制参考产品商标。

其他模块的参考原则见 [DESIGN.md](DESIGN.md)。后续 A 轨迹按用户要求复现 DeepSeek Harness 网页版的紧凑事件表、轮次边界及检查器布局；参考本机 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 `ui-trajectory` 源码与尺寸规则，许可证为 MIT，通知见 [DeepSeek Harness LICENSE](licenses/deepseek-harness--LICENSE)。未引入其运行时、插件框架或品牌素材。
