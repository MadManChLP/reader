use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

/// Security helper: Verify that a path is safe to access
/// A path is considered safe if it is within:
/// 1. The app's data directory (for cache, settings, etc.)
/// 2. The user's configured library directory (from settings)
/// 3. Standard document directories
///
/// This prevents path traversal attacks from the frontend
pub fn is_path_safe(path: &Path, app_handle: &AppHandle) -> bool {
    // Canonicalize the path to resolve any .. or symlinks
    // Walk up the directory tree to find the first existing ancestor
    let canonical_path = match path.canonicalize() {
        Ok(p) => p,
        // If the path doesn't exist yet (for writes), walk up to find an existing ancestor
        Err(_) => {
            let mut ancestor = path.to_path_buf();
            let mut suffix_parts: Vec<std::ffi::OsString> = Vec::new();
            loop {
                if let Some(parent) = ancestor.parent() {
                    if let Some(name) = ancestor.file_name() {
                        suffix_parts.push(name.to_os_string());
                    }
                    ancestor = parent.to_path_buf();
                    if let Ok(canonical_ancestor) = ancestor.canonicalize() {
                        // Rebuild the path from the canonical ancestor + remaining parts
                        let mut result = canonical_ancestor;
                        for part in suffix_parts.into_iter().rev() {
                            result = result.join(part);
                        }
                        break result;
                    }
                } else {
                    return false; // Reached root without finding an existing ancestor
                }
            }
        }
    };

    // 1. Check if within app data directory
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        if let Ok(canonical_app_data) = app_data_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_app_data) {
                return true;
            }
        }
        // Also allow if app data dir doesn't exist yet but path would be under it
        if canonical_path.starts_with(&app_data_dir) {
            return true;
        }
    }

    // 1b. Check if within app cache directory (cover cache etc.; on iOS this
    // is the sandbox Caches dir, which may live outside app_data_dir)
    if let Ok(app_cache_dir) = app_handle.path().app_cache_dir() {
        if let Ok(canonical_cache) = app_cache_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_cache) {
                return true;
            }
        }
        if canonical_path.starts_with(&app_cache_dir) {
            return true;
        }
    }

    // 2. Check if within user's documents directory (default library location)
    // Desktop only: mobile apps are sandboxed to their container
    #[cfg(desktop)]
    if let Some(docs_dir) = dirs::document_dir() {
        if let Ok(canonical_docs) = docs_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_docs) {
                return true;
            }
        }
    }

    // 2b. App's Documents directory via the Tauri path resolver — allowed on
    // ALL platforms. On iOS this is the app-sandbox Documents folder (exposed
    // to the Files app) where get_default_path now puts downloads; the
    // dirs::document_dir() check above is desktop-only and never covers it, so
    // without this every iOS download fails the path-safety check.
    if let Ok(docs_dir) = app_handle.path().document_dir() {
        if let Ok(canonical_docs) = docs_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_docs) {
                return true;
            }
        }
        // Also allow before the directory exists (path built but not created yet).
        if canonical_path.starts_with(&docs_dir) {
            return true;
        }
    }

    // 3. Check if within user's downloads directory (common download location)
    #[cfg(desktop)]
    if let Some(downloads_dir) = dirs::download_dir() {
        if let Ok(canonical_downloads) = downloads_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_downloads) {
                return true;
            }
        }
    }

    // 4. Check if within user's home directory library subdirectory
    #[cfg(desktop)]
    if let Some(home_dir) = dirs::home_dir() {
        let library_subdir = home_dir.join("Calibre Reader Library");
        if canonical_path.starts_with(&library_subdir) {
            return true;
        }
    }

    // 5. Check if within the system temp directory (for downloadToTemp files)
    {
        let temp_dir = std::env::temp_dir();
        if let Ok(canonical_temp) = temp_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_temp) {
                return true;
            }
        }
        if canonical_path.starts_with(&temp_dir) {
            return true;
        }
    }

    // 7. Check if within the default download directory (./dl relative to cwd)
    // Desktop only: current_dir() is not meaningful inside the iOS sandbox
    #[cfg(desktop)]
    if let Ok(cwd) = std::env::current_dir() {
        let dl_dir = cwd.join("dl");
        if let Ok(canonical_dl) = dl_dir.canonicalize() {
            if canonical_path.starts_with(&canonical_dl) {
                return true;
            }
        }
        if canonical_path.starts_with(&dl_dir) {
            return true;
        }
    }

    // 8. Load user's custom library path from localStorage settings (if configured)
    // This is stored in the app's data directory as appSettings
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let settings_path = app_data_dir.join("appSettings.json");
        if settings_path.exists() {
            if let Ok(content) = fs::read_to_string(&settings_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(download_path) = json.get("downloadPath").and_then(|v| v.as_str()) {
                        let custom_library = PathBuf::from(download_path);
                        if let Ok(canonical_library) = custom_library.canonicalize() {
                            if canonical_path.starts_with(&canonical_library) {
                                return true;
                            }
                        }
                        // Also check non-canonicalized for paths that don't exist yet
                        if canonical_path.starts_with(&custom_library) {
                            return true;
                        }
                    }
                }
            }
        }
    }

    // Path is not within any allowed directory
    false
}

