use base64::Engine;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

/// State to hold HTTP clients (secure and insecure).
/// reqwest::Client is internally reference-counted and thread-safe — it must NOT
/// be wrapped in a Mutex, or all HTTP requests get serialized to one at a time.
pub struct HttpState {
    /// Default secure client (validates SSL certificates)
    pub client: Client,
    /// Insecure client for self-signed certificates (only used when explicitly requested)
    pub insecure_client: Client,
    /// Clients that do NOT follow redirects (return 3xx + Location to the caller).
    /// Used for OIDC flows where the client must see intermediate redirects.
    /// NOTE: each reqwest client has its own cookie jar — every step of a
    /// cookie-dependent flow must consistently use the same (no-redirect) client.
    pub no_redirect_client: Client,
    pub no_redirect_insecure_client: Client,
    /// URLs whose in-flight download should be aborted (checked per chunk in download_file).
    /// std Mutex is fine: locks are held only for a HashSet lookup, never across await.
    pub cancelled_downloads: std::sync::Mutex<std::collections::HashSet<String>>,
}

/// Mark an in-flight download (by URL) as cancelled. The streaming loop in
/// `download_file` notices on the next chunk, deletes the partial file and stops.
#[tauri::command]
pub async fn cancel_download(url: String, state: tauri::State<'_, HttpState>) -> Result<(), String> {
    state
        .cancelled_downloads
        .lock()
        .map_err(|e| e.to_string())?
        .insert(url);
    Ok(())
}

/// Connection establishment timeout for all clients. Without it, a request to
/// an unreachable host (dropped packets, e.g. iOS local-network permission
/// denied or a LAN-only server) hangs indefinitely and login screens spin
/// forever. Deliberately NOT a total-request timeout — that would kill large
/// streaming downloads.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Create a secure HTTP client that validates SSL certificates
/// This is the default and should be used for most requests
pub fn create_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .cookie_store(true)
        .build()
        .expect("Failed to create HTTP client")
}

/// Create an insecure HTTP client that accepts invalid SSL certificates
/// Only use this when the user explicitly enables "allowInsecureSsl"
pub fn create_insecure_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .danger_accept_invalid_certs(true)
        .cookie_store(true)
        .build()
        .expect("Failed to create insecure HTTP client")
}

/// Create a client that does not follow redirects (3xx responses are returned
/// as-is with their Location header). Cookie store enabled so multi-step auth
/// flows (e.g. OIDC) keep their session cookies across calls.
pub fn create_no_redirect_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(true)
        .build()
        .expect("Failed to create no-redirect HTTP client")
}

/// No-redirect variant that also accepts invalid SSL certificates
pub fn create_no_redirect_insecure_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(true)
        .cookie_store(true)
        .build()
        .expect("Failed to create no-redirect insecure HTTP client")
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
pub struct RequestConfig {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(rename = "responseType", default)]
    pub response_type: Option<String>,
    /// Set to true to allow insecure SSL connections (self-signed certificates)
    /// WARNING: Only enable this for trusted self-hosted servers
    #[serde(rename = "allowInsecureSsl", default)]
    pub allow_insecure_ssl: bool,
    /// Set to false to receive 3xx responses instead of following them
    /// (needed for OIDC flows that must inspect the Location header)
    #[serde(rename = "followRedirects", default = "default_true")]
    pub follow_redirects: bool,
}

