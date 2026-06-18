use log::{error as log_error, info as log_info};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct UpNoteNotebooksResponse {
    pub notebooks: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpNoteSyncItem {
    pub meeting_id: String,
    pub title: String,
    pub target_notebook: String,
    pub matched_by: String,
    pub action: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpNoteSyncResponse {
    pub items: Vec<UpNoteSyncItem>,
    pub sync_log_created: bool,
}

#[derive(Debug, Deserialize)]
struct BridgeSyncResponse {
    items: Vec<BridgeSyncItem>,
    sync_log_created: bool,
}

#[derive(Debug, Deserialize)]
struct BridgeSyncItem {
    meeting_id: String,
    title: String,
    target_notebook: String,
    matched_by: String,
    action: String,
    reason: String,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())
}

fn bridge_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("activeresearch/tools/meetily-upnote/meetily-upnote"))
}

fn meetily_db_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Library/Application Support/com.meetily.ai/meeting_minutes.sqlite"))
}

fn upnote_backup_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(
        "Library/Containers/com.getupnote.desktop/Data/Library/Application Support/UpNote/UpNote Backup",
    ))
}

fn config_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".meetily-upnote"))
}

fn bridge_command() -> Result<Command, String> {
    let bridge = bridge_path()?;
    if !bridge.exists() {
        return Err(format!("UpNote bridge not found at {}", bridge.display()));
    }

    let mut command = Command::new(bridge);
    command
        .arg("--meetily-db")
        .arg(meetily_db_path()?)
        .arg("--upnote-backup-dir")
        .arg(upnote_backup_dir()?)
        .arg("--config-dir")
        .arg(config_dir()?)
        .arg("--json");
    Ok(command)
}

fn run_bridge(mut command: Command) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|e| format!("Failed to run UpNote bridge: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("UpNote bridge failed: {}", detail));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn api_list_upnote_notebooks() -> Result<Vec<String>, String> {
    log_info!("Listing UpNote notebooks via integration bridge");
    let mut command = bridge_command()?;
    command.arg("list-notebooks");
    let stdout = run_bridge(command)?;
    serde_json::from_str::<UpNoteNotebooksResponse>(&stdout)
        .map(|response| response.notebooks)
        .map_err(|e| {
            log_error!("Failed to parse UpNote notebook list: {}", e);
            format!("Failed to parse UpNote notebook list: {}", e)
        })
}

#[tauri::command]
pub async fn api_sync_meeting_to_upnote(
    meeting_id: String,
    notebook: Option<String>,
    force: Option<bool>,
) -> Result<UpNoteSyncResponse, String> {
    log_info!("Syncing meeting {} to UpNote", meeting_id);
    let mut command = bridge_command()?;
    command.arg("import-one").arg("--meeting-id").arg(&meeting_id);
    if let Some(notebook) = notebook.filter(|value| !value.trim().is_empty()) {
        command.arg("--notebook").arg(notebook);
    }
    if force.unwrap_or(false) {
        command.arg("--force");
    }

    let stdout = run_bridge(command)?;
    let parsed = serde_json::from_str::<BridgeSyncResponse>(&stdout).map_err(|e| {
        log_error!("Failed to parse UpNote sync response: {}", e);
        format!("Failed to parse UpNote sync response: {}", e)
    })?;

    Ok(UpNoteSyncResponse {
        sync_log_created: parsed.sync_log_created,
        items: parsed
            .items
            .into_iter()
            .map(|item| UpNoteSyncItem {
                meeting_id: item.meeting_id,
                title: item.title,
                target_notebook: item.target_notebook,
                matched_by: item.matched_by,
                action: item.action,
                reason: item.reason,
            })
            .collect(),
    })
}
