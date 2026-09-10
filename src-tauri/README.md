# Tauri Backend

This directory contains the Rust backend for the Tauri version of the Reader app.

## Prerequisites

1. **Rust** - Install from https://rustup.rs/
2. **System Dependencies** (Windows):
   - Visual Studio Build Tools with C++ workload
   - WebView2 (usually pre-installed on Windows 10/11)

## Development

```bash
# From the project root
npm run tauri:dev
```

## Building

```bash
# From the project root
npm run tauri:build
```

## Project Structure

```
src-tauri/
  src/
    main.rs           # Entry point, protocol handler
    commands/
      mod.rs          # Module exports
      filesystem.rs   # File system operations
      http.rs         # HTTP client with cookies
      dialog.rs       # Native dialogs
      window.rs       # Window controls
  Cargo.toml          # Rust dependencies
  tauri.conf.json     # Tauri configuration
```

## Commands

### Filesystem
- `read_file_binary` - Read file as base64
- `write_file` - Write text file
- `read_directory` - List books in directory
- `create_directory` - Create directory
- `delete_directory` - Delete directory recursively
- `delete_file` - Delete single file
- `file_exists` - Check if file exists
- `get_cache_path` - Get cover cache directory
- `get_default_path` - Get default library path
- `clear_cache` - Clear cover cache
- `download_file` - Download file from URL

### HTTP
- `api_request` - Make HTTP request with cookie support and SSL bypass

### Dialog
- `select_folder` - Open folder picker dialog

### Window
- `minimize_window` - Minimize window
- `maximize_window` - Maximize/restore window
- `close_window` - Close window

## Custom Protocol

The `book-file://` protocol is registered to serve local files to the WebView.

Example: `book-file://C:/Users/name/Books/cover.jpg`

## SSL/TLS

Self-signed certificates are accepted by default to support self-hosted Calibre-Web instances.
