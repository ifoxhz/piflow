use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hide console window for console-subsystem children (node.exe) on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct RagServerState(Mutex<Option<Child>>);

const RAG_PORT: &str = "3847";

fn emit_status(app: &AppHandle, phase: &str, detail: &str) {
    let _ = app.emit(
        "sidecar-status",
        serde_json::json!({ "phase": phase, "detail": detail }),
    );
}

fn kill_rag_server(app: &AppHandle) {
    let state = app.state::<RagServerState>();
    let child = state.0.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("[rag-sidecar] stopped");
    }
}

/// Prefer the folder next to piFlow.exe for portable layout (runtime/, rag-server.zip, seed/).
fn resolve_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let portable_zip = dir.join("rag-server.zip");
            let portable_node = dir.join("runtime").join("node.exe");
            if portable_zip.exists() || portable_node.exists() {
                eprintln!("[rag-sidecar] resource_dir(exe)={}", dir.display());
                return Ok(dir.to_path_buf());
            }
        }
    }
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    eprintln!("[rag-sidecar] resource_dir(tauri)={}", dir.display());
    Ok(dir)
}

/// Windows MAX_PATH / locked native modules often break fs::remove_dir_all.
fn remove_dir_robust(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if fs::remove_dir_all(path).is_ok() {
        return Ok(());
    }
    let raw = path.to_string_lossy();
    let long = if raw.starts_with(r"\\?\") {
        raw.to_string()
    } else {
        format!(r"\\?\{raw}")
    };
    let status = Command::new("cmd")
        .args(["/C", "rmdir", "/S", "/Q", &long])
        .status()
        .map_err(|e| format!("rmdir {}: {e}", path.display()))?;
    if path.exists() {
        return Err(format!(
            "failed to remove {} (status {status})",
            path.display()
        ));
    }
    Ok(())
}

fn entry_ok(rag_dir: &Path) -> bool {
    let entry = rag_dir.join("dist").join("index.js");
    let entry_meta = match fs::metadata(&entry) {
        Ok(meta) if meta.is_file() && meta.len() > 64 => meta,
        _ => return false,
    };
    let _ = entry_meta;
    // Workspace packages must ship compiled JS (tsx source paths break in portable Node).
    let pg_actions = rag_dir
        .join("node_modules")
        .join("@bluelamp")
        .join("pg-actions")
        .join("dist")
        .join("index.js");
    match fs::metadata(&pg_actions) {
        Ok(meta) if meta.is_file() && meta.len() > 64 => true,
        _ => false,
    }
}

/// Prefer system tar: the zip crate silently mishandles large Windows trees from bsdtar.
fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    remove_dir_robust(dest)?;
    fs::create_dir_all(dest).map_err(|e| format!("mkdir {}: {e}", dest.display()))?;

    let status = Command::new("tar")
        .arg("-xf")
        .arg(zip_path)
        .arg("-C")
        .arg(dest)
        .status()
        .map_err(|e| format!("spawn tar: {e}"))?;
    if !status.success() {
        let _ = remove_dir_robust(dest);
        return Err(format!(
            "tar -xf {} failed with {status}",
            zip_path.display()
        ));
    }
    if !entry_ok(dest) {
        let _ = remove_dir_robust(dest);
        return Err(format!(
            "extract incomplete: missing or empty {}",
            dest.join("dist").join("index.js").display()
        ));
    }
    Ok(())
}

fn seed_empty_database(data_dir: &Path, resource_dir: &Path) -> Result<(), String> {
    let next = data_dir.join("piflow.db");
    let legacy = data_dir.join("bluelamp.db");
    if next.exists() || legacy.exists() {
        return Ok(());
    }
    let seed = resource_dir.join("seed").join("piflow.db");
    if !seed.exists() {
        eprintln!(
            "[rag-sidecar] no seed db at {} (will create schema on first open)",
            seed.display()
        );
        return Ok(());
    }
    fs::copy(&seed, &next).map_err(|e| format!("copy seed db: {e}"))?;
    eprintln!(
        "[rag-sidecar] seeded empty database {} → {}",
        seed.display(),
        next.display()
    );
    Ok(())
}

