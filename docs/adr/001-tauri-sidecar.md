# ADR-001：采用 Tauri 2 + Node Sidecar 架构

**状态**：已接受  
**日期**：2026-07-01

## 背景

BlueLamp 需要一款跨平台桌面壳，承载 React UI，同时运行依赖 Node 原生模块的 RAG 后端（`node-llama-cpp`、`better-sqlite3`、`@huggingface/transformers`）。

曾评估 Electron（体积过大）、Neutralino.js（生态较小、仍需 Sidecar 跑 Node）。

## 决策

采用 **Tauri 2** 作为桌面壳，**Node Sidecar** 作为 RAG 推理进程。

- Tauri：窗口、系统 API、Sidecar 生命周期、打包签名
- Node Sidecar：全部 RAG 业务逻辑与原生模块
- 通信：WebView ↔ Sidecar 经 `HTTP + SSE`（localhost）；Tauri Rust 负责 spawn/kill Sidecar

## 理由

1. 安装包体积小（~5–10 MB 壳 + Sidecar 二进制），无捆绑 Chromium
2. 无需在 Rust 中重写 RAG 逻辑；Rust 代码量极少
3. 官方 Sidecar 支持，Windows/macOS 打包工具链成熟
4. 开发期可直接 `node apps/rag-server` 调试，无需每次编译 Rust

## 后果

- 需维护 Sidecar 跨平台二进制打包流程
- 需处理 Sidecar 启动就绪、端口分配、进程清理
- 日常开发需安装 Rust 工具链（仅构建 Tauri 壳时）

## 备选方案（未采用）

| 方案 | 放弃原因 |
|------|----------|
| Electron | 体积 ~150 MB+，捆绑 Chromium |
| Neutralino + Node Sidecar | 生态与工具链弱于 Tauri；同样需 Sidecar |
| 纯 Tauri Rust 插件跑模型 | 重写成本高，无成熟 llama.cpp Rust 集成路径 |
