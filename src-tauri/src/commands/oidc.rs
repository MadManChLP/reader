#[cfg(desktop)]
use std::sync::{Arc, Mutex};
#[cfg(desktop)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(desktop)]
const OIDC_WINDOW_LABEL: &str = "oidc-login";
/// How long the user gets to complete the login before the window is closed
#[cfg(desktop)]
const LOGIN_TIMEOUT_SECS: u64 = 300;

/// Opens a login window at `authorize_url` (the identity provider's page) and
/// waits until it navigates to a URL starting with `redirect_prefix` — that
/// navigation is blocked, the window closes, and the full callback URL
/// (containing `?code=...&state=...`) is returned.
///
/// Returns `Ok(None)` if the user closes the window or the timeout elapses.
#[tauri::command]
pub async fn open_oidc_window(
    app: tauri::AppHandle,
    authorize_url: String,
    redirect_prefix: String,
) -> Result<Option<String>, String> {
    // iOS/Android: multi-window is not supported; OIDC login needs a native
    // auth-session flow that doesn't exist yet (v1 limitation)
    #[cfg(mobile)]
    {
        let _ = (app, authorize_url, redirect_prefix);
        return Err("OIDC login is not supported on iOS yet".to_string());
    }

    #[cfg(desktop)]
    {
    let url: tauri::Url = authorize_url
        .parse()
        .map_err(|e| format!("Invalid authorize URL: {}", e))?;

    // Close a leftover window from a previous attempt
    if let Some(existing) = app.get_webview_window(OIDC_WINDOW_LABEL) {
        let _ = existing.close();
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    // on_navigation is Fn (not FnOnce), so the sender lives behind a Mutex<Option>
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_nav = tx.clone();
    let tx_destroyed = tx.clone();

    let window = WebviewWindowBuilder::new(&app, OIDC_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Anmelden")
        .inner_size(480.0, 720.0)
        .center()
        // Intercept navigation to the redirect URI: block it and hand the URL back
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            if url_str.starts_with(&redirect_prefix) {
                if let Some(sender) = tx_nav.lock().unwrap().take() {
                    let _ = sender.send(Some(url_str));
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("Failed to open login window: {}", e))?;

    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(sender) = tx_destroyed.lock().unwrap().take() {
                let _ = sender.send(None); // user closed the window
            }
        }
    });

    let result = match tokio::time::timeout(
        std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS),
        rx,
    )
    .await
    {
        Ok(Ok(callback_url)) => callback_url,
        // Sender dropped or timeout — treat both as cancelled
        _ => None,
    };

    if let Some(win) = app.get_webview_window(OIDC_WINDOW_LABEL) {
        let _ = win.close();
    }

    Ok(result)
    }
}

/// Open a URL in the system browser (Safari on iOS). The JS-invokable
/// `plugin:shell|open` command runs the DESKTOP implementation only (it
/// spawns an opener process — impossible inside the iOS sandbox), so it
/// rejects on mobile. The Rust-side `shell().open()` routes to the native
/// mobile plugin (UIApplication.open) instead, which is why this wrapper
/// command exists. Used by the mobile OIDC flow to hand the IdP login
/// page to Safari.
#[tauri::command]
pub async fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened externally".to_string());
    }
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app.shell()
        .open(url, None)
        .map_err(|e| format!("Failed to open the system browser: {}", e))
}

/// Launch a downloaded desktop installer/update file. Uses the shell opener so
/// the OS handles it natively: runs the .exe (Windows Inno installer), mounts
/// the .dmg (macOS), or opens the .deb/.AppImage (Linux). Only called on
/// desktop by the in-app updater — mobile updates go through SideStore (iOS)
/// or the APK download URL (Android), never this command.
#[tauri::command]
pub async fn run_installer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app.shell()
        .open(path, None)
        .map_err(|e| format!("Failed to launch installer: {}", e))
}