/// Unpack rag-server.zip into %APPDATA%/piFlow/sidecar when missing or bundle version changed.
fn ensure_rag_server_dir(app: &AppHandle, resource_dir: &Path) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    let sidecar_root = data_dir.join("sidecar");
    let rag_dir = sidecar_root.join("rag-server");
    let marker = sidecar_root.join(".bundle-version");
    let zip_path = resource_dir.join("rag-server.zip");
    let bundle_info = resource_dir.join("BUNDLE_INFO.json");

    let expected = fs::read_to_string(&bundle_info).unwrap_or_else(|_| "unknown".into());
    let current = fs::read_to_string(&marker).unwrap_or_default();

    if entry_ok(&rag_dir) && current == expected {
        return Ok(rag_dir);
    }

    // Broken / partial previous extract: force clean re-extract.
    if rag_dir.exists() && !entry_ok(&rag_dir) {
        eprintln!(
            "[rag-sidecar] incomplete install at {}, re-extracting",
            rag_dir.display()
        );
        let _ = remove_dir_robust(&rag_dir);
        let _ = fs::remove_file(&marker);
    }

    if !zip_path.exists() {
        let legacy = resource_dir.join("rag-server");
        if entry_ok(&legacy) {
            return Ok(legacy);
        }
        return Err(format!(
            "missing rag-server.zip at {} and no legacy folder",
            zip_path.display()
        ));
    }

    emit_status(
        app,
        "extracting",
        "正在解压后端 / Extracting backend…",
    );
    eprintln!(
        "[rag-sidecar] extracting {} → {}",
        zip_path.display(),
        rag_dir.display()
    );
    fs::create_dir_all(&sidecar_root).map_err(|e| format!("mkdir sidecar: {e}"))?;
    extract_zip(&zip_path, &rag_dir)?;
    fs::write(&marker, &expected).map_err(|e| format!("write marker: {e}"))?;
    Ok(rag_dir)
}

fn spawn_rag_server(app: &AppHandle) -> Result<(), String> {
    emit_status(app, "starting", "正在启动服务 / Starting backend…");

    let resource_dir = resolve_resource_dir(app)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    let node = resource_dir.join("runtime").join("node.exe");
    let models_dir = resource_dir.join("models");

    if !node.exists() {
        // Dev mode: UI talks to an externally started rag-server.
        eprintln!(
            "[rag-sidecar] resources missing (dev mode?). Expect external rag-server on :{RAG_PORT}"
        );
        eprintln!("  node={}", node.display());
        emit_status(app, "dev", "dev-mode");
        return Ok(());
    }

    let rag_dir = ensure_rag_server_dir(app, &resource_dir)?;
    if !entry_ok(&rag_dir) {
        return Err(format!(
            "entry missing after extract: {}",
            rag_dir.join("dist").join("index.js").display()
        ));
    }

    fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir: {e}"))?;
    seed_empty_database(&data_dir, &resource_dir)?;
    let log_dir = data_dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|e| format!("mkdir logs: {e}"))?;
    let spawn_err_log = log_dir.join("sidecar-spawn.err.log");
    let spawn_err_file = fs::File::create(&spawn_err_log)
        .map_err(|e| format!("create spawn err log: {e}"))?;

    let entry = rag_dir.join("dist").join("index.js");
    eprintln!("[rag-sidecar] starting");
    eprintln!("  node={}", node.display());
    eprintln!("  entry={}", entry.display());
    eprintln!("  data={}", data_dir.display());
    eprintln!("  models={}", models_dir.display());

    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .current_dir(&rag_dir)
        .env("PIFLOW_RAG_PORT", RAG_PORT)
        .env("PIFLOW_DATA_DIR", &data_dir)
        .env("PIFLOW_MODELS_DIR", &models_dir)
        .env("PIFLOW_USE_LOCAL_LLM", "false")
        .env("PIFLOW_PREFER_LOCAL_LLM", "false")
        .env("PIFLOW_USE_PLEIAS", "false")
        .env("PIFLOW_PDF_OCR", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(spawn_err_file));

    let seed_db = resource_dir.join("seed").join("piflow.db");
    if seed_db.exists() {
        cmd.env("PIFLOW_SEED_DB", &seed_db);
        eprintln!("  seed={}", seed_db.display());
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn rag-server: {e}"))?;

    {
        let state = app.state::<RagServerState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    emit_status(app, "spawned", "后端已启动 / Backend spawned");
    std::thread::sleep(Duration::from_millis(1200));

    // Detect immediate crash (missing deps, bad exports, etc.).
    {
        let state = app.state::<RagServerState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let err_tail = fs::read_to_string(&spawn_err_log).unwrap_or_default();
                    let snippet = err_tail
                        .lines()
                        .rev()
                        .take(12)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n");
                    *guard = None;
                    return Err(format!(
                        "rag-server exited immediately ({status}). See {}{}",
                        spawn_err_log.display(),
                        if snippet.is_empty() {
                            String::new()
                        } else {
                            format!("\n{snippet}")
                        }
                    ));
                }
                Ok(None) => {}
                Err(e) => eprintln!("[rag-sidecar] try_wait: {e}"),
            }
        }
    }

    emit_status(app, "ready", "ready");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RagServerState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                emit_status(&handle, "preparing", "正在准备环境 / Preparing environment…");
                if let Err(err) = spawn_rag_server(&handle) {
                    eprintln!("[rag-sidecar] failed to start: {err}");
                    emit_status(&handle, "error", &err);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                kill_rag_server(app_handle);
            }
        });
}
