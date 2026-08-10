use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hide console window for console-subsystem children (node.exe) on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct RagServerState(Mutex<Option<Child>>);

const RAG_PORT: &str = "3847";

fn kill_rag_server(app: &AppHandle) {
    let state = app.state::<RagServerState>();
    let child = state.0.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("[rag-sidecar] stopped");
    }
}

/// Windows MAX_PATH / locked native modules often break fs::remove_dir_all.
fn remove_dir_robust(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if fs::remove_dir_all(path).is_ok() {
        return Ok(());
    }
    // Fallback: cmd rmdir with extended-length prefix
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
        return Err(format!(
            "tar -xf {} failed with {status}",
            zip_path.display()
        ));
    }
    let entry = dest.join("dist").join("index.js");
    if !entry.exists() {
        return Err(format!(
            "extract missing entry point {}",
            entry.display()
        ));
    }
    Ok(())
}

/// Unpack rag-server.zip into %APPDATA%/piFlow/sidecar when missing or bundle version changed.
fn ensure_rag_server_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
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
    let entry = rag_dir.join("dist").join("index.js");

    if entry.exists() && current == expected {
        return Ok(rag_dir);
    }

    if !zip_path.exists() {
        // Dev / legacy layout: unpacked resources/rag-server
        let legacy = resource_dir.join("rag-server");
        if legacy.join("dist").join("index.js").exists() {
            return Ok(legacy);
        }
        return Err(format!(
            "missing rag-server.zip at {} and no legacy folder",
            zip_path.display()
        ));
    }

    eprintln!(
        "[rag-sidecar] extracting {} → {}",
        zip_path.display(),
        rag_dir.display()
    );
    fs::create_dir_all(&sidecar_root).map_err(|e| format!("mkdir sidecar: {e}"))?;
    extract_zip(&zip_path, &rag_dir)?;
    fs::write(&marker, expected).map_err(|e| format!("write marker: {e}"))?;
    Ok(rag_dir)
}

fn spawn_rag_server(app: &AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    let node = resource_dir.join("runtime").join("node.exe");
    let models_dir = resource_dir.join("models");

    if !node.exists() {
        eprintln!(
            "[rag-sidecar] resources missing (dev mode?). Expect external rag-server on :{RAG_PORT}"
        );
        eprintln!("  node={}", node.display());
        return Ok(());
    }

    let rag_dir = match ensure_rag_server_dir(app) {
        Ok(p) => p,
        Err(err) => {
            eprintln!("[rag-sidecar] {err}");
            return Ok(());
        }
    };
    let entry = rag_dir.join("dist").join("index.js");
    if !entry.exists() {
        eprintln!("[rag-sidecar] entry missing: {}", entry.display());
        return Ok(());
    }

    fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir: {e}"))?;

    eprintln!("[rag-sidecar] starting");
    eprintln!("  node={}", node.display());
    eprintln!("  entry={}", entry.display());
    eprintln!("  data={}", data_dir.display());
    eprintln!("  models={}", models_dir.display());

    // Console output is tee'd by rag-server into `{dataDir}/logs/rag-server.log`.
    // Do not inherit stderr (that forces a visible console on Windows).
    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .current_dir(&rag_dir)
        .env("BLUELAMP_RAG_PORT", RAG_PORT)
        .env("BLUELAMP_DATA_DIR", &data_dir)
        .env("BLUELAMP_MODELS_DIR", &models_dir)
        .env("BLUELAMP_USE_LOCAL_LLM", "false")
        .env("BLUELAMP_PREFER_LOCAL_LLM", "false")
        .env("BLUELAMP_USE_PLEIAS", "false")
        .env("BLUELAMP_PDF_OCR", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

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

    std::thread::sleep(Duration::from_millis(800));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RagServerState(Mutex::new(None)))
        .setup(|app| {
            if let Err(err) = spawn_rag_server(app.handle()) {
                eprintln!("[rag-sidecar] failed to start: {err}");
            }
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
