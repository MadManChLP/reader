mod commands;

use commands::{filesystem, http, dialog, window, secrets, oidc};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK renders a blank white window on many Linux setups — notably
    // Arch-based distros (Nyarch, EndeavourOS, …) with recent Mesa/NVIDIA
    // drivers — because its DMABUF-backed accelerated renderer is broken in the
    // system WebKit build. The webview process is alive and the JS runs; only
    // the paint fails. Disabling the DMABUF renderer forces a working GL/SW
    // path. Must be set before the webview initializes (i.e. here, first thing).
    // We only set it when the user hasn't provided their own value, so anyone
    // who needs the accelerated path can still override it from the environment.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        // Delivers mediamaster:// OIDC callbacks on iOS (scheme registered in
        // the generated Info.plist by the CI workflow). No desktop schemes are
        // configured, so this changes nothing on Windows/Linux/macOS.
        .plugin(tauri_plugin_deep_link::init());

    // Haptic feedback (tab taps, gesture thresholds) — mobile-only plugin;
    // the JS wrapper (src/utils/haptics.ts) no-ops everywhere else
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    // System media volume (Now Playing slider) — mobile-only in-repo plugin;
    // the JS wrapper (src/utils/systemVolume.ts) hides the UI elsewhere
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_system_volume::init());

    // Saves window geometry (size, position/monitor, maximized, fullscreen)
    // on close and restores it on the next launch — desktop-only plugin
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .setup(|app| {
            // Config windows already exist here, and window-state has restored
            // them — apply the wrong-monitor workaround for maximized windows.
            #[cfg(desktop)]
            fix_maximized_monitor(app.handle());
            #[cfg(windows)]
            allow_media_permission(app.handle());
            // Linux: the taskbar/dock icon is otherwise a blank placeholder
            // (GTK doesn't pick up an icon unless a matching .desktop is
            // installed). Set the window icon explicitly so _NET_WM_ICON is
            // populated and the real app icon shows regardless of install method.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(tauri::include_image!("icons/128x128.png"));
                }
            }
            // Clear leftover temp downloads (old installers already launched,
            // temp books) at startup — nothing is in use yet, so removing them
            // all is safe. Done off-thread so fs I/O never delays window show.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    http::purge_temp_downloads_dir(&handle, 0);
                });
            }
            let _ = app;
            Ok(())
        })
        .manage(http::HttpState {
            // Secure client (validates SSL) - used by default
            client: http::create_client(),
            // Insecure client (ignores SSL errors) - only used when explicitly requested
            insecure_client: http::create_insecure_client(),
            // No-redirect clients (return 3xx + Location) - used for OIDC login flows
            no_redirect_client: http::create_no_redirect_client(),
            no_redirect_insecure_client: http::create_no_redirect_insecure_client(),
            cancelled_downloads: std::sync::Mutex::new(std::collections::HashSet::new()),
        })
        .register_asynchronous_uri_scheme_protocol("book-file", |ctx, request, responder| {
            // Get app handle for path validation
            let app_handle = ctx.app_handle().clone();
            // Blocking file I/O on the shared tokio blocking pool — avoids spawning
            // a fresh OS thread per request (EPUB/manga readers issue many small ones)
            tauri::async_runtime::spawn_blocking(move || {
                let response = handle_book_file_protocol(&request, &app_handle);
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            // Filesystem commands
            filesystem::read_file_binary,
            filesystem::write_file,
            filesystem::read_directory,
            filesystem::create_directory,
            filesystem::delete_directory,
            filesystem::delete_file,
            filesystem::file_exists,
            filesystem::get_cache_path,
            filesystem::get_default_path,
            filesystem::clear_cache,
            filesystem::download_file,
            filesystem::list_directory_names,
            filesystem::list_archive,
            filesystem::extract_archive_entry,
            // HTTP commands
            http::api_request,
            http::download_to_temp,
            http::cancel_download,
            http::purge_temp_downloads,
            // Secret storage (OS credential store)
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            // OIDC login window (Audiobookshelf / Authentik)
            oidc::open_oidc_window,
            oidc::open_external,
            oidc::run_installer,
            oidc::apply_linux_update,
            oidc::apply_pacman_update,
            // Dialog commands
            dialog::select_folder,
            dialog::save_file_dialog,
            // Window commands
            window::minimize_window,
            window::maximize_window,
            window::close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// tauri-plugin-window-state restores a maximized window by first moving it to
/// its pre-maximize position (prev_x/prev_y) and then maximizing — so it ends up
/// maximized on whatever monitor the window was on BEFORE it was maximized, not
/// the monitor it was closed on. The saved x/y of a maximized window IS the
/// maximized origin (correct monitor), so if the plugin picked a different
/// monitor, re-maximize there. The plugin's Moved listener then records the
/// corrected positions, so the state heals itself for future launches.
#[cfg(desktop)]
fn fix_maximized_monitor(app: &tauri::AppHandle) {
    use tauri::{Manager, PhysicalPosition};

    let Some(window) = app.get_webview_window("main") else { return };
    if !window.is_maximized().unwrap_or(false) {
        return;
    }

    // The plugin doesn't expose its cache — read the saved x/y from its file
    let Ok(config_dir) = app.path().app_config_dir() else { return };
    let path = config_dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);
    let Ok(raw) = std::fs::read(path) else { return };
    let Ok(states) = serde_json::from_slice::<serde_json::Value>(&raw) else { return };
    let (Some(x), Some(y)) = (
        states.pointer("/main/x").and_then(|v| v.as_i64()),
        states.pointer("/main/y").and_then(|v| v.as_i64()),
    ) else {
        return;
    };

    // Nudge inside the frame: the maximized origin sits slightly outside the
    // monitor on Windows (e.g. (1912, -8)) due to invisible resize borders
    let (px, py) = (x as i32 + 32, y as i32 + 32);

    let Ok(monitors) = window.available_monitors() else { return };
    let target = monitors.into_iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        px >= pos.x
            && px < pos.x + size.width as i32
            && py >= pos.y
            && py < pos.y + size.height as i32
    });
    // Saved monitor no longer connected — keep whatever the OS picked
    let Some(target) = target else { return };

    let current = window.current_monitor().ok().flatten();
    if current
        .map(|c| c.position() == target.position())
        .unwrap_or(false)
    {
        return; // already maximized on the right monitor
    }

    let _ = window.unmaximize();
    let _ = window.set_position(PhysicalPosition::new(
        target.position().x + 64,
        target.position().y + 64,
    ));
    let _ = window.maximize();
}

/// Auto-grant microphone permission requests from the webview. The audio
/// output picker (Settings → Advanced) runs a transient getUserMedia() purely
/// to unlock device labels in enumerateDevices() — without media permission
/// Chromium hides all output devices behind one unlabeled placeholder.
/// WebView2 never persists its permission prompt decisions, so without this
/// handler the user would get a mic prompt on every enumeration.
#[cfg(windows)]
fn allow_media_permission(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        );
    });
}