/// Recursively look for the `reader` executable inside an extracted update tree.
/// The portable archive lays it out as `Mediamaster/reader`, but we search a few
/// levels deep so a different top-level folder name still works. Bounded depth
/// keeps this cheap and avoids following arbitrarily nested trees.
#[cfg(target_os = "linux")]
fn find_reader_binary(dir: &std::path::Path, depth: usize) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        if path.is_file() {
            if path.file_name().and_then(|n| n.to_str()) == Some("reader") {
                return Some(path);
            }
        } else if path.is_dir() {
            subdirs.push(path);
        }
    }
    if depth > 0 {
        for d in subdirs {
            if let Some(found) = find_reader_binary(&d, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

/// Apply a downloaded Linux portable `.tar.gz` update in place: extract it, swap
/// the currently-running `reader` binary for the new one, and relaunch. Linux
/// only — used by the in-app updater for the tar.gz format that Arch and other
/// bleeding-edge distros use (the AppImage bundles a WebKit that fails on very
/// new Mesa). On success the new binary is spawned and the caller should close
/// the old process so the swap fully takes effect.
#[tauri::command]
pub async fn apply_linux_update(archive_path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        // The binary we must replace is whatever we are running from.
        let current = std::env::current_exe()
            .map_err(|e| format!("Cannot locate running binary: {}", e))?;

        // An AppImage runs from a read-only mount; current_exe() points inside
        // it, not at the .AppImage file, so an in-place swap would do nothing.
        if std::env::var_os("APPIMAGE").is_some() {
            return Err("Running as an AppImage — please download the new AppImage instead.".into());
        }

        // Extract into a fresh temp dir.
        let extract_dir = std::env::temp_dir().join(format!("mediamaster-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&extract_dir);
        std::fs::create_dir_all(&extract_dir)
            .map_err(|e| format!("Cannot create temp dir: {}", e))?;

        // `tar` is present on every Linux system, so shell out rather than pull
        // in a gzip/tar crate just for this one path.
        let status = Command::new("tar")
            .arg("xzf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&extract_dir)
            .status()
            .map_err(|e| format!("Failed to run tar: {}", e))?;
        if !status.success() {
            return Err("Extraction failed (tar returned an error).".into());
        }

        let new_bin = find_reader_binary(&extract_dir, 3)
            .ok_or_else(|| "Could not find the 'reader' binary in the update archive.".to_string())?;

        // Replace the running binary. On Linux a busy executable can be renamed
        // or unlinked while running (the old inode stays live for this process),
        // so move the old file aside, then copy the new one into its place.
        let backup = current.with_extension("old");
        let _ = std::fs::remove_file(&backup);
        if std::fs::rename(&current, &backup).is_err() {
            // rename can fail across filesystems — fall back to unlinking.
            std::fs::remove_file(&current)
                .map_err(|e| format!("Cannot replace the binary (no write permission?): {}", e))?;
        }
        if let Err(e) = std::fs::copy(&new_bin, &current) {
            // Best effort: restore the old binary so we don't leave the user
            // with nothing to run.
            let _ = std::fs::rename(&backup, &current);
            return Err(format!("Cannot write the new binary: {}", e));
        }

        // Mark the new binary executable (0o755).
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&current) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&current, perms);
        }

        // Relaunch the freshly installed binary, detached from this process.
        Command::new(&current)
            .spawn()
            .map_err(|e| format!("Update installed but relaunch failed — start it manually: {}", e))?;

        // Tidy the extraction dir. Leave the `.old` backup: this process is still
        // executing from its inode, and the next launch's binary differs anyway.
        let _ = std::fs::remove_dir_all(&extract_dir);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = archive_path;
        Err("In-place tar update is only supported on Linux.".into())
    }
}

/// Install a downloaded Arch `.pkg.tar.zst` via `pkexec pacman -U` — polkit
/// shows a graphical root prompt, pacman installs the package (updating
/// /usr/bin/reader etc.), then we relaunch. Linux only. Requires pacman +
/// polkit (pkexec); the package is unsigned so the user's pacman.conf
/// `LocalFileSigLevel` must allow it (Arch default `Optional` does).
#[tauri::command]
pub async fn apply_pacman_update(package_path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let status = Command::new("pkexec")
            .arg("pacman")
            .arg("-U")
            .arg("--noconfirm")
            .arg(&package_path)
            .status()
            .map_err(|e| format!("Could not run pkexec/pacman (are pacman and polkit installed?): {}", e))?;
        if !status.success() {
            return Err("pacman -U failed or was cancelled.".into());
        }
        // Relaunch the freshly installed binary, detached, so the swap takes
        // effect; the caller closes the old process.
        if let Ok(current) = std::env::current_exe() {
            let _ = Command::new(current).spawn();
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = package_path;
        Err("pacman update is only supported on Linux.".into())
    }
}
