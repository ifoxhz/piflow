# WSL 开发指南

> **策略**：可用 WSL 做 Node 后端与浏览器 UI 开发；**Windows 桌面壳与便携包**在 Windows 本机验证与发布（见 [development-windows.md](development-windows.md)）。不把未验证的其它桌面平台当作发布目标。

---

## 1. 开发模式对照

| 阶段 | 环境 | 运行方式 |
|------|------|----------|
| **日常开发** | WSL2 或 Windows | 浏览器 + `rag-server`（推荐，无需 Rust） |
| **桌面壳 / 打包** | Windows 本机 | `pnpm tauri dev` / `pnpm build:windows` |

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
cd ~/workspace/github/raglamp   # 建议放在 Linux 文件系统，勿用 /mnt/c/
pnpm install
```

> **路径建议**：仓库放在 `~/...` 下，不要放在 `/mnt/c/...`。原生模块（`better-sqlite3`、`pdf-oxide`、`node-llama-cpp`）在 Linux 文件系统上编译/加载更可靠、更快。

### 2.2 国内镜像（模型下载）

写入 `~/.bashrc` 或 `~/.zshrc`：

```bash
export HF_ENDPOINT=https://hf-mirror.com
```

### 2.3 可选说明

不要在 WSL 里交叉编译 Windows 便携包。桌面窗口与 `pnpm build:windows` 请在 **Windows 本机**完成。

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

## 4. WSL 与 Windows 差异

| 项目 | WSL（开发） | Windows（桌面 / 发布） |
|------|-------------|------------------------|
| UI 调试 | Chrome / Edge 访问 `:1420` | 浏览器或 Tauri WebView |
| 加速 | CPU（llama.cpp / ONNX） | CPU；可选远端 Ollama / DeepSeek |
| 原生模块 | `linux-x64-gnu` 预编译 | Windows x64 预编译 |
| 模型目录 | `{repo}/models` | 同上（开发）；便携版随包 / AppData |
| Tauri 打包 | 不做 | `pnpm build:windows` → `dist-windows/piFlow/` |

---

## 5. 功能开发顺序（WSL 可完成项）

在 WSL 可完整开发与测试：

- [x] Monorepo + UI + `rag-server` 骨架
- [ ] `pnpm models:ensure` 下载 Xenova/bge-m3 等
- [ ] BGE-M3 嵌入
- [ ] pdf-oxide 文档导入
- [ ] SQLite + 向量检索
- [ ] piFlow 对话 + 引用
- [ ] 生成后端（Ollama / DeepSeek）

留到 **Windows 本机**再验证：

- [ ] Tauri `tauri dev` / 系统选文件夹
- [ ] `pnpm build:windows` 便携包
- [ ] `%APPDATA%\piFlow\` 数据与 sidecar 解压

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

## 7. 常见问题

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

可以。WSL 阶段只用 `pnpm dev:ui` + `pnpm dev:server` 即可完成绝大部分开发。桌面打包见 [development-windows.md](development-windows.md)。