/// Wrapper that returns a FileResult error if path is unsafe
fn check_path_safety(path: &str, app_handle: &AppHandle) -> Result<(), FileResult> {
    let path = Path::new(path);
    if !is_path_safe(path, app_handle) {
        return Err(FileResult {
            success: false,
            data: None,
            error: Some("Access denied: Path is outside allowed directories".to_string()),
            path: None,
        });
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FileResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct LocalBook {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub book_type: String,
    pub cover: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct WriteFileConfig {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct DownloadFileConfig {
    pub url: String,
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(default)]
    pub headers: Option<std::collections::HashMap<String, String>>,
    /// Set to true to allow insecure SSL connections (self-signed certificates)
    #[serde(rename = "allowInsecureSsl", default)]
    pub allow_insecure_ssl: bool,
}

/// Read a file and return its raw bytes.
/// Uses tauri::ipc::Response so the bytes travel over the IPC channel directly —
/// no base64 encoding in Rust and no atob() decode in JS (≈2.7x less transient
/// memory and far less CPU for large files like archives and covers).
#[tauri::command]
pub async fn read_file_binary(file_path: String, app_handle: AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = Path::new(&file_path);
    if !is_path_safe(path, &app_handle) {
        return Err("Access denied: Path is outside allowed directories".to_string());
    }

    match fs::read(&file_path) {
        Ok(content) => Ok(tauri::ipc::Response::new(content)),
        Err(e) => Err(e.to_string()),
    }
}

/// Write content to a file
#[tauri::command]
pub async fn write_file(config: WriteFileConfig, app_handle: AppHandle) -> FileResult {
    // Security check: verify path is within allowed directories
    if let Err(result) = check_path_safety(&config.path, &app_handle) {
        return result;
    }

    match fs::write(&config.path, &config.content) {
        Ok(_) => FileResult {
            success: true,
            data: None,
            error: None,
            path: None,
        },
        Err(e) => FileResult {
            success: false,
            data: None,
            error: Some(e.to_string()),
            path: None,
        },
    }
}

/// Read directory contents, looking for book files and metadata
#[tauri::command]
pub async fn read_directory(dir_path: String, app_handle: AppHandle) -> Vec<LocalBook> {
    let mut books = Vec::new();
    let path = Path::new(&dir_path);

    // Security check: verify path is within allowed directories
    if !is_path_safe(path, &app_handle) {
        return books;
    }

    if !path.exists() || !path.is_dir() {
        return books;
    }

    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return books,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if entry_path.is_file() {
            // Flat file support
            if is_book_file(&file_name) {
                books.push(LocalBook {
                    name: file_name,
                    path: entry_path.to_string_lossy().to_string(),
                    book_type: "local".to_string(),
                    cover: String::new(),
                    author: String::new(),
                    metadata: None,
                });
            }
        } else if entry_path.is_dir() {
            // Folder support (check for book file + metadata)
            if let Some(book) = read_book_folder(&entry_path) {
                books.push(book);
            }
        }
    }

    books
}

fn is_book_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".epub")
        || lower.ends_with(".pdf")
        || lower.ends_with(".cbr")
        || lower.ends_with(".cbz")
        || lower.ends_with(".cbt")
}

