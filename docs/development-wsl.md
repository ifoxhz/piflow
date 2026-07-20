# WSL 开发指南

> **策略**：在 WSL 完成全部功能开发与测试，功能稳定后再在 **macOS** 上打包、签名与分发。

---

## 1. 开发模式对照

| 阶段 | 环境 | 运行方式 |
|------|------|----------|
| **日常开发** | WSL2 | 浏览器 + `rag-server`（推荐，无需 Rust） |
| **可选预览** | WSL2 + WSLg | `pnpm tauri dev`（需 Linux 图形与 Rust 工具链） |
| **发布打包** | macOS | `pnpm tauri build` + Sidecar 二进制 + 公证 |

WSL 阶段**不阻塞**在 Tauri/Rust 上：UI 用 Vite 在浏览器调试，与 Tauri WebView 共用同一套 React 代码。

---

## 2. 环境准备（WSL）

### 2.1 必需

```bash
# Node.js 20+（推荐 nvm）
node -v   # >= 20

# pnpm
corepack enable && corepack prepare pnpm@latest --activate

# 项目依赖
cd ~/workspace/github/bluelamp   # 建议放在 Linux 文件系统，勿用 /mnt/c/
pnpm install
```

> **路径建议**：仓库放在 `~/...` 下，不要放在 `/mnt/c/...`。原生模块（`better-sqlite3`、`pdf-oxide`、`node-llama-cpp`）在 Linux 文件系统上编译/加载更可靠、更快。

### 2.2 国内镜像（模型下载）

写入 `~/.bashrc` 或 `~/.zshrc`：

```bash
export HF_ENDPOINT=https://hf-mirror.com
```

### 2.3 可选（仅在 WSL 要跑 Tauri 窗口时）

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri Linux 依赖（Ubuntu/Debian WSL）
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

需要 **Windows 11 + WSLg** 才能在 WSL 里弹出桌面窗口。若无图形环境，继续用浏览器开发即可。

---

## 3. 日常开发命令

```bash
# 终端 1 — RAG 后端
pnpm dev:server
# → http://127.0.0.1:3847

# 终端 2 — 前端（浏览器）
pnpm dev:ui
# → http://localhost:1420
```

在 Windows 浏览器打开 `http://localhost:1420` 即可（WSL 端口自动转发）。

### 一键并行（可选）

```bash
pnpm dev   # 同时启动 rag-server + Vite
```

### 模型

```bash
export HF_ENDPOINT=https://hf-mirror.com
pnpm models:ensure
```

### 健康检查

```bash
curl http://127.0.0.1:3847/health
```

---

## 4. WSL 与 macOS 差异

| 项目 | WSL（开发） | macOS（发布） |
|------|-------------|---------------|
| UI 调试 | Chrome / Edge 访问 `:1420` | Tauri WebView 或浏览器 |
| Pleias 加速 | CPU（llama.cpp） | Metal（Apple Silicon） |
| Sidecar 二进制 | `rag-server-x86_64-unknown-linux-gnu` | `rag-server-aarch64-apple-darwin` 等 |
| pdf-oxide | `linux-x64-gnu` 预编译包 | `darwin-arm64` 预编译包 |
| 模型目录 | `{repo}/models` | 同上（开发）；生产用 Application Support |
| Tauri 打包 | 可忽略 | **必须**在 macOS 上 `tauri build` |

**不要在 WSL 里交叉编译 macOS 安装包**。Tauri 的 `.app` / 公证只在 macOS 上完成。

---

## 5. 功能开发顺序（WSL 可完成项）

在 WSL 可完整开发与测试：

- [x] Monorepo + UI + `rag-server` 骨架
- [ ] `pnpm models:ensure` 下载 Xenova/bge-m3、Pleias GGUF
- [ ] BGE-M3 嵌入（Transformers.js WASM）
- [ ] pdf-oxide 文档导入
- [ ] Pleias 推理（node-llama-cpp，CPU）
- [ ] SQLite + 向量检索
- [ ] 对话流式输出 + 引用

留到 **macOS 阶段**再验证：

- [ ] Tauri `tauri dev` / `tauri build`
- [ ] Metal 推理性能
- [ ] Sidecar 随 `.app` 打包
- [ ] 代码签名与公证
- [ ] 安装包分发

---

## 6. 环境变量

复制 `.env.example` 为 `.env`（可选）：

```bash
cp .env.example .env
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HF_ENDPOINT` | `https://hf-mirror.com` | 模型下载镜像 |
| `BLUELAMP_RAG_PORT` | `3847` | RAG 服务端口 |
| `VITE_RAG_SERVER_URL` | `http://127.0.0.1:3847` | 前端连后端 |
| `BLUELAMP_MODELS_DIR` | `{repo}/models` | 模型根目录 |

---

## 7. 迁移到 macOS 发布清单

功能在 WSL 验收通过后，在 Mac 上执行：

```bash
# 1. 克隆/同步代码
git pull

# 2. 安装依赖
pnpm install

# 3. 下载模型（若未同步 models/ 目录）
export HF_ENDPOINT=https://hf-mirror.com
pnpm models:ensure

# 4. 安装 Rust + Tauri 前置（见 https://tauri.app/start/prerequisites/）

# 5. 开发验证
pnpm dev:server
cd apps/desktop && pnpm tauri dev

# 6. 打包
cd apps/desktop && pnpm tauri build
```

Sidecar 需在 macOS 上单独构建并放入 `src-tauri/binaries/`（后续 CI 脚本会自动化）。

---

## 8. 常见问题

### 端口访问不到

确认服务监听 `127.0.0.1`，Windows 浏览器用 `localhost:1420` / `localhost:3847`。

### 原生模块安装失败

- 确保在 Linux 路径（`~/workspace/...`）而非 `/mnt/c/`
- 运行 `pnpm approve-builds` 允许 `esbuild` 等构建脚本

### WSL 内存不足（加载模型）

WSL 默认内存可能偏小。在 Windows 用户目录 `.wslconfig`：

```ini
[wsl2]
memory=16GB
swap=8GB
```

修改后 `wsl --shutdown` 再重启 WSL。

### 不在 WSL 装 Rust 可以吗？

可以。WSL 阶段只用 `pnpm dev:ui` + `pnpm dev:server` 即可完成绝大部分开发。
