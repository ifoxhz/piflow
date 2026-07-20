# ADR-004：WSL 开发、macOS 发布

**状态**：已接受  
**日期**：2026-07-01

## 背景

开发者使用 WSL2 进行日常编码，目标平台首发 macOS。需在不影响进度的前提下，避免在 WSL 上强依赖 Tauri/Rust 桌面打包。

## 决策

1. **WSL 日常开发**：`pnpm dev:server` + `pnpm dev:ui`（浏览器访问 `localhost:1420`）
2. **不在 WSL 交叉编译 macOS 安装包**；`.app` 仅在 macOS 上 `tauri build`
3. **RAG 全链路**（嵌入、检索、Pleias、pdf-oxide）在 WSL 上开发与测试
4. **Tauri 窗口 / 签名 / 公证** 留到功能完成后在 Mac 验证
5. 代码与仓库路径放在 WSL Linux 文件系统（`~/...`），不用 `/mnt/c/`

## 理由

- WSL 可无 Rust 跑通 90%+ 功能（HTTP Sidecar + React）
- 原生模块在 Linux 与 macOS 均有预编译包，WSL 可验证 Node 侧逻辑
- macOS Metal、Sidecar 打包、公证无法在 WSL 真实复现

## 后果

- 文档增加 [development-wsl.md](../development-wsl.md)
- Phase 1 验收以 WSL 浏览器 + API 为准
- 发布前增加 macOS 专项检查清单
