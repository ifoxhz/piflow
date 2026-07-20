# BlueLamp

本地 RAG 桌面应用 — **Pleias-RAG-1B** + **BGE-M3** + **Tauri 2**

UI 设计参考：[docs/index.png](docs/index.png)

> **开发策略**：在 **WSL** 完成日常开发与功能测试；功能稳定后在 **macOS** 打包发布。详见 [WSL 开发指南](docs/development-wsl.md)。

## 快速开始（WSL / Linux）

```bash
# 安装依赖（建议仓库在 ~/ 下，勿放 /mnt/c/）
pnpm install
cp .env.example .env   # 可选

# 终端 1：RAG 后端
pnpm dev:server

# 终端 2：前端（Windows 浏览器打开 http://localhost:1420）
pnpm dev:ui

# 或一键并行
pnpm dev
```

## macOS 打包（功能完成后）

```bash
cd apps/desktop && pnpm tauri dev    # 验证桌面壳
cd apps/desktop && pnpm tauri build  # 生成 .app
```

需安装 [Rust + Tauri 前置依赖](https://tauri.app/start/prerequisites/)。

## 模型下载（国内镜像）

```bash
export HF_ENDPOINT=https://hf-mirror.com
pnpm models:ensure
```

详见 [models/README.md](models/README.md)。

## 项目结构

```
apps/desktop/     Tauri + React UI
apps/rag-server/  Node RAG HTTP 服务
packages/core/    共享类型与常量
models/           模型清单与本地缓存
docs/             架构设计文档
```

## 文档

- [架构设计](docs/architecture.md)
- [**WSL 开发指南**](docs/development-wsl.md)
- [ADR 001 — Tauri + Sidecar](docs/adr/001-tauri-sidecar.md)
- [ADR 002 — 文档解析](docs/adr/002-document-parsing.md)
- [ADR 003 — 模型管理](docs/adr/003-model-management.md)
- [ADR 004 — WSL 开发 / macOS 发布](docs/adr/004-wsl-dev-macos-release.md)
