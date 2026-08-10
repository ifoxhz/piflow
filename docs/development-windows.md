# Windows 编译与运行清单

> **目标**：在 Windows 本机把 piFlow 跑起来（开发态），并打出**可独立运行**的 MSI（含 Node sidecar + BGE-M3）。  
> **现状**：开发态仍推荐 `pnpm dev:server` + `pnpm dev:ui`；发布用 `pnpm build:windows`（会打包 sidecar、内嵌 BGE-M3，启动时自动起 `rag-server`）。  
> **远端 LLM**：生成走 Ollama（Settings 配置）；未配置时 Chat 返回检索摘要 + 引用。OCR / 本地 GGUF 首版不进安装包。

---

## 0. 先搞清楚你会得到什么

| 目标 | 现在能否完成 |
|------|----------------|
| Windows 上开发运行（Node + 浏览器） | ✅ |
| Windows 上 `tauri dev`（系统选文件夹） | ✅（需本机起 `rag-server`） |
| `pnpm build:windows` 出便携包（含 sidecar + BGE-M3） | ✅ |
| 解压即用（导入/向量检索；Ollama 可选） | ✅ 首版（无 OCR / 无本地 LLM；因单文件 >1GB，不用 NSIS/MSI） |

---

## 1. 环境准备（一次性）

在 **Windows 本机**（PowerShell 或 Windows Terminal）完成，不要只在 WSL 里做 Tauri Windows 打包。

### 1.1 必需软件

