#[cfg(desktop)]
use tauri_plugin_dialog::{DialogExt, FilePath};
#[cfg(desktop)]
use std::sync::mpsc;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct SaveFileConfig {
    #[serde(rename = "defaultName")]
    pub default_name: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct SaveFileResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Open a native "Save As" dialog and write `content` to the chosen path.
/// Desktop only — mobile uses the Web Share API from the frontend instead.
#[tauri::command]
pub async fn save_file_dialog(app: tauri::AppHandle, config: SaveFileConfig) -> SaveFileResult {
    #[cfg(desktop)]
    {
        let (tx, rx) = mpsc::channel();
        app.dialog()
            .file()
            .set_file_name(&config.default_name)
            .save_file(move |result| {
                let _ = tx.send(result);
            });

        match rx.recv() {
            Ok(Some(FilePath::Path(path))) => match std::fs::write(&path, config.content.as_bytes()) {
                Ok(_) => SaveFileResult {
                    success: true,
                    path: Some(path.to_string_lossy().to_string()),
                    canceled: false,
                    error: None,
                },
                Err(e) => SaveFileResult {
                    success: false,
                    path: None,
                    canceled: false,
                    error: Some(e.to_string()),
                },
            },
            Ok(Some(_)) => SaveFileResult {
                success: false,
                path: None,
                canceled: false,
                error: Some("Unsupported save path".into()),
            },
            _ => SaveFileResult {
                success: false,
                path: None,
                canceled: true,
                error: None,
            },
        }
    }
    #[cfg(mobile)]
    {
        let _ = (app, config);
        SaveFileResult {
            success: false,
            path: None,
            canceled: false,
            error: Some("Save dialog is desktop-only".into()),
        }
    }
}

/// Open a folder selection dialog.
/// On mobile there is no folder picker (iOS apps are sandboxed to their
/// container) — returns None, which the frontend treats as "keep current path";
/// downloads use the app-container default from get_default_path.
#[tauri::command]
pub async fn select_folder(app: tauri::AppHandle) -> Option<String> {
    #[cfg(desktop)]
    {
        // Use a channel to get the result since the dialog callback is sync
        let (tx, rx) = mpsc::channel();

        app.dialog()
            .file()
            .pick_folder(move |result| {
                let _ = tx.send(result);
            });

        // Wait for dialog result
        match rx.recv() {
            Ok(Some(file_path)) => {
                match file_path {
                    FilePath::Path(path) => Some(path.to_string_lossy().to_string()),
                    _ => None,
                }
            }
            _ => None,
        }
    }
    #[cfg(mobile)]
    {
        let _ = app;
        None
    }
}
