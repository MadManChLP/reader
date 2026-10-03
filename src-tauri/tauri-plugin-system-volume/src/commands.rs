use tauri::{command, ipc::Channel, AppHandle, Runtime};

use crate::{BrightnessResponse, Result, SystemVolumeExt, VolumeResponse};

#[command]
pub(crate) async fn get_volume<R: Runtime>(app: AppHandle<R>) -> Result<VolumeResponse> {
    app.system_volume().get_volume()
}

#[command]
pub(crate) async fn set_volume<R: Runtime>(app: AppHandle<R>, volume: f32) -> Result<()> {
    app.system_volume().set_volume(volume)
}

#[command]
pub(crate) async fn watch_volume<R: Runtime>(app: AppHandle<R>, channel: Channel) -> Result<()> {
    app.system_volume().watch_volume(channel)
}

#[command]
pub(crate) async fn get_brightness<R: Runtime>(app: AppHandle<R>) -> Result<BrightnessResponse> {
    app.system_volume().get_brightness()
}

#[command]
pub(crate) async fn set_brightness<R: Runtime>(app: AppHandle<R>, brightness: f32) -> Result<()> {
    app.system_volume().set_brightness(brightness)
}

#[command]
pub(crate) async fn restore_brightness<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.system_volume().restore_brightness()
}
