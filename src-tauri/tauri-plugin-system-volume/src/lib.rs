//! System media volume plugin (mobile).
//!
//! The WebView cannot control the OS volume — iOS ignores HTMLMediaElement
//! volume entirely, and element volume on Android only scales within the app.
//! This plugin exposes the real system media volume:
//!   • get_volume / set_volume — normalized 0..1
//!   • watch_volume — a Channel that receives updates when the volume changes
//!     (hardware buttons, control center, other apps)
//!
//! iOS: MPVolumeView slider (the only sanctioned programmatic setter) +
//!      AVAudioSession outputVolume KVO.
//! Android: AudioManager STREAM_MUSIC + a ContentObserver on system settings.
//! Desktop: stubs (the app registers this plugin only on mobile).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
pub use desktop::SystemVolume;
#[cfg(mobile)]
pub use mobile::SystemVolume;

/// Extension trait to access the system-volume APIs from tauri types.
pub trait SystemVolumeExt<R: Runtime> {
    fn system_volume(&self) -> &SystemVolume<R>;
}

impl<R: Runtime, T: Manager<R>> SystemVolumeExt<R> for T {
    fn system_volume(&self) -> &SystemVolume<R> {
        self.state::<SystemVolume<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("system-volume")
        .invoke_handler(tauri::generate_handler![
            commands::get_volume,
            commands::set_volume,
            commands::watch_volume,
            commands::get_brightness,
            commands::set_brightness,
            commands::restore_brightness
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let system_volume = mobile::init(app, api)?;
            #[cfg(desktop)]
            let system_volume = desktop::init(app, api)?;
            app.manage(system_volume);
            Ok(())
        })
        .build()
}