- [ ] **Node.js ≥ 20**（[nodejs.org](https://nodejs.org/) LTS）
- [ ] **pnpm 10**：`corepack enable` 后 `corepack prepare pnpm@10.30.2 --activate`
- [ ] **Git**，并 clone / pull 本仓库到 **Windows 路径**（推荐 `C:\dev\raglamp`，避免只放在 `\\wsl$\...`）
- [ ] **WebView2 Runtime**（Win10/11 通常已有；没有则装 [Evergreen Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)）

### 1.2 仅在需要 Tauri 窗口 / 打包时

官方说明：[Tauri Prerequisites](https://tauri.app/start/prerequisites/)

- [ ] **Rust**：`rustup` 默认 toolchain（`x86_64-pc-windows-msvc`）
- [ ] **Visual Studio Build Tools**（或 VS 2022）
  - 工作负载：**使用 C++ 的桌面开发**
  - 含 Windows SDK、MSVC
- [ ] 确认：

```powershell
node -v          # >= 20
pnpm -v          # 10.x
rustc -V
cargo -V
```

### 1.3 远端 Ollama（你的场景）

- [ ] 远端机器已安装 Ollama，模型已 `ollama pull <model>`
- [ ] Windows 本机可访问，例如浏览器或：

```powershell
curl http://<OLLAMA_HOST>:11434/api/tags
```

- [ ] 防火墙放行 11434（或你实际端口）

---

## 2. 仓库与依赖

在仓库根目录（Windows 路径）：

```powershell
cd C:\dev\raglamp   # 按你的实际路径改
git pull
pnpm install
copy .env.example .env
```

- [ ] `pnpm install` 成功（`better-sqlite3` 等需能在 Windows 上编译/下载预编译包；失败时检查 VS Build Tools）
- [ ] 编辑 `.env`（至少）：

```env
HF_ENDPOINT=https://hf-mirror.com
BLUELAMP_RAG_PORT=3847
VITE_RAG_SERVER_URL=http://127.0.0.1:3847

# 远端 Ollama（也可稍后在 Settings UI 里改，确定后立即生效）
BLUELAMP_OLLAMA_URL=http://<OLLAMA_HOST>:11434
BLUELAMP_OLLAMA_MODEL=qwen3.5:4b

# 使用远端时不要优先本地 GGUF
# BLUELAMP_USE_LOCAL_LLM=true
# BLUELAMP_PREFER_LOCAL_LLM=true
```

- [ ] 下载嵌入等本地模型（生成可走远端，但 BGE-M3 仍要本机）：

```powershell
$env:HF_ENDPOINT="https://hf-mirror.com"
pnpm models:ensure
```

- [ ] 健康检查后端（见下一节启动后）：

```powershell
curl http://127.0.0.1:3847/health
```

---

## 3. 运行方式 A — 浏览器开发（最快验证业务）

两个终端，均在仓库根目录：

**终端 1 — RAG 后端**

```powershell
pnpm dev:server
```

**终端 2 — 前端**

```powershell
pnpm dev:ui
```

- [ ] 浏览器打开 `http://localhost:1420`
- [ ] Settings → Ollama：确认地址/模型，点 **确定**（立即生效；会写入 `.data/ollama-config.json`）
- [ ] Knowledge Base → Import：手填 **Windows 绝对路径**，如 `C:\Users\<you>\Documents\papers`
- [ ] 导入完成后 Chat 提问，确认引用与远端生成正常

> 浏览器模式下**没有**系统「选择文件夹」对话框，只能手填路径。要测原生选目录用方式 B。

---

## 4. 运行方式 B — Tauri 桌面壳（测选目录 / 窗口）

仍须**先起** `rag-server`（壳不会自动拉起后端）。

**终端 1**

```powershell
pnpm dev:server
```

**终端 2**

```powershell
cd apps\desktop
pnpm tauri dev
```

- [ ] 桌面窗口正常打开
- [ ] Settings → Ollama 可保存并显示连通状态
- [ ] Knowledge → Import folder → **选择文件夹** 弹出系统对话框
- [ ] 选中目录后路径为 `C:\...`，导入成功
- [ ] Chat 走远端 Ollama 正常

路径注意：`rag-server` 与 UI 都在 Windows 时，直接用 `C:\...`；不要传 WSL 的 `/mnt/c/...`。

---

## 5. 编译便携包（含 sidecar）

前置：Rust + VS Build Tools；仓库内已有 BGE-M3（`pnpm models:ensure`）；本机 `node.exe` 可被打包脚本复制。

> 说明：BGE-M3 ONNX ≈ 1.1GB，NSIS/MSI 无法可靠打包超大单文件，故首版发**便携 zip**（解压即用，多机部署同样方便）。

```powershell
cd D:\dev\raglamp
pnpm build:windows
```

步骤：`bundle:windows-sidecar` → `tauri build --no-bundle` → `package:windows-portable`。  
`rag-server` 以 zip 随附，首次启动解压到 `%APPDATA%\piFlow\sidecar\`。

- [ ] 产物：  
  `dist-windows\piFlow\` 与 `dist-windows\piFlow-0.1.0-portable.zip`
- [ ] 解压后运行 `piFlow.exe`；无需手起 `pnpm dev:server`
- [ ] 未配置 Ollama 时可导入 + 检索摘要；配置 Ollama 后可生成回答

---

## 6. Windows 验收检查表（开发态）

功能都应用方式 A 或 B 验证，不要用「仅安装包」验证。

- [ ] `pnpm install` + `pnpm models:ensure` 完成
- [ ] `pnpm dev:server` 监听 `127.0.0.1:3847`
- [ ] Ollama 远端可达；Settings 保存后立即生效
- [ ] 目录导入（方式 A 手填路径 / 方式 B 系统对话框）
- [ ] 聊天有答案 + 引用
- [ ] （可选）`pnpm tauri build` 能通过编译

---

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| `pnpm install` 原生模块失败 | 安装 VS「使用 C++ 的桌面开发」，重开终端后再装 |
| UI 正常但聊天/导入失败 | 确认终端 1 的 `rag-server` 在跑；`curl http://127.0.0.1:3847/health` |
| Ollama「暂不可达」 | 查防火墙、URL、模型名；配置仍会保存，修好服务后再聊 |
| 导入找不到文件 | server 在 Windows 用 `C:\...`；若 server 在 WSL，要用 `/mnt/c/...`，且不要混用 |
| `tauri build` 缺 WebView2/SDK | 按 [Tauri Windows 前置](https://tauri.app/start/prerequisites/) 补齐 |
| 仓库在 WSL、在 Windows 调 Tauri | 原生模块与路径易出问题；Windows 验证请用 Windows 路径下的 clone + `pnpm install` |

---

## 8. 后续增强（首版之后）

首版 MSI 已含 Node 运行时 + rag-server 目录 + BGE-M3，并由 Tauri 启停。可选后续：

- [ ] 随包 / 可选下载 OCR（PP-OCR）
- [ ] NSIS 双击安装包；CI 自动 `build:windows`
- [ ] （可选）代码签名
- [ ] 安装包体积优化（裁剪 `node-llama-cpp` / paddleocr 等未用路径）

设计参考：`docs/adr/001-tauri-sidecar.md`、`docs/architecture.md` §7.2。

---

## 9. 建议操作顺序（你切到 Windows 后照做）

1. 装 Node / pnpm /（可选）Rust + VS Build Tools + WebView2  
2. Windows 路径 clone，`pnpm install`，配置 `.env` 远端 Ollama  
3. `pnpm models:ensure`  
4. `pnpm dev:server` + `pnpm dev:ui` → 浏览器跑通导入与聊天  
5. Settings 确认 Ollama  
6. 需要测选文件夹时再 `pnpm tauri dev`  
7. 有余力再 `pnpm tauri build` 验证编译（不作为功能验收）

---

*文档版本：v0.1 · 与当前仓库状态一致（无 Windows sidecar）*
