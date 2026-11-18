// Secret storage for the shared LDAP password and Audiobookshelf refresh token.
//
// Desktop (Windows/macOS/Linux) and iOS use the OS credential store via the
// `keyring` crate (Credential Manager / Keychain / Secret Service).
//
// Android has NO keyring backend (the crate ships no Android store), so
// `Entry::new` fails and secrets never persist. There we fall back to a JSON
// file in the app's private data dir — sandboxed per-app storage that other
// apps cannot read without root. Same three-command interface either way, so
// the frontend (utils/tauriApi.ts) is unchanged.

/// OS credential store backend (everything except Android).
#[cfg(not(target_os = "android"))]
mod backend {
    use keyring::Entry;

    /// Service name used for all entries in the OS credential store.
    const SERVICE: &str = "com.reader.app";

    pub fn set(_app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
        entry.set_password(value).map_err(|e| e.to_string())
    }

    pub fn get(_app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(_app: &tauri::AppHandle, key: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// App-private file backend (Android only).
#[cfg(target_os = "android")]
mod backend {
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tauri::Manager;

    // Serializes concurrent read-modify-write on the secrets file.
    static LOCK: Mutex<()> = Mutex::new(());

    fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("secrets.json"))
    }

    fn read_map(path: &PathBuf) -> HashMap<String, String> {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_map(path: &PathBuf, map: &HashMap<String, String>) -> Result<(), String> {
        let data = serde_json::to_string(map).map_err(|e| e.to_string())?;
        fs::write(path, data).map_err(|e| e.to_string())
    }

    pub fn set(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let path = store_path(app)?;
        let mut map = read_map(&path);
        map.insert(key.to_string(), value.to_string());
        write_map(&path, &map)
    }

    pub fn get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let path = store_path(app)?;
        Ok(read_map(&path).get(key).cloned())
    }

    pub fn delete(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let path = store_path(app)?;
        let mut map = read_map(&path);
        map.remove(key);
        write_map(&path, &map)
    }
}

/// Store a secret. Runs on a blocking thread — the OS credential-store calls are
/// synchronous, and the Android file store does blocking I/O.
#[tauri::command]
pub async fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || backend::set(&app, &key, &value))
        .await
        .map_err(|e| e.to_string())?
}

/// Read a secret. Returns None if not present.
#[tauri::command]
pub async fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || backend::get(&app, &key))
        .await
        .map_err(|e| e.to_string())?
}

/// Delete a secret. Missing entries are not an error.
#[tauri::command]
pub async fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || backend::delete(&app, &key))
        .await
        .map_err(|e| e.to_string())?
}