fn read_book_folder(folder: &Path) -> Option<LocalBook> {
    let entries = fs::read_dir(folder).ok()?;
    let entries: Vec<_> = entries.flatten().collect();

    // Find book file
    let book_entry = entries.iter().find(|e| {
        let name = e.file_name().to_string_lossy().to_string();
        is_book_file(&name)
    })?;

    let book_file = book_entry.file_name().to_string_lossy().to_string();
    let book_path = book_entry.path();

    // Find cover file
    let cover_entry = entries.iter().find(|e| {
        let name = e.file_name().to_string_lossy().to_lowercase();
        name.starts_with("cover.") && (name.ends_with(".jpg") || name.ends_with(".jpeg") || name.ends_with(".png"))
    });

    let cover = cover_entry
        .map(|e| {
            let path = e.path().to_string_lossy().replace('\\', "/");
            format!("book-file://{}", path)
        })
        .unwrap_or_default();

    // Find metadata file
    let metadata_entry = entries.iter().find(|e| {
        e.file_name().to_string_lossy() == "metadata.json"
    });

    let (title, author, metadata) = if let Some(meta_entry) = metadata_entry {
        match fs::read_to_string(meta_entry.path()) {
            Ok(content) => {
                let json: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
                let title = json.get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| book_file.clone());
                let author = json.get("author")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                (title, author, Some(json))
            }
            Err(_) => (book_file.clone(), String::new(), None),
        }
    } else {
        (book_file.clone(), String::new(), None)
    };

    Some(LocalBook {
        name: title,
        path: book_path.to_string_lossy().to_string(),
        book_type: "local".to_string(),
        cover,
        author,
        metadata,
    })
}

/// Create a directory (recursive)
#[tauri::command]
pub async fn create_directory(dir_path: String, app_handle: AppHandle) -> FileResult {
    // Security check: verify path is within allowed directories
    if let Err(result) = check_path_safety(&dir_path, &app_handle) {
        return result;
    }

    match fs::create_dir_all(&dir_path) {
        Ok(_) => FileResult {
            success: true,
            data: None,
            error: None,
            path: None,
        },
        Err(e) => FileResult {
            success: false,
            data: None,
            error: Some(e.to_string()),
            path: None,
        },
    }
}

/// Delete a directory recursively
#[tauri::command]
pub async fn delete_directory(dir_path: String, app_handle: AppHandle) -> FileResult {
    // Security check: verify path is within allowed directories
    if let Err(result) = check_path_safety(&dir_path, &app_handle) {
        return result;
    }

    match fs::remove_dir_all(&dir_path) {
        Ok(_) => FileResult {
            success: true,
            data: None,
            error: None,
            path: None,
        },
        Err(e) => FileResult {
            success: false,
            data: None,
            error: Some(e.to_string()),
            path: None,
        },
    }
}

/// Delete a single file
#[tauri::command]
pub async fn delete_file(file_path: String, app_handle: AppHandle) -> FileResult {
    // Security check: verify path is within allowed directories
    if let Err(result) = check_path_safety(&file_path, &app_handle) {
        return result;
    }

    match fs::remove_file(&file_path) {
        Ok(_) => FileResult {
            success: true,
            data: None,
            error: None,
            path: None,
        },
        Err(e) => FileResult {
            success: false,
            data: None,
            error: Some(e.to_string()),
            path: None,
        },
    }
}

/// Check if a file exists
#[tauri::command]
pub async fn file_exists(file_path: String, app_handle: AppHandle) -> bool {
    // Security check: verify path is within allowed directories
    let path = Path::new(&file_path);
    if !is_path_safe(path, &app_handle) {
        return false;
    }

    path.exists()
}

/// Get the cache path for cover images
/// Uses app data directory (always writable and in the is_path_safe allowlist)
#[tauri::command]
pub async fn get_cache_path(app: AppHandle) -> String {
    app.path().app_data_dir()
        .map(|p| p.join("cover-cache").to_string_lossy().to_string())
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .map(|p| p.join("cover-cache").to_string_lossy().to_string())
                .unwrap_or_else(|_| "cover-cache".to_string())
        })
}

/// Get the default path for book downloads.
/// Desktop/Android: the app data directory (always writable, in the allowed
/// paths list). iOS: the app's Documents directory — with UIFileSharingEnabled
/// in Info.plist this folder is browsable in the Files app, so users can reach
/// their downloads. document_dir is already an allowed path (see is_path_allowed).
#[tauri::command]
pub async fn get_default_path(app: AppHandle) -> String {
    #[cfg(target_os = "ios")]
    let base_dir = app.path().document_dir();
    #[cfg(not(target_os = "ios"))]
    let base_dir = app.path().app_data_dir();

    let dl_path = base_dir
        .map(|p| p.join("downloads"))
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .map(|p| p.join("dl"))
                .unwrap_or_else(|_| PathBuf::from("dl"))
        });

    // Create the directory if it doesn't exist
    if !dl_path.exists() {
        let _ = fs::create_dir_all(&dl_path);
    }

    dl_path.to_string_lossy().to_string()
}

