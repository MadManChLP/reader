const COMMANDS: &[&str] = &[
    "get_volume",
    "set_volume",
    "watch_volume",
    "get_brightness",
    "set_brightness",
    "restore_brightness",
];

fn main() {
    let result = tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build();

    // when building documentation for Android the plugin build result is
    // always Err() and is irrelevant to the crate documentation build
    if !(cfg!(docsrs) && std::env::var("TARGET").unwrap().contains("android")) {
        result.unwrap();
    }
}
