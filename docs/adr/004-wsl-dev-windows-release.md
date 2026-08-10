# ADR-004：WSL 开发、Windows 发布

**状态**：已接受  
**日期**：2026-08-10

## 背景

日常可用 WSL2 或 Windows 做 Node + 浏览器开发；桌面壳与安装形态以 **Windows 便携包** 为已验证发布路径。未在其它桌面平台做发布验证，文档不以之为目标。

## 决策

1. **日常开发**：`pnpm dev:server` + `pnpm dev:ui`（浏览器访问 `localhost:1420`）
2. **不在 WSL 交叉编译 Windows 便携包**；`pnpm build:windows` 仅在 Windows 本机执行
3. **RAG / piFlow 全链路**（嵌入、检索、导入、Agent）可在 WSL 或 Windows 开发态验证
4. **Tauri 窗口、系统对话框、便携包解压 sidecar** 在 Windows 本机验收
5. 若使用 WSL：代码放在 Linux 文件系统（`~/...`），不用 `/mnt/c/`

## 理由

- WSL / Windows 均可无完整 Tauri 打包跑通 90%+ 功能（HTTP Sidecar + React）
- 便携包体积与 WebView2 / 路径问题只能在 Windows 实机发现
- 未测试平台不写入发布承诺，避免文档误导

## 后果

- 文档：[development-wsl.md](../development-wsl.md)、[development-windows.md](../development-windows.md)
- Phase 1 验收：开发态浏览器 + API；发布验收：`dist-windows/piFlow/`