/// Clear the cover cache
#[tauri::command]
pub async fn clear_cache(app: AppHandle) -> FileResult {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.join("cover-cache"))
        .unwrap_or_else(|_| std::path::PathBuf::from("cover-cache"));

    if cache_dir.exists() {
        match fs::remove_dir_all(&cache_dir) {
            Ok(_) => FileResult {
                success: true,
                data: None,
                error: None,
                path: None,
            },
            Err(e) => FileResult {
                success: false,
                data: None,
                error: Some(e.to_string()),
                path: None,
            },
        }
    } else {
        FileResult {
            success: true,
            data: None,
            error: None,
            path: None,
        }
    }
}

/// Download a file from URL to local filesystem
/// Uses streaming to avoid loading entire file into RAM (prevents OOM on large files)
#[tauri::command]
pub async fn download_file(
    config: DownloadFileConfig,
    state: tauri::State<'_, crate::commands::http::HttpState>,
    app_handle: AppHandle,
) -> Result<FileResult, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let file_path = Path::new(&config.folder_path).join(&config.file_name);

    // Security check: verify path is within allowed directories
    if !is_path_safe(&file_path, &app_handle) {
        return Ok(FileResult {
            success: false,
            data: None,
            error: Some("Access denied: Download path is outside allowed directories".to_string()),
            path: None,
        });
    }

    // Ensure directory exists
    if let Err(e) = tokio::fs::create_dir_all(&config.folder_path).await {
        return Ok(FileResult {
            success: false,
            data: None,
            error: Some(format!("Failed to create directory: {}", e)),
            path: None,
        });
    }

    // Build request using appropriate client based on SSL preference
    let client = if config.allow_insecure_ssl {
        &state.insecure_client
    } else {
        &state.client
    };
    let mut request = client.get(&config.url);

    // Add headers
    if let Some(headers) = &config.headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    // Execute request
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(FileResult {
                success: false,
                data: None,
                error: Some(format!("Request failed: {}", e)),
                path: None,
            });
        }
    };

    if !response.status().is_success() {
        return Ok(FileResult {
            success: false,
            data: None,
            error: Some(format!("HTTP error: {}", response.status())),
            path: None,
        });
    }

    // Get content length for progress reporting
    let total_bytes = response.content_length().unwrap_or(0);

    // Create output file
    let mut file = match tokio::fs::File::create(&file_path).await {
        Ok(f) => f,
        Err(e) => {
            return Ok(FileResult {
                success: false,
                data: None,
                error: Some(format!("Failed to create file: {}", e)),
                path: None,
            });
        }
    };

    // Clear any stale cancellation flag from a previous download of the same URL
    if let Ok(mut cancelled) = state.cancelled_downloads.lock() {
        cancelled.remove(&config.url);
    }

    // Stream response body directly to disk (avoids loading entire file into RAM)
    let mut stream = response.bytes_stream();
    let mut downloaded_bytes: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk_result) = stream.next().await {
        // Honor cancellation requests (cancel_download command)
        let is_cancelled = state
            .cancelled_downloads
            .lock()
            .map(|mut set| set.remove(&config.url))
            .unwrap_or(false);
        if is_cancelled {
            drop(file);
            let _ = tokio::fs::remove_file(&file_path).await;
            return Ok(FileResult {
                success: false,
                data: None,
                error: Some("Cancelled".to_string()),
                path: None,
            });
        }

        match chunk_result {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk).await {
                    // Clean up partial file on error
                    let _ = tokio::fs::remove_file(&file_path).await;
                    return Ok(FileResult {
                        success: false,
                        data: None,
                        error: Some(format!("Failed to write chunk: {}", e)),
                        path: None,
                    });
                }
                downloaded_bytes += chunk.len() as u64;

                // Emit progress every ~500KB to avoid flooding the event bus
                if downloaded_bytes - last_emit >= 512_000 || downloaded_bytes == total_bytes {
                    last_emit = downloaded_bytes;
                    let _ = app_handle.emit("download-progress", serde_json::json!({
                        "url": config.url,
                        "downloadedBytes": downloaded_bytes,
                        "totalBytes": total_bytes,
                    }));
                }
            }
            Err(e) => {
                // Clean up partial file on error
                let _ = tokio::fs::remove_file(&file_path).await;
                return Ok(FileResult {
                    success: false,
                    data: None,
                    error: Some(format!("Failed to read response chunk: {}", e)),
                    path: None,
                });
            }
        }
    }

    // Ensure all data is flushed to disk
    if let Err(e) = file.flush().await {
        return Ok(FileResult {
            success: false,
            data: None,
            error: Some(format!("Failed to flush file: {}", e)),
            path: None,
        });
    }

    Ok(FileResult {
        success: true,
        data: None,
        error: None,
        path: Some(file_path.to_string_lossy().to_string()),
    })
}