// Maximum chunk size for range requests (4MB) — used by video/audio streaming
const MAX_CHUNK_SIZE: u64 = 4 * 1024 * 1024;

/// Handle the book-file:// protocol for serving local files
/// Supports HTTP Range requests for efficient streaming of large files
fn handle_book_file_protocol(request: &tauri::http::Request<Vec<u8>>, app_handle: &tauri::AppHandle) -> tauri::http::Response<Vec<u8>> {
    use std::fs::File;
    use std::io::{Read, Seek, SeekFrom};
    use std::path::Path;

    let uri = request.uri().to_string();
    #[cfg(debug_assertions)]
    println!("[Protocol] book-file request: {}", uri);

    // Parse the path from the URI
    let path = match decode_book_file_path(&uri) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[Protocol] Parsing error: {}", e);
            return tauri::http::Response::builder()
                .status(404)
                .body(format!("File not found: {}", e).into_bytes())
                .unwrap();
        }
    };

    #[cfg(debug_assertions)]
    println!("[Protocol] Resolved filesystem path: {}", path);

    // Security check: verify path is within allowed directories
    let path_buf = Path::new(&path);
    if !filesystem::is_path_safe(path_buf, app_handle) {
        eprintln!("[Protocol] Security: Access denied for path: {}", path);
        return tauri::http::Response::builder()
            .status(403)
            .body("Access denied: Path is outside allowed directories".as_bytes().to_vec())
            .unwrap();
    }

    // Get file metadata
    let metadata = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[Protocol] Metadata error for {}: {}", path, e);
            return tauri::http::Response::builder()
                .status(404)
                .body(format!("File not found: {}", e).into_bytes())
                .unwrap();
        }
    };

    let file_size = metadata.len();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    // Check for Range header
    let range_header = request.headers()
        .get("Range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // No Range header: serve the entire file (fetch() expects full content)
    // Range requests are only used by <video>/<audio> tags for streaming
    if range_header.is_none() {
        match std::fs::read(&path) {
            Ok(content) => {
                return tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", &mime)
                    .header("Content-Length", content.len().to_string())
                    .header("Accept-Ranges", "bytes")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(content)
                    .unwrap();
            }
            Err(e) => {
                eprintln!("Failed to read file {}: {}", path, e);
                return tauri::http::Response::builder()
                    .status(404)
                    .body(format!("File not found: {}", e).into_bytes())
                    .unwrap();
            }
        }
    }

    // Range header present: serve requested chunk (for video/audio streaming)
    let (start, end) = match parse_range_header(&range_header, file_size) {
        Ok((s, e)) => (s, e),
        Err(_) => {
            // Invalid range - return 416 Range Not Satisfiable
            return tauri::http::Response::builder()
                .status(416)
                .header("Content-Range", format!("bytes */{}", file_size))
                .body(Vec::new())
                .unwrap();
        }
    };

    // Limit chunk size
    let end = std::cmp::min(end, start + MAX_CHUNK_SIZE - 1);
    let end = std::cmp::min(end, file_size - 1);

    // Read the requested range
    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Failed to open file {}: {}", path, e);
            return tauri::http::Response::builder()
                .status(404)
                .body(format!("File not found: {}", e).into_bytes())
                .unwrap();
        }
    };

    if let Err(e) = file.seek(SeekFrom::Start(start)) {
        eprintln!("Failed to seek in file {}: {}", path, e);
        return tauri::http::Response::builder()
            .status(500)
            .body(format!("Seek error: {}", e).into_bytes())
            .unwrap();
    }

    let length = (end - start + 1) as usize;
    let mut buffer = vec![0u8; length];

    match file.read_exact(&mut buffer) {
        Ok(_) => {
            let content_range = format!("bytes {}-{}/{}", start, end, file_size);

            // Use 206 Partial Content for range requests, 200 for full file
            let status = if start == 0 && end == file_size - 1 { 200 } else { 206 };

            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", &mime)
                .header("Content-Length", length.to_string())
                .header("Content-Range", content_range)
                .header("Accept-Ranges", "bytes")
                .header("Access-Control-Allow-Origin", "*")
                .body(buffer)
                .unwrap()
        }
        Err(e) => {
            eprintln!("Failed to read file {}: {}", path, e);
            tauri::http::Response::builder()
                .status(500)
                .body(format!("Read error: {}", e).into_bytes())
                .unwrap()
        }
    }
}

