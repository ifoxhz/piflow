# Windows workspace status

Path: `D:\dev\raglamp` (synced from WSL working tree).

## Toolchain

- Node 24 / pnpm 10.30.2
- Rust 1.97.1
- VS Build Tools 2022 + VCTools
- Python 3.12 (needed to compile `better-sqlite3` for Node 24)
- WebView2 present
- Cargo mirror: rsproxy.cn (`%USERPROFILE%\.cargo\config.toml`)
- WiX 3.14: `%LOCALAPPDATA%\tauri\WixTools314`

## Verified

- `better-sqlite3` rebuilt on Windows
- Ollama `http://10.0.0.7:11434` reachable
- Ingest `.test-docs` (3 files) OK
- Chat with citations OK
- MSI: `apps\desktop\src-tauri\target\release\bundle\msi\RAG Assistant_0.1.0_x64_en-US.msi`

## Daily run

```powershell
powershell -ExecutionPolicy Bypass -File D:\dev\raglamp\scripts\dev-windows.ps1
```

Or two terminals in `D:\dev\raglamp`:

```powershell
pnpm dev:server
pnpm dev:ui
```

Open http://localhost:1420

Tauri (folder picker), with server already running:

```powershell
cd D:\dev\raglamp\apps\desktop
pnpm tauri dev
```

Note: Installer still has **no rag-server sidecar** — use dev mode for real work.