// ─── Archive commands ──────────────────────────────────────────────────────────

/// Natural sort comparison: numbers within strings are compared numerically.
/// e.g. "page9.jpg" < "page10.jpg" (instead of lexicographic "page9" > "page10").
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let mut ai = 0usize;
    let mut bi = 0usize;

    while ai < a_bytes.len() && bi < b_bytes.len() {
        let a_digit = a_bytes[ai].is_ascii_digit();
        let b_digit = b_bytes[bi].is_ascii_digit();

        if a_digit && b_digit {
            // Collect full digit run for each side
            let a_start = ai;
            while ai < a_bytes.len() && a_bytes[ai].is_ascii_digit() { ai += 1; }
            let b_start = bi;
            while bi < b_bytes.len() && b_bytes[bi].is_ascii_digit() { bi += 1; }

            let an: u64 = a[a_start..ai].parse().unwrap_or(0);
            let bn: u64 = b[b_start..bi].parse().unwrap_or(0);
            match an.cmp(&bn) {
                std::cmp::Ordering::Equal => continue,
                other => return other,
            }
        } else {
            let ac = a_bytes[ai].to_ascii_lowercase();
            let bc = b_bytes[bi].to_ascii_lowercase();
            match ac.cmp(&bc) {
                std::cmp::Ordering::Equal => { ai += 1; bi += 1; }
                other => return other,
            }
        }
    }

    a_bytes.len().cmp(&b_bytes.len())
}

/// List image file names in a ZIP/CBZ archive, sorted in natural order.
/// Only returns files with image extensions (jpg, jpeg, png, webp, gif).
/// Does NOT decompress any entry — reads the ZIP central directory only.
#[tauri::command]
pub async fn list_archive(path: String, app_handle: AppHandle) -> Result<Vec<String>, String> {
    let path_obj = Path::new(&path);
    if !is_path_safe(path_obj, &app_handle) {
        return Err("Access denied: Path is outside allowed directories".to_string());
    }

    let file = fs::File::open(path_obj)
        .map_err(|e| format!("Failed to open archive: {}", e))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP: {}", e))?;

    // Use a for loop — iterator chains cannot hold the borrowed ZipFile across iterations
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index_raw(i) {
            if !entry.is_dir() {
                let name = entry.name().to_string();
                let lower = name.to_lowercase();
                if lower.ends_with(".jpg")
                    || lower.ends_with(".jpeg")
                    || lower.ends_with(".png")
                    || lower.ends_with(".webp")
                    || lower.ends_with(".gif")
                {
                    names.push(name);
                }
            }
        }
    }

    names.sort_by(|a, b| natural_cmp(a, b));
    Ok(names)
}

/// Extract and decompress a single entry from a ZIP/CBZ archive.
/// Returns the raw bytes via tauri::ipc::Response (no base64 round-trip).
/// Uses Rust's compiled DEFLATE — significantly faster than JavaScript-based decompression.
#[tauri::command]
pub async fn extract_archive_entry(
    path: String,
    entry: String,
    app_handle: AppHandle,
) -> Result<tauri::ipc::Response, String> {
    use std::io::Read;

    let path_obj = Path::new(&path);
    if !is_path_safe(path_obj, &app_handle) {
        return Err("Access denied: Path is outside allowed directories".to_string());
    }

    let file = fs::File::open(path_obj)
        .map_err(|e| format!("Failed to open archive: {}", e))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP: {}", e))?;

    let mut zip_entry = archive.by_name(&entry)
        .map_err(|e| format!("Entry '{}' not found: {}", entry, e))?;

    let mut bytes = Vec::with_capacity(zip_entry.size() as usize);
    Read::read_to_end(&mut zip_entry, &mut bytes)
        .map_err(|e| format!("Failed to decompress entry: {}", e))?;

    Ok(tauri::ipc::Response::new(bytes))
}

/// List file names (not subdirectories) in a directory.
/// Returns only the file names, not full paths. Used by the cover cache to build
/// an in-memory index with a single IPC call instead of one call per file.
#[tauri::command]
pub async fn list_directory_names(dir_path: String, app_handle: AppHandle) -> Vec<String> {
    let path = Path::new(&dir_path);
    if !is_path_safe(path, &app_handle) {
        return vec![];
    }
    if !path.exists() || !path.is_dir() {
        return vec![];
    }
    match fs::read_dir(path) {
        Ok(entries) => entries
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(_) => vec![],
    }
}