/// Parse HTTP Range header
/// Returns (start, end) byte positions
fn parse_range_header(range_header: &Option<String>, file_size: u64) -> Result<(u64, u64), ()> {
    match range_header {
        Some(range) => {
            // Parse "bytes=start-end" or "bytes=start-" or "bytes=-suffix"
            let range = range.trim();
            if !range.starts_with("bytes=") {
                return Err(());
            }

            let range_spec = &range[6..]; // Remove "bytes=" prefix
            let parts: Vec<&str> = range_spec.split('-').collect();

            if parts.len() != 2 {
                return Err(());
            }

            let start: u64;
            let end: u64;

            if parts[0].is_empty() {
                // Suffix range: "-500" means last 500 bytes
                let suffix: u64 = parts[1].parse().map_err(|_| ())?;
                start = file_size.saturating_sub(suffix);
                end = file_size - 1;
            } else if parts[1].is_empty() {
                // Open-ended range: "500-" means from byte 500 to end
                start = parts[0].parse().map_err(|_| ())?;
                end = file_size - 1;
            } else {
                // Closed range: "0-499"
                start = parts[0].parse().map_err(|_| ())?;
                end = parts[1].parse().map_err(|_| ())?;
            }

            // Validate range
            if start > end || start >= file_size {
                return Err(());
            }

            Ok((start, std::cmp::min(end, file_size - 1)))
        }
        None => {
            // No range header - return first chunk for large files
            Ok((0, std::cmp::min(MAX_CHUNK_SIZE - 1, file_size - 1)))
        }
    }
}

/// Decode a book-file:// URL into a filesystem path
/// Handles various URI formats:
///   book-file://C:/Users/...
///   book-file:///C:/Users/...
///   book-file://localhost/C:/Users/...
///   http://book-file.localhost/C:/Users/...
fn decode_book_file_path(uri: &str) -> Result<String, String> {
    // Remove the protocol prefix (handle multiple formats)
    let path = uri
        .strip_prefix("http://book-file.localhost/")
        .or_else(|| uri.strip_prefix("https://book-file.localhost/"))
        .or_else(|| uri.strip_prefix("book-file://localhost/"))
        .or_else(|| uri.strip_prefix("book-file://"))
        .ok_or_else(|| format!("Invalid protocol in URI: {}", uri))?;

    // URL decode
    let decoded = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .map_err(|e| format!("UTF-8 decode error: {}", e))?
        .to_string();

    // Handle Windows paths
    let mut file_path = decoded;

    // Remove leading slash if followed by drive letter (e.g., /C:/...)
    if file_path.starts_with('/') && file_path.len() > 2 {
        let chars: Vec<char> = file_path.chars().collect();
        if chars.len() > 2 && chars[1].is_ascii_alphabetic() && chars[2] == ':' {
            file_path = file_path[1..].to_string();
        }
    }

    // Normalize path separators for the current platform
    #[cfg(windows)]
    {
        file_path = file_path.replace('/', "\\");
    }

    // On Unix (iOS/Linux/macOS) absolute paths must keep their leading slash.
    // Stripping the protocol prefix above eats it whenever the path wasn't
    // percent-encoded (e.g. book-file://localhost/var/mobile/... → var/mobile/...)
    #[cfg(not(windows))]
    if !file_path.starts_with('/') {
        file_path = format!("/{}", file_path);
    }

    Ok(file_path)
}
