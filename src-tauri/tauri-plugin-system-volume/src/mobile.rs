use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.systemvolume";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_system_volume);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SystemVolume<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SystemVolumePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_system_volume)?;
    Ok(SystemVolume(handle))
}

/// Access to the system-volume APIs.
pub struct SystemVolume<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SystemVolume<R> {
    pub fn get_volume(&self) -> crate::Result<VolumeResponse> {
        self.0
            .run_mobile_plugin("getVolume", ())
            .map_err(Into::into)
    }

    pub fn set_volume(&self, volume: f32) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("setVolume", SetVolumePayload { volume })
            .map_err(Into::into)
    }

    pub fn watch_volume(&self, channel: Channel) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("watchVolume", WatchVolumePayload { channel })
            .map_err(Into::into)
    }

    pub fn get_brightness(&self) -> crate::Result<BrightnessResponse> {
        self.0
            .run_mobile_plugin("getBrightness", ())
            .map_err(Into::into)
    }

    pub fn set_brightness(&self, brightness: f32) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("setBrightness", SetBrightnessPayload { brightness })
            .map_err(Into::into)
    }

    pub fn restore_brightness(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("restoreBrightness", ())
            .map_err(Into::into)
    }
}

#[derive(Serialize)]
struct SetVolumePayload {
    volume: f32,
}

#[derive(Serialize)]
struct WatchVolumePayload {
    channel: Channel,
}

#[derive(Serialize)]
struct SetBrightnessPayload {
    brightness: f32,
}
