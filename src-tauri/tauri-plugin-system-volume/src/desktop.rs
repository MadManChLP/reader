// Desktop stub — the app only registers this plugin on mobile (desktop uses
// HTMLMediaElement volume + setSinkId routing instead). Present so the crate
// still compiles if it ever ends up in a desktop build.

use serde::de::DeserializeOwned;
use tauri::{ipc::Channel, plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<SystemVolume<R>> {
    Ok(SystemVolume(app.clone()))
}

pub struct SystemVolume<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> SystemVolume<R> {
    pub fn get_volume(&self) -> crate::Result<VolumeResponse> {
        Ok(VolumeResponse { volume: 1.0 })
    }

    pub fn set_volume(&self, _volume: f32) -> crate::Result<()> {
        Ok(())
    }

    pub fn watch_volume(&self, _channel: Channel) -> crate::Result<()> {
        Ok(())
    }

    pub fn get_brightness(&self) -> crate::Result<BrightnessResponse> {
        Ok(BrightnessResponse { brightness: 1.0 })
    }

    pub fn set_brightness(&self, _brightness: f32) -> crate::Result<()> {
        Ok(())
    }

    pub fn restore_brightness(&self) -> crate::Result<()> {
        Ok(())
    }
}
