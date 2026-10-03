use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;

/// Minimize the main window (no-op on mobile: iOS has no window chrome)
#[tauri::command]
pub async fn minimize_window(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.minimize().map_err(|e| e.to_string())?;
        }
    }
    #[cfg(mobile)]
    let _ = app;
    Ok(())
}

/// Maximize or restore the main window (no-op on mobile)
#[tauri::command]
pub async fn maximize_window(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(window) = app.get_webview_window("main") {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(mobile)]
    let _ = app;
    Ok(())
}

/// Close the main window (no-op on mobile)
#[tauri::command]
pub async fn close_window(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    #[cfg(mobile)]
    let _ = app;
    Ok(())
}