#[derive(Serialize)]
pub struct ApiResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Make an HTTP request, bypassing CORS and supporting cookies
/// By default, SSL certificates are validated. Set `allowInsecureSsl: true` in the config
/// to allow self-signed certificates (only for trusted self-hosted servers).
#[tauri::command]
pub async fn api_request(
    config: RequestConfig,
    state: tauri::State<'_, HttpState>,
) -> Result<ApiResponse, String> {
    // Parse method
    let method = match config.method.to_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        "PATCH" => Method::PATCH,
        "HEAD" => Method::HEAD,
        "OPTIONS" => Method::OPTIONS,
        _ => Method::GET,
    };

    #[cfg(debug_assertions)]
    println!("[Rust API] {} {}", method, config.url);

    // Choose the appropriate client based on SSL and redirect preference
    let client: &Client = match (config.follow_redirects, config.allow_insecure_ssl) {
        (true, false) => &state.client,
        (true, true) => &state.insecure_client,
        (false, false) => &state.no_redirect_client,
        (false, true) => &state.no_redirect_insecure_client,
    };

    // Build request
    let mut request = client.request(method.clone(), &config.url);

    // Add a default User-Agent if not provided to avoid blocks by some servers
    if !config.headers.as_ref().map(|h| h.contains_key("User-Agent")).unwrap_or(false) {
        request = request.header("User-Agent", "Reader/1.0.0 (Tauri; Windows)");
    }

    // Add headers
    if let Some(headers) = &config.headers {
        for (key, value) in headers {
            if key.to_lowercase() != "content-length" && key.to_lowercase() != "host" {
                request = request.header(key, value);
            }
        }
    }

    // Add body only for methods that support it (not GET or HEAD)
    if method != Method::GET && method != Method::HEAD {
        if let Some(data) = &config.data {
            // Only add the body if it's not a JSON null
            if !data.is_null() {
                request = request.json(data);
            }
        }
    }

    // Execute request
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Rust API] Request failed: {}", e);
            return Ok(ApiResponse {
                success: false,
                data: None,
                status: 0,
                headers: None,
                error: Some(e.to_string()),
            });
        }
    };

    let status = response.status().as_u16();
    let success = response.status().is_success();
    
    if !success {
        eprintln!("[Rust API] Server returned error: {}", status);
    }

    // Collect response headers
    let response_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // Get response body
    let is_arraybuffer = config.response_type.as_deref() == Some("arraybuffer");

    let data = if is_arraybuffer {
        // Return as base64 for binary data
        match response.bytes().await {
            Ok(bytes) => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                Some(serde_json::Value::String(b64))
            }
            Err(e) => {
                eprintln!("[Rust API] Failed to read binary response: {}", e);
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    status,
                    headers: Some(response_headers),
                    error: Some(format!("Failed to read response: {}", e)),
                });
            }
        }
    } else {
        // Try to parse as JSON, fall back to text
        match response.text().await {
            Ok(text) => {
                // Try JSON first
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    Some(json)
                } else {
                    Some(serde_json::Value::String(text))
                }
            }
            Err(e) => {
                eprintln!("[Rust API] Failed to read text response: {}", e);
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    status,
                    headers: Some(response_headers),
                    error: Some(format!("Failed to read response: {}", e)),
                });
            }
        }
    };

    Ok(ApiResponse {
        success,
        data,
        status,
        headers: Some(response_headers),
        error: None,
    })
}

#[derive(Deserialize)]
pub struct DownloadToTempConfig {
    pub url: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub extension: Option<String>,
    #[serde(rename = "allowInsecureSsl", default)]
    pub allow_insecure_ssl: bool,
}

