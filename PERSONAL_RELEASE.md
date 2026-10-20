# Skills Manager · yann359 个人版本

本仓库基于 [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)。原作者为 Tianliang Zhang，原项目 MIT LICENSE 与署名完整保留。

个人版本：`1.41.1-yann.2`。Windows MSI 的数字产品版本为 `1.41.1002`，应用内部仍显示完整个人版本号。应用标识、用户配置位置、Skill 原文和系统安全凭据条目保持兼容。

主要个人修改包括 Gemini 免费中文翻译、一次授权、独立本地缓存、渐进阅读、中英对照及断点续译。本次统一桌面布局、通用组件和全局滚动条，新增独立 Presets 页面、Agent 筛选与在线示例预览；原有翻译调度、缓存和管理流程保持不变。

[在线体验](https://yann359.github.io/skills-manager/) · [下载安装包](https://github.com/yann359/skills-manager/releases/latest) · [UI 实现与验证](UI_REDESIGN.md)

免费额度由用户在 Google AI Studio 核实并记录；成功响应不能证明计费层级。软件不自动启用账单、付费模型或无限重试。Gemini API Key 保存在系统安全凭据中，不存入此仓库。

本轮为未签名 Windows 构建。个人版通过本仓库 Releases 手动更新，不复用上游自动更新签名和安装包，避免覆盖个人功能。上游多平台发布工作流仅在上游仓库执行。

安装包只作为 GitHub Releases Assets 发布，不提交到源码目录。缓存、日志、私有 Skill 内容及本机配置均在 Git 忽略范围内。

## 本地验证

```powershell
npm run build
node scripts/test-translation-markdown.mjs
node scripts/test-translation-corpus.mjs --prepare
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib
node scripts/test-translation-corpus.mjs --verify
```

语料脚本默认只读本机 `.codex/skills`，也可通过 `TRANSLATION_SKILLS_ROOT` 指定测试文档目录；生成输入和结果位于被忽略的 `build-cache.local`，不作为发布源码。

页面回归使用已有 Playwright 与浏览器，可通过 `PLAYWRIGHT_MODULE_ROOT`、`BROWSER_EXE` 指定路径；脚本不会自动下载依赖或向 Google 发送请求。真实 API 验收默认忽略，必须显式选择。