#[derive(Serialize)]
pub struct DownloadToTempResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Download a file from URL to a temporary file, streaming to avoid OOM.
/// Returns the path to the temp file so the frontend can load it via book-file:// protocol.
/// Writes to app data dir (not system temp) to ensure book-file:// protocol can serve it.
#[tauri::command]
pub async fn download_to_temp(
    config: DownloadToTempConfig,
    state: tauri::State<'_, HttpState>,
    app_handle: tauri::AppHandle,
) -> Result<DownloadToTempResult, String> {
    // Choose the appropriate client
    let client: &Client = if config.allow_insecure_ssl {
        &state.insecure_client
    } else {
        &state.client
    };

    // Build request
    let mut request = client.get(&config.url);
    if let Some(headers) = &config.headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    // Execute request
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(DownloadToTempResult {
                success: false,
                path: None,
                status: None,
                error: Some(format!("Request failed: {}", e)),
            });
        }
    };

    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Ok(DownloadToTempResult {
            success: false,
            path: None,
            status: Some(status),
            error: Some(format!("HTTP error: {}", status)),
        });
    }

    // Create temp file in app data dir (ensures book-file:// protocol can serve it)
    let ext = config.extension.as_deref().unwrap_or("tmp");
    let temp_dir = {
        use tauri::Manager;
        match app_handle.path().app_data_dir() {
            Ok(dir) => dir.join("temp_downloads"),
            Err(_) => std::env::temp_dir(),
        }
    };
    // Ensure temp dir exists
    let _ = tokio::fs::create_dir_all(&temp_dir).await;
    let file_name = format!("reader_tmp_{}.{}", uuid_simple(), ext);
    let temp_path = temp_dir.join(&file_name);

    let mut file = match tokio::fs::File::create(&temp_path).await {
        Ok(f) => f,
        Err(e) => {
            return Ok(DownloadToTempResult {
                success: false,
                path: None,
                status: Some(status),
                error: Some(format!("Failed to create temp file: {}", e)),
            });
        }
    };

    // Stream to disk
    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk).await {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Ok(DownloadToTempResult {
                        success: false,
                        path: None,
                        status: Some(status),
                        error: Some(format!("Failed to write chunk: {}", e)),
                    });
                }
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Ok(DownloadToTempResult {
                    success: false,
                    path: None,
                    status: Some(status),
                    error: Some(format!("Failed to read response: {}", e)),
                });
            }
        }
    }

    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Ok(DownloadToTempResult {
            success: false,
            path: None,
            status: Some(status),
            error: Some(format!("Failed to flush: {}", e)),
        });
    }

    println!("[Rust API] Downloaded to temp: {}", temp_path.display());

    Ok(DownloadToTempResult {
        success: true,
        path: Some(temp_path.to_string_lossy().to_string()),
        status: Some(status),
        error: None,
    })
}

/// Resolve the temp-download directory (app_data_dir/temp_downloads) — where
/// download_to_temp streams installers and temp books.
fn temp_downloads_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    match app_handle.path().app_data_dir() {
        Ok(dir) => dir.join("temp_downloads"),
        Err(_) => std::env::temp_dir(),
    }
}

/// Remove stale files from the temp-download dir. These files are transient
/// (installer downloads that have already been launched, temp books opened for
/// reading) and otherwise accumulate forever. `max_age_secs == 0` clears
/// everything — safe at startup, when nothing is in use. Returns (count, bytes).
pub fn purge_temp_downloads_dir(app_handle: &tauri::AppHandle, max_age_secs: u64) -> (u64, u64) {
    let dir = temp_downloads_dir(app_handle);
    let mut removed = 0u64;
    let mut freed = 0u64;
    let now = std::time::SystemTime::now();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let old_enough = if max_age_secs == 0 {
                true
            } else {
                meta.modified()
                    .ok()
                    .and_then(|m| now.duration_since(m).ok())
                    .map(|d| d.as_secs() >= max_age_secs)
                    .unwrap_or(true)
            };
            if old_enough {
                let size = meta.len();
                if std::fs::remove_file(&path).is_ok() {
                    removed += 1;
                    freed += size;
                }
            }
        }
    }
    (removed, freed)
}

/// Frontend-callable purge of the temp-download dir. `max_age_secs` defaults to
/// 0 (remove everything). Returns the number of files removed.
#[tauri::command]
pub async fn purge_temp_downloads(
    app_handle: tauri::AppHandle,
    max_age_secs: Option<u64>,
) -> Result<u64, String> {
    let (removed, freed) = purge_temp_downloads_dir(&app_handle, max_age_secs.unwrap_or(0));
    if removed > 0 {
        println!("[Rust API] Purged {} temp file(s), freed {} bytes", removed, freed);
    }
    Ok(removed)
}

/// Simple unique ID generator (no external crate needed)
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", nanos)
}
